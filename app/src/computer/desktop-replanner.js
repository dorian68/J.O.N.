function compactStep(step = null) {
  if (!step) {
    return null;
  }
  return {
    id: step.id ?? null,
    primitive: step.primitive ?? null,
    label: step.label ?? null,
    target: step.target ?? {},
    input: step.input ?? {},
    expectedOutcome: step.expectedOutcome ?? ""
  };
}

function compactActionLogEntry(entry = null) {
  if (!entry) {
    return null;
  }
  return {
    step: compactStep(entry.step),
    status: entry.status ?? null,
    error: entry.error ?? null,
    recoveryStrategy: entry.recovery?.selectedStrategy ?? entry.recovery?.strategy ?? null,
    resultKeys: entry.result && typeof entry.result === "object" ? Object.keys(entry.result).slice(0, 8) : []
  };
}

export function buildDesktopReplanContext({
  run = null,
  failedStep = null,
  error = null,
  currentStepIndex = 0,
  remainingSteps = [],
  actionLog = [],
  observationSummary = null,
  currentWindow = null
} = {}) {
  return {
    schemaVersion: "desktop_replan_context_v1",
    mission: run?.mission ?? null,
    trigger: {
      failedStep: compactStep(failedStep),
      error: String(error?.message ?? error ?? "").slice(0, 500),
      currentStepIndex
    },
    currentWindow: currentWindow ? {
      id: currentWindow.id ?? null,
      title: currentWindow.title ?? null,
      processName: currentWindow.processName ?? null
    } : null,
    completedOrAttemptedSteps: actionLog.map(compactActionLogEntry).filter(Boolean).slice(-10),
    remainingSteps: remainingSteps.map(compactStep).filter(Boolean).slice(0, 10),
    observationSummary,
    instruction: "Return a replacement continuation from the current desktop state. Do not repeat completed steps unless needed for recovery. Prefer observe/read/refocus/semantic actions before asking the operator."
  };
}

export function selectDesktopReplanContinuation(output = null, { maxSteps = 8 } = {}) {
  if (!output || output.requiresClarification) {
    return [];
  }
  const steps = Array.isArray(output.steps) ? output.steps : [];
  return steps
    .filter((step) => step?.primitive && step.primitive !== "stop")
    .slice(0, maxSteps);
}
