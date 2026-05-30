import assert from "node:assert/strict";
import {
  buildWorkspacePlan,
  findRunnableStages,
  findRunningStages,
  computePlanStatus,
  updateStageInPlan,
  stageForTerminal,
  planSummary,
  STAGE_STATUS,
  STAGE_AGENT_TYPE,
  PLAN_STATUS
} from "../src/workspace/workspace-plan.js";
import {
  deriveHeuristicVerdict,
  VERDICT
} from "../src/workspace/semantic-terminal-verifier.js";
import { aggregatePlanState, buildPlanStatusMessage } from "../src/workspace/project-state-aggregator.js";
import {
  evaluateEscalationNeed,
  buildEscalationMessage,
  ESCALATION_REASON
} from "../src/workspace/escalation-rules.js";
import { WorkspaceOrchestratorLoop } from "../src/workspace/orchestrator-loop.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStage(overrides = {}) {
  return {
    id: overrides.id ?? "stage-1",
    label: overrides.label ?? "Audit module",
    agentType: overrides.agentType ?? STAGE_AGENT_TYPE.CLAUDE_CODE,
    command: overrides.command ?? "claude",
    args: overrides.args ?? ["--print", "audit src/utils/ids.js"],
    cwd: overrides.cwd ?? process.cwd(),
    dependsOn: overrides.dependsOn ?? [],
    successCriteria: overrides.successCriteria ?? ["All functions documented"],
    expectedArtifacts: overrides.expectedArtifacts ?? [],
    status: overrides.status ?? STAGE_STATUS.PENDING,
    terminalId: overrides.terminalId ?? null,
    autonomyMode: overrides.autonomyMode ?? "supervised_autonomy",
    ...overrides
  };
}

function makePlan(stageOverrides = []) {
  const stages = stageOverrides.length > 0 ? stageOverrides : [makeStage()];
  return buildWorkspacePlan({
    projectId: "proj-test",
    conversationId: "conv-test",
    objective: "Audit and patch ids module",
    stages
  });
}

function makeTerminal(overrides = {}) {
  const exitCode = overrides.exitCode ?? 0;
  const transcript = overrides.transcript ?? "All done.\n> Task completed successfully.";
  return {
    id: overrides.id ?? "term-1",
    label: overrides.label ?? "Claude Code",
    status: overrides.status ?? "completed",
    recentOutput: transcript,
    metadata: { exitCode, ...(overrides.metadata ?? {}) },
    createdAt: new Date().toISOString()
  };
}

// ─── workspace-plan.js ──────────────────────────────────────────────────────

export async function run() {

  // buildWorkspacePlan produces required fields
  {
    const plan = makePlan();
    assert.ok(plan.id, "plan has id");
    assert.equal(plan.projectId, "proj-test");
    assert.equal(plan.status, PLAN_STATUS.DRAFT);
    assert.equal(plan.stages.length, 1);
    assert.equal(plan.stages[0].status, STAGE_STATUS.PENDING);
  }

  // findRunnableStages — no deps, pending → runnable
  {
    const plan = makePlan();
    const runnable = findRunnableStages(plan);
    assert.equal(runnable.length, 1, "single pending stage with no deps is runnable");
  }

  // findRunnableStages — stage with unmet dep is not runnable
  {
    const s1 = makeStage({ id: "s1", status: STAGE_STATUS.PENDING });
    const s2 = makeStage({ id: "s2", dependsOn: ["s1"], status: STAGE_STATUS.PENDING });
    const plan = makePlan([s1, s2]);
    const runnable = findRunnableStages(plan);
    assert.equal(runnable.length, 1, "only s1 is runnable when s2 depends on unfinished s1");
    assert.equal(runnable[0].id, "s1");
  }

  // findRunnableStages — dep completed unlocks dependent
  {
    const s1 = makeStage({ id: "s1", status: STAGE_STATUS.COMPLETED });
    const s2 = makeStage({ id: "s2", dependsOn: ["s1"], status: STAGE_STATUS.PENDING });
    const plan = makePlan([s1, s2]);
    const runnable = findRunnableStages(plan);
    assert.equal(runnable.length, 1);
    assert.equal(runnable[0].id, "s2");
  }

  // findRunningStages
  {
    const s1 = makeStage({ id: "s1", status: STAGE_STATUS.RUNNING, terminalId: "term-1" });
    const s2 = makeStage({ id: "s2", status: STAGE_STATUS.PENDING });
    const plan = makePlan([s1, s2]);
    const running = findRunningStages(plan);
    assert.equal(running.length, 1);
    assert.equal(running[0].id, "s1");
  }

  // computePlanStatus — all pending → active
  {
    const plan = makePlan();
    assert.equal(computePlanStatus({ ...plan, status: PLAN_STATUS.ACTIVE }), PLAN_STATUS.ACTIVE);
  }

  // computePlanStatus — all completed → completed
  {
    const s1 = makeStage({ id: "s1", status: STAGE_STATUS.COMPLETED });
    const plan = makePlan([s1]);
    assert.equal(computePlanStatus(plan), PLAN_STATUS.COMPLETED);
  }

  // computePlanStatus — any failed → failed
  {
    const s1 = makeStage({ id: "s1", status: STAGE_STATUS.FAILED });
    const plan = makePlan([s1]);
    assert.equal(computePlanStatus(plan), PLAN_STATUS.FAILED);
  }

  // computePlanStatus — needs_user_decision → needs_user_decision
  {
    const s1 = makeStage({ id: "s1", status: STAGE_STATUS.NEEDS_USER_DECISION });
    const plan = makePlan([s1]);
    assert.equal(computePlanStatus(plan), PLAN_STATUS.NEEDS_USER_DECISION);
  }

  // updateStageInPlan — patches correct stage, leaves others intact
  {
    const s1 = makeStage({ id: "s1" });
    const s2 = makeStage({ id: "s2" });
    const plan = makePlan([s1, s2]);
    const updated = updateStageInPlan(plan, "s1", { status: STAGE_STATUS.RUNNING, terminalId: "term-x" });
    const patched = updated.stages.find(s => s.id === "s1");
    const untouched = updated.stages.find(s => s.id === "s2");
    assert.equal(patched.status, STAGE_STATUS.RUNNING);
    assert.equal(patched.terminalId, "term-x");
    assert.equal(untouched.status, STAGE_STATUS.PENDING);
  }

  // stageForTerminal — finds by terminalId
  {
    const s1 = makeStage({ id: "s1", terminalId: "term-abc" });
    const plan = makePlan([s1]);
    assert.ok(stageForTerminal(plan, "term-abc"));
    assert.equal(stageForTerminal(plan, "term-xyz"), null);
  }

  // planSummary shape
  {
    const plan = makePlan();
    const summary = planSummary(plan);
    assert.ok("planId" in summary && "objective" in summary && "status" in summary);
  }

  // ─── semantic-terminal-verifier.js (heuristic path) ─────────────────────

  // exit 0 + success keyword → success
  {
    const terminal = makeTerminal({ exitCode: 0, transcript: "All tests passed.\nTask completed successfully." });
    const stage = makeStage();
    const result = deriveHeuristicVerdict(terminal, stage);
    assert.equal(result.verdict, VERDICT.SUCCESS);
    assert.ok(result.confidence >= 0.5);
  }

  // exit non-0 → failed
  {
    const terminal = makeTerminal({ exitCode: 1, transcript: "Error: module not found" });
    const stage = makeStage();
    const result = deriveHeuristicVerdict(terminal, stage);
    assert.equal(result.verdict, VERDICT.FAILED);
  }

  // exit 0 but transcript contains error → partial or failed
  {
    const terminal = makeTerminal({ exitCode: 0, transcript: "Warning: something failed\nError in step 2" });
    const stage = makeStage();
    const result = deriveHeuristicVerdict(terminal, stage);
    assert.ok(
      [VERDICT.FAILED, VERDICT.PARTIAL_SUCCESS, VERDICT.UNCLEAR].includes(result.verdict),
      `expected degraded verdict, got ${result.verdict}`
    );
  }

  // credentials request → blocked
  {
    const terminal = makeTerminal({ exitCode: 1, transcript: "Please authenticate\nEnter your API key:" });
    const stage = makeStage();
    const result = deriveHeuristicVerdict(terminal, stage);
    assert.ok(
      [VERDICT.BLOCKED, VERDICT.FAILED].includes(result.verdict),
      `expected blocked/failed, got ${result.verdict}`
    );
  }

  // ─── project-state-aggregator.js ─────────────────────────────────────────

  // aggregatePlanState with no verifications
  {
    const plan = makePlan([
      makeStage({ id: "s1", status: STAGE_STATUS.COMPLETED }),
      makeStage({ id: "s2", status: STAGE_STATUS.PENDING })
    ]);
    const state = aggregatePlanState(plan, []);
    assert.equal(state.planId, plan.id);
    assert.ok("summary" in state);
    assert.ok(state.summary.completed >= 1 || state.summary.total >= 1);
  }

  // buildPlanStatusMessage returns a string
  {
    const plan = makePlan([makeStage({ id: "s1", status: STAGE_STATUS.COMPLETED })]);
    const state = aggregatePlanState(plan, []);
    const msg = buildPlanStatusMessage(state);
    assert.ok(msg === null || typeof msg === "string");
  }

  // ─── escalation-rules.js ─────────────────────────────────────────────────

  // stage failed → shouldEscalate = true, priority high
  {
    const stage = makeStage();
    const verdict = { verdict: VERDICT.FAILED, confidence: 0.9, summary: "Tests failed", risks: [] };
    const planState = aggregatePlanState(makePlan([stage]), []);
    const terminal = makeTerminal({ exitCode: 1 });
    const result = evaluateEscalationNeed({ stage, verdict, planState, terminal });
    assert.equal(result.shouldEscalate, true);
    assert.equal(result.priority, "high");
  }

  // success with no risks → no escalation
  {
    const stage = makeStage();
    const verdict = { verdict: VERDICT.SUCCESS, confidence: 0.95, summary: "All good", risks: [] };
    const planState = aggregatePlanState(makePlan([stage]), []);
    const terminal = makeTerminal({ exitCode: 0 });
    const result = evaluateEscalationNeed({ stage, verdict, planState, terminal });
    assert.equal(result.shouldEscalate, false);
  }

  // credentials in transcript → escalate
  {
    const stage = makeStage();
    const verdict = {
      verdict: VERDICT.BLOCKED, confidence: 0.85, summary: "Needs API key",
      risks: ["credentials required"]
    };
    const planState = aggregatePlanState(makePlan([stage]), []);
    const terminal = makeTerminal({ exitCode: 1, transcript: "Please enter your token:" });
    const result = evaluateEscalationNeed({ stage, verdict, planState, terminal });
    assert.equal(result.shouldEscalate, true);
  }

  // buildEscalationMessage returns a non-empty string
  {
    const stage = makeStage();
    const verdict = { verdict: VERDICT.FAILED, confidence: 0.9, summary: "build error", risks: [] };
    const planState = aggregatePlanState(makePlan([stage]), []);
    const escalation = { shouldEscalate: true, priority: "high", reasons: [{ reason: ESCALATION_REASON.STAGE_FAILED, priority: "high", detail: "build failed" }] };
    const msg = buildEscalationMessage({ stage, verdict, escalation, planState });
    assert.ok(typeof msg === "string" && msg.length > 0);
  }

  // ─── orchestrator-loop.js (in-memory integration) ────────────────────────

  {
    // Build a minimal in-memory database stub
    const plans = new Map();
    const verifications = [];
    const events = [];
    const injected = [];
    const launched = [];

    const termSessions = new Map();

    const db = {
      getWorkspacePlan: id => plans.get(id) ?? null,
      upsertWorkspacePlan: plan => { plans.set(plan.id, plan); return plan; },
      getWorkspaceTerminalSession: id => termSessions.get(id) ?? null,
      insertWorkspacePlanVerification: v => verifications.push(v),
      listWorkspacePlanVerifications: planId => verifications.filter(v => v.planId === planId)
    };

    const emitEvent = (type, payload) => events.push({ type, payload });

    const injectConversationMessage = async (projectId, conversationId, msg) => {
      injected.push(msg);
    };

    const launchTerminal = async (projectId, opts) => {
      const terminalId = `term-${launched.length + 1}`;
      const terminal = {
        id: terminalId,
        label: opts.label,
        status: "completed",
        recentOutput: "All done.\nTask completed successfully.",
        metadata: { exitCode: 0 },
        createdAt: new Date().toISOString()
      };
      termSessions.set(terminalId, terminal);
      launched.push({ projectId, opts, terminalId });
      return { terminal };
    };

    const writeTerminalInput = async () => {};
    const auditLog = () => {};

    // Null LLM gateway — forces heuristic fallback
    const llmGateway = null;

    const loop = new WorkspaceOrchestratorLoop({
      database: db,
      llmGateway,
      emitEvent,
      launchTerminal,
      writeTerminalInput,
      injectConversationMessage,
      auditLog
    });

    // Create a simple one-stage plan
    const plan = buildWorkspacePlan({
      projectId: "proj-test",
      conversationId: "conv-test",
      objective: "Audit ids.js",
      stages: [makeStage({ id: "s1", status: STAGE_STATUS.PENDING })]
    });
    const activePlan = { ...plan, status: PLAN_STATUS.ACTIVE };
    plans.set(activePlan.id, activePlan);

    loop.startPlan(activePlan, { tickIntervalMs: 50, maxElapsedMs: 60_000 });
    assert.ok(loop.getActivePlanIds().includes(activePlan.id), "plan is tracked as active");

    // Wait for at least one tick to fire
    await new Promise(resolve => setTimeout(resolve, 200));

    // A terminal should have been launched for the stage
    assert.ok(launched.length >= 1, `expected terminal launch, got ${launched.length}`);

    // Plan should have converged to completed or needs_user_decision
    const finalPlan = plans.get(activePlan.id);
    assert.ok(
      [PLAN_STATUS.COMPLETED, PLAN_STATUS.NEEDS_USER_DECISION, PLAN_STATUS.FAILED].includes(finalPlan?.status ?? ""),
      `expected terminal plan status, got ${finalPlan?.status}`
    );

    loop.shutdown();
    assert.equal(loop.getActivePlanIds().length, 0, "shutdown clears active plans");
  }
}
