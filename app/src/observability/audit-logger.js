import path from "node:path";
import { LOGS_ROOT } from "../config.js";
import { StructuredLogger } from "./structured-logger.js";

const logger = new StructuredLogger({
  filePath: path.join(LOGS_ROOT, "jon-audit.jsonl"),
  enabled: true
});

function compactText(value, maxChars = 3000) {
  if (value == null) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > maxChars ? s.slice(0, maxChars) + "…[truncated]" : s;
}

function compactSteps(steps = [], maxSteps = 30) {
  return steps.slice(0, maxSteps).map((s) => {
    // actionLog entry: { step: { id, primitive, label, riskLevel... }, status, result, error?, safety? }
    // browser stepResults: { id, action, label, status, error? }
    const isBrowser = !s.step;
    const id = isBrowser ? s.id : s.step?.id;
    const primitive = isBrowser ? (s.action ?? null) : (s.step?.primitive ?? null);
    const label = isBrowser ? s.label : s.step?.label;
    const riskLevel = isBrowser ? null : s.step?.riskLevel;
    const blockedReason = s.safety?.blocked ? (s.safety?.reason ?? null) : null;
    const errorMsg = s.error
      ? String(s.error).slice(0, 300)
      : blockedReason
        ? `BLOCKED: ${blockedReason}`
        : s.reason === "approval_denied"
          ? "SKIPPED: approval denied"
          : null;
    return {
      id: id ?? null,
      primitive,
      label: label ?? null,
      status: s.status ?? null,
      riskLevel: riskLevel ?? null,
      error: errorMsg,
      result: s.result !== undefined && s.result !== null
        ? compactText(JSON.stringify(s.result), 300)
        : undefined,
      verificationPassed: s.checkpoint?.verification?.validated ?? null,
      verificationReason: s.checkpoint?.verification?.reason
        ? String(s.checkpoint.verification.reason).slice(0, 200)
        : null
    };
  });
}

// ── Conversation turn (user message → JON response) ──────────────────────────

export async function auditConversationTurn({
  projectId,
  conversationId,
  runId,
  userMessage,
  jonReply,
  intentType,
  action,
  generationMode,
  fallbackReason,
  missionDraft,
  requiresClarification,
  clarificationQuestion,
  llm
}) {
  await logger.safeLog({
    type: "jon.conversation.turn",
    projectId,
    conversationId,
    runId: runId ?? null,
    userMessage: compactText(userMessage, 2000),
    jonReply: compactText(jonReply, 3000),
    intentType: intentType ?? null,
    action: action ?? null,
    generationMode: generationMode ?? null,
    fallbackReason: fallbackReason ?? null,
    requiresClarification: requiresClarification ?? false,
    clarificationQuestion: clarificationQuestion ?? null,
    missionDraft: missionDraft ? {
      objective: compactText(missionDraft.objective, 400),
      mode: missionDraft.mode ?? null,
      deliverable: compactText(missionDraft.deliverable, 200)
    } : null,
    llmProvider: llm?.providerAlias ?? null,
    llmModel: llm?.providerModel ?? null,
    estimatedCost: llm?.estimatedCost ?? null,
    tokenUsage: llm?.tokenUsage ?? null
  });
}

// ── Desktop mission plan generated ───────────────────────────────────────────

export async function auditMissionPlan({
  projectId,
  runId,
  mission,
  plan
}) {
  await logger.safeLog({
    type: "jon.mission.plan",
    projectId,
    runId,
    mission: compactText(mission, 500),
    missionSummary: compactText(plan?.missionSummary, 400),
    planSummary: compactText(plan?.planSummary, 600),
    selectedApplication: plan?.selectedApplication?.id ?? plan?.selectedApplication ?? null,
    requiresClarification: plan?.requiresClarification ?? false,
    clarificationQuestion: plan?.clarificationQuestion ?? null,
    stepCount: plan?.steps?.length ?? 0,
    steps: (plan?.steps ?? []).slice(0, 20).map((s) => ({
      id: s.id,
      primitive: s.primitive,
      label: s.label,
      riskLevel: s.riskLevel,
      requiresApproval: s.requiresApproval ?? false
    })),
    verificationGoals: (plan?.verificationGoals ?? []).slice(0, 5),
    safetyNotes: (plan?.safetyNotes ?? []).slice(0, 5),
    unsupportedRequests: (plan?.unsupportedRequests ?? []).slice(0, 5)
  });
}

// ── Desktop mission execution result ─────────────────────────────────────────

export async function auditMissionExecution({
  projectId,
  runId,
  mission,
  finalStatus,
  actionLog = [],
  consecutiveFailures = 0,
  stoppedReason = null
}) {
  const completed = actionLog.filter((e) => e.status === "completed").length;
  const failed = actionLog.filter((e) => e.status === "failed").length;
  const blocked = actionLog.filter((e) => e.status === "blocked").length;
  const skipped = actionLog.filter((e) => e.status === "skipped").length;
  await logger.safeLog({
    type: "jon.mission.execution",
    projectId,
    runId,
    mission: compactText(mission, 500),
    finalStatus,
    stoppedReason: stoppedReason ?? null,
    stepCount: actionLog.length,
    completedSteps: completed,
    failedSteps: failed,
    blockedSteps: blocked,
    skippedSteps: skipped,
    consecutiveFailures,
    steps: compactSteps(actionLog)
  });
}

// ── Browser mission execution result ─────────────────────────────────────────

export async function auditBrowserMission({
  projectId,
  runId,
  mission,
  finalStatus,
  browserResult
}) {
  await logger.safeLog({
    type: "jon.browser.mission",
    projectId,
    runId,
    mission: compactText(mission, 500),
    finalStatus,
    browserStatus: browserResult?.status ?? null,
    stepCount: browserResult?.stepResults?.length ?? 0,
    errorCount: browserResult?.errors?.length ?? 0,
    blockerCount: browserResult?.blockers?.length ?? 0,
    extracted: browserResult?.extracted
      ? compactText(JSON.stringify(browserResult.extracted), 800)
      : null,
    finalUrl: browserResult?.browserState?.url ?? null,
    steps: (browserResult?.stepResults ?? []).slice(0, 20).map((s) => ({
      id: s.id,
      action: s.action,
      label: s.label,
      status: s.status,
      error: s.error ? String(s.error).slice(0, 300) : undefined
    })),
    errors: (browserResult?.errors ?? []).slice(0, 10).map((e) => ({
      id: e.id,
      action: e.action,
      error: String(e.error ?? "").slice(0, 300)
    }))
  });
}

// ── Terminal reasoning decision ───────────────────────────────────────────────

export async function auditTerminalReasoning({
  projectId,
  terminalId,
  terminalLabel,
  agentKind,
  terminalStatus,
  missionObjective,
  suggestion,
  actionTaken
}) {
  await logger.safeLog({
    type: "jon.terminal.reasoning",
    projectId,
    terminalId,
    terminalLabel,
    agentKind,
    terminalStatus,
    missionObjective: compactText(missionObjective, 300),
    shouldInject: suggestion?.shouldInject ?? false,
    suggestedInput: suggestion?.suggestedInput
      ? compactText(suggestion.suggestedInput, 200)
      : null,
    reasoning: suggestion?.reasoning ?? null,
    confidence: suggestion?.confidence ?? null,
    actionTaken
  });
}

// ── Approval decision (approved / denied / stop_run) ─────────────────────────

export async function auditApprovalDecision({
  runId,
  projectId,
  approvalId,
  decision,
  actionLabel,
  category,
  riskLevel,
  rationale
}) {
  await logger.safeLog({
    type: "jon.approval.decision",
    runId,
    projectId,
    approvalId,
    decision,
    approved: decision === "approved_once",
    stoppedRun: decision === "stop_run",
    actionLabel: compactText(actionLabel, 200),
    category: category ?? null,
    riskLevel: riskLevel ?? null,
    rationale: compactText(rationale, 400) ?? null
  });
}

// ── Run terminal status change (completed / failed / stopped) ─────────────────

export async function auditRunStatusChange({
  runId,
  projectId,
  mission,
  toStatus,
  lifecycleStage,
  reason,
  errorMessage,
  errorName,
  consecutiveFailures,
  stoppedBy
}) {
  await logger.safeLog({
    type: "jon.run.status_change",
    runId,
    projectId,
    mission: compactText(mission, 300),
    toStatus,
    lifecycleStage: lifecycleStage ?? null,
    reason: compactText(reason, 400) ?? null,
    errorMessage: compactText(errorMessage, 600) ?? null,
    errorName: errorName ?? null,
    consecutiveFailures: consecutiveFailures ?? null,
    stoppedBy: stoppedBy ?? null
  });
}

// ── Step failure in desktop execution loop (blocked / failed / skipped) ───────

export async function auditStepFailure({
  runId,
  projectId,
  stepId,
  primitive,
  label,
  stepIndex,
  totalSteps,
  status,
  errorMessage,
  reason,
  safetyReason,
  riskLevel,
  recoveryAttempted,
  approvalRationale,
  consecutiveFailures,
  screenshotPath
}) {
  await logger.safeLog({
    type: "jon.step.failure",
    runId,
    projectId,
    stepId: stepId ?? null,
    stepIndex: stepIndex ?? null,
    totalSteps: totalSteps ?? null,
    primitive: primitive ?? null,
    label: compactText(label, 200) ?? null,
    status,
    errorMessage: compactText(errorMessage, 600) ?? null,
    reason: reason ?? null,
    safetyReason: compactText(safetyReason, 300) ?? null,
    riskLevel: riskLevel ?? null,
    recoveryAttempted: recoveryAttempted ?? false,
    approvalRationale: compactText(approvalRationale, 300) ?? null,
    consecutiveFailures: consecutiveFailures ?? null,
    screenshotPath: screenshotPath ?? null
  });
}

// ── LLM output capture (called from gateway) ─────────────────────────────────

export async function auditLlmOutput({
  requestId,
  runId,
  projectId,
  callType,
  providerAlias,
  modelAlias,
  latencyMs,
  outputText
}) {
  await logger.safeLog({
    type: "jon.llm.output",
    requestId,
    runId,
    projectId,
    callType,
    providerAlias,
    modelAlias,
    latencyMs,
    outputText: compactText(outputText, 3000)
  });
}
