import { summarizeLlmCalls } from "./llm-analytics.js";

function buildMap(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function deriveOperatorState(run, pendingApprovals) {
  if (!run) {
    return {
      code: "no_run",
      label: "No run selected",
      tone: "neutral"
    };
  }

  if (run.status === "completed") {
    return {
      code: "finished",
      label: "Run finished",
      tone: "ok"
    };
  }

  if (run.status === "stopped") {
    return {
      code: "stopped",
      label: "Run stopped",
      tone: "danger"
    };
  }

  if (run.status === "failed") {
    return {
      code: "failed",
      label: "Run failed",
      tone: "danger"
    };
  }

  if (run.status === "paused" && pendingApprovals.length > 0) {
    return {
      code: "blocked_approval",
      label: "Blocked on approval",
      tone: "warn"
    };
  }

  if (run.status === "paused" && run.lifecycleStage === "queued_surface_lock") {
    return {
      code: "queued",
      label: "Queued on shared surface",
      tone: "info"
    };
  }

  if (run.status === "running") {
    return {
      code: "running",
      label: "Run executing",
      tone: "info"
    };
  }

  if (run.status === "planned") {
    return {
      code: "planned",
      label: "Plan ready",
      tone: "warn"
    };
  }

  return {
    code: run.status,
    label: run.status,
    tone: "neutral"
  };
}

function extractReferences(payload = {}) {
  return {
    approvalId: payload.approvalId ?? null,
    sourceId: payload.sourceId ?? null,
    evidenceId: payload.evidenceId ?? null,
    artifactId: payload.artifactId ?? null,
    llmCallId: payload.llmCallId ?? null
  };
}

function buildLifecycle(events) {
  const importantPrefixes = [
    "run.",
    "plan.",
    "approval.",
    "artifact.",
    "source.",
    "evidence."
  ];

  return events.filter((event) => importantPrefixes.some((prefix) => event.type.startsWith(prefix)));
}

function uniqueItems(items = []) {
  return Array.from(new Set(items.map((entry) => String(entry ?? "").trim()).filter(Boolean)));
}

function verificationSummaryView(verificationSummary = null) {
  if (!verificationSummary) {
    return {
      overallStatus: null,
      passedChecks: [],
      failedChecks: [],
      verificationGoals: []
    };
  }
  return {
    overallStatus: verificationSummary.overallStatus ?? null,
    passedChecks: (verificationSummary.checks ?? [])
      .filter((check) => check.status === "pass")
      .map((check) => check.label),
    failedChecks: (verificationSummary.checks ?? [])
      .filter((check) => check.status !== "pass")
      .map((check) => check.label),
    verificationGoals: verificationSummary.verificationGoals ?? []
  };
}

function buildOutcomeSummary({ run, counts, missionUnderstanding, verificationSummary, llmUsage }) {
  if (!run) {
    return null;
  }

  const orchestration = run.metadata?.orchestration ?? {};
  const verificationView = verificationSummaryView(verificationSummary);
  const didNow = uniqueItems(missionUnderstanding?.coveredNow ?? missionUnderstanding?.requestedOutcomes ?? []);
  const notDoneNow = uniqueItems([
    ...(missionUnderstanding?.notCoveredNow ?? []),
    ...(missionUnderstanding?.unsupportedRequests ?? []),
    ...verificationView.failedChecks.map((label) => `Verification still missing or failed: ${label}`)
  ]);
  const verifiedNow = uniqueItems([
    ...(missionUnderstanding?.verificationGoals ?? []),
    ...verificationView.passedChecks
  ]);
  const nextRunRecommendation = missionUnderstanding?.nextRunRecommendation ?? null;
  const maybeLaterRecommendation = missionUnderstanding?.maybeLaterRecommendation ?? null;

  return {
    clarifiedObjective: missionUnderstanding?.clarifiedObjective ?? run.metadata?.missionSpec?.objective ?? run.mission,
    coverageStatus: missionUnderstanding?.coverageStatus ?? null,
    runStatus: run.status,
    verificationStatus: verificationView.overallStatus,
    didNow,
    verifiedNow,
    notDoneNow,
    recommendedNextStep: {
      summary: missionUnderstanding?.nextRunSuggestion ?? "No follow-up run is recommended if this run completes as planned.",
      recommendation: nextRunRecommendation,
      canPrepare: Boolean(nextRunRecommendation)
    },
    maybeLater: {
      summary: missionUnderstanding?.maybeLaterSuggestion ?? "No later run is suggested right now.",
      recommendation: maybeLaterRecommendation,
      canPrepare: Boolean(maybeLaterRecommendation)
    },
    selectedBrowser: missionUnderstanding?.selectedBrowser ?? null,
    ambiguityNote: missionUnderstanding?.ambiguityNote ?? "",
    requiresClarification: Boolean(missionUnderstanding?.requiresClarification),
    clarificationQuestion: missionUnderstanding?.clarificationQuestion ?? "",
    chain: {
      chainId: orchestration.chainId ?? null,
      rootRunId: orchestration.rootRunId ?? run.id,
      parentRunId: orchestration.parentRunId ?? null,
      runIndex: orchestration.runIndex ?? 1,
      maxAutoRuns: orchestration.maxAutoRuns ?? 1,
      autoContinueRequested: Boolean(orchestration.autoContinueRequested),
      continuedToRunId: orchestration.continuedToRunId ?? null
    },
    handoffDecision: orchestration.handoffDecision ?? null,
    capabilityRecovery: run.metadata?.orchestrationRecovery ?? null,
    browserObservationSummary: run.metadata?.browserObservationSummary ?? null,
    desktopObservationSummary: run.metadata?.desktopObservationSummary ?? null,
    desktopMemorySummary: run.metadata?.desktopMemorySummary ?? null,
    userFacingError: run.metadata?.userFacingError ?? null,
    artifactsCreated: counts.artifacts,
    proofItems: counts.evidence,
    sourcesUsed: counts.sources,
    llmUsage: {
      callCount: llmUsage.callCount,
      totalTokens: llmUsage.totalTokens,
      estimatedCost: llmUsage.estimatedCost,
      fallbackCalls: llmUsage.fallbackCalls,
      degradedCalls: llmUsage.degradedCalls,
      reusedCalls: llmUsage.reusedCalls
    }
  };
}

export function buildRunReviewModel(bundle, pendingApprovals = []) {
  const sourceById = buildMap(bundle.sources);
  const eventById = buildMap(bundle.events);
  const evidenceById = buildMap(bundle.evidence);
  const artifactById = buildMap(bundle.artifacts);
  const approvalById = buildMap(bundle.approvals);
  const llmCallById = buildMap(bundle.llmCalls ?? []);
  const reasoningSnapshotById = buildMap(bundle.reasoningSnapshots ?? []);

  const evidence = bundle.evidence.map((entry) => ({
    ...entry,
    linkedSource: entry.linkedSourceId ? sourceById.get(entry.linkedSourceId) ?? null : null,
    linkedEvent: entry.linkedEventId ? eventById.get(entry.linkedEventId) ?? null : null,
    hasScreenshot: Boolean(entry.metadata?.screenshotPath)
  }));

  const evidenceByLinkedSource = new Map();
  for (const item of evidence) {
    if (!item.linkedSourceId) {
      continue;
    }
    if (!evidenceByLinkedSource.has(item.linkedSourceId)) {
      evidenceByLinkedSource.set(item.linkedSourceId, []);
    }
    evidenceByLinkedSource.get(item.linkedSourceId).push(item);
  }

  const approvals = bundle.approvals.map((approval) => ({
    ...approval,
    decisionAt: approval.metadata?.decisionAt ?? null,
    operatorRationale: approval.metadata?.operatorRationale ?? null,
    targetPage: approval.metadata?.targetPage ?? null,
    targetWindowId: approval.metadata?.targetWindowId ?? null,
    linkedEvidence: approval.evidenceId ? evidenceById.get(approval.evidenceId) ?? null : null
  }));

  const pending = pendingApprovals.map((approval) => ({
    ...approval,
    targetPage: approval.metadata?.targetPage ?? null,
    targetWindowId: approval.metadata?.targetWindowId ?? null
  }));

  const events = bundle.events.map((event) => {
    const refs = extractReferences(event.payload);
    return {
      ...event,
      refs,
      linkedApproval: refs.approvalId ? approvalById.get(refs.approvalId) ?? null : null,
      linkedSource: refs.sourceId ? sourceById.get(refs.sourceId) ?? null : null,
      linkedEvidence: refs.evidenceId ? evidenceById.get(refs.evidenceId) ?? null : null,
      linkedArtifact: refs.artifactId ? artifactById.get(refs.artifactId) ?? null : null,
      linkedLlmCall: refs.llmCallId ? llmCallById.get(refs.llmCallId) ?? null : null
    };
  });

  const sources = bundle.sources.map((source) => ({
    ...source,
    linkedEvidence: evidenceByLinkedSource.get(source.id) ?? []
  }));

  const artifacts = bundle.artifacts.map((artifact) => {
    const sourceIds = artifact.metadata?.sourceIds ?? [];
    const evidenceIds = artifact.metadata?.evidenceIds ?? [];
    return {
      ...artifact,
      linkedSources: sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean),
      linkedEvidence: evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).filter(Boolean),
      linkedLlmCall: artifact.metadata?.llmCallId ? llmCallById.get(artifact.metadata.llmCallId) ?? null : null,
      linkedReasoningSnapshots: (artifact.metadata?.reasoningContextSnapshotIds ?? [])
        .map((snapshotId) => reasoningSnapshotById.get(snapshotId))
        .filter(Boolean)
    };
  });

  const llmCalls = (bundle.llmCalls ?? []).map((call) => ({
    ...call,
    linkedEvents: events.filter((event) => event.refs.llmCallId === call.id),
    linkedArtifacts: artifacts.filter((artifact) => artifact.metadata?.llmCallId === call.id),
    linkedReasoningSnapshot: call.metadata?.contextSnapshotId ? reasoningSnapshotById.get(call.metadata.contextSnapshotId) ?? null : null
  }));

  const llmUsage = summarizeLlmCalls(llmCalls);

  const reasoningSnapshots = (bundle.reasoningSnapshots ?? []).map((snapshot) => ({
    ...snapshot,
    linkedLlmCalls: llmCalls.filter((call) => call.metadata?.contextSnapshotId === snapshot.id)
  }));

  const missionUnderstanding = bundle.run?.plan?.missionUnderstanding ?? null;
  const verificationSummary = bundle.run?.metadata?.verificationSummary ?? null;
  const counts = {
    events: events.length,
    approvals: approvals.length,
    pendingApprovals: pending.length,
    sources: sources.length,
    evidence: evidence.length,
    artifacts: artifacts.length,
    llmCalls: llmCalls.length,
    reasoningSnapshots: reasoningSnapshots.length
  };

  return {
    ...bundle,
    approvals,
    pendingApprovals: pending,
    sources,
    evidence,
    artifacts,
    reasoningSnapshots,
    llmCalls,
    events,
    review: {
      operatorState: deriveOperatorState(bundle.run, pending),
      counts,
      lifecycle: buildLifecycle(events),
      mission: bundle.run?.mission ?? null,
      planSteps: bundle.run?.plan?.steps ?? [],
      llmUsage,
      outcomeSummary: buildOutcomeSummary({
        run: bundle.run,
        counts,
        missionUnderstanding,
        verificationSummary,
        llmUsage
      })
    }
  };
}
