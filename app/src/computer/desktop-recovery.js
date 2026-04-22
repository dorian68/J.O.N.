export function buildRecoveryAttempt({ step, error = null, currentWindow = null, beforeWindow = null }) {
  const primitive = String(step?.primitive ?? "").trim();
  const reason = error?.message ?? "Post-action verification did not have enough evidence.";
  const strategies = [];

  if (currentWindow?.id) {
    strategies.push({
      id: "reinspect_current_window",
      label: "Reinspect current window",
      kind: "observe",
      reason: "The target window is still known; re-read accessibility state before retrying."
    });
  }

  if (beforeWindow?.id && beforeWindow.id !== currentWindow?.id) {
    strategies.push({
      id: "refocus_prior_window",
      label: "Refocus prior window",
      kind: "focus",
      windowId: beforeWindow.id,
      reason: "The action may have shifted focus away from the original target."
    });
  }

  strategies.push({
    id: "active_window_fallback",
    label: "Use active window fallback",
    kind: "observe",
    reason: "Recover to the current foreground window rather than guessing a hidden target."
  });

  if (primitive === "click_point" && (step?.target?.semanticTarget || step?.input?.semanticTarget)) {
    strategies.push({
      id: "semantic_target_retry",
      label: "Retry semantic target resolution",
      kind: "semantic_resolution",
      reason: "The intended UI target may have moved after the previous observation."
    });
  }

  strategies.push({
    id: "capture_failure_proof",
    label: "Capture failure proof",
    kind: "evidence",
    reason: "Persist visible proof instead of hiding the failed or ambiguous state."
  });

  return {
    attemptedAt: new Date().toISOString(),
    reason,
    primitive,
    strategies,
    selectedStrategy: strategies[0]?.id ?? "capture_failure_proof"
  };
}

export function checkpointRecord({ step, before = null, after = null, safety = null, recovery = null, verification = null }) {
  return {
    id: `checkpoint_${step?.id ?? "unknown"}`,
    stepId: step?.id ?? null,
    primitive: step?.primitive ?? null,
    createdAt: new Date().toISOString(),
    before: before ? {
      windowId: before.windowId ?? before.id ?? null,
      title: before.title ?? null,
      accessibilityAvailable: Boolean(before.accessibility?.available ?? before.accessibilitySummary?.available)
    } : null,
    after: after ? {
      windowId: after.windowId ?? after.id ?? null,
      title: after.title ?? null,
      accessibilityAvailable: Boolean(after.accessibility?.available ?? after.accessibilitySummary?.available)
    } : null,
    safety,
    recovery,
    verification
  };
}
