import { createId, nowIso } from "../utils/ids.js";

export const STAGE_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  BLOCKED: "blocked",
  FAILED: "failed",
  COMPLETED: "completed",
  NEEDS_USER_DECISION: "needs_user_decision",
  SKIPPED: "skipped"
});

export const STAGE_AGENT_TYPE = Object.freeze({
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
  SHELL: "shell",
  BROWSER: "browser",
  MANUAL: "manual"
});

export const PLAN_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  NEEDS_USER_DECISION: "needs_user_decision"
});

// Agent type → CLI command mapping used when no explicit command is provided
const AGENT_TYPE_COMMAND = Object.freeze({
  [STAGE_AGENT_TYPE.CLAUDE_CODE]: "claude",
  [STAGE_AGENT_TYPE.CODEX]: "codex",
  [STAGE_AGENT_TYPE.SHELL]: null
});

export function buildWorkspacePlan({
  projectId,
  conversationId = null,
  objective,
  stages = [],
  metadata = {}
} = {}) {
  if (!projectId) throw new Error("buildWorkspacePlan requires projectId.");
  if (!objective?.trim()) throw new Error("buildWorkspacePlan requires objective.");
  const planId = createId("wplan");
  return {
    id: planId,
    projectId,
    conversationId,
    objective: String(objective).trim().slice(0, 4000),
    status: PLAN_STATUS.DRAFT,
    stages: stages.map((s, i) => buildPlanStage(s, i, planId)),
    metadata: metadata ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildPlanStage(spec, index, planId) {
  const agentType = Object.values(STAGE_AGENT_TYPE).includes(spec.agentType)
    ? spec.agentType
    : STAGE_AGENT_TYPE.SHELL;
  const command = spec.command ?? AGENT_TYPE_COMMAND[agentType] ?? null;
  return {
    id: spec.id ?? `s${index + 1}`,
    planId,
    label: String(spec.label ?? `Stage ${index + 1}`).slice(0, 200),
    agentType,
    command,
    args: Array.isArray(spec.args) ? spec.args.map(String) : [],
    cwd: spec.cwd ? String(spec.cwd) : null,
    autonomyMode: spec.autonomyMode ?? "supervised_autonomy",
    dependsOn: Array.isArray(spec.dependsOn) ? spec.dependsOn.map(String) : [],
    successCriteria: Array.isArray(spec.successCriteria) ? spec.successCriteria.slice(0, 10) : [],
    expectedArtifacts: Array.isArray(spec.expectedArtifacts) ? spec.expectedArtifacts.slice(0, 10) : [],
    expectedTests: spec.expectedTests ? String(spec.expectedTests) : null,
    status: Object.values(STAGE_STATUS).includes(spec.status) ? spec.status : STAGE_STATUS.PENDING,
    terminalId: spec.terminalId ?? null,
    verificationId: null,
    startedAt: null,
    completedAt: null,
    verdict: null,
    metadata: spec.metadata ?? {}
  };
}

export function findRunnableStages(plan) {
  const doneIds = new Set(
    plan.stages
      .filter(s => s.status === STAGE_STATUS.COMPLETED || s.status === STAGE_STATUS.SKIPPED)
      .map(s => s.id)
  );
  return plan.stages.filter(s =>
    s.status === STAGE_STATUS.PENDING &&
    s.dependsOn.every(dep => doneIds.has(dep))
  );
}

export function findRunningStages(plan) {
  return plan.stages.filter(s => s.status === STAGE_STATUS.RUNNING);
}

export function findBlockedStages(plan) {
  return plan.stages.filter(s =>
    [STAGE_STATUS.BLOCKED, STAGE_STATUS.FAILED, STAGE_STATUS.NEEDS_USER_DECISION].includes(s.status)
  );
}

export function computePlanStatus(plan) {
  const { stages } = plan;
  if (!stages.length) return PLAN_STATUS.DRAFT;
  if (stages.some(s => s.status === STAGE_STATUS.NEEDS_USER_DECISION)) return PLAN_STATUS.NEEDS_USER_DECISION;
  if (stages.some(s => s.status === STAGE_STATUS.FAILED)) return PLAN_STATUS.FAILED;
  if (stages.every(s => [STAGE_STATUS.COMPLETED, STAGE_STATUS.SKIPPED].includes(s.status))) return PLAN_STATUS.COMPLETED;
  if (stages.some(s => s.status === STAGE_STATUS.RUNNING)) return PLAN_STATUS.ACTIVE;
  if (stages.some(s => s.status === STAGE_STATUS.BLOCKED)) return PLAN_STATUS.PAUSED;
  return PLAN_STATUS.ACTIVE;
}

export function updateStageInPlan(plan, stageId, patch) {
  return {
    ...plan,
    stages: plan.stages.map(s => s.id === stageId ? { ...s, ...patch } : s),
    updatedAt: nowIso()
  };
}

export function stageForTerminal(plan, terminalId) {
  return plan.stages.find(s => s.terminalId === terminalId) ?? null;
}

export function planSummary(plan) {
  const counts = { pending: 0, running: 0, blocked: 0, failed: 0, completed: 0, needs_user_decision: 0, skipped: 0 };
  for (const s of plan.stages) counts[s.status] = (counts[s.status] ?? 0) + 1;
  return {
    planId: plan.id,
    objective: plan.objective.slice(0, 200),
    status: plan.status,
    stageCount: plan.stages.length,
    ...counts,
    progress: plan.stages.length > 0
      ? Math.round((counts.completed / plan.stages.length) * 100)
      : 0
  };
}
