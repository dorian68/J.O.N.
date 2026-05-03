import { nowIso } from "../utils/ids.js";

export const DESKTOP_AUTONOMY_MEMORY_SETTING_KEY = "desktop.autonomy.memory.v1";

export function defaultDesktopAutonomyMemory() {
  return {
    schemaVersion: "desktop_autonomy_memory_v1",
    recoveryStrategies: {},
    applications: {},
    semanticTargets: {},
    recentRuns: [],
    updatedAt: null
  };
}

function normalizeStats(value = {}) {
  return {
    attempts: Math.max(0, Number.parseInt(String(value.attempts ?? 0), 10) || 0),
    successes: Math.max(0, Number.parseInt(String(value.successes ?? 0), 10) || 0),
    failures: Math.max(0, Number.parseInt(String(value.failures ?? 0), 10) || 0),
    lastUsedAt: value.lastUsedAt ?? null,
    primitive: value.primitive ?? null
  };
}

export function normalizeDesktopAutonomyMemory(value = null) {
  const base = defaultDesktopAutonomyMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return base;
  }
  return {
    ...base,
    ...value,
    recoveryStrategies: Object.fromEntries(Object.entries(value.recoveryStrategies ?? {}).map(([key, stats]) => [
      key,
      normalizeStats(stats)
    ])),
    applications: value.applications && typeof value.applications === "object" && !Array.isArray(value.applications)
      ? value.applications
      : {},
    semanticTargets: value.semanticTargets && typeof value.semanticTargets === "object" && !Array.isArray(value.semanticTargets)
      ? value.semanticTargets
      : {},
    recentRuns: Array.isArray(value.recentRuns) ? value.recentRuns.slice(-20) : [],
    updatedAt: value.updatedAt ?? null
  };
}

function bumpStrategy(memory, { id, primitive, succeeded }) {
  if (!id) {
    return;
  }
  const current = normalizeStats(memory.recoveryStrategies[id]);
  memory.recoveryStrategies[id] = {
    ...current,
    primitive: primitive ?? current.primitive,
    attempts: current.attempts + 1,
    successes: current.successes + (succeeded ? 1 : 0),
    failures: current.failures + (succeeded ? 0 : 1),
    lastUsedAt: nowIso()
  };
}

function bumpApplication(memory, application = null, succeeded = false) {
  if (!application?.id) {
    return;
  }
  const current = memory.applications[application.id] ?? {
    id: application.id,
    label: application.label ?? application.id,
    runs: 0,
    successes: 0,
    failures: 0,
    lastUsedAt: null
  };
  memory.applications[application.id] = {
    ...current,
    label: application.label ?? current.label,
    runs: current.runs + 1,
    successes: current.successes + (succeeded ? 1 : 0),
    failures: current.failures + (succeeded ? 0 : 1),
    lastUsedAt: nowIso()
  };
}

function bumpSemanticTarget(memory, entry, succeeded) {
  const target = entry?.result?.semanticResolution?.target ?? entry?.recovery?.semanticResolution?.target ?? null;
  const label = target?.label ?? entry?.step?.target?.semanticTarget ?? null;
  if (!label) {
    return;
  }
  const key = String(label).toLowerCase();
  const current = memory.semanticTargets[key] ?? {
    label,
    role: target?.role ?? entry?.step?.target?.role ?? null,
    attempts: 0,
    successes: 0,
    failures: 0,
    lastUsedAt: null
  };
  memory.semanticTargets[key] = {
    ...current,
    label,
    role: target?.role ?? current.role,
    attempts: current.attempts + 1,
    successes: current.successes + (succeeded ? 1 : 0),
    failures: current.failures + (succeeded ? 0 : 1),
    lastUsedAt: nowIso()
  };
}

export function updateDesktopAutonomyMemory(memoryInput, {
  run,
  desktopPlan,
  actionLog = [],
  observationSummary = null,
  outcomeStatus = "failed"
} = {}) {
  const memory = normalizeDesktopAutonomyMemory(memoryInput);
  const succeeded = ["success", "pass", "completed"].includes(outcomeStatus);
  bumpApplication(memory, desktopPlan?.selectedApplication ?? null, succeeded);

  for (const entry of actionLog) {
    const strategyId = entry?.recovery?.selectedStrategy ?? entry?.recovery?.strategy ?? null;
    if (strategyId) {
      bumpStrategy(memory, {
        id: strategyId,
        primitive: entry?.step?.primitive ?? null,
        succeeded: entry.status === "completed"
      });
    }
    if (entry?.step?.primitive === "click_point") {
      bumpSemanticTarget(memory, entry, entry.status === "completed");
    }
  }

  memory.recentRuns = [
    ...memory.recentRuns,
    {
      runId: run?.id ?? null,
      mission: String(run?.mission ?? "").slice(0, 240),
      status: outcomeStatus,
      selectedApplicationId: desktopPlan?.selectedApplication?.id ?? null,
      actionCount: actionLog.length,
      observationSummary,
      completedAt: nowIso()
    }
  ].slice(-20);
  memory.updatedAt = nowIso();
  return memory;
}

export function summarizeDesktopAutonomyMemory(memoryInput) {
  const memory = normalizeDesktopAutonomyMemory(memoryInput);
  const strategies = Object.entries(memory.recoveryStrategies)
    .map(([id, stats]) => ({
      id,
      primitive: stats.primitive,
      attempts: stats.attempts,
      successes: stats.successes,
      failures: stats.failures,
      successRate: stats.attempts > 0 ? Number((stats.successes / stats.attempts).toFixed(2)) : 0,
      lastUsedAt: stats.lastUsedAt
    }))
    .sort((left, right) => right.successRate - left.successRate || right.successes - left.successes)
    .slice(0, 8);
  return {
    schemaVersion: memory.schemaVersion,
    updatedAt: memory.updatedAt,
    recoveryStrategies: strategies,
    knownApplicationCount: Object.keys(memory.applications).length,
    knownSemanticTargetCount: Object.keys(memory.semanticTargets).length,
    recentRunCount: memory.recentRuns.length
  };
}

