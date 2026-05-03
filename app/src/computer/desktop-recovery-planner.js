import { nowIso } from "../utils/ids.js";

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function semanticSelectorForStep(step = {}) {
  const query = cleanText(step.target?.semanticTarget ?? step.input?.semanticTarget ?? "", 160);
  if (!query) {
    return null;
  }
  return {
    query,
    role: cleanText(step.target?.role ?? step.input?.role ?? "", 80) || null,
    automationId: cleanText(step.target?.automationId ?? step.input?.automationId ?? "", 160) || null
  };
}

function strategyFromMemory(memory = null, primitive = "") {
  const strategies = memory?.recoveryStrategies ?? {};
  const ranked = Object.entries(strategies)
    .filter(([, stats]) => stats?.primitive === primitive && stats.successes > 0)
    .sort((left, right) => {
      const leftRate = left[1].successes / Math.max(1, left[1].attempts);
      const rightRate = right[1].successes / Math.max(1, right[1].attempts);
      return rightRate - leftRate || right[1].successes - left[1].successes;
    });
  return ranked[0]?.[0] ?? null;
}

function orderedStrategies(strategies, preferredId = null) {
  const deduped = [];
  const seen = new Set();
  for (const strategy of strategies) {
    if (!strategy?.id || seen.has(strategy.id)) {
      continue;
    }
    seen.add(strategy.id);
    deduped.push(strategy);
  }
  if (!preferredId) {
    return deduped;
  }
  return [
    ...deduped.filter((strategy) => strategy.id === preferredId),
    ...deduped.filter((strategy) => strategy.id !== preferredId)
  ];
}

export function buildDesktopRecoveryPlan({
  step,
  error = null,
  currentWindow = null,
  beforeWindow = null,
  visibleWindows = [],
  desktopMemory = null
} = {}) {
  const primitive = cleanText(step?.primitive, 80);
  const semanticSelector = semanticSelectorForStep(step);
  const reason = cleanText(error?.message ?? "The action could not be verified from the current desktop state.");
  const strategies = [];

  if (currentWindow?.id) {
    strategies.push({
      id: "reinspect_current_window",
      kind: "observe",
      canAutoExecute: true,
      windowId: currentWindow.id,
      label: "Reinspect current window",
      reason: "The target window is still known, so reread its accessibility tree before changing strategy."
    });
  }

  if (semanticSelector) {
    strategies.push({
      id: "semantic_target_retry",
      kind: "actuation_retry",
      canAutoExecute: true,
      selector: semanticSelector,
      candidateWindowIds: Array.from(new Set([
        currentWindow?.id,
        beforeWindow?.id,
        ...visibleWindows.map((windowState) => windowState?.id)
      ].filter(Boolean))),
      label: "Retry semantic target",
      reason: "The intended UI target may be visible in another window or after a fresh accessibility read."
    });
  }

  if (beforeWindow?.id && beforeWindow.id !== currentWindow?.id) {
    strategies.push({
      id: "refocus_prior_window",
      kind: "focus",
      canAutoExecute: true,
      windowId: beforeWindow.id,
      label: "Refocus prior window",
      reason: "The action may have shifted focus away from the original target."
    });
  }

  strategies.push({
    id: "active_window_fallback",
    kind: "observe",
    canAutoExecute: true,
    label: "Use active window fallback",
    reason: "Recover to the foreground window instead of guessing a hidden target."
  });
  strategies.push({
    id: "capture_failure_proof",
    kind: "evidence",
    canAutoExecute: true,
    label: "Capture failure proof",
    reason: "Persist visible proof so the operator can see the blocker."
  });

  const preferredStrategyId = strategyFromMemory(desktopMemory, primitive);
  const ordered = orderedStrategies(strategies, preferredStrategyId);
  return {
    id: `recovery_plan_${step?.id ?? "unknown"}`,
    schemaVersion: "desktop_recovery_plan_v1",
    createdAt: nowIso(),
    trigger: {
      stepId: step?.id ?? null,
      primitive,
      label: cleanText(step?.label, 160),
      reason
    },
    preferredStrategyId,
    strategies: ordered,
    canAutoRecover: ordered.some((strategy) => strategy.canAutoExecute),
    userFacingSummary: {
      title: "Action desktop non vérifiée",
      explanation: `Je n'ai pas pu confirmer l'étape "${cleanText(step?.label || primitive, 140)}".`,
      likelyCause: reason,
      nextAction: ordered[0]?.label ?? "Capture failure proof"
    }
  };
}

