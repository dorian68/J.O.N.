import { nowIso } from "../utils/ids.js";
import {
  STAGE_STATUS, PLAN_STATUS,
  findRunnableStages, findRunningStages,
  computePlanStatus, updateStageInPlan, stageForTerminal
} from "./workspace-plan.js";
import { verifyTerminalOutcome, deriveHeuristicVerdict, VERDICT } from "./semantic-terminal-verifier.js";
import { aggregatePlanState, buildPlanStatusMessage } from "./project-state-aggregator.js";
import {
  evaluateEscalationNeed, buildEscalationMessage, buildBudgetEscalationMessage,
  ESCALATION_REASON
} from "./escalation-rules.js";

const DEFAULT_BUDGET = Object.freeze({
  maxActionsPerTick: 2,
  maxNudgesPerTerminal: 3,
  maxElapsedMs: 30 * 60 * 1000,
  tickIntervalMs: 15_000
});

export class WorkspaceOrchestratorLoop {
  constructor({
    database,
    llmGateway,
    emitEvent,
    launchTerminal,
    writeTerminalInput,
    injectConversationMessage,
    auditLog = null
  }) {
    this.database = database;
    this.llmGateway = llmGateway;
    this.emitEvent = emitEvent;
    this.launchTerminal = launchTerminal;
    this.writeTerminalInput = writeTerminalInput;
    this.injectConversationMessage = injectConversationMessage;
    this.auditLog = auditLog;

    // planId → { plan, timer, nudgeCounts, startedAt, actionCount, budget }
    this.activePlans = new Map();
    this.isShuttingDown = false;
  }

  startPlan(plan, budget = {}) {
    if (this.activePlans.has(plan.id) || this.isShuttingDown) return;
    const context = {
      plan,
      nudgeCounts: new Map(),
      startedAt: Date.now(),
      actionCount: 0,
      timer: null,
      budget: { ...DEFAULT_BUDGET, ...budget }
    };
    this.activePlans.set(plan.id, context);
    this.#scheduleTick(plan.id);
    this.#auditLog({ type: "workspace.orchestrator.plan_started", planId: plan.id, objective: plan.objective.slice(0, 120) });
  }

  stopPlan(planId, reason = "manual") {
    const ctx = this.activePlans.get(planId);
    if (!ctx) return;
    if (ctx.timer) clearTimeout(ctx.timer);
    this.activePlans.delete(planId);
    this.#auditLog({ type: "workspace.orchestrator.plan_stopped", planId, reason });
  }

  // Called by OperatorService when a terminal status changes (exit / error)
  async onTerminalStatusChange(terminalId, newStatus) {
    if (this.isShuttingDown) return;
    for (const [planId, ctx] of this.activePlans) {
      const stage = stageForTerminal(ctx.plan, terminalId);
      if (!stage) continue;
      // Immediate tick — cancel pending timer
      if (ctx.timer) clearTimeout(ctx.timer);
      ctx.timer = null;
      await this.#tick(planId).catch(err =>
        this.#auditLog({ type: "workspace.orchestrator.tick_error", planId, error: err?.message ?? String(err) })
      );
      return;
    }
  }

  shutdown() {
    this.isShuttingDown = true;
    for (const [, ctx] of this.activePlans) {
      if (ctx.timer) clearTimeout(ctx.timer);
    }
    this.activePlans.clear();
  }

  getActivePlanIds() {
    return Array.from(this.activePlans.keys());
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  #scheduleTick(planId) {
    const ctx = this.activePlans.get(planId);
    if (!ctx || this.isShuttingDown) return;
    ctx.timer = setTimeout(async () => {
      await this.#tick(planId).catch(err =>
        this.#auditLog({ type: "workspace.orchestrator.tick_error", planId, error: err?.message ?? String(err) })
      );
    }, ctx.budget.tickIntervalMs);
  }

  async #tick(planId) {
    if (this.isShuttingDown) return;
    const ctx = this.activePlans.get(planId);
    if (!ctx) return;

    const plan = this.database.getWorkspacePlan(planId);
    if (!plan) { this.stopPlan(planId, "plan_not_found"); return; }
    if ([PLAN_STATUS.COMPLETED, PLAN_STATUS.FAILED].includes(plan.status)) {
      this.stopPlan(planId, `plan_terminal_status:${plan.status}`);
      return;
    }
    ctx.plan = plan;

    await this.#orchestrate(plan, ctx);

    // Re-read plan after mutations, re-schedule if still active
    const refreshed = this.database.getWorkspacePlan(planId);
    if (refreshed && [PLAN_STATUS.ACTIVE, PLAN_STATUS.DRAFT, PLAN_STATUS.PAUSED].includes(refreshed.status)) {
      this.#scheduleTick(planId);
    } else {
      this.stopPlan(planId, `plan_status:${refreshed?.status ?? "gone"}`);
    }
  }

  async #orchestrate(plan, ctx) {
    const elapsed = Date.now() - ctx.startedAt;

    // Budget: time
    if (elapsed > ctx.budget.maxElapsedMs) {
      const msg = buildBudgetEscalationMessage({
        plan, elapsedMs: elapsed, actionCount: ctx.actionCount,
        maxElapsedMs: ctx.budget.maxElapsedMs
      });
      await this.#escalate(plan, null, msg, ESCALATION_REASON.BUDGET_EXCEEDED);
      this.stopPlan(plan.id, "budget_exceeded");
      return;
    }

    // 1. Check running stages — terminal done?
    for (const stage of findRunningStages(plan)) {
      if (!stage.terminalId) continue;
      const terminal = this.database.getWorkspaceTerminalSession(stage.terminalId);
      if (!terminal) continue;

      if (["completed", "error", "detached"].includes(terminal.status)) {
        await this.#handleTerminalDone(plan, stage, terminal, ctx);
        // Re-fetch plan after stage mutation
        const updated = this.database.getWorkspacePlan(plan.id);
        if (updated) { plan = updated; ctx.plan = updated; }
      } else if (["waiting_for_input", "needs_attention"].includes(terminal.status)) {
        await this.#handleTerminalWaiting(plan, stage, terminal, ctx);
      }
    }

    // 2. Launch runnable stages (respecting maxActionsPerTick)
    let launched = 0;
    for (const stage of findRunnableStages(plan)) {
      if (launched >= ctx.budget.maxActionsPerTick) break;

      if (stage.agentType === "manual") {
        this.#mutateStage(plan, stage.id, { status: STAGE_STATUS.NEEDS_USER_DECISION });
        await this.#escalate(plan, stage,
          `L'étape **${stage.label}** nécessite une action manuelle de votre part.`,
          "manual_stage_required"
        );
        continue;
      }

      if (!stage.command) {
        this.#mutateStage(plan, stage.id, { status: STAGE_STATUS.BLOCKED });
        continue;
      }

      const ok = await this.#launchStage(plan, stage);
      if (ok) { launched++; ctx.actionCount++; }
    }

    // 3. Recompute plan status
    const fresh = this.database.getWorkspacePlan(plan.id);
    if (!fresh) return;
    const newStatus = computePlanStatus(fresh);
    if (newStatus !== fresh.status) {
      const saved = this.database.upsertWorkspacePlan({ ...fresh, status: newStatus, updatedAt: nowIso() });
      this.emitEvent("workspace.plan.status_changed", {
        projectId: plan.projectId, planId: plan.id, status: newStatus, updatedAt: saved.updatedAt
      });
      if (newStatus === PLAN_STATUS.COMPLETED) await this.#onPlanCompleted(fresh);
      else if (newStatus === PLAN_STATUS.FAILED) await this.#onPlanFailed(fresh);
    }
  }

  async #handleTerminalDone(plan, stage, terminal, ctx) {
    // Use LLM semantic verification, fall back to heuristic if gateway unavailable
    let verdict;
    try {
      verdict = await verifyTerminalOutcome({
        projectId: plan.projectId,
        terminal,
        stage,
        llmGateway: this.llmGateway
      });
    } catch {
      const heuristic = deriveHeuristicVerdict(terminal, stage);
      verdict = {
        id: `wverif_heuristic_${Date.now()}`,
        terminalId: terminal.id, stageId: stage.id, planId: stage.planId,
        projectId: plan.projectId, createdAt: nowIso(),
        modifiedFiles: [], testsRun: [], testsPassed: [], testsFailed: [],
        observedEvidence: [], criteriaResults: [], risks: [],
        ...heuristic
      };
    }

    this.database.insertWorkspacePlanVerification(verdict);
    this.emitEvent("workspace.plan.stage_verified", {
      projectId: plan.projectId, planId: plan.id,
      stageId: stage.id, verdict: verdict.verdict, confidence: verdict.confidence
    });

    const verifications = this.database.listWorkspacePlanVerifications(plan.id);
    const planState = aggregatePlanState(plan, verifications);
    const escalation = evaluateEscalationNeed({ stage, verdict, planState, terminal });

    let newStatus;
    if (escalation.shouldEscalate && escalation.priority === "high") {
      newStatus = STAGE_STATUS.NEEDS_USER_DECISION;
      const msg = buildEscalationMessage({ stage, verdict, escalation, planState });
      await this.#escalate(plan, stage, msg, escalation.primaryReason?.reason ?? "escalation_required");
    } else if (escalation.shouldEscalate && escalation.priority === "medium") {
      // Medium escalations: complete the stage but warn
      newStatus = verdict.verdict === VERDICT.FAILED ? STAGE_STATUS.FAILED : STAGE_STATUS.COMPLETED;
      const msg = buildEscalationMessage({ stage, verdict, escalation, planState });
      if (msg) await this.#escalate(plan, stage, msg, escalation.primaryReason?.reason ?? "warning");
    } else if (verdict.verdict === VERDICT.SUCCESS || verdict.verdict === VERDICT.PARTIAL_SUCCESS) {
      newStatus = STAGE_STATUS.COMPLETED;
    } else if (verdict.verdict === VERDICT.FAILED) {
      newStatus = STAGE_STATUS.FAILED;
      const msg = buildEscalationMessage({
        stage, verdict,
        escalation: { shouldEscalate: true, reasons: [{ reason: ESCALATION_REASON.STAGE_FAILED, priority: "high", detail: verdict.summary }] },
        planState
      });
      await this.#escalate(plan, stage, msg, ESCALATION_REASON.STAGE_FAILED);
    } else if (verdict.verdict === VERDICT.BLOCKED) {
      newStatus = STAGE_STATUS.BLOCKED;
      await this.#escalate(plan, stage,
        `L'étape **${stage.label}** est bloquée : ${verdict.summary}`,
        "stage_blocked"
      );
    } else {
      // UNCLEAR — escalate for human review
      newStatus = STAGE_STATUS.NEEDS_USER_DECISION;
      await this.#escalate(plan, stage,
        `JON ne peut pas déterminer si l'étape **${stage.label}** a réussi. Verdict : unclear. ${verdict.summary}`,
        "verdict_unclear"
      );
    }

    this.#mutateStage(plan, stage.id, {
      status: newStatus,
      verificationId: verdict.id,
      verdict: verdict.verdict,
      completedAt: nowIso()
    });
  }

  async #handleTerminalWaiting(plan, stage, terminal, ctx) {
    const nudges = ctx.nudgeCounts.get(stage.id) ?? 0;
    if (nudges >= ctx.budget.maxNudgesPerTerminal) {
      this.#mutateStage(plan, stage.id, { status: STAGE_STATUS.NEEDS_USER_DECISION });
      await this.#escalate(plan, stage,
        `Le terminal **${terminal.label}** attend une réponse depuis ${nudges} relances. Intervention humaine requise.`,
        ESCALATION_REASON.MAX_RETRIES
      );
      return;
    }
    // The existing terminal reasoning logic (operator-service) handles the actual nudge.
    // We just count here to enforce the retry budget.
    ctx.nudgeCounts.set(stage.id, nudges + 1);
  }

  async #launchStage(plan, stage) {
    try {
      const result = await this.launchTerminal(plan.projectId, {
        label: stage.label,
        command: stage.command,
        args: stage.args ?? [],
        cwd: stage.cwd ?? process.cwd(),
        autonomyMode: stage.autonomyMode ?? "supervised_autonomy",
        authorized: true,
        conversationId: plan.conversationId,
        metadata: { planId: plan.id, stageId: stage.id }
      });
      const terminalId = result?.terminal?.id;
      if (!terminalId) return false;

      this.#mutateStage(plan, stage.id, {
        status: STAGE_STATUS.RUNNING,
        terminalId,
        startedAt: nowIso()
      });
      this.emitEvent("workspace.plan.stage_started", {
        projectId: plan.projectId, planId: plan.id,
        stageId: stage.id, terminalId, agentType: stage.agentType
      });
      return true;
    } catch (err) {
      this.#mutateStage(plan, stage.id, { status: STAGE_STATUS.BLOCKED });
      this.#auditLog({ type: "workspace.orchestrator.launch_failed", planId: plan.id, stageId: stage.id, error: err?.message ?? String(err) });
      return false;
    }
  }

  async #onPlanCompleted(plan) {
    const verifications = this.database.listWorkspacePlanVerifications(plan.id);
    const planState = aggregatePlanState(plan, verifications);
    const msg = [
      `✅ **Mission workspace terminée** — "${plan.objective.slice(0, 120)}"`,
      "",
      buildPlanStatusMessage(planState) ?? `${planState?.summary?.completed ?? 0} étapes complétées.`
    ].join("\n");
    await this.injectConversationMessage(plan.projectId, plan.conversationId, {
      kind: "workspace_plan_completed",
      content: msg,
      payload: { planId: plan.id, planState }
    });
  }

  async #onPlanFailed(plan) {
    const failedStages = plan.stages.filter(s => s.status === STAGE_STATUS.FAILED);
    const msg = [
      `❌ **Mission workspace échouée** — "${plan.objective.slice(0, 120)}"`,
      "",
      `Étapes échouées : ${failedStages.map(s => s.label).join(", ")}`,
      "JON attend votre intervention pour continuer."
    ].join("\n");
    await this.injectConversationMessage(plan.projectId, plan.conversationId, {
      kind: "workspace_plan_failed",
      content: msg,
      payload: { planId: plan.id, failedStageIds: failedStages.map(s => s.id) }
    });
  }

  async #escalate(plan, stage, message, reason) {
    const content = message ?? `JON a besoin d'une décision pour la mission "${plan.objective.slice(0, 80)}".`;
    try {
      await this.injectConversationMessage(plan.projectId, plan.conversationId, {
        kind: "workspace_plan_escalation",
        content,
        payload: { planId: plan.id, stageId: stage?.id ?? null, reason }
      });
    } catch { /* absorb injection errors */ }
    this.emitEvent("workspace.plan.escalated", {
      projectId: plan.projectId, planId: plan.id,
      stageId: stage?.id ?? null, reason
    });
    this.#auditLog({ type: "workspace.orchestrator.escalated", planId: plan.id, stageId: stage?.id ?? null, reason });
  }

  #mutateStage(plan, stageId, patch) {
    const current = this.database.getWorkspacePlan(plan.id);
    if (!current) return;
    const updated = updateStageInPlan(current, stageId, patch);
    this.database.upsertWorkspacePlan(updated);
  }

  #auditLog(entry) {
    try { this.auditLog?.({ ...entry, at: nowIso() }); } catch { /* absorb */ }
  }
}
