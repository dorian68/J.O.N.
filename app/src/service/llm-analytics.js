function toStageKey(call) {
  return String(call?.metadata?.reasoningStage ?? call?.callType ?? "unknown").trim() || "unknown";
}

function toStageLabel(stage) {
  switch (stage) {
    case "mission_understanding":
      return "Mission understanding";
    case "run_handoff_decision":
      return "Run handoff";
    case "desktop_plan":
      return "Desktop plan";
    case "plan_generation":
      return "Plan generation";
    case "decision_note_draft":
      return "Decision draft";
    case "evaluation_support":
      return "Evaluator";
    case "ambiguity_note":
      return "Ambiguity note";
    default:
      return stage.replaceAll("_", " ");
  }
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function round(value, digits = 6) {
  return Number(numberOrZero(value).toFixed(digits));
}

function tokenUsageSnapshot(call) {
  const exactInput = call?.tokenUsage?.inputTokens;
  const exactOutput = call?.tokenUsage?.outputTokens;
  const exactTotal = call?.tokenUsage?.totalTokens;
  const estimatedInput = call?.metadata?.tokenGovernance?.estimatedInputTokens;
  const estimatedTotal = call?.metadata?.tokenGovernance?.estimatedTotalTokens;
  const inputTokens = exactInput ?? estimatedInput ?? 0;
  const totalTokens = exactTotal ?? estimatedTotal ?? 0;
  const outputTokens = exactOutput ?? Math.max(0, totalTokens - inputTokens);
  const mode = exactTotal != null
    ? "reported"
    : estimatedTotal != null || estimatedInput != null
      ? "estimated"
      : "unavailable";
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    mode
  };
}

function estimatedCostSnapshot(call) {
  const reportedCost = call?.estimatedCost;
  const governanceEstimate = call?.metadata?.tokenGovernance?.estimatedRequestUsd;
  const value = reportedCost ?? governanceEstimate ?? 0;
  const mode = reportedCost != null
    ? "reported"
    : governanceEstimate != null
      ? "estimated"
      : "unavailable";
  return {
    value: round(value),
    mode
  };
}

function providerModeForCall(call) {
  const providerAlias = String(call?.providerAlias ?? "").trim();
  const resultStatus = String(call?.resultStatus ?? "").trim();
  const executionMode = call?.metadata?.tokenGovernance?.executionMode ?? null;

  if (executionMode === "suppressed" || providerAlias === "governance") {
    return "suppressed";
  }
  if (resultStatus === "failed") {
    return "failed";
  }
  if (providerAlias === "openai_compatible") {
    return "live";
  }
  if (providerAlias === "mock_offline") {
    return "mock";
  }
  if (providerAlias === "deterministic_fallback") {
    return "deterministic";
  }
  return "other";
}

function buildEmptyStageSummary(stage) {
  return {
    stage,
    stageLabel: toStageLabel(stage),
    callCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    reusedCalls: 0,
    suppressedCalls: 0,
    blockedCalls: 0,
    downgradedCalls: 0,
    fallbackCalls: 0,
    degradedCalls: 0,
    liveCalls: 0,
    mockCalls: 0,
    deterministicCalls: 0,
    suppressedProviderCalls: 0,
    failedProviderCalls: 0,
    otherProviderCalls: 0,
    compactionCalls: 0
  };
}

function buildEmptySummary() {
  return {
    callCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    reusedCalls: 0,
    suppressedCalls: 0,
    blockedCalls: 0,
    downgradedCalls: 0,
    fallbackCalls: 0,
    degradedCalls: 0,
    liveCalls: 0,
    mockCalls: 0,
    deterministicCalls: 0,
    suppressedProviderCalls: 0,
    failedProviderCalls: 0,
    otherProviderCalls: 0,
    compactionCalls: 0,
    exactTokenCalls: 0,
    estimatedTokenCalls: 0,
    unavailableTokenCalls: 0,
    exactCostCalls: 0,
    estimatedCostCalls: 0,
    unavailableCostCalls: 0,
    stageBreakdown: [],
    providerModeBreakdown: {
      live: 0,
      mock: 0,
      deterministic: 0,
      suppressed: 0,
      failed: 0,
      other: 0
    },
    topCostDrivers: [],
    topTokenDrivers: [],
    recentRuns: [],
    averages: {
      costPerInstrumentedRun: 0,
      tokensPerInstrumentedRun: 0,
      callsPerInstrumentedRun: 0
    },
    notes: []
  };
}

function summarizeSingleCall(call, stageSummary, summary) {
  const tokenSnapshot = tokenUsageSnapshot(call);
  const costSnapshot = estimatedCostSnapshot(call);
  const executionMode = call?.metadata?.tokenGovernance?.executionMode ?? null;
  const liveProviderBlocked = Boolean(call?.metadata?.tokenGovernance?.liveProviderBlocked);
  const downgraded = Boolean(call?.metadata?.tokenGovernance?.downgraded);
  const fallbackUsed = Boolean(call?.metadata?.fallbackUsed);
  const degradedModeUsed = Boolean(call?.metadata?.degradedModeUsed);
  const compacted = Boolean(call?.metadata?.inputCompaction?.applied);
  const providerMode = providerModeForCall(call);

  summary.callCount += 1;
  summary.inputTokens += tokenSnapshot.inputTokens;
  summary.outputTokens += tokenSnapshot.outputTokens;
  summary.totalTokens += tokenSnapshot.totalTokens;
  summary.estimatedCost = round(summary.estimatedCost + costSnapshot.value);
  stageSummary.callCount += 1;
  stageSummary.inputTokens += tokenSnapshot.inputTokens;
  stageSummary.outputTokens += tokenSnapshot.outputTokens;
  stageSummary.totalTokens += tokenSnapshot.totalTokens;
  stageSummary.estimatedCost = round(stageSummary.estimatedCost + costSnapshot.value);

  if (executionMode === "reused") {
    summary.reusedCalls += 1;
    stageSummary.reusedCalls += 1;
  }
  if (executionMode === "suppressed") {
    summary.suppressedCalls += 1;
    stageSummary.suppressedCalls += 1;
  }
  if (liveProviderBlocked) {
    summary.blockedCalls += 1;
    stageSummary.blockedCalls += 1;
  }
  if (downgraded) {
    summary.downgradedCalls += 1;
    stageSummary.downgradedCalls += 1;
  }
  if (fallbackUsed) {
    summary.fallbackCalls += 1;
    stageSummary.fallbackCalls += 1;
  }
  if (degradedModeUsed) {
    summary.degradedCalls += 1;
    stageSummary.degradedCalls += 1;
  }
  switch (providerMode) {
    case "live":
      summary.liveCalls += 1;
      stageSummary.liveCalls += 1;
      break;
    case "mock":
      summary.mockCalls += 1;
      stageSummary.mockCalls += 1;
      break;
    case "deterministic":
      summary.deterministicCalls += 1;
      stageSummary.deterministicCalls += 1;
      break;
    case "suppressed":
      summary.suppressedProviderCalls += 1;
      stageSummary.suppressedProviderCalls += 1;
      break;
    case "failed":
      summary.failedProviderCalls += 1;
      stageSummary.failedProviderCalls += 1;
      break;
    default:
      summary.otherProviderCalls += 1;
      stageSummary.otherProviderCalls += 1;
      break;
  }
  summary.providerModeBreakdown[providerMode] = (summary.providerModeBreakdown[providerMode] ?? 0) + 1;
  if (compacted) {
    summary.compactionCalls += 1;
    stageSummary.compactionCalls += 1;
  }

  if (tokenSnapshot.mode === "reported") {
    summary.exactTokenCalls += 1;
  } else if (tokenSnapshot.mode === "estimated") {
    summary.estimatedTokenCalls += 1;
  } else {
    summary.unavailableTokenCalls += 1;
  }

  if (costSnapshot.mode === "reported") {
    summary.exactCostCalls += 1;
  } else if (costSnapshot.mode === "estimated") {
    summary.estimatedCostCalls += 1;
  } else {
    summary.unavailableCostCalls += 1;
  }
}

function buildRecentRunSummaries(runs, calls) {
  const callsByRun = new Map();
  for (const call of calls) {
    if (!callsByRun.has(call.runId)) {
      callsByRun.set(call.runId, []);
    }
    callsByRun.get(call.runId).push(call);
  }

  return runs.slice(0, 8).map((run) => {
    const runCalls = callsByRun.get(run.id) ?? [];
    const runSummary = summarizeLlmCalls(runCalls);
    return {
      runId: run.id,
      createdAt: run.createdAt,
      status: run.status,
      mission: run.metadata?.missionSpec?.objective ?? run.mission,
      callCount: runSummary.callCount,
      totalTokens: runSummary.totalTokens,
      estimatedCost: runSummary.estimatedCost,
      fallbackCalls: runSummary.fallbackCalls,
      degradedCalls: runSummary.degradedCalls,
      liveCalls: runSummary.liveCalls,
      mockCalls: runSummary.mockCalls,
      deterministicCalls: runSummary.deterministicCalls,
      suppressedCalls: runSummary.suppressedCalls,
      suppressedProviderCalls: runSummary.suppressedProviderCalls,
      failedProviderCalls: runSummary.failedProviderCalls,
      providerModeBreakdown: runSummary.providerModeBreakdown,
      blockedCalls: runSummary.blockedCalls,
      reusedCalls: runSummary.reusedCalls
    };
  });
}

export function summarizeLlmCalls(calls = [], runs = []) {
  const summary = buildEmptySummary();
  const stageMap = new Map();

  for (const call of calls) {
    const stage = toStageKey(call);
    if (!stageMap.has(stage)) {
      stageMap.set(stage, buildEmptyStageSummary(stage));
    }
    summarizeSingleCall(call, stageMap.get(stage), summary);
  }

  summary.stageBreakdown = Array.from(stageMap.values())
    .map((entry) => ({
      ...entry,
      estimatedCost: round(entry.estimatedCost),
      averageCostPerCall: entry.callCount > 0 ? round(entry.estimatedCost / entry.callCount) : 0,
      averageTokensPerCall: entry.callCount > 0 ? Math.round(entry.totalTokens / entry.callCount) : 0
    }))
    .sort((left, right) => right.estimatedCost - left.estimatedCost || right.totalTokens - left.totalTokens);

  summary.topCostDrivers = summary.stageBreakdown
    .filter((entry) => entry.callCount > 0)
    .slice(0, 4)
    .map((entry) => ({
      kind: "stage",
      label: entry.stageLabel,
      estimatedCost: entry.estimatedCost,
      totalTokens: entry.totalTokens,
      callCount: entry.callCount
    }));

  summary.topTokenDrivers = summary.stageBreakdown
    .filter((entry) => entry.callCount > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens || right.estimatedCost - left.estimatedCost)
    .slice(0, 4)
    .map((entry) => ({
      kind: "stage",
      label: entry.stageLabel,
      totalTokens: entry.totalTokens,
      estimatedCost: entry.estimatedCost,
      callCount: entry.callCount
    }));

  if (Array.isArray(runs) && runs.length > 0) {
    const instrumentedRuns = runs.filter((run) => calls.some((call) => call.runId === run.id));
    summary.recentRuns = buildRecentRunSummaries(runs, calls);
    if (instrumentedRuns.length > 0) {
      summary.averages = {
        costPerInstrumentedRun: round(summary.estimatedCost / instrumentedRuns.length),
        tokensPerInstrumentedRun: Math.round(summary.totalTokens / instrumentedRuns.length),
        callsPerInstrumentedRun: Number((summary.callCount / instrumentedRuns.length).toFixed(2))
      };
    }
  }

  if (summary.estimatedCostCalls > 0 || summary.unavailableCostCalls > 0) {
    summary.notes.push("Estimated cost mixes provider-reported values with governance estimates when exact pricing data is unavailable.");
  }
  if (summary.estimatedTokenCalls > 0 || summary.unavailableTokenCalls > 0) {
    summary.notes.push("Token totals mix provider-reported usage with governance estimates when exact provider usage is unavailable.");
  }
  if (summary.reusedCalls > 0 || summary.suppressedCalls > 0 || summary.blockedCalls > 0) {
    summary.notes.push("Reuse, suppression, and live-provider blocking come from the active token-governance policy.");
  }

  summary.estimatedCost = round(summary.estimatedCost);
  return summary;
}
