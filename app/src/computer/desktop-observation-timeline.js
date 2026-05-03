import { nowIso } from "../utils/ids.js";

export function createDesktopObservationTimeline({ runId, mission }) {
  return {
    schemaVersion: "desktop_observation_timeline_v1",
    runId,
    mission: String(mission ?? "").slice(0, 500),
    startedAt: nowIso(),
    entries: []
  };
}

function compactWindow(windowState = null) {
  if (!windowState) {
    return null;
  }
  return {
    id: windowState.id ?? windowState.windowId ?? null,
    title: windowState.title ?? windowState.window?.title ?? null,
    processName: windowState.processName ?? null,
    bounds: windowState.bounds ?? windowState.window?.bounds ?? null
  };
}

function compactPerception(perception = null) {
  if (!perception) {
    return null;
  }
  const summary = perception.accessibilitySummary ?? null;
  return {
    available: Boolean(perception.available ?? perception.accessibility?.available ?? summary?.available),
    title: perception.title ?? null,
    reason: perception.reason ?? perception.accessibility?.reason ?? null,
    contentPreview: typeof perception.content === "string" ? perception.content.slice(0, 240) : null,
    nodeCount: summary?.nodesReturned ?? perception.accessibility?.nodesReturned ?? null,
    visibleTextPreview: (summary?.visibleTextPreview ?? []).slice(0, 8),
    semanticTargets: (perception.semanticTargets ?? summary?.semanticTargets ?? []).slice(0, 8).map((target) => ({
      id: target.id ?? null,
      label: target.label ?? null,
      role: target.role ?? null
    }))
  };
}

export function appendDesktopObservation(timeline, {
  phase,
  step = null,
  status = "observed",
  window = null,
  perception = null,
  result = null,
  recovery = null,
  error = null,
  capturePath = null,
  visualDescription = null,
  visualHash = null
} = {}) {
  const entry = {
    id: `obs_${timeline.entries.length + 1}`,
    at: nowIso(),
    phase,
    status,
    stepId: step?.id ?? null,
    primitive: step?.primitive ?? null,
    stepLabel: step?.label ?? null,
    window: compactWindow(window),
    perception: compactPerception(perception),
    resultSummary: result ? {
      keys: typeof result === "object" ? Object.keys(result).slice(0, 12) : [],
      recovered: Boolean(result?.recovered),
      targetHandle: result?.targetHandle ?? null
    } : null,
    recovery: recovery ? {
      selectedStrategy: recovery.selectedStrategy ?? recovery.strategy ?? null,
      retryReason: recovery.retryReason ?? recovery.reason ?? null,
      recoveredWindowId: recovery.recoveredWindowId ?? null
    } : null,
    error: error ? String(error.message ?? error).slice(0, 500) : null,
    capturePath,
    visualHash,
    visualDescription: visualDescription ? {
      description: String(visualDescription.description ?? "").slice(0, 500),
      keyElements: (visualDescription.keyElements ?? []).slice(0, 8),
      pageType: visualDescription.pageType ?? null,
      generationMode: visualDescription.generationMode ?? null
    } : null
  };
  timeline.entries.push(entry);
  return entry;
}

export function summarizeDesktopObservationTimeline(timeline) {
  const entries = timeline?.entries ?? [];
  const last = entries.at(-1) ?? null;
  const phases = entries.reduce((counts, entry) => {
    counts[entry.phase] = (counts[entry.phase] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: timeline?.schemaVersion ?? "desktop_observation_timeline_v1",
    entryCount: entries.length,
    failureCount: entries.filter((entry) => entry.status === "failed").length,
    recoveryCount: entries.filter((entry) => entry.phase?.startsWith("recovery")).length,
    multimodalFrameCount: entries.filter((entry) => entry.visualDescription).length,
    phases,
    lastWindowTitle: last?.window?.title ?? null,
    lastPhase: last?.phase ?? null,
    lastStatus: last?.status ?? null,
    screenshotPaths: entries.map((entry) => entry.capturePath).filter(Boolean).slice(-5),
    visualHashes: entries.map((entry) => entry.visualHash).filter(Boolean).slice(-5),
    lastVisualDescription: last?.visualDescription?.description ?? null
  };
}
