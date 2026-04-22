const state = {
  dashboard: null,
  selectedProjectId: null,
  selectedRunId: null,
  selectedBenchmarkCreatedAt: null,
  runDetail: null,
  missionPreflight: null,
  preview: null,
  feedback: null,
  agentConfig: null,
  agentConfigPreview: null,
  capabilityPanel: {
    query: "",
    kind: "",
    skillId: "",
    riskLevel: "",
    rankingMission: "",
    rankingResult: null,
    userSkillJson: ""
  },
  liveUpdates: "connecting",
  liveFeed: [],
  lastRefreshAt: null,
  workspaceTab: "run",
  missionDraft: {
    mode: "",
    modeTouched: false,
    objective: "",
    deliverable: "",
    constraints: "",
    forbiddenActions: "",
    browserId: "",
    browserSearchQuery: "",
    browserLaunchUrl: "",
    computerActionType: "",
    autoContinue: true,
    formName: "",
    formRole: "operator",
    formSubscribe: false
  },
  busy: {
    scenarioId: null,
    preflight: false,
    mission: false,
    benchmark: false,
    benchmarkReviewSuiteId: null,
    agentConfig: false,
    capabilityGraph: false,
    cleanup: null,
    approvals: new Set()
  }
};

const elements = {
  flashBanner: document.querySelector("#flash-banner"),
  projects: document.querySelector("#projects-list"),
  missionOnboarding: document.querySelector("#mission-onboarding"),
  missionEntry: document.querySelector("#mission-entry"),
  currentMissionPanel: document.querySelector("#current-mission-panel"),
  scenarios: document.querySelector("#scenario-list"),
  runs: document.querySelector("#runs-list"),
  statusBanner: document.querySelector("#status-banner"),
  runSummary: document.querySelector("#run-summary"),
  runLifecycle: document.querySelector("#run-lifecycle"),
  workspaceTabs: document.querySelector("#workspace-tabs"),
  runWorkspace: document.querySelector("#run-workspace"),
  outputsWorkspace: document.querySelector("#outputs-workspace"),
  diagnosticsWorkspace: document.querySelector("#diagnostics-workspace"),
  approvals: document.querySelector("#approvals-list"),
  approvalHistory: document.querySelector("#approval-history-list"),
  events: document.querySelector("#events-list"),
  sources: document.querySelector("#sources-list"),
  llmCalls: document.querySelector("#llm-calls-list"),
  evidence: document.querySelector("#evidence-list"),
  artifacts: document.querySelector("#artifacts-list"),
  llmDashboard: document.querySelector("#llm-dashboard"),
  agentConfig: document.querySelector("#agent-config-panel"),
  guardrails: document.querySelector("#guardrails-panel"),
  capabilityGraph: document.querySelector("#capability-graph-panel"),
  preview: document.querySelector("#preview-pane"),
  benchmarks: document.querySelector("#benchmarks-pane")
};

const SURFACE_MODE = document.body.dataset.surface ?? "user";
const IS_ADMIN_SURFACE = SURFACE_MODE === "admin";

function hasElement(element) {
  return Boolean(element);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusPill(status) {
  if (["completed", "pass", "gating_pass", "live"].includes(status)) {
    return "ok";
  }
  if (["paused", "planned", "created", "skipped", "connecting"].includes(status)) {
    return "warn";
  }
  if (["failed", "stopped", "fail", "gating_fail", "degraded"].includes(status)) {
    return "danger";
  }
  return "";
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function approvalPill(decision) {
  if (decision === "approved_once") {
    return "ok";
  }
  if (decision === "pending" || decision === "auto_approved") {
    return "warn";
  }
  if (["denied", "stop_run", "blocked"].includes(decision)) {
    return "danger";
  }
  return "";
}

function currentRun() {
  return state.runDetail?.run ?? null;
}

function currentResolvedApprovals() {
  return (state.runDetail?.approvals ?? []).filter((approval) => approval.decision !== "pending");
}

function truncate(value, maxLength = 120) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function benchmarkReports() {
  const reports = [];
  if (state.dashboard?.latestBenchmark) {
    reports.push(state.dashboard.latestBenchmark);
  }
  for (const report of state.dashboard?.benchmarkHistory ?? []) {
    if (!reports.some((candidate) => candidate.createdAt === report.createdAt)) {
      reports.push(report);
    }
  }
  return reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function selectedBenchmarkReport() {
  const reports = benchmarkReports();
  if (reports.length === 0) {
    return null;
  }
  if (!state.selectedBenchmarkCreatedAt) {
    return reports[0];
  }
  return reports.find((report) => report.createdAt === state.selectedBenchmarkCreatedAt) ?? reports[0];
}

function badge(label, tone = "") {
  return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
}

function skillStatusTone(status) {
  return ["operational_basic", "operational_deep"].includes(status) ? "ok" : "warn";
}

function setFeedback(message, tone = "info") {
  state.feedback = {
    message,
    tone,
    createdAt: new Date().toISOString()
  };
}

function clearFeedback() {
  state.feedback = null;
}

function pushLiveFeed(event) {
  const type = String(event?.type ?? "update");
  const payload = event?.payload ?? {};
  state.liveFeed = [
    {
      type,
      runId: payload.runId ?? null,
      createdAt: event?.createdAt ?? new Date().toISOString(),
      payload
    },
    ...state.liveFeed
  ].slice(0, 24);
}

function llmModeTone(mode) {
  if (["live_only", "live_with_mock_fallback"].includes(mode)) {
    return "ok";
  }
  if (["mock_only", "deterministic_only"].includes(mode)) {
    return "warn";
  }
  if (["degraded_mock_only", "unavailable"].includes(mode)) {
    return "danger";
  }
  return "";
}

function refButtons(refs = {}) {
  const runId = currentRun()?.id ?? "";
  const items = [];
  if (refs.approvalId) {
    items.push(`<span class="pill">approval ${escapeHtml(refs.approvalId)}</span>`);
  }
  if (refs.sourceId) {
    items.push(`<span class="pill">source ${escapeHtml(refs.sourceId)}</span>`);
  }
  if (refs.evidenceId) {
    items.push(`<button type="button" class="ghost small" data-action="view-evidence" data-run-id="${escapeHtml(runId)}" data-evidence-id="${escapeHtml(refs.evidenceId)}">Evidence</button>`);
  }
  if (refs.artifactId) {
    items.push(`<button type="button" class="ghost small" data-action="view-artifact" data-run-id="${escapeHtml(runId)}" data-artifact-id="${escapeHtml(refs.artifactId)}">Artifact</button>`);
  }
  if (refs.llmCallId) {
    items.push(`<button type="button" class="ghost small" data-action="view-llm-call" data-llm-call-id="${escapeHtml(refs.llmCallId)}">LLM call</button>`);
  }
  return items.length > 0 ? `<div class="pill-row">${items.join("")}</div>` : "";
}

function currentProject() {
  return state.dashboard?.projects.find((project) => project.id === state.selectedProjectId) ?? null;
}

function currentRuns() {
  return currentProject()?.runs ?? [];
}

function runChainRootId(run) {
  return run?.metadata?.orchestration?.rootRunId ?? run?.id ?? null;
}

function sortRunsForChain(runs = []) {
  return [...runs].sort((left, right) => {
    const leftIndex = Number(left.metadata?.orchestration?.runIndex ?? 0);
    const rightIndex = Number(right.metadata?.orchestration?.runIndex ?? 0);
    if (leftIndex !== rightIndex) {
      return rightIndex - leftIndex;
    }
    return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
  });
}

function currentPendingApprovals() {
  if (state.runDetail?.pendingApprovals) {
    return state.runDetail.pendingApprovals;
  }
  const all = state.dashboard?.pendingApprovals ?? [];
  return state.selectedRunId
    ? all.filter((approval) => approval.runId === state.selectedRunId)
    : all;
}

function missionEntryContract() {
  return state.dashboard?.missionEntry ?? {
    defaultModeId: "research",
    modes: state.dashboard?.scenarios ?? [],
    limits: {
      objectiveMaxLength: 360,
      deliverableMaxLength: 180,
      lineItemMaxLength: 180,
      maxListItems: 6
    },
    formDefaults: {
      name: "Jordan Labry",
      role: "operator",
      subscribe: false
    },
    formRoleOptions: [
      { value: "analyst", label: "Analyst" },
      { value: "operator", label: "Operator" },
      { value: "lead", label: "Lead" }
    ],
    notices: [],
    starterMissions: []
  };
}

function missionModeOptions() {
  return missionEntryContract().modes ?? [];
}

function selectedMissionMode() {
  return missionModeOptions().find((mode) => mode.id === state.missionDraft.mode) ?? null;
}

function syncMissionDraftWithDashboard() {
  const contract = missionEntryContract();
  if (state.missionDraft.mode && !missionModeOptions().some((mode) => mode.id === state.missionDraft.mode)) {
    state.missionDraft.mode = "";
    state.missionDraft.modeTouched = false;
  }
  if (!state.missionDraft.formName) {
    state.missionDraft.formName = contract.formDefaults?.name ?? "Jordan Labry";
  }
  if (!state.missionDraft.formRole) {
    state.missionDraft.formRole = contract.formDefaults?.role ?? "operator";
  }
  if (state.missionDraft.browserId && !availableBrowsers().some((browser) => browser.id === state.missionDraft.browserId)) {
    state.missionDraft.browserId = "";
  }
}

function missionStarterTemplates() {
  return missionEntryContract().starterMissions ?? [];
}

function missionStarterTemplate(exampleId) {
  return missionStarterTemplates().find((example) => example.id === exampleId) ?? null;
}

function availableBrowsers() {
  return state.dashboard?.desktopActionSupport?.availableBrowsers ?? [];
}

function selectedBrowserPreference() {
  return availableBrowsers().find((browser) => browser.id === state.missionDraft.browserId) ?? null;
}

function populateMissionDraftFromTemplate(template) {
  if (!template) {
    return;
  }
  const defaults = missionEntryContract().formDefaults ?? {};
  state.missionDraft.mode = template.mode;
  state.missionDraft.modeTouched = true;
  state.missionDraft.objective = template.objective ?? "";
  state.missionDraft.deliverable = template.deliverable ?? "";
  state.missionDraft.constraints = (template.constraints ?? []).join("\n");
  state.missionDraft.forbiddenActions = (template.forbiddenActions ?? []).join("\n");
  state.missionDraft.browserId = "";
  state.missionDraft.browserSearchQuery = "";
  state.missionDraft.browserLaunchUrl = "";
  state.missionDraft.computerActionType = "";
  if (template.mode === "form") {
    state.missionDraft.formName = defaults.name ?? "Jordan Labry";
    state.missionDraft.formRole = defaults.role ?? "operator";
    state.missionDraft.formSubscribe = Boolean(defaults.subscribe);
  }
}

function missionBusy() {
  return state.busy.preflight || state.busy.mission || state.busy.scenarioId;
}

function currentMissionPreflight() {
  return state.missionPreflight?.understanding ?? null;
}

function currentOutcomeSummary() {
  return state.runDetail?.review?.outcomeSummary ?? null;
}

function clearMissionPreflight() {
  state.missionPreflight = null;
}

function executionFrameLabel(frame) {
  switch (frame) {
    case "research":
      return "bounded web research";
    case "form_preparation":
      return "controlled form preparation";
    case "computer_observation":
      return "local desktop step";
    default:
      return "bounded run";
  }
}

function preflightCoverageTone(status) {
  if (status === "full") {
    return "ok";
  }
  if (status === "partial" || status === "clarification_needed") {
    return "warn";
  }
  return "";
}

function followUpRecommendationLabel(recommendation) {
  if (!recommendation) {
    return "";
  }
  return recommendation.objective || recommendation.deliverable || "";
}

function recommendationToMissionDraft(recommendation) {
  if (!recommendation) {
    return null;
  }
  return {
    mode: recommendation.preferredMode ?? "",
    modeTouched: Boolean(recommendation.preferredMode),
    objective: recommendation.objective ?? "",
    deliverable: recommendation.deliverable ?? "",
    constraints: "",
    forbiddenActions: "",
    browserId: recommendation.parameters?.browserLaunch?.browserId ?? "",
    browserSearchQuery: recommendation.parameters?.browserLaunch?.searchQuery ?? "",
    browserLaunchUrl: recommendation.parameters?.browserLaunch?.url ?? "",
    computerActionType: recommendation.parameters?.computerAction?.type ?? "",
    formName: state.missionDraft.formName,
    formRole: state.missionDraft.formRole,
    formSubscribe: state.missionDraft.formSubscribe,
    autoContinue: state.missionDraft.autoContinue
  };
}

function focusMissionComposer() {
  const composer = document.querySelector("#mission-objective");
  composer?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
  composer?.focus();
}

async function prepareMissionRecommendation(recommendation, { autoReview = true } = {}) {
  const nextDraft = recommendationToMissionDraft(recommendation);
  if (!nextDraft) {
    throw new Error("No follow-up mission is available for this run.");
  }
  state.missionDraft = {
    ...state.missionDraft,
    ...nextDraft
  };
  clearMissionPreflight();
  state.preview = null;
  state.workspaceTab = "run";
  render();
  focusMissionComposer();
  if (autoReview) {
    await reviewMission();
    setFeedback("Recommended next step loaded and reviewed. Confirm it when you are ready.", "ok");
  } else {
    setFeedback("Recommended next step loaded into the mission composer.", "ok");
  }
}

function buildMissionDraftPayload({ includeMode = false } = {}) {
  const contract = missionEntryContract();
  const payload = {
    objective: state.missionDraft.objective,
    deliverable: state.missionDraft.deliverable,
    constraints: state.missionDraft.constraints,
    forbiddenActions: state.missionDraft.forbiddenActions
  };
  if (includeMode && state.missionDraft.mode) {
    payload.mode = state.missionDraft.mode;
  }
  if ((includeMode && state.missionDraft.mode === "form") || state.missionDraft.mode === "form") {
    payload.parameters = {
      ...(payload.parameters ?? {}),
      formValues: {
        name: state.missionDraft.formName || contract.formDefaults?.name,
        role: state.missionDraft.formRole || contract.formDefaults?.role,
        subscribe: Boolean(state.missionDraft.formSubscribe)
      }
    };
  }
  if (state.missionDraft.browserId || state.missionDraft.browserSearchQuery || state.missionDraft.browserLaunchUrl) {
    payload.parameters = {
      ...(payload.parameters ?? {}),
      browserLaunch: {
        ...(state.missionDraft.browserId ? { browserId: state.missionDraft.browserId } : {}),
        ...(state.missionDraft.browserSearchQuery ? { searchQuery: state.missionDraft.browserSearchQuery } : {}),
        ...(state.missionDraft.browserLaunchUrl ? { url: state.missionDraft.browserLaunchUrl } : {})
      }
    };
  }
  if (state.missionDraft.computerActionType) {
    payload.parameters = {
      ...(payload.parameters ?? {}),
      computerAction: {
        type: state.missionDraft.computerActionType
      }
    };
  }
  return payload;
}

function describeRunStatus(run, pendingApprovals = 0) {
  if (!run) {
    return {
      label: "Ready for a new mission",
      tone: "ok",
      detail: "Write the goal above, review how the cowork understood it, then confirm the run."
    };
  }
  if (run.status === "completed") {
    return {
      label: "Run finished",
      tone: "ok",
      detail: "Results and proof are ready to review."
    };
  }
  if (run.status === "paused" && pendingApprovals > 0) {
    return {
      label: "Waiting for your approval",
      tone: "warn",
      detail: "The run is paused until you choose how to proceed."
    };
  }
  if (run.status === "running") {
    return {
      label: "Run in progress",
      tone: "warn",
      detail: "Live progress, proof capture, and outputs are updating below."
    };
  }
  if (run.status === "failed" || run.status === "stopped") {
    return {
      label: "Run stopped",
      tone: "danger",
      detail: "Open the current run to inspect what blocked it."
    };
  }
  return {
    label: `Run ${run.status}`,
    tone: statusPill(run.status),
    detail: run.summary || "The run is active in a bounded, reviewable state."
  };
}

function describeGatewayState(llmGatewayStatus) {
  if (!llmGatewayStatus) {
    return null;
  }
  const effectiveMode = llmGatewayStatus.effectiveMode ?? llmGatewayStatus.providerMode ?? "unknown";
  if (["live_only", "live_with_mock_fallback"].includes(effectiveMode)) {
    return {
      label: "Live AI available",
      tone: "ok",
      detail: "The run can use the configured live provider when the policy allows it."
    };
  }
  if (["mock_only", "deterministic_only"].includes(effectiveMode)) {
    return {
      label: "Fallback-only path",
      tone: "warn",
      detail: "This session is using bounded fallback behavior instead of the live provider."
    };
  }
  return {
    label: "Degraded AI path",
    tone: "danger",
    detail: "The session is currently relying on degraded or unavailable live-provider behavior."
  };
}

function workspaceTabs() {
  if (IS_ADMIN_SURFACE) {
    return [
      {
        id: "run",
        label: "Live run",
        description: "Status, plan, approvals"
      },
      {
        id: "outputs",
        label: "Results",
        description: "Outputs, proof, sources"
      },
      {
        id: "diagnostics",
        label: "Diagnostics",
        description: "LLM traces, events, benchmarks"
      }
    ];
  }
  return [
    {
      id: "run",
      label: "Mission progress",
      description: "Status, plan, approvals"
    },
    {
      id: "outputs",
      label: "Results",
      description: "Outputs, proof, sources"
    }
  ];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function refreshDashboard({ preserveRun = true } = {}) {
  const dashboard = await api("/api/dashboard");
  state.dashboard = dashboard;
  state.agentConfig = dashboard.agentConfiguration ?? state.agentConfig;
  state.lastRefreshAt = new Date().toISOString();
  syncMissionDraftWithDashboard();

  if (!state.selectedProjectId || !dashboard.projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = dashboard.selectedProjectId ?? dashboard.projects[0]?.id ?? null;
  }

  const runs = currentRuns();
  const selectedRunBeforeRefresh = state.runDetail?.run
    ?? runs.find((run) => run.id === state.selectedRunId)
    ?? null;
  const selectedRootRunId = selectedRunBeforeRefresh ? runChainRootId(selectedRunBeforeRefresh) : null;
  if (!preserveRun || !state.selectedRunId || !runs.some((run) => run.id === state.selectedRunId)) {
    state.selectedRunId = runs[0]?.id ?? null;
  }
  if (preserveRun && selectedRootRunId) {
    const sameChainRuns = sortRunsForChain(runs.filter((run) => runChainRootId(run) === selectedRootRunId));
    const activeSameChain = sameChainRuns.find((run) => (dashboard.activeRunIds ?? []).includes(run.id)) ?? null;
    const newestSameChain = sameChainRuns[0] ?? null;
    const shouldFollow = activeSameChain
      ?? (selectedRunBeforeRefresh?.status === "completed" && newestSameChain && newestSameChain.id !== state.selectedRunId
        ? newestSameChain
        : null);
    if (shouldFollow) {
      state.selectedRunId = shouldFollow.id;
    }
  }

  const reports = benchmarkReports();
  if (!state.selectedBenchmarkCreatedAt || !reports.some((report) => report.createdAt === state.selectedBenchmarkCreatedAt)) {
    state.selectedBenchmarkCreatedAt = reports[0]?.createdAt ?? null;
  }

  if (state.selectedRunId) {
    state.runDetail = await api(`/api/runs/${state.selectedRunId}`);
  } else {
    state.runDetail = null;
  }
}

async function startScenario(scenarioId) {
  state.busy.scenarioId = scenarioId;
  clearFeedback();
  render();
  try {
    const response = await api(`/api/projects/${state.selectedProjectId}/runs`, {
      method: "POST",
      body: JSON.stringify({ scenarioId })
    });
    state.selectedRunId = response.runId;
    state.workspaceTab = "run";
    state.preview = null;
    await refreshDashboard({ preserveRun: true });
    setFeedback("Quick start launched. Follow the live run below.", "ok");
  } finally {
    state.busy.scenarioId = null;
    render();
  }
}

async function startMission() {
  if (!state.missionPreflight) {
    throw new Error("Review the mission first so the cowork can explain how it will handle the run.");
  }
  state.busy.mission = true;
  clearFeedback();
  render();
  try {
    const response = await api(`/api/projects/${state.selectedProjectId}/missions`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: buildMissionDraftPayload({
          includeMode: state.missionDraft.modeTouched && Boolean(state.missionDraft.mode)
        }),
        preflight: state.missionPreflight,
        orchestration: {
          autoContinue: Boolean(state.missionDraft.autoContinue),
          maxAutoRuns: state.missionDraft.autoContinue ? 2 : 1
        }
      })
    });
    state.selectedRunId = response.runId;
    state.workspaceTab = "run";
    state.preview = null;
    clearMissionPreflight();
    await refreshDashboard({ preserveRun: true });
    setFeedback("Mission confirmed. The run has started.", "ok");
  } finally {
    state.busy.mission = false;
    render();
  }
}

async function reviewMission() {
  state.busy.preflight = true;
  clearFeedback();
  render();
  try {
    const payload = await api(`/api/projects/${state.selectedProjectId}/missions/preflight`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: buildMissionDraftPayload({
          includeMode: state.missionDraft.modeTouched && Boolean(state.missionDraft.mode)
        })
      })
    });
    state.missionPreflight = payload.preflight;
    state.workspaceTab = "run";
    setFeedback("Mission reviewed. Confirm the run or revise the request.", "ok");
  } finally {
    state.busy.preflight = false;
    render();
  }
}

async function resolveApproval(approvalId, decision) {
  const rationale = document.querySelector(`#approval-rationale-${approvalId}`)?.value?.trim() ?? "";
  state.busy.approvals.add(approvalId);
  render();
  try {
    await api(`/api/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        rationale: rationale || null
      })
    });
    await refreshDashboard({ preserveRun: true });
    if (decision === "approved_once") {
      setFeedback("Approval granted. The run has resumed.", "ok");
    } else if (decision === "stop_run") {
      setFeedback("Run stopped at your request.", "warn");
    } else {
      setFeedback("Approval denied. The run remains blocked.", "warn");
    }
  } finally {
    state.busy.approvals.delete(approvalId);
    render();
  }
}

async function viewArtifact(runId, artifactId) {
  const payload = await api(`/api/runs/${runId}/artifacts/${artifactId}/content`);
  state.workspaceTab = "outputs";
  state.preview = {
    kind: "artifact",
    title: payload.artifact.title,
    subtitle: payload.artifact.artifactType,
    meta: {
      createdAt: payload.artifact.createdAt,
      status: payload.artifact.status,
      validationState: payload.artifact.metadata?.validationState ?? null,
      overallConfidence: payload.artifact.metadata?.overallConfidence ?? null
    },
    content: payload.content
  };
  render();
}

async function viewEvidence(runId, evidenceId) {
  const payload = await api(`/api/runs/${runId}/evidence/${evidenceId}/manifest`);
  state.workspaceTab = "outputs";
  state.preview = {
    kind: "evidence",
    title: payload.evidence.label,
    subtitle: payload.evidence.evidenceType,
    meta: {
      linkedSurface: payload.evidence.linkedSurface,
      createdAt: payload.evidence.createdAt
    },
    content: JSON.stringify(payload.content, null, 2),
    screenshotUrl: payload.evidence.metadata?.screenshotPath
      ? `/api/runs/${runId}/evidence/${evidenceId}/screenshot`
      : null
  };
  render();
}

function viewLlmCall(callId) {
  const llmCall = state.runDetail?.llmCalls?.find((entry) => entry.id === callId);
  if (!llmCall) {
    throw new Error(`Unknown LLM call: ${callId}`);
  }
  state.workspaceTab = "diagnostics";
  const linkedSnapshot = llmCall.linkedReasoningSnapshot ?? null;
  state.preview = {
    kind: "llm_call",
    title: `${llmCall.callType}`,
    subtitle: `${llmCall.providerAlias} / ${llmCall.modelAlias}`,
    meta: {
      createdAt: llmCall.createdAt,
      resultStatus: llmCall.resultStatus,
      latencyMs: llmCall.latencyMs,
      estimatedCost: llmCall.estimatedCost ?? "cost unavailable",
      providerModel: llmCall.providerModel ?? "n/a",
      reasoningStage: llmCall.metadata?.reasoningStage ?? "n/a",
      contextSnapshotId: llmCall.metadata?.contextSnapshotId ?? "n/a"
    },
    content: JSON.stringify({
      id: llmCall.id,
      promptRefs: llmCall.promptRefs,
      tokenUsage: llmCall.tokenUsage,
      retryCount: llmCall.retryCount,
      fallbackChain: llmCall.fallbackChain,
      errorCategory: llmCall.errorCategory,
      metadata: llmCall.metadata,
      linkedReasoningSnapshot: linkedSnapshot ? {
        id: linkedSnapshot.id,
        stage: linkedSnapshot.stage,
        summary: linkedSnapshot.summary,
        observations: linkedSnapshot.observations?.map((entry) => entry.id) ?? [],
        guidelines: linkedSnapshot.guidelines?.map((entry) => entry.id) ?? [],
        variables: linkedSnapshot.variables?.map((entry) => entry.key) ?? [],
        sourceIds: linkedSnapshot.sources?.map((entry) => entry.id) ?? [],
        artifactIds: linkedSnapshot.artifacts?.map((entry) => entry.id) ?? [],
        evidenceIds: linkedSnapshot.evidence?.map((entry) => entry.id) ?? [],
        policyConstraintIds: linkedSnapshot.policyConstraints?.map((entry) => entry.id) ?? [],
        injectionReasons: linkedSnapshot.injectionReasons ?? []
      } : null
    }, null, 2)
  };
  render();
}

async function runBenchmarks() {
  state.busy.benchmark = true;
  render();
  try {
    const payload = await api("/api/benchmarks/run", {
      method: "POST",
      body: JSON.stringify({})
    });
    state.selectedBenchmarkCreatedAt = payload.report.createdAt;
    await refreshDashboard({ preserveRun: true });
    setFeedback("Benchmark suite finished. Review details in Diagnostics.", "info");
  } finally {
    state.busy.benchmark = false;
    render();
  }
}

async function submitBenchmarkReview(createdAt, suiteId) {
  const classification = document.querySelector(`#benchmark-review-${suiteId}`)?.value ?? "";
  const notes = document.querySelector(`#benchmark-review-notes-${suiteId}`)?.value?.trim() ?? "";
  if (!classification) {
    throw new Error("Choose a benchmark review classification first.");
  }
  state.busy.benchmarkReviewSuiteId = suiteId;
  render();
  try {
    await api(`/api/benchmarks/${encodeURIComponent(createdAt)}/review`, {
      method: "POST",
      body: JSON.stringify({
        suiteId,
        classification,
        notes,
        reviewer: "operator"
      })
    });
    await refreshDashboard({ preserveRun: true });
    setFeedback("Benchmark review saved.", "ok");
  } finally {
    state.busy.benchmarkReviewSuiteId = null;
    render();
  }
}

async function deleteResource(pathname, label) {
  if (!window.confirm(`Delete ${label}? This removes persisted local state and files for that object.`)) {
    return;
  }
  state.busy.cleanup = pathname;
  render();
  try {
    await api(pathname, {
      method: "DELETE"
    });
    state.preview = null;
    await refreshDashboard({ preserveRun: false });
    setFeedback(`${label} deleted from local state.`, "warn");
  } finally {
    state.busy.cleanup = null;
    render();
  }
}

async function clearTempState() {
  if (!window.confirm("Clear temporary runtime state? This removes bounded temporary assets only.")) {
    return;
  }
  state.busy.cleanup = "temp";
  render();
  try {
    await api("/api/runtime/cleanup-temp", {
      method: "POST",
      body: JSON.stringify({})
    });
    await refreshDashboard({ preserveRun: true });
    setFeedback("Temporary local runtime files were cleared.", "info");
  } finally {
    state.busy.cleanup = null;
    render();
  }
}

function readAgentConfigForm() {
  const current = state.agentConfig ?? {};
  const approvalModeByAction = { ...(current.guardrails?.approvalModeByAction ?? {}) };
  document.querySelectorAll("[data-approval-mode]").forEach((field) => {
    approvalModeByAction[field.dataset.approvalMode] = field.value;
  });
  return {
    ...current,
    conversationalSystemPrompt: document.querySelector("#agent-system-prompt")?.value ?? current.conversationalSystemPrompt,
    guardrails: {
      ...(current.guardrails ?? {}),
      safetyPreset: document.querySelector("#guardrail-safety-preset")?.value ?? current.guardrails?.safetyPreset,
      assistantVerbosity: document.querySelector("#agent-verbosity")?.value ?? current.guardrails?.assistantVerbosity,
      conversationMode: document.querySelector("#agent-conversation-mode")?.value ?? current.guardrails?.conversationMode,
      debugMode: Boolean(document.querySelector("#agent-debug-mode")?.checked),
      showInternalPlansInChat: Boolean(document.querySelector("#agent-show-internal-plans")?.checked),
      showTraceLinksInChat: Boolean(document.querySelector("#agent-show-trace-links")?.checked),
      desktopScope: document.querySelector("#guardrail-desktop-scope")?.value ?? current.guardrails?.desktopScope,
      browserScope: document.querySelector("#guardrail-browser-scope")?.value ?? current.guardrails?.browserScope,
      fileScope: document.querySelector("#guardrail-file-scope")?.value ?? current.guardrails?.fileScope,
      desktopAutonomy: {
        ...(current.guardrails?.desktopAutonomy ?? {}),
        level: document.querySelector("#desktop-autonomy-level")?.value ?? current.guardrails?.desktopAutonomy?.level,
        maxPlanSteps: Number.parseInt(document.querySelector("#desktop-autonomy-max-steps")?.value ?? current.guardrails?.desktopAutonomy?.maxPlanSteps ?? "8", 10),
        autoApproveLowRisk: Boolean(document.querySelector("#desktop-autonomy-auto-low")?.checked),
        autoApproveMediumRisk: Boolean(document.querySelector("#desktop-autonomy-auto-medium")?.checked),
        requireApprovalForHighRisk: Boolean(document.querySelector("#desktop-autonomy-confirm-high")?.checked),
        allowSkillOverride: Boolean(document.querySelector("#desktop-autonomy-skill-override")?.checked),
        allowCoordinateClicks: Boolean(document.querySelector("#desktop-autonomy-coordinate-clicks")?.checked),
        allowTextInput: Boolean(document.querySelector("#desktop-autonomy-text-input")?.checked),
        allowHotkeys: Boolean(document.querySelector("#desktop-autonomy-hotkeys")?.checked),
        allowClicks: Boolean(document.querySelector("#desktop-autonomy-clicks")?.checked),
        allowScroll: Boolean(document.querySelector("#desktop-autonomy-scroll")?.checked),
        allowCapture: Boolean(document.querySelector("#desktop-autonomy-capture")?.checked),
        allowSystemHotkeys: Boolean(document.querySelector("#desktop-autonomy-system-hotkeys")?.checked),
        sensitiveActionMode: document.querySelector("#desktop-autonomy-sensitive-mode")?.value ?? current.guardrails?.desktopAutonomy?.sensitiveActionMode,
        destructiveActionMode: document.querySelector("#desktop-autonomy-destructive-mode")?.value ?? current.guardrails?.desktopAutonomy?.destructiveActionMode
      },
      approvalModeByAction
    }
  };
}

async function saveAgentConfiguration() {
  state.busy.agentConfig = true;
  clearFeedback();
  render();
  try {
    const payload = await api("/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({
        config: readAgentConfigForm()
      })
    });
    state.agentConfig = payload.config;
    state.agentConfigPreview = null;
    setFeedback("Agent configuration saved.", "ok");
  } finally {
    state.busy.agentConfig = false;
    render();
  }
}

async function resetAgentConfiguration() {
  state.busy.agentConfig = true;
  clearFeedback();
  render();
  try {
    const payload = await api("/api/agent/config/reset", {
      method: "POST",
      body: JSON.stringify({})
    });
    state.agentConfig = payload.config;
    state.agentConfigPreview = null;
    setFeedback("Agent configuration reset to default.", "ok");
  } finally {
    state.busy.agentConfig = false;
    render();
  }
}

async function previewAgentConfiguration() {
  state.busy.agentConfig = true;
  clearFeedback();
  render();
  try {
    await saveAgentConfiguration();
    state.busy.agentConfig = true;
    const payload = await api("/api/agent/config/preview", {
      method: "POST",
      body: JSON.stringify({
        message: "ouvre mon éditeur de note"
      })
    });
    state.agentConfigPreview = payload;
    setFeedback("Agent preview generated.", "info");
  } finally {
    state.busy.agentConfig = false;
    render();
  }
}

function renderFlashBanner() {
  if (!hasElement(elements.flashBanner)) {
    return;
  }
  if (!state.feedback) {
    elements.flashBanner.innerHTML = "";
    return;
  }
  elements.flashBanner.innerHTML = `
    <article class="feedback-banner ${escapeHtml(state.feedback.tone)}">
      <div>
        <strong>${escapeHtml(state.feedback.message)}</strong>
      </div>
      <button type="button" class="ghost small" data-action="dismiss-feedback">Dismiss</button>
    </article>
  `;
}

function renderMissionOnboarding() {
  if (!hasElement(elements.missionOnboarding)) {
    return;
  }
  const examples = missionStarterTemplates();
  const llmState = describeGatewayState(state.dashboard?.llmGatewayStatus ?? null);
  elements.missionOnboarding.innerHTML = `
    <div class="minimal-guidance">
      <div class="minimal-trust-row">
        <div class="pill-row">
          ${badge("Mission-first")}
          ${badge("Bounded run, not open chat")}
          ${badge("Approvals stay explicit", "ok")}
          ${badge("Proof remains reviewable")}
          ${llmState ? badge(llmState.label, llmState.tone) : ""}
        </div>
        <p class="helper-text">Start with a natural request. The cowork will review it, show the bounded plan, then ask for confirmation.</p>
      </div>
      <div class="minimal-example-strip">
        <span class="micro-label">Try one of these missions</span>
        <div class="suggestion-pill-row">
          ${examples.map((example) => `
            <button
              type="button"
              class="suggestion-pill ${state.missionDraft.objective === example.objective ? "selected" : ""}"
              data-action="apply-mission-example"
              data-example-id="${escapeHtml(example.id)}"
            >
              ${escapeHtml(example.label)}
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderProjects() {
  if (!hasElement(elements.projects)) {
    return;
  }
  const projects = state.dashboard?.projects ?? [];
  if (projects.length === 0) {
    elements.projects.innerHTML = `<div class="empty">No project is available yet. Create or restore one before starting a mission.</div>`;
    return;
  }

  elements.projects.innerHTML = `
    <div class="stack">
      ${projects.map((project) => `
        <article class="card ${project.id === state.selectedProjectId ? "active" : ""}">
          <h3>${escapeHtml(project.name)}</h3>
          <p>${escapeHtml(project.description || "No description.")}</p>
          <div class="pill-row">
            ${project.id === state.selectedProjectId ? badge("Current project", "ok") : ""}
            ${badge(`${project.runs.length} run(s)`)}
          </div>
          <div class="card-actions">
            <button
              type="button"
              class="${project.id === state.selectedProjectId ? "secondary" : "ghost"}"
              data-action="select-project"
              data-project-id="${escapeHtml(project.id)}"
            >
              ${project.id === state.selectedProjectId ? "Selected" : "Open"}
            </button>
            <button
              type="button"
              class="ghost small"
              data-action="delete-project"
              data-project-id="${escapeHtml(project.id)}"
              ${state.busy.cleanup ? "disabled" : ""}
            >
              Delete project
            </button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderMissionPreflightCard({ compact = false } = {}) {
  const preflight = state.missionPreflight;
  const understanding = currentMissionPreflight();
  if (!preflight || !understanding) {
    return "";
  }

  const willNotDo = Array.from(new Set([
    ...(understanding.notCoveredNow ?? []),
    ...(understanding.unsupportedRequests ?? [])
  ]));
  const confidenceLabel = understanding.routingConfidence === "high"
    ? "high confidence"
    : understanding.routingConfidence === "medium"
      ? "bounded confidence"
      : "low confidence";
  const confidenceTone = understanding.routingConfidence === "high" ? "ok" : "warn";
  const generationLabel = preflight.generationMode === "llm"
    ? "reviewed by live AI"
    : preflight.generationMode === "confirmed_preflight"
      ? "confirmed review reused"
      : "reviewed by bounded fallback";
  const clarificationNeeded = Boolean(understanding.requiresClarification);
  const runNowPlan = understanding.runNowPlan ?? [];
  const nextRecommendation = understanding.nextRunRecommendation ?? null;
  const laterRecommendation = understanding.maybeLaterRecommendation ?? null;
  const clarificationOptions = understanding.clarificationOptions ?? [];
  const selectedBrowser = understanding.selectedBrowser ?? null;
  const autoContinueEnabled = Boolean(state.missionDraft.autoContinue);

  return `
    <article class="preflight-card ${understanding.coverageStatus === "full" ? "" : "warning"}">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Mission preflight</p>
          <h3>Here's how I understand your request</h3>
        </div>
        <div class="pill-row">
          ${badge(executionFrameLabel(understanding.chosenExecutionFrame), "ok")}
          ${badge(`coverage ${understanding.coverageStatus.replaceAll("_", " ")}`, preflightCoverageTone(understanding.coverageStatus))}
          ${badge(confidenceLabel, confidenceTone)}
          ${badge(generationLabel, preflight.generationMode === "llm" ? "ok" : "warn")}
        </div>
      </div>
      <p class="preflight-summary">${escapeHtml(understanding.clarifiedObjective)}</p>
      <div class="meta-grid compact">
        <div>
          <strong>How I'll handle it</strong>
          <span>${escapeHtml(understanding.whyThisFrame)}</span>
        </div>
        <div>
          <strong>Coverage now</strong>
          <span>${escapeHtml(understanding.coverageStatus === "full" ? "The request fits this run." : understanding.coverageStatus === "partial" ? "I can safely cover part of the request now." : "I am choosing the safest bounded interpretation.")}</span>
        </div>
      </div>
      ${selectedBrowser ? `
        <div class="pill-row">
          ${badge(`Selected browser: ${selectedBrowser.label}`, "ok")}
        </div>
      ` : ""}
      ${clarificationNeeded ? `
        <article class="card warning preflight-warning">
          <strong>Clarification needed before start</strong>
          <p>${escapeHtml(understanding.clarificationQuestion || "Please clarify the priority for this run before launch.")}</p>
          ${clarificationOptions.length > 0 ? `
            <div class="card-actions clarification-actions">
              ${clarificationOptions.map((option) => `
                <button
                  type="button"
                  class="secondary small"
                  data-action="apply-browser-clarification"
                  data-browser-id="${escapeHtml(option.id)}"
                  ${missionBusy() ? "disabled" : ""}
                >
                  Use ${escapeHtml(option.label)}
                </button>
              `).join("")}
            </div>
          ` : ""}
          <p class="muted">Revise the mission above to answer this, then review it again.</p>
        </article>
      ` : ""}
      ${understanding.ambiguityNote ? `
        <article class="card warning preflight-warning">
          <strong>Before launch</strong>
          <p>${escapeHtml(understanding.ambiguityNote)}</p>
        </article>
      ` : ""}
      <div class="preflight-grid ${compact ? "compact" : ""}">
        <article class="card">
          <h4>What I can do now</h4>
          <ul class="compact-list">
            ${(understanding.coveredNow ?? understanding.requestedOutcomes ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </article>
        <article class="card">
          <h4>How I'll run it now</h4>
          <ol class="plan-list">
            ${runNowPlan.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ol>
        </article>
        <article class="card">
          <h4>What I'll verify</h4>
          <ul class="compact-list">
            ${(understanding.verificationGoals ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </article>
        <article class="card">
          <h4>What would need another step</h4>
          <p><strong>Recommended next bounded run:</strong> ${escapeHtml(understanding.nextRunSuggestion ?? "No follow-up run is recommended if this run completes as planned.")}</p>
          ${nextRecommendation ? `<p class="muted"><strong>Next step objective:</strong> ${escapeHtml(followUpRecommendationLabel(nextRecommendation))}</p>` : ""}
          <p><strong>Maybe later:</strong> ${escapeHtml(understanding.maybeLaterSuggestion ?? "No later run is suggested right now.")}</p>
          ${laterRecommendation ? `<p class="muted"><strong>Later objective:</strong> ${escapeHtml(followUpRecommendationLabel(laterRecommendation))}</p>` : ""}
        </article>
        <article class="card">
          <h4>What I won't do in this run</h4>
          ${willNotDo.length === 0 ? `<p class="muted">Nothing outside the current bounded run was detected.</p>` : `
            <ul class="compact-list">
              ${willNotDo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          `}
        </article>
      </div>
      <div class="launch-row preflight-actions">
        <p class="helper-text">${clarificationNeeded
          ? "Answer the clarification by revising the mission above, then review it again."
          : autoContinueEnabled && nextRecommendation
            ? "Confirm to start the bounded run. If it finishes cleanly, the cowork may continue with one recommended next bounded step automatically."
            : "Confirm to start the bounded run with this interpretation, or revise the mission above."}</p>
        <div class="card-actions">
          <button
            type="button"
            class="cta-primary"
            data-action="confirm-mission-preflight"
            ${missionBusy() || !state.selectedProjectId || clarificationNeeded ? "disabled" : ""}
          >
            ${clarificationNeeded ? "Clarification needed before start" : state.busy.mission ? "Starting run..." : "Confirm and start"}
          </button>
          <button
            type="button"
            class="ghost"
            data-action="clear-mission-preflight"
            ${missionBusy() ? "disabled" : ""}
          >
            Revise mission
          </button>
        </div>
      </div>
    </article>
  `;
}

function agentActivityLabel(event) {
  switch (String(event?.type ?? "")) {
    case "stream.connected":
      return "Live workspace connected.";
    case "run.started":
      return "The agent started a bounded run.";
    case "run.settled":
      return "The run finished or stopped.";
    case "approval.requested":
      return "The agent paused for your approval.";
    case "approval.resolved":
      return "Approval was resolved; the agent can continue if allowed.";
    case "run.chain.decided":
      return "The agent decided whether a next bounded step should run.";
    case "run.chain.continued":
      return "The agent started the next bounded step.";
    case "run.chain.blocked":
      return "The agent stopped the chain because one detail is missing.";
    case "run.chain.error":
      return "The automatic chain stopped after an orchestration error.";
    default:
      return String(event?.type ?? "update").replaceAll(".", " ");
  }
}

function eventTone(type) {
  const text = String(type ?? "");
  if (text.includes("error") || text.includes("blocked")) {
    return "danger";
  }
  if (text.includes("approval") || text.includes("chain")) {
    return "warn";
  }
  if (text.includes("started") || text.includes("connected")) {
    return "ok";
  }
  return "";
}

function reasoningStageLabel(stage) {
  return String(stage ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function renderAgentActivityPanel() {
  const run = currentRun();
  const activeRunCount = state.dashboard?.activeRunIds?.length ?? 0;
  const recentEvents = state.liveFeed
    .filter((event) => !run?.id || !event.runId || event.runId === run.id || event.runId === run.metadata?.orchestration?.rootRunId)
    .slice(0, 6);
  const llmCalls = (state.runDetail?.llmCalls ?? []).slice(-4).reverse();
  const show = state.busy.preflight || state.busy.mission || activeRunCount > 0 || recentEvents.length > 0 || llmCalls.length > 0;
  if (!show) {
    return "";
  }
  const headline = state.busy.preflight
    ? "Reviewing your mission"
    : state.busy.mission
      ? "Starting the bounded run"
      : activeRunCount > 0
        ? "Agent is working"
        : "Recent agent activity";
  return `
    <article class="agent-activity-panel">
      <div class="agent-activity-header">
        <div>
          <p class="eyebrow">Agent activity</p>
          <h3>${escapeHtml(headline)}</h3>
        </div>
        <div class="agent-orb ${activeRunCount > 0 || state.busy.preflight || state.busy.mission ? "active" : ""}" aria-hidden="true"></div>
      </div>
      <div class="agent-activity-grid">
        <div>
          <strong>Reasoning stages</strong>
          ${llmCalls.length === 0 ? `<p class="muted">Reasoning calls will appear here as the run progresses.</p>` : `
            <ul class="activity-list">
              ${llmCalls.map((call) => `
                <li>
                  <span>${escapeHtml(reasoningStageLabel(call.metadata?.reasoningStage ?? call.callType))}</span>
                  ${badge(call.resultStatus ?? "recorded", call.resultStatus === "success" ? "ok" : "warn")}
                </li>
              `).join("")}
            </ul>
          `}
        </div>
        <div>
          <strong>Live updates</strong>
          ${recentEvents.length === 0 ? `<p class="muted">No live update yet.</p>` : `
            <ul class="activity-list">
              ${recentEvents.map((event) => `
                <li>
                  <span>${escapeHtml(agentActivityLabel(event))}</span>
                  ${badge(event.type, eventTone(event.type))}
                </li>
              `).join("")}
            </ul>
          `}
        </div>
      </div>
      <p class="muted">This is a product-level reasoning trace, not raw hidden chain-of-thought.</p>
    </article>
  `;
}

function chatBubble(role, body, { tone = "", meta = "", compact = false } = {}) {
  return `
    <article class="chat-message ${escapeHtml(role)} ${tone ? escapeHtml(tone) : ""} ${compact ? "compact" : ""}">
      <div class="chat-avatar" aria-hidden="true">${role === "user" ? "You" : role === "approval" ? "OK" : role === "tool" ? "Run" : "AI"}</div>
      <div class="chat-bubble">
        ${meta ? `<p class="chat-meta">${escapeHtml(meta)}</p>` : ""}
        ${body}
      </div>
    </article>
  `;
}

function eventChatLabel(event) {
  const type = String(event?.type ?? "");
  const payload = event?.payload ?? {};
  if (type === "tool.executed" && payload.primitive) {
    return `Action executed: ${payload.primitive}`;
  }
  if (type === "tool.recovery_attempted") {
    return `Recovery attempted after ${payload.primitive ?? "desktop action"}`;
  }
  if (type === "tool.blocked") {
    return `Action blocked: ${payload.reason ?? "safety policy"}`;
  }
  if (type === "approval.requested") {
    return "I need your approval before continuing.";
  }
  if (type === "approval.granted") {
    return "Approval received. I’m continuing the run.";
  }
  if (type === "evidence.recorded") {
    return "Proof was captured and linked to the run.";
  }
  if (type === "run.completed") {
    return "The run finished. Results and proof are ready.";
  }
  if (type === "run.failed") {
    return "The run failed. I kept the failure trace for review.";
  }
  if (type === "llm.degraded_mode.activated") {
    return "AI provider degraded; I switched to the safe fallback path.";
  }
  return agentActivityLabel(event);
}

function renderChatEventMessages() {
  const run = currentRun();
  const eventItems = [
    ...(state.runDetail?.events ?? []).map((event) => ({
      type: event.type,
      runId: run?.id ?? null,
      createdAt: event.createdAt,
      payload: event.payload ?? {},
      source: "run"
    })),
    ...state.liveFeed.map((event) => ({
      ...event,
      source: "live"
    }))
  ];
  const seen = new Set();
  const filtered = eventItems
    .filter((event) => !run?.id || !event.runId || event.runId === run.id || event.runId === run.metadata?.orchestration?.rootRunId)
    .filter((event) => {
      const key = `${event.type}:${event.createdAt}:${event.payload?.approvalId ?? ""}:${event.payload?.evidenceId ?? ""}:${event.payload?.primitive ?? ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
    .slice(-10);

  return filtered.map((event) => {
    const tone = eventTone(event.type);
    return chatBubble(
      event.type?.startsWith("tool.") ? "tool" : "assistant",
      `
        <div class="chat-event-row">
          <span>${escapeHtml(eventChatLabel(event))}</span>
          ${badge(String(event.type ?? "event"), tone)}
        </div>
        ${event.payload?.reason ? `<p class="muted">${escapeHtml(event.payload.reason)}</p>` : ""}
      `,
      {
        tone,
        meta: formatDate(event.createdAt),
        compact: true
      }
    );
  }).join("");
}

function renderChatApprovals() {
  const approvals = currentPendingApprovals();
  if (approvals.length === 0) {
    return "";
  }
  return approvals.map((approval) => chatBubble("approval", `
    <h3>Approval needed</h3>
    <p>${escapeHtml(approval.actionLabel)}</p>
    <p class="muted">${escapeHtml(approval.reason ?? "This action needs your explicit approval before I continue.")}</p>
    <div class="meta-grid compact">
      <div><strong>Target</strong><span>${escapeHtml(approval.targetLabel ?? "desktop")}</span></div>
      <div><strong>Risk</strong><span>${escapeHtml(approval.riskLevel ?? "medium")}</span></div>
    </div>
    <textarea id="approval-rationale-${escapeHtml(approval.id)}" placeholder="Optional note for the audit trail"></textarea>
    <div class="card-actions">
      <button type="button" data-action="approval-decision" data-approval-id="${escapeHtml(approval.id)}" data-decision="approved_once" ${state.busy.approvals.has(approval.id) ? "disabled" : ""}>Approve once</button>
      <button type="button" class="secondary" data-action="approval-decision" data-approval-id="${escapeHtml(approval.id)}" data-decision="denied" ${state.busy.approvals.has(approval.id) ? "disabled" : ""}>Deny</button>
      <button type="button" class="danger" data-action="approval-decision" data-approval-id="${escapeHtml(approval.id)}" data-decision="stop_run" ${state.busy.approvals.has(approval.id) ? "disabled" : ""}>Stop run</button>
    </div>
  `, {
    tone: "warn",
    meta: "Action paused"
  })).join("");
}

function renderOutcomeChatMessage() {
  const outcome = currentOutcomeSummary();
  if (!outcome) {
    return "";
  }
  return chatBubble("assistant", `
    <h3>${escapeHtml(outcome.headline ?? "Run result")}</h3>
    <p>${escapeHtml(outcome.summary ?? currentRun()?.summary ?? "The run finished.")}</p>
    <div class="preflight-grid compact">
      ${outcome.done?.length ? `<article class="card"><h4>Done</h4><ul class="compact-list">${outcome.done.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>` : ""}
      ${outcome.verified?.length ? `<article class="card"><h4>Verified</h4><ul class="compact-list">${outcome.verified.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>` : ""}
      ${outcome.notDone?.length ? `<article class="card warning"><h4>Not done</h4><ul class="compact-list">${outcome.notDone.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>` : ""}
    </div>
    <div class="card-actions">
      <button type="button" class="secondary" data-action="open-results">Open results and proof</button>
      ${outcome.recommendedNextStep?.recommendation ? `<button type="button" data-action="prepare-follow-up-mission" data-recommendation-kind="next">Prepare next step</button>` : ""}
    </div>
  `, {
    tone: currentRun()?.status === "completed" ? "ok" : statusPill(currentRun()?.status),
    meta: "Result"
  });
}

function renderCoworkChatSurface({ preflightCard, busy, llmState, laneHintCopy, browsers, selectedBrowser, formDefaults, roleOptions, selectedMode }) {
  const run = currentRun();
  const objective = state.missionDraft.objective.trim();
  const transcript = [
    chatBubble("assistant", `
      <h3>Tell me the mission. I’ll reason before acting.</h3>
      <p>Write naturally. I’ll turn it into a bounded run, ask for approval when needed, act on the desktop, verify, and return proof.</p>
      <div class="pill-row">
        ${badge("bounded")}
        ${badge("approval-aware")}
        ${badge("desktop vision")}
        ${badge("auditable")}
      </div>
    `, {
      meta: "Cowork"
    }),
    objective || state.missionPreflight || run ? chatBubble("user", `<p>${escapeHtml(objective || run?.metadata?.missionSpec?.objective || run?.mission || "Mission started")}</p>`, {
      meta: "Mission"
    }) : "",
    state.busy.preflight ? chatBubble("assistant", `
      <div class="typing-row"><span></span><span></span><span></span></div>
      <p>I’m reading the mission, checking the bounded frame, and preparing the run plan.</p>
    `, {
      tone: "active",
      meta: "Reasoning"
    }) : "",
    state.missionPreflight ? chatBubble("assistant", preflightCard, {
      tone: state.missionPreflight.understanding?.requiresClarification ? "warn" : "ok",
      meta: "Preflight"
    }) : "",
    state.busy.mission ? chatBubble("assistant", `
      <div class="typing-row"><span></span><span></span><span></span></div>
      <p>I’m starting the approved bounded run and opening the live trace.</p>
    `, {
      tone: "active",
      meta: "Starting"
    }) : "",
    run ? chatBubble("assistant", `
      <h3>${escapeHtml(describeRunStatus(run, currentPendingApprovals().length).label)}</h3>
      <p>${escapeHtml(run.summary ?? describeRunStatus(run, currentPendingApprovals().length).detail)}</p>
      <div class="pill-row">
        ${badge(run.status, statusPill(run.status))}
        ${badge(run.lifecycleStage)}
        ${run.metadata?.computerActionType ? badge(run.metadata.computerActionType) : ""}
        ${state.liveUpdates === "live" ? badge("live updates", "ok") : badge("live reconnecting", "warn")}
      </div>
    `, {
      tone: statusPill(run.status),
      meta: "Current run"
    }) : "",
    renderChatApprovals(),
    renderChatEventMessages(),
    renderOutcomeChatMessage()
  ].filter(Boolean).join("");

  return `
    <div class="cowork-chat-shell">
      <section class="chat-thread" aria-label="Cowork conversation">
        ${transcript}
      </section>
      <article class="chat-composer-card">
        <div class="chat-composer-input-row">
          <textarea
            id="mission-objective"
            data-mission-field="objective"
            class="chat-composer-input"
            placeholder="Ask Cowork: open my browser and search for..., capture proof, prepare the result..."
            ${busy ? "disabled" : ""}
          >${escapeHtml(state.missionDraft.objective)}</textarea>
          <button
            type="button"
            class="chat-send-button"
            data-action="review-mission"
            ${busy || !state.selectedProjectId || !state.missionDraft.objective.trim() ? "disabled" : ""}
            aria-label="Send mission to cowork"
          >
            ${state.busy.preflight ? "..." : "Send"}
          </button>
        </div>
        <div class="chat-composer-footer">
          <span>${llmState ? escapeHtml(llmState.label) : "Cowork will review before acting"}</span>
          <span>${escapeHtml(laneHintCopy)}</span>
        </div>
      </article>
      <details class="details-panel mission-detail-drawer chat-details-drawer">
        <summary>Optional details and preferences</summary>
        <div class="form-stack">
          <div class="field compact">
            <label for="mission-deliverable">Expected deliverable</label>
            <input id="mission-deliverable" data-mission-field="deliverable" type="text" value="${escapeHtml(state.missionDraft.deliverable)}" placeholder="${escapeHtml(selectedMode?.deliverableHint ?? "Optional explicit deliverable")}" ${busy ? "disabled" : ""}>
          </div>
          <div class="grid-two">
            <div class="field compact">
              <label for="mission-constraints">Constraints</label>
              <textarea id="mission-constraints" data-mission-field="constraints" placeholder="One constraint per line" ${busy ? "disabled" : ""}>${escapeHtml(state.missionDraft.constraints)}</textarea>
            </div>
            <div class="field compact">
              <label for="mission-forbidden">Actions à éviter</label>
              <textarea id="mission-forbidden" data-mission-field="forbiddenActions" placeholder="Une action à éviter par ligne" ${busy ? "disabled" : ""}>${escapeHtml(state.missionDraft.forbiddenActions)}</textarea>
            </div>
          </div>
          ${browsers.length > 0 ? `
            <div class="field compact">
              <label for="mission-browser-id">Preferred browser</label>
              <select id="mission-browser-id" data-mission-field="browserId" ${busy ? "disabled" : ""}>
                <option value="">Let the cowork choose if one is obvious</option>
                ${browsers.map((browser) => `
                  <option value="${escapeHtml(browser.id)}" ${browser.id === state.missionDraft.browserId ? "selected" : ""}>${escapeHtml(browser.label)}</option>
                `).join("")}
              </select>
              <p class="helper-text">${selectedBrowser ? escapeHtml(`The cowork will prefer ${selectedBrowser.label} if this mission needs a browser launch.`) : "Only used when the mission needs a local browser."}</p>
            </div>
          ` : ""}
          <div class="field compact">
            <label>
              <input id="mission-auto-continue" data-mission-field="autoContinue" type="checkbox" ${state.missionDraft.autoContinue ? "checked" : ""} ${busy ? "disabled" : ""}>
              Continue to the next bounded step automatically when it is safe
            </label>
          </div>
          <article class="card">
            <div class="panel-header">
              <div>
                <h3>Optional lane hint</h3>
                <p class="muted">Leave empty if you want the agent to choose.</p>
              </div>
              ${state.missionDraft.modeTouched ? `<button type="button" class="ghost small" data-action="clear-mission-mode" ${busy ? "disabled" : ""}>Let Cowork choose</button>` : ""}
            </div>
            <div class="mode-strip">
              ${missionModeOptions().map((mode) => `
                <button type="button" class="mode-pill ${mode.id === state.missionDraft.mode ? "selected" : ""}" data-action="select-mission-mode" data-mode-id="${escapeHtml(mode.id)}" ${busy ? "disabled" : ""}>${escapeHtml(mode.label)}</button>
              `).join("")}
            </div>
          </article>
          ${state.missionDraft.mode === "form" ? `
            <article class="card">
              <h3>Controlled form values</h3>
              <div class="field compact">
                <label for="mission-form-name">Candidate name</label>
                <input id="mission-form-name" data-mission-field="formName" type="text" value="${escapeHtml(state.missionDraft.formName || formDefaults.name || "")}" ${busy ? "disabled" : ""}>
              </div>
              <div class="field compact">
                <label for="mission-form-role">Role</label>
                <select id="mission-form-role" data-mission-field="formRole" ${busy ? "disabled" : ""}>
                  ${roleOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === state.missionDraft.formRole ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                </select>
              </div>
              <div class="field compact">
                <label><input id="mission-form-subscribe" data-mission-field="formSubscribe" type="checkbox" ${state.missionDraft.formSubscribe ? "checked" : ""} ${busy ? "disabled" : ""}> Toggle the newsletter checkbox</label>
              </div>
            </article>
          ` : ""}
        </div>
      </details>
    </div>
  `;
}

function renderMissionEntry() {
  if (!hasElement(elements.missionEntry)) {
    return;
  }
  const contract = missionEntryContract();
  const selectedMode = selectedMissionMode();
  const browsers = availableBrowsers();
  const selectedBrowser = selectedBrowserPreference();
  const formDefaults = contract.formDefaults ?? {};
  const roleOptions = contract.formRoleOptions ?? [];
  const limits = contract.limits ?? {};
  const preflightCard = renderMissionPreflightCard({
    compact: !IS_ADMIN_SURFACE
  });
  const busy = missionBusy();

  if (!state.selectedProjectId) {
    elements.missionEntry.innerHTML = `<div class="empty">Select a project before starting a mission.</div>`;
    return;
  }

  if (!IS_ADMIN_SURFACE) {
    const llmState = describeGatewayState(state.dashboard?.llmGatewayStatus ?? null);
    const laneHintCopy = selectedMode
      ? selectedMode.scopeHint ?? selectedMode.description ?? "A bounded lane hint is set for this mission."
      : "No lane hint is set. The cowork will choose the safest bounded run during the review.";
    elements.missionEntry.innerHTML = renderCoworkChatSurface({
      preflightCard,
      busy,
      llmState,
      laneHintCopy,
      browsers,
      selectedBrowser,
      formDefaults,
      roleOptions,
      selectedMode
    });
    return;
    elements.missionEntry.innerHTML = `
      <div class="mission-home-stack">
        <article class="mission-composer-card">
          <div class="mission-composer-head">
            <div class="pill-row composer-status-row">
              ${badge(`Workspace ${currentProject()?.name ?? state.selectedProjectId}`)}
              ${state.missionDraft.modeTouched && selectedMode ? badge(`Lane hint: ${selectedMode.label}`, "ok") : badge("Lane hint optional")}
              ${llmState ? badge(llmState.label, llmState.tone) : ""}
            </div>
          </div>
          <div class="field field-hero mission-composer-field">
            <label for="mission-objective" class="sr-only">Mission</label>
            <textarea
              id="mission-objective"
              data-mission-field="objective"
              class="home-composer minimal-composer"
              placeholder="Open the allowlisted pages, compare the key differences, capture proof where useful, and prepare a short decision note."
              ${busy ? "disabled" : ""}
            >${escapeHtml(state.missionDraft.objective)}</textarea>
          </div>
          <div class="mission-composer-footer">
            <div class="mission-composer-meta">
              <p class="composer-note">The cowork reviews the mission before starting anything.</p>
              <p class="composer-subnote">${escapeHtml(laneHintCopy)}</p>
            </div>
            <button
              type="button"
              class="cta-primary composer-primary"
              data-action="review-mission"
              ${busy || !state.selectedProjectId || !state.missionDraft.objective.trim() ? "disabled" : ""}
            >
              ${state.busy.preflight ? "Reviewing..." : "Review mission"}
            </button>
          </div>
        </article>
        <details class="details-panel mission-detail-drawer">
          <summary>Add details</summary>
          <div class="form-stack">
            <div class="field compact">
              <label for="mission-deliverable">Expected deliverable</label>
              <input
                id="mission-deliverable"
                data-mission-field="deliverable"
                type="text"
                value="${escapeHtml(state.missionDraft.deliverable)}"
                placeholder="${escapeHtml(selectedMode?.deliverableHint ?? "Optional explicit deliverable")}"
                ${busy ? "disabled" : ""}
              >
            </div>
            <div class="field compact">
              <label for="mission-constraints">Constraints</label>
              <textarea
                id="mission-constraints"
                data-mission-field="constraints"
                placeholder="One constraint per line"
                ${busy ? "disabled" : ""}
              >${escapeHtml(state.missionDraft.constraints)}</textarea>
            </div>
            <div class="field compact">
              <label for="mission-forbidden">Actions à éviter</label>
              <textarea
                id="mission-forbidden"
                data-mission-field="forbiddenActions"
                placeholder="Une action à éviter par ligne"
                ${busy ? "disabled" : ""}
              >${escapeHtml(state.missionDraft.forbiddenActions)}</textarea>
            </div>
            ${browsers.length > 0 ? `
              <div class="field compact">
                <label for="mission-browser-id">Preferred browser</label>
                <select id="mission-browser-id" data-mission-field="browserId" ${busy ? "disabled" : ""}>
                  <option value="">Let the cowork choose if one is obvious</option>
                  ${browsers.map((browser) => `
                    <option value="${escapeHtml(browser.id)}" ${browser.id === state.missionDraft.browserId ? "selected" : ""}>
                      ${escapeHtml(browser.label)}
                    </option>
                  `).join("")}
                </select>
                <p class="helper-text">${selectedBrowser
                  ? escapeHtml(`The cowork will prefer ${selectedBrowser.label} if this mission needs a browser launch.`)
                  : "Only used when the mission actually needs a local browser to be opened."}</p>
              </div>
            ` : ""}
            <div class="field compact">
              <label>
                <input
                  id="mission-auto-continue"
                  data-mission-field="autoContinue"
                  type="checkbox"
                  ${state.missionDraft.autoContinue ? "checked" : ""}
                  ${busy ? "disabled" : ""}
                >
                Continue to the next bounded step automatically when it is safe
              </label>
              <p class="helper-text">The cowork still stays inside one bounded frame per run and stops if a clarification or approval is needed.</p>
            </div>
            <article class="card">
              <div class="panel-header">
                <div>
                  <h3>Optional lane hint</h3>
                  <p class="muted">Keep this empty if you want the cowork to choose the bounded run on its own.</p>
                </div>
                ${state.missionDraft.modeTouched ? `
                  <button type="button" class="ghost small" data-action="clear-mission-mode" ${busy ? "disabled" : ""}>Let the cowork choose</button>
                ` : ""}
              </div>
              <div class="mode-strip">
                ${missionModeOptions().map((mode) => `
                  <button
                    type="button"
                    class="mode-pill ${mode.id === state.missionDraft.mode ? "selected" : ""}"
                    data-action="select-mission-mode"
                    data-mode-id="${escapeHtml(mode.id)}"
                    ${busy ? "disabled" : ""}
                  >
                    ${escapeHtml(mode.label)}
                  </button>
                `).join("")}
              </div>
              <p class="helper-text">${selectedMode
                ? escapeHtml(selectedMode.scopeHint ?? selectedMode.description ?? "")
                : "No lane preference is set. The cowork will choose the safest bounded run during the review step."}</p>
            </article>
            ${state.missionDraft.mode === "form" ? `
              <article class="card">
                <h3>Controlled form values</h3>
                <div class="field compact">
                  <label for="mission-form-name">Candidate name</label>
                  <input
                    id="mission-form-name"
                    data-mission-field="formName"
                    type="text"
                    value="${escapeHtml(state.missionDraft.formName || formDefaults.name || "")}"
                    ${busy ? "disabled" : ""}
                  >
                </div>
                <div class="field compact">
                  <label for="mission-form-role">Role</label>
                  <select id="mission-form-role" data-mission-field="formRole" ${busy ? "disabled" : ""}>
                    ${roleOptions.map((option) => `
                      <option value="${escapeHtml(option.value)}" ${option.value === state.missionDraft.formRole ? "selected" : ""}>
                        ${escapeHtml(option.label)}
                      </option>
                    `).join("")}
                  </select>
                </div>
                <div class="field compact">
                  <label>
                    <input
                      id="mission-form-subscribe"
                      data-mission-field="formSubscribe"
                      type="checkbox"
                      ${state.missionDraft.formSubscribe ? "checked" : ""}
                      ${busy ? "disabled" : ""}
                    >
                    Toggle the newsletter checkbox
                  </label>
                </div>
              </article>
            ` : ""}
          </div>
        </details>
        ${renderAgentActivityPanel()}
        ${preflightCard}
      </div>
    `;
    return;
  }

  elements.missionEntry.innerHTML = `
    <div class="form-stack">
      <div class="field field-hero">
        <label for="mission-objective">Objective</label>
        <textarea
          id="mission-objective"
          data-mission-field="objective"
          placeholder="Describe the work in plain language. Example: Compare the allowlisted pages, collect the key differences, and prepare a decision note."
          ${busy ? "disabled" : ""}
        >${escapeHtml(state.missionDraft.objective)}</textarea>
        <p class="helper-text">Required. Describe the outcome you want. The cowork now reviews the mission before the run starts. Max ${escapeHtml(limits.objectiveMaxLength ?? 360)} characters.</p>
      </div>
      <div class="stack">
        <div>
          <strong>Preferred lane</strong>
          <p class="helper-text">Optional. Leave this unset if you want the cowork to choose the safest bounded run during preflight.</p>
        </div>
        <div class="card-actions">
          ${state.missionDraft.modeTouched ? `
            <button type="button" class="ghost small" data-action="clear-mission-mode" ${busy ? "disabled" : ""}>Let the cowork choose</button>
          ` : ""}
        </div>
        <div class="mode-grid">
          ${missionModeOptions().map((mode) => `
            <button
              type="button"
              class="mode-card ${mode.id === state.missionDraft.mode ? "selected" : ""}"
              data-action="select-mission-mode"
              data-mode-id="${escapeHtml(mode.id)}"
              ${busy ? "disabled" : ""}
            >
              <h3>${escapeHtml(mode.label)}</h3>
              <p>${escapeHtml(mode.scopeHint ?? mode.description ?? "Bounded supervised execution.")}</p>
              <div class="pill-row">
                ${mode.writeBoundary ? badge(mode.writeBoundary) : ""}
                ${mode.deliverableHint ? badge(mode.deliverableHint) : ""}
              </div>
            </button>
          `).join("")}
        </div>
        ${selectedMode ? `
          <article class="card">
            <h3>${escapeHtml(selectedMode.label)}</h3>
            <p>${escapeHtml(selectedMode.description ?? selectedMode.scopeHint ?? "Bounded supervised execution.")}</p>
            <div class="pill-row">
              ${selectedMode.writeBoundary ? badge(selectedMode.writeBoundary) : ""}
              ${selectedMode.evidenceFocus ? badge(selectedMode.evidenceFocus) : ""}
              ${selectedMode.deliverableHint ? badge(selectedMode.deliverableHint) : ""}
            </div>
          </article>
        ` : ""}
      </div>
      <details class="details-panel">
        <summary>Refine this run</summary>
        <div class="form-stack">
          <div class="field compact">
            <label for="mission-deliverable">Expected deliverable</label>
            <input
              id="mission-deliverable"
              data-mission-field="deliverable"
              type="text"
              value="${escapeHtml(state.missionDraft.deliverable)}"
              placeholder="${escapeHtml(selectedMode?.deliverableHint ?? "Optional explicit deliverable")}"
              ${busy ? "disabled" : ""}
            >
            <p class="helper-text">Optional. Use this when the output format matters for review.</p>
          </div>
          <div class="field compact">
            <label for="mission-constraints">Constraints</label>
            <textarea
              id="mission-constraints"
              data-mission-field="constraints"
              placeholder="One constraint per line"
              ${busy ? "disabled" : ""}
            >${escapeHtml(state.missionDraft.constraints)}</textarea>
            <p class="helper-text">Optional. One line per constraint.</p>
          </div>
          <div class="field compact">
            <label for="mission-forbidden">Actions à éviter</label>
            <textarea
              id="mission-forbidden"
              data-mission-field="forbiddenActions"
              placeholder="Une action à éviter par ligne"
              ${busy ? "disabled" : ""}
            >${escapeHtml(state.missionDraft.forbiddenActions)}</textarea>
            <p class="helper-text">Optionnel. Une ligne par action à éviter.</p>
          </div>
          ${browsers.length > 0 ? `
            <div class="field compact">
              <label for="mission-browser-id">Preferred browser</label>
              <select id="mission-browser-id" data-mission-field="browserId" ${busy ? "disabled" : ""}>
                <option value="">Let the cowork choose if one is obvious</option>
                ${browsers.map((browser) => `
                  <option value="${escapeHtml(browser.id)}" ${browser.id === state.missionDraft.browserId ? "selected" : ""}>
                    ${escapeHtml(browser.label)}
                  </option>
                `).join("")}
              </select>
              <p class="helper-text">${selectedBrowser
                ? escapeHtml(`The cowork will prefer ${selectedBrowser.label} if this mission needs a browser launch.`)
                : "Only used when the mission actually needs a local browser to be opened."}</p>
            </div>
          ` : ""}
          <div class="field compact">
            <label>
              <input
                id="mission-auto-continue-admin"
                data-mission-field="autoContinue"
                type="checkbox"
                ${state.missionDraft.autoContinue ? "checked" : ""}
                ${busy ? "disabled" : ""}
              >
              Continue automatically to one recommended next bounded run when it is safe
            </label>
            <p class="helper-text">The cowork still pauses for approvals and stops if it needs a clarification.</p>
          </div>
          ${state.missionDraft.mode === "form" ? `
            <article class="card">
              <h3>Controlled form values</h3>
              <p class="helper-text">These values parameterize the bounded fixture form. Submission remains disabled.</p>
              <div class="field compact">
                <label for="mission-form-name">Candidate name</label>
                <input
                  id="mission-form-name"
                  data-mission-field="formName"
                  type="text"
                  value="${escapeHtml(state.missionDraft.formName || formDefaults.name || "")}"
                  ${busy ? "disabled" : ""}
                >
              </div>
              <div class="field compact">
                <label for="mission-form-role">Role</label>
                <select id="mission-form-role" data-mission-field="formRole" ${busy ? "disabled" : ""}>
                  ${roleOptions.map((option) => `
                    <option value="${escapeHtml(option.value)}" ${option.value === state.missionDraft.formRole ? "selected" : ""}>
                      ${escapeHtml(option.label)}
                    </option>
                  `).join("")}
                </select>
              </div>
              <div class="field compact">
                <label>
                  <input
                    id="mission-form-subscribe"
                    data-mission-field="formSubscribe"
                    type="checkbox"
                    ${state.missionDraft.formSubscribe ? "checked" : ""}
                    ${busy ? "disabled" : ""}
                  >
                  Toggle the newsletter checkbox
                </label>
              </div>
            </article>
          ` : ""}
        </div>
      </details>
      <div class="launch-row">
        <div class="launch-copy">
          <div class="pill-row">
            ${badge(`Project ${currentProject()?.name ?? state.selectedProjectId}`)}
            ${selectedMode ? badge(`Preferred lane: ${selectedMode.label}`, "ok") : badge("Cowork chooses the lane during review", "ok")}
          </div>
          <p class="helper-text">The cowork reviews the mission first, then you confirm the run with the final bounded interpretation.</p>
        </div>
        <button
          type="button"
          data-action="review-mission"
          ${busy || !state.selectedProjectId || !state.missionDraft.objective.trim() ? "disabled" : ""}
        >
          ${state.busy.preflight ? "Reviewing run..." : "Review mission"}
        </button>
      </div>
      ${preflightCard}
    </div>
  `;
}

function renderScenarios() {
  if (!hasElement(elements.scenarios)) {
    return;
  }
  const scenarios = state.dashboard?.scenarios ?? [];
  elements.scenarios.innerHTML = scenarios.length === 0
    ? `<div class="empty">No advanced shortcut is available.</div>`
    : `
      <div class="stack">
        ${scenarios.map((scenario) => `
          <article class="card">
            <h3>${escapeHtml(scenario.label)}</h3>
            <p>${escapeHtml(scenario.description)}</p>
            <div class="pill-row">
              ${badge(scenario.writeBoundary)}
              ${badge(scenario.evidenceFocus)}
            </div>
            <div class="card-actions">
              <button
                type="button"
                data-action="start-scenario"
                data-scenario-id="${escapeHtml(scenario.id)}"
                ${state.busy.scenarioId || !state.selectedProjectId ? "disabled" : ""}
              >
                ${state.busy.scenarioId === scenario.id ? "Starting..." : "Use quick start"}
              </button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
}

function renderRuns() {
  if (!hasElement(elements.runs)) {
    return;
  }
  const runs = currentRuns();
  elements.runs.innerHTML = runs.length === 0
    ? `<div class="empty">No run has been started for this project yet. Start with the mission composer above.</div>`
    : `
      <div class="stack">
        ${runs.map((run) => {
          const pendingForRun = (state.dashboard?.pendingApprovals ?? []).filter((approval) => approval.runId === run.id).length;
          const runState = describeRunStatus(run, pendingForRun);
          const missionObjective = run.metadata?.missionSpec?.objective ?? run.mission;
          const orchestration = run.metadata?.orchestration ?? null;
          return `
            <article class="card ${run.id === state.selectedRunId ? "active" : ""}">
              <h3>${escapeHtml(truncate(missionObjective, 110))}</h3>
              <p class="meta">${formatDate(run.createdAt)} • ${escapeHtml(run.metadata?.type ?? "run")}</p>
              <p>${escapeHtml(runState.detail)}</p>
              <div class="pill-row">
                ${badge(runState.label, runState.tone)}
                ${badge(run.lifecycleStage)}
                ${run.metadata?.entryPoint === "mission_entry_gui" ? badge("mission entry", "ok") : run.metadata?.entryPoint ? badge("advanced shortcut") : ""}
                ${orchestration?.runIndex ? badge(`step ${orchestration.runIndex}/${orchestration.maxAutoRuns ?? orchestration.runIndex}`) : ""}
                ${orchestration?.selectedBy === "agent_handoff" ? badge("auto chain", "ok") : ""}
                ${pendingForRun > 0 ? badge(`${pendingForRun} approval needed`, "warn") : ""}
              </div>
              <div class="card-actions">
                <button type="button" class="ghost" data-action="select-run" data-run-id="${escapeHtml(run.id)}">Open run</button>
                <button
                  type="button"
                  class="ghost small"
                  data-action="delete-run"
                  data-run-id="${escapeHtml(run.id)}"
                  ${state.busy.cleanup ? "disabled" : ""}
                >Delete run</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
}

function renderStatusAndSummary() {
  if (!hasElement(elements.statusBanner) || !hasElement(elements.runSummary)) {
    return;
  }
  const run = currentRun();
  const activeRunCount = state.dashboard?.activeRunIds?.length ?? 0;
  const llmGatewayStatus = state.dashboard?.llmGatewayStatus ?? null;
  const llmState = describeGatewayState(llmGatewayStatus);
  const runTokens = llmGatewayStatus?.sessionUsage?.totalTokens ?? null;
  const blockedCalls = llmGatewayStatus?.tokenGovernance?.blockedCalls ?? 0;
  const pendingApprovals = currentPendingApprovals().length;
  const runState = describeRunStatus(run, pendingApprovals);
  const outcomeSummary = currentOutcomeSummary();
  const runLlmUsage = state.runDetail?.review?.llmUsage ?? null;
  if (hasElement(elements.currentMissionPanel)) {
    elements.currentMissionPanel.classList.toggle("hidden", !IS_ADMIN_SURFACE && !run);
  }
  elements.statusBanner.innerHTML = `
    <div class="status-banner">
      ${badge(runState.label, runState.tone)}
      ${badge(activeRunCount > 0 ? `${activeRunCount} active run` : "No other active run", activeRunCount > 0 ? "warn" : "ok")}
      ${run ? badge(`stage ${run.lifecycleStage}`) : badge("waiting to start")}
      ${llmState ? badge(llmState.label, llmState.tone) : ""}
      ${runTokens != null ? badge(`session tokens ${runTokens}`) : ""}
      ${blockedCalls > 0 ? badge(`${blockedCalls} blocked AI call(s)`, "warn") : ""}
      ${state.liveUpdates === "degraded" ? badge("Live updates reconnecting", "warn") : state.liveUpdates === "live" ? badge("Live updates connected", "ok") : badge("Connecting live updates", "warn")}
    </div>
  `;

  if (!run) {
    elements.runSummary.innerHTML = `
      <article class="card">
        <h3>Ready when you are</h3>
        <p>Start from the mission composer, then follow progress, approvals, proof, and results here.</p>
        <div class="pill-row">
          ${llmState ? badge(llmState.label, llmState.tone) : ""}
          ${state.liveUpdates === "live" ? badge("Workspace connected", "ok") : ""}
        </div>
      </article>
    `;
    if (hasElement(elements.runLifecycle)) {
      elements.runLifecycle.innerHTML = "";
    }
    return;
  }

  const planSteps = state.runDetail?.review?.planSteps ?? [];
  const counts = state.runDetail?.review?.counts ?? null;
  const missionSpec = run.metadata?.missionSpec ?? null;
  const metaItems = IS_ADMIN_SURFACE
    ? [
        ["Created", formatDate(run.createdAt)],
        ["Updated", formatDate(run.updatedAt)],
        ["Project", currentProject()?.name ?? run.projectId],
        ["Run reference", run.id]
      ]
    : [
        ["Started", formatDate(run.createdAt)],
        ["Workspace", currentProject()?.name ?? run.projectId]
      ];
  const fallbackNote = llmState?.tone === "warn" || llmState?.tone === "danger"
    ? `<article class="card ${llmState.tone === "danger" ? "danger" : "warning"}">
        <h3>AI path for this session</h3>
        <p>${escapeHtml(llmState.detail)}</p>
      </article>`
    : "";
  const outcomeCard = outcomeSummary ? `
    <article class="card outcome-card ${outcomeSummary.verificationStatus === "fail" || run.status === "failed" ? "danger" : outcomeSummary.coverageStatus === "partial" ? "warning" : ""}">
      <div class="timeline-header">
        <h3>${escapeHtml(run.status === "completed" ? "What this run completed" : run.status === "running" ? "What this run is doing now" : "What this run covered")}</h3>
        <span class="meta">${escapeHtml(outcomeSummary.coverageStatus?.replaceAll("_", " ") ?? "bounded")}</span>
      </div>
      <p>${escapeHtml(outcomeSummary.clarifiedObjective)}</p>
      <div class="pill-row">
        ${outcomeSummary.verificationStatus ? badge(`verification ${outcomeSummary.verificationStatus}`, outcomeSummary.verificationStatus === "pass" ? "ok" : "warn") : ""}
        ${badge(`${outcomeSummary.artifactsCreated} result(s)`)}
        ${badge(`${outcomeSummary.proofItems} proof item(s)`)}
        ${badge(`${outcomeSummary.sourcesUsed} source(s)`)}
        ${outcomeSummary.selectedBrowser ? badge(`browser ${outcomeSummary.selectedBrowser.label}`, "ok") : ""}
        ${outcomeSummary.chain?.runIndex ? badge(`step ${outcomeSummary.chain.runIndex}/${outcomeSummary.chain.maxAutoRuns}`) : ""}
        ${outcomeSummary.chain?.autoContinueRequested ? badge("auto continuation enabled", "ok") : ""}
        ${runLlmUsage ? badge(`${runLlmUsage.callCount} AI call(s)`) : ""}
        ${runLlmUsage?.totalTokens ? badge(`${runLlmUsage.totalTokens} run token(s)`) : ""}
      </div>
      <div class="summary-grid">
        <article class="card inner-card">
          <h4>${escapeHtml(run.status === "completed" ? "What got done" : "What this run was covering")}</h4>
          ${outcomeSummary.didNow.length === 0 ? `<p class="muted">No completed action has been summarized yet.</p>` : `
            <ul class="compact-list">
              ${outcomeSummary.didNow.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          `}
        </article>
        <article class="card inner-card">
          <h4>What was verified</h4>
          ${outcomeSummary.verifiedNow.length === 0 ? `<p class="muted">Verification details will appear here once the run records them.</p>` : `
            <ul class="compact-list">
              ${outcomeSummary.verifiedNow.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          `}
        </article>
        <article class="card inner-card">
          <h4>What was not done in this run</h4>
          ${outcomeSummary.notDoneNow.length === 0 ? `<p class="muted">Nothing outside the current bounded run was detected.</p>` : `
            <ul class="compact-list">
              ${outcomeSummary.notDoneNow.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          `}
        </article>
        <article class="card inner-card">
          <h4>Recommended next step</h4>
          <p>${escapeHtml(outcomeSummary.recommendedNextStep.summary)}</p>
          ${outcomeSummary.recommendedNextStep.recommendation ? `
            <p class="muted"><strong>Next mission:</strong> ${escapeHtml(followUpRecommendationLabel(outcomeSummary.recommendedNextStep.recommendation))}</p>
          ` : ""}
          ${outcomeSummary.handoffDecision ? `
            <p class="muted"><strong>Chain decision:</strong> ${escapeHtml(outcomeSummary.handoffDecision.decisionSummary ?? outcomeSummary.handoffDecision.decision ?? "")}</p>
          ` : ""}
          <p><strong>Maybe later:</strong> ${escapeHtml(outcomeSummary.maybeLater.summary)}</p>
          ${outcomeSummary.maybeLater.recommendation ? `
            <p class="muted"><strong>Later mission:</strong> ${escapeHtml(followUpRecommendationLabel(outcomeSummary.maybeLater.recommendation))}</p>
          ` : ""}
          ${outcomeSummary.chain?.continuedToRunId ? `
            <p class="muted"><strong>Automatic continuation:</strong> the cowork already started the next bounded run for this chain.</p>
          ` : ""}
          ${(outcomeSummary.recommendedNextStep.canPrepare || outcomeSummary.maybeLater.canPrepare) && !missionBusy() && (state.dashboard?.activeRunIds?.length ?? 0) === 0 ? `
            <div class="card-actions">
              ${outcomeSummary.recommendedNextStep.canPrepare ? `
                <button type="button" class="secondary" data-action="prepare-follow-up-mission" data-recommendation-kind="next">
                  Review recommended next step
                </button>
              ` : ""}
              ${outcomeSummary.maybeLater.canPrepare ? `
                <button type="button" class="ghost" data-action="prepare-follow-up-mission" data-recommendation-kind="later">
                  Load later step
                </button>
              ` : ""}
            </div>
          ` : ""}
        </article>
      </div>
      ${outcomeSummary.ambiguityNote ? `<p class="muted">${escapeHtml(outcomeSummary.ambiguityNote)}</p>` : ""}
    </article>
  ` : "";
  elements.runSummary.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(missionSpec?.objective ?? run.mission)}</h2>
      <p>${escapeHtml(run.summary ?? runState.detail)}</p>
      <div class="pill-row">
        ${badge(runState.label, runState.tone)}
        ${badge(run.metadata?.type ?? "run")}
        ${IS_ADMIN_SURFACE && missionSpec?.mode ? badge(`frame ${missionSpec.mode}`) : ""}
        ${run.metadata?.entryPoint === "auto_chain" ? badge("agent handoff", "ok") : ""}
        ${missionSpec?.deliverable ? badge(missionSpec.deliverable) : ""}
        ${pendingApprovals > 0 ? badge(`${pendingApprovals} approval needed`, "warn") : ""}
        ${runLlmUsage?.estimatedCost ? badge(`run cost ${runLlmUsage.estimatedCost}`) : ""}
      </div>
      <div class="meta-grid compact">
        ${metaItems.map(([label, value]) => `
          <div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>
        `).join("")}
      </div>
      ${counts ? `
        <div class="pill-row">
          ${badge(`${counts.pendingApprovals} approval waiting`, counts.pendingApprovals > 0 ? "warn" : "ok")}
          ${badge(`${counts.artifacts} result(s)`)}
          ${badge(`${counts.evidence} proof item(s)`)}
          ${badge(`${counts.sources} source(s)`)}
          ${counts.llmCalls ? badge(`${counts.llmCalls} AI call(s)`) : ""}
        </div>
      ` : ""}
      ${fallbackNote}
      ${outcomeCard}
    </div>
  `;

  const lifecycle = state.runDetail?.review?.lifecycle ?? [];
  if (hasElement(elements.runLifecycle)) {
    elements.runLifecycle.innerHTML = lifecycle.length === 0
      ? `<div class="empty">No run milestone has been captured yet.</div>`
      : `
        <div class="stack">
          <article class="card">
            <h3>Plan</h3>
            ${planSteps.length === 0 ? `<div class="empty">No plan has been recorded yet.</div>` : `
              <ol class="plan-list">
                ${planSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
              </ol>
            `}
            ${missionSpec?.constraints?.length ? `
              <div class="stack">
                <strong>Constraints</strong>
                <ul class="compact-list">
                  ${missionSpec.constraints.map((constraint) => `<li>${escapeHtml(constraint)}</li>`).join("")}
                </ul>
              </div>
            ` : ""}
            ${missionSpec?.forbiddenActions?.length ? `
              <div class="stack">
                <strong>Actions à éviter</strong>
                <ul class="compact-list">
                  ${missionSpec.forbiddenActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
                </ul>
              </div>
            ` : ""}
          </article>
          <div class="list">
            ${lifecycle.map((event) => `
              <article class="card">
                <div class="timeline-header">
                  <h3>${escapeHtml(event.type)}</h3>
                  <span class="meta">${formatDate(event.createdAt)}</span>
                </div>
                <p>${escapeHtml(event.summary)}</p>
                ${refButtons(event.refs)}
              </article>
            `).join("")}
          </div>
        </div>
      `;
  }
}

function renderApprovals() {
  if (!hasElement(elements.approvals)) {
    return;
  }
  const approvals = currentPendingApprovals();
  if (approvals.length === 0) {
    elements.approvals.innerHTML = `<div class="empty">Nothing is waiting for approval right now.</div>`;
    return;
  }

  elements.approvals.innerHTML = `
    <div class="stack">
      ${approvals.map((approval) => `
        <article class="card warning">
          <div class="timeline-header">
            <h3>${escapeHtml(approval.actionLabel)}</h3>
            <span class="meta">${formatDate(approval.requestedAt ?? approval.createdAt)}</span>
          </div>
          <div class="pill-row">
            ${badge(approval.category)}
            ${badge(approval.riskLevel, "warn")}
            ${(approval.targetPage ?? approval.metadata?.targetPage) ? badge(approval.targetPage ?? approval.metadata?.targetPage) : ""}
            ${(approval.targetWindowId ?? approval.metadata?.targetWindowId) ? badge(`window ${approval.targetWindowId ?? approval.metadata?.targetWindowId}`) : ""}
          </div>
          <p><strong>Target:</strong> ${escapeHtml(approval.targetLabel)}</p>
          <p><strong>Reason:</strong> ${escapeHtml(approval.reason)}</p>
          <p><strong>Expected effect:</strong> ${escapeHtml(approval.expectedEffect)}</p>
          <p><strong>If refused:</strong> ${escapeHtml(approval.consequenceOfRefusal)}</p>
          <p class="muted">The run stays paused until you approve once, deny the action, or stop the run.</p>
          <div class="meta-grid compact">
            <div><strong>Approval id</strong><span>${escapeHtml(approval.id)}</span></div>
            <div><strong>Run id</strong><span>${escapeHtml(approval.runId)}</span></div>
            <div><strong>Decision state</strong><span>pending</span></div>
            <div><strong>Reversibility</strong><span>${escapeHtml(approval.metadata?.reversibility ?? "unspecified")}</span></div>
          </div>
          <div class="card-actions">
            ${approval.evidenceId ? `<button type="button" class="ghost" data-action="view-evidence" data-run-id="${escapeHtml(approval.runId)}" data-evidence-id="${escapeHtml(approval.evidenceId)}">Open supporting proof</button>` : ""}
            <textarea id="approval-rationale-${escapeHtml(approval.id)}" placeholder="Optional note for the audit trail"></textarea>
            <button
              type="button"
              data-action="approval-decision"
              data-approval-id="${escapeHtml(approval.id)}"
              data-decision="approved_once"
              ${state.busy.approvals.has(approval.id) ? "disabled" : ""}
            >Approve once</button>
            <button
              type="button"
              class="secondary"
              data-action="approval-decision"
              data-approval-id="${escapeHtml(approval.id)}"
              data-decision="denied"
              ${state.busy.approvals.has(approval.id) ? "disabled" : ""}
            >Deny action</button>
            <button
              type="button"
              class="danger"
              data-action="approval-decision"
              data-approval-id="${escapeHtml(approval.id)}"
              data-decision="stop_run"
              ${state.busy.approvals.has(approval.id) ? "disabled" : ""}
            >Stop run</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderApprovalHistory() {
  if (!hasElement(elements.approvalHistory)) {
    return;
  }
  const approvals = currentResolvedApprovals();
  elements.approvalHistory.innerHTML = approvals.length === 0
    ? `<div class="empty">No approval decision has been recorded for this run yet.</div>`
    : `
      <div class="list">
        ${approvals.map((approval) => `
          <article class="card ${approval.decision === "approved_once" ? "" : "danger"}">
            <div class="timeline-header">
              <h3>${escapeHtml(approval.actionLabel)}</h3>
              <span class="meta">${formatDate(approval.decisionAt ?? approval.createdAt)}</span>
            </div>
            <div class="pill-row">
              ${badge(approval.decision, approvalPill(approval.decision))}
              ${badge(approval.category)}
              ${badge(approval.riskLevel, approvalPill(approval.decision))}
            </div>
            <p><strong>Target:</strong> ${escapeHtml(approval.targetLabel)}</p>
            <p><strong>Expected effect:</strong> ${escapeHtml(approval.expectedEffect)}</p>
            <p><strong>Operator rationale:</strong> ${escapeHtml(approval.operatorRationale ?? "No rationale provided.")}</p>
            <div class="card-actions">
              ${approval.evidenceId ? `<button type="button" class="ghost" data-action="view-evidence" data-run-id="${escapeHtml(approval.runId)}" data-evidence-id="${escapeHtml(approval.evidenceId)}">Open proof</button>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    `;
}

function renderEvents() {
  if (!hasElement(elements.events)) {
    return;
  }
  const events = state.runDetail?.events ?? [];
  elements.events.innerHTML = events.length === 0
    ? `<div class="empty">No lower-level run event has been recorded yet.</div>`
    : `
      <div class="list">
        ${events.map((event) => `
          <article class="card">
            <div class="timeline-header">
              <h3>${escapeHtml(event.type)}</h3>
              <span class="meta">${escapeHtml(event.actor)} • ${formatDate(event.createdAt)}</span>
            </div>
            <p>${escapeHtml(event.summary)}</p>
            ${refButtons(event.refs)}
          </article>
        `).join("")}
      </div>
    `;
}

function renderLlmDashboard() {
  if (!hasElement(elements.llmDashboard)) {
    return;
  }
  const llmDashboard = state.dashboard?.llmDashboard ?? null;
  const gatewayStatus = state.dashboard?.llmGatewayStatus ?? null;
  const selectedRunUsage = state.runDetail?.review?.llmUsage ?? null;

  if (!llmDashboard) {
    elements.llmDashboard.innerHTML = `<div class="empty">No token or cost data is available yet.</div>`;
    return;
  }

  const stageCards = llmDashboard.stageBreakdown.length === 0
    ? `<div class="empty">No LLM stage has been recorded for this project yet.</div>`
    : `
      <div class="list">
        ${llmDashboard.stageBreakdown.map((stage) => `
          <article class="card">
            <div class="timeline-header">
              <h3>${escapeHtml(stage.stageLabel)}</h3>
              <span class="meta">${escapeHtml(stage.callCount)} call(s)</span>
            </div>
            <div class="pill-row">
              ${badge(`${stage.totalTokens} tok`)}
              ${badge(`cost ${stage.estimatedCost}`)}
              ${stage.reusedCalls ? badge(`reuse ${stage.reusedCalls}`, "ok") : ""}
              ${stage.suppressedCalls ? badge(`suppressed ${stage.suppressedCalls}`, "warn") : ""}
              ${stage.blockedCalls ? badge(`blocked ${stage.blockedCalls}`, "warn") : ""}
              ${stage.downgradedCalls ? badge(`downgraded ${stage.downgradedCalls}`, "warn") : ""}
              ${stage.fallbackCalls ? badge(`fallback ${stage.fallbackCalls}`, "warn") : ""}
              ${stage.degradedCalls ? badge(`degraded ${stage.degradedCalls}`, "danger") : ""}
            </div>
            <p class="muted">
              input ${escapeHtml(stage.inputTokens)} • output ${escapeHtml(stage.outputTokens)}
              • avg cost/call ${escapeHtml(stage.averageCostPerCall)}
              • avg tokens/call ${escapeHtml(stage.averageTokensPerCall)}
            </p>
          </article>
        `).join("")}
      </div>
    `;

  const recentRuns = llmDashboard.recentRuns.length === 0
    ? `<div class="empty">No recent run has recorded LLM usage yet.</div>`
    : `
      <div class="list">
        ${llmDashboard.recentRuns.map((run) => `
          <article class="card ${run.runId === state.selectedRunId ? "active" : ""}">
            <div class="timeline-header">
              <h3>${escapeHtml(truncate(run.mission, 92))}</h3>
              <span class="meta">${formatDate(run.createdAt)}</span>
            </div>
            <div class="pill-row">
              ${badge(run.status, statusPill(run.status))}
              ${badge(`${run.callCount} call(s)`)}
              ${badge(`${run.totalTokens} tok`)}
              ${badge(`cost ${run.estimatedCost}`)}
              ${run.reusedCalls ? badge(`reuse ${run.reusedCalls}`, "ok") : ""}
              ${run.fallbackCalls ? badge(`fallback ${run.fallbackCalls}`, "warn") : ""}
              ${run.degradedCalls ? badge(`degraded ${run.degradedCalls}`, "danger") : ""}
            </div>
            <div class="card-actions">
              <button type="button" class="ghost" data-action="select-run" data-run-id="${escapeHtml(run.runId)}">Open run</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;

  elements.llmDashboard.innerHTML = `
    <div class="stack">
      <div class="dashboard-grid">
        <article class="card metric-card">
          <span class="metric-label">Total tokens</span>
          <strong class="metric-value">${escapeHtml(llmDashboard.totalTokens)}</strong>
          <span class="muted">input ${escapeHtml(llmDashboard.inputTokens)} • output ${escapeHtml(llmDashboard.outputTokens)}</span>
        </article>
        <article class="card metric-card">
          <span class="metric-label">Estimated total cost</span>
          <strong class="metric-value">${escapeHtml(llmDashboard.estimatedCost)}</strong>
          <span class="muted">reported or estimated honestly from current pricing data</span>
        </article>
        <article class="card metric-card">
          <span class="metric-label">LLM calls</span>
          <strong class="metric-value">${escapeHtml(llmDashboard.callCount)}</strong>
          <span class="muted">avg ${escapeHtml(llmDashboard.averages.callsPerInstrumentedRun)} per instrumented run</span>
        </article>
        <article class="card metric-card">
          <span class="metric-label">Average mission cost</span>
          <strong class="metric-value">${escapeHtml(llmDashboard.averages.costPerInstrumentedRun)}</strong>
          <span class="muted">avg ${escapeHtml(llmDashboard.averages.tokensPerInstrumentedRun)} tok per instrumented run</span>
        </article>
      </div>

      <div class="dashboard-grid">
        <article class="card">
          <h3>Governance in action</h3>
          <div class="pill-row">
            ${badge(`reuse ${llmDashboard.reusedCalls}`, llmDashboard.reusedCalls ? "ok" : "")}
            ${badge(`suppressed ${llmDashboard.suppressedCalls}`, llmDashboard.suppressedCalls ? "warn" : "")}
            ${badge(`blocked ${llmDashboard.blockedCalls}`, llmDashboard.blockedCalls ? "warn" : "")}
            ${badge(`downgraded ${llmDashboard.downgradedCalls}`, llmDashboard.downgradedCalls ? "warn" : "")}
            ${badge(`fallback ${llmDashboard.fallbackCalls}`, llmDashboard.fallbackCalls ? "warn" : "")}
            ${badge(`degraded ${llmDashboard.degradedCalls}`, llmDashboard.degradedCalls ? "danger" : "")}
            ${badge(`compacted ${llmDashboard.compactionCalls}`, llmDashboard.compactionCalls ? "ok" : "")}
          </div>
          <p class="muted">The dashboard reflects live provider calls, reuse, suppression, degradation, and other token-governance decisions across recent runs in this project.</p>
        </article>
        <article class="card">
          <h3>Current gateway posture</h3>
          <div class="pill-row">
            ${gatewayStatus ? badge(`mode ${gatewayStatus.providerMode}`) : ""}
            ${gatewayStatus ? badge(`effective ${gatewayStatus.effectiveMode ?? "unknown"}`, llmModeTone(gatewayStatus.effectiveMode)) : ""}
            ${gatewayStatus?.providerDetails?.openaiCompatible?.providerLabel ? badge(gatewayStatus.providerDetails.openaiCompatible.providerLabel) : ""}
            ${gatewayStatus?.providerDetails?.openaiCompatible
              ? badge(gatewayStatus.providerDetails.openaiCompatible.configured ? "live configured" : "live not configured", gatewayStatus.providerDetails.openaiCompatible.configured ? "ok" : "warn")
              : ""}
            ${gatewayStatus?.providerDetails?.openaiCompatible?.secretStoreActive ? badge("OS secret store", "ok") : ""}
            ${gatewayStatus?.providerDetails?.openaiCompatible?.envFallbackActive ? badge("env fallback", "warn") : ""}
          </div>
          ${selectedRunUsage ? `
            <p class="muted">Selected run: ${escapeHtml(selectedRunUsage.callCount)} call(s), ${escapeHtml(selectedRunUsage.totalTokens)} tok, estimated cost ${escapeHtml(selectedRunUsage.estimatedCost)}.</p>
          ` : `<p class="muted">Open a run to inspect its specific usage alongside the project-wide trend.</p>`}
          ${llmDashboard.notes.length > 0 ? `
            <ul class="compact-list">
              ${llmDashboard.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
            </ul>
          ` : ""}
        </article>
      </div>

      <div class="workspace-grid">
        <section class="panel nested-panel">
          <div class="panel-header">
            <h3>Cost by reasoning stage</h3>
            <p class="muted">Where the agent spends reasoning budget</p>
          </div>
          ${stageCards}
        </section>
        <section class="panel nested-panel">
          <div class="panel-header">
            <h3>Recent run trend</h3>
            <p class="muted">Latest instrumented runs for this project</p>
          </div>
          ${recentRuns}
        </section>
      </div>

      <section class="panel nested-panel">
        <div class="panel-header">
          <h3>Top cost drivers</h3>
          <p class="muted">The most expensive reasoning stages in the current project history</p>
        </div>
        ${llmDashboard.topCostDrivers.length === 0 ? `<div class="empty">No cost driver has been recorded yet.</div>` : `
          <div class="list">
            ${llmDashboard.topCostDrivers.map((driver) => `
              <article class="card">
                <div class="timeline-header">
                  <h4>${escapeHtml(driver.label)}</h4>
                  <span class="meta">${escapeHtml(driver.callCount)} call(s)</span>
                </div>
                <div class="pill-row">
                  ${badge(`cost ${driver.estimatedCost}`)}
                  ${badge(`${driver.totalTokens} tok`)}
                </div>
              </article>
            `).join("")}
          </div>
        `}
      </section>
    </div>
  `;
}

function guardrailValue(key, fallback = "") {
  return state.agentConfig?.guardrails?.[key] ?? fallback;
}

function approvalModeValue(key) {
  return state.agentConfig?.guardrails?.approvalModeByAction?.[key] ?? "";
}

function desktopAutonomyValue(key) {
  return state.agentConfig?.guardrails?.desktopAutonomy?.[key];
}

function renderAgentConfiguration() {
  if (!hasElement(elements.agentConfig)) {
    return;
  }
  const config = state.agentConfig;
  if (!config) {
    elements.agentConfig.innerHTML = `<div class="empty">Agent configuration is not loaded yet.</div>`;
    return;
  }
  elements.agentConfig.innerHTML = `
    <div class="settings-grid">
      <label class="settings-field wide">
        Conversation system prompt
        <textarea id="agent-system-prompt" rows="14" ${state.busy.agentConfig ? "disabled" : ""}>${escapeHtml(config.conversationalSystemPrompt)}</textarea>
      </label>
      <label class="settings-field">
        Assistant verbosity
        <select id="agent-verbosity" ${state.busy.agentConfig ? "disabled" : ""}>
          ${["concise", "balanced", "detailed_on_request"].map((value) => `
            <option value="${value}" ${guardrailValue("assistantVerbosity") === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
      </label>
      <label class="settings-field">
        Conversation mode
        <select id="agent-conversation-mode" ${state.busy.agentConfig ? "disabled" : ""}>
          ${["natural_agent", "terse_operator", "debug_verbose"].map((value) => `
            <option value="${value}" ${guardrailValue("conversationMode") === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
      </label>
      <label class="settings-field checkbox-row">
        <input id="agent-debug-mode" type="checkbox" ${guardrailValue("debugMode") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
        Debug mode
      </label>
      <label class="settings-field checkbox-row">
        <input id="agent-show-internal-plans" type="checkbox" ${guardrailValue("showInternalPlansInChat") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
        Show internal plans in chat
      </label>
      <label class="settings-field checkbox-row">
        <input id="agent-show-trace-links" type="checkbox" ${guardrailValue("showTraceLinksInChat") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
        Show trace links in chat
      </label>
    </div>
    <div class="settings-split">
      <article class="card">
        <h3>Internal orchestration instructions</h3>
        <p>${escapeHtml(config.orchestrationInstructionsSummary)}</p>
      </article>
      <article class="card">
        <h3>Policies and tool rules</h3>
        <p>${escapeHtml(config.policyRulesSummary)}</p>
      </article>
    </div>
    <div class="card-actions">
      <button type="button" data-action="save-agent-config" ${state.busy.agentConfig ? "disabled" : ""}>Save prompt</button>
      <button type="button" class="secondary" data-action="preview-agent-config" ${state.busy.agentConfig ? "disabled" : ""}>Test preview</button>
      <button type="button" class="ghost" data-action="reset-agent-config" ${state.busy.agentConfig ? "disabled" : ""}>Reset to default</button>
    </div>
    ${state.agentConfigPreview ? `
      <article class="card">
        <h3>Preview</h3>
        <p><strong>User:</strong> ${escapeHtml(state.agentConfigPreview.message)}</p>
        <p><strong>Cowork:</strong> ${escapeHtml(state.agentConfigPreview.preview)}</p>
        <div class="pill-row">
          ${(state.agentConfigPreview.hiddenLayers ?? []).map((item) => badge(`hidden: ${item}`)).join("")}
          ${(state.agentConfigPreview.visibleLayers ?? []).map((item) => badge(`visible: ${item}`, "ok")).join("")}
        </div>
      </article>
    ` : ""}
  `;
}

function renderGuardrails() {
  if (!hasElement(elements.guardrails)) {
    return;
  }
  const config = state.agentConfig;
  if (!config) {
    elements.guardrails.innerHTML = `<div class="empty">Guardrail settings are not loaded yet.</div>`;
    return;
  }
  const approvalKeys = [
    ["local_app_launch", "Open local app"],
    ["browser_navigation", "Browser navigation"],
    ["file_read", "File read"],
    ["file_write", "File write"],
    ["destructive_action", "Destructive action"],
    ["form_submit_or_publish", "Submit or publish"]
  ];
  const approvalModes = ["confirm", "confirm_when_external_or_sensitive", "confirm_outside_project", "always_confirm", "quiet_when_auto_allowed"];
  const desktopAutonomyLevels = [
    ["supervised", "Supervised"],
    ["expanded", "Expanded"],
    ["operator_trusted", "Operator trusted"],
    ["maximum_governed", "Maximum governed"]
  ];
  const actionModes = ["block", "confirm"];
  elements.guardrails.innerHTML = `
    <div class="settings-grid">
      <label class="settings-field">
        Safety preset
        <select id="guardrail-safety-preset" ${state.busy.agentConfig ? "disabled" : ""}>
          ${["balanced", "strict", "pilot_relaxed"].map((value) => `
            <option value="${value}" ${guardrailValue("safetyPreset") === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
      </label>
      <label class="settings-field">
        Desktop scope
        <input id="guardrail-desktop-scope" value="${escapeHtml(guardrailValue("desktopScope"))}" ${state.busy.agentConfig ? "disabled" : ""}>
      </label>
      <label class="settings-field">
        Browser scope
        <input id="guardrail-browser-scope" value="${escapeHtml(guardrailValue("browserScope"))}" ${state.busy.agentConfig ? "disabled" : ""}>
      </label>
      <label class="settings-field">
        File scope
        <input id="guardrail-file-scope" value="${escapeHtml(guardrailValue("fileScope"))}" ${state.busy.agentConfig ? "disabled" : ""}>
      </label>
    </div>
    <article class="card">
      <div class="panel-header">
        <div>
          <h3>Desktop autonomy</h3>
          <p class="muted">Tune how broadly Cowork can act on the desktop. Hard safety floors still apply.</p>
        </div>
        ${badge(`level ${desktopAutonomyValue("level") ?? "supervised"}`, "warn")}
      </div>
      <div class="settings-grid">
        <label class="settings-field">
          Autonomy level
          <select id="desktop-autonomy-level" ${state.busy.agentConfig ? "disabled" : ""}>
            ${desktopAutonomyLevels.map(([value, label]) => `
              <option value="${value}" ${desktopAutonomyValue("level") === value ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </label>
        <label class="settings-field">
          Max planned steps
          <input id="desktop-autonomy-max-steps" type="number" min="1" max="20" value="${escapeHtml(desktopAutonomyValue("maxPlanSteps") ?? 8)}" ${state.busy.agentConfig ? "disabled" : ""}>
        </label>
        <label class="settings-field">
          Sensitive actions
          <select id="desktop-autonomy-sensitive-mode" ${state.busy.agentConfig ? "disabled" : ""}>
            ${actionModes.map((mode) => `<option value="${mode}" ${desktopAutonomyValue("sensitiveActionMode") === mode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
        </label>
        <label class="settings-field">
          Destructive actions
          <select id="desktop-autonomy-destructive-mode" ${state.busy.agentConfig ? "disabled" : ""}>
            ${actionModes.map((mode) => `<option value="${mode}" ${desktopAutonomyValue("destructiveActionMode") === mode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="settings-grid">
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-auto-low" type="checkbox" ${desktopAutonomyValue("autoApproveLowRisk") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Auto-allow low-risk primitives
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-auto-medium" type="checkbox" ${desktopAutonomyValue("autoApproveMediumRisk") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Auto-allow medium-risk primitives
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-confirm-high" type="checkbox" ${desktopAutonomyValue("requireApprovalForHighRisk") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Confirm high-risk primitives
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-skill-override" type="checkbox" ${desktopAutonomyValue("allowSkillOverride") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Allow skill override with policy review
        </label>
      </div>
      <div class="settings-grid">
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-text-input" type="checkbox" ${desktopAutonomyValue("allowTextInput") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Text input
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-hotkeys" type="checkbox" ${desktopAutonomyValue("allowHotkeys") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Hotkeys
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-clicks" type="checkbox" ${desktopAutonomyValue("allowClicks") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Clicks
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-scroll" type="checkbox" ${desktopAutonomyValue("allowScroll") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Scroll
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-capture" type="checkbox" ${desktopAutonomyValue("allowCapture") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Screenshots
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-coordinate-clicks" type="checkbox" ${desktopAutonomyValue("allowCoordinateClicks") !== false ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          Coordinate clicks
        </label>
        <label class="settings-field checkbox-row">
          <input id="desktop-autonomy-system-hotkeys" type="checkbox" ${desktopAutonomyValue("allowSystemHotkeys") ? "checked" : ""} ${state.busy.agentConfig ? "disabled" : ""}>
          System hotkeys
        </label>
      </div>
    </article>
    <div class="settings-grid">
      ${approvalKeys.map(([key, label]) => `
        <label class="settings-field">
          ${escapeHtml(label)}
          <select data-approval-mode="${escapeHtml(key)}" ${state.busy.agentConfig ? "disabled" : ""}>
            ${approvalModes.map((mode) => `<option value="${mode}" ${approvalModeValue(key) === mode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
        </label>
      `).join("")}
    </div>
    <article class="card">
      <h3>Non-bypassable floor</h3>
      <ul class="compact-list">
        ${(config.guardrails.nonBypassableFloor ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <p class="muted">These settings tune UX and approval posture. They do not disable hard runtime safety.</p>
    </article>
  `;
}

function optionList(values = [], selected = "") {
  return [`<option value="">All</option>`, ...values.map((value) => `
    <option value="${escapeHtml(value)}" ${String(selected) === String(value) ? "selected" : ""}>${escapeHtml(value)}</option>
  `)].join("");
}

function capabilityFeedbackForNode(graph, nodeId) {
  return (graph.feedback ?? []).find((item) => item.nodeId === nodeId) ?? null;
}

function capabilityNodeSearchText(node = {}) {
  return [
    node.id,
    node.label,
    node.kind,
    node.skillId,
    node.riskLevel,
    node.sourceKind,
    node.description,
    node.category,
    node.implementationStatus,
    node.capabilityDepth,
    ...(node.affordances ?? []),
    ...(node.supportedWorkflows ?? []).map((workflow) => `${workflow.id} ${workflow.label}`),
    ...(node.verifiers ?? []),
    ...(node.recoveryStrategies ?? []),
    ...(node.knownLimits ?? [])
  ].join(" ").toLowerCase();
}

function filteredCapabilityNodes(graph) {
  const filters = state.capabilityPanel;
  const query = filters.query.trim().toLowerCase();
  return (graph.nodes ?? []).filter((node) => {
    if (filters.kind && node.kind !== filters.kind) {
      return false;
    }
    if (filters.skillId && node.skillId !== filters.skillId && node.id !== `skill.${filters.skillId}` && node.id !== filters.skillId) {
      return false;
    }
    if (filters.riskLevel && node.riskLevel !== filters.riskLevel) {
      return false;
    }
    return !query || capabilityNodeSearchText(node).includes(query);
  });
}

function renderRankingResult() {
  const result = state.capabilityPanel.rankingResult;
  if (!result) {
    return `<div class="empty compact-empty">Run a ranking simulation to see why JON would prefer a skill/tool/surface for a mission.</div>`;
  }
  return `
    <div class="capability-ranking-results">
      <div class="timeline-header">
        <h3>Ranking simulation</h3>
        <span class="meta">${escapeHtml(result.policyId)} · ${escapeHtml(result.results?.length ?? 0)} results</span>
      </div>
      ${(result.results ?? []).slice(0, 8).map((node) => {
        const components = node.explanation?.components ?? {};
        return `
          <article class="capability-rank-card">
            <div>
              <strong>${escapeHtml(node.label)}</strong>
              <span class="meta">${escapeHtml(node.kind)} · ${escapeHtml(node.id)}</span>
            </div>
            <div class="pill-row">
              ${badge(`score ${node.score}`)}
              ${node.skillId ? badge(node.skillId) : ""}
              ${badge(`risk ${node.riskLevel}`, node.riskLevel === "high" ? "warn" : "ok")}
              ${node.approvalRequired ? badge("approval", "warn") : badge("auto", "ok")}
            </div>
            <div class="capability-score-grid">
              <span>relevance <strong>${escapeHtml(components.relevance ?? 0)}</strong></span>
              <span>keywords <strong>${escapeHtml(components.keyword ?? 0)}</strong></span>
              <span>feedback <strong>${escapeHtml(components.feedback ?? 0)}</strong></span>
              <span>risk/policy <strong>${escapeHtml(components.riskAndApproval ?? 0)}</strong></span>
            </div>
            ${(node.explanation?.matchedWords ?? []).length ? `<p class="muted">Matched: ${escapeHtml(node.explanation.matchedWords.join(", "))}</p>` : ""}
            <div class="card-actions">
              <button type="button" class="ghost small" data-action="capability-feedback-positive" data-node-id="${escapeHtml(node.id)}" data-score="${escapeHtml(node.score)}">Good choice</button>
              <button type="button" class="ghost small" data-action="capability-feedback-negative" data-node-id="${escapeHtml(node.id)}" data-score="${escapeHtml(node.score)}">Bad choice</button>
              <button type="button" class="ghost small" data-action="capability-feedback-expected" data-node-id="${escapeHtml(node.id)}" data-score="${escapeHtml(node.score)}">Expected</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderCapabilityGraph() {
  if (!hasElement(elements.capabilityGraph)) {
    return;
  }
  const graph = state.dashboard?.capabilityGraph;
  if (!graph) {
    elements.capabilityGraph.innerHTML = `<div class="empty">Capability graph not loaded yet.</div>`;
    return;
  }
  const allNodes = graph.nodes ?? [];
  const editableNodes = filteredCapabilityNodes(graph).slice(0, 30);
  const feedback = graph.summary?.feedback ?? {};
  const kinds = Array.from(new Set(allNodes.map((node) => node.kind).filter(Boolean))).sort();
  const skills = Array.from(new Set(allNodes.map((node) => node.skillId).filter(Boolean))).sort();
  const risks = Array.from(new Set(allNodes.map((node) => node.riskLevel).filter(Boolean))).sort();
  const skillManifests = graph.summary?.skillManifests ?? [];
  const skillRegistry = graph.skillRegistry ?? {};
  const userSkills = skillRegistry.userDefined ?? [];
  const deepValidation = graph.summary?.deepValidation;
  const operationalDeep = state.dashboard?.operationalDeep;
  elements.capabilityGraph.innerHTML = `
    <div class="settings-split">
      <article class="card">
        <div class="timeline-header">
          <h3>Machine capability scan</h3>
          <span class="meta">${state.busy.capabilityGraph ? "updating" : "ready"}</span>
        </div>
        <div class="pill-row">
          ${badge(`${graph.summary?.nodeCount ?? 0} nodes`)}
          ${Object.entries(graph.summary?.counts ?? {}).map(([kind, count]) => badge(`${kind}: ${count}`)).join("")}
          ${graph.summary?.updatedAt ? badge(`updated ${formatDate(graph.summary.updatedAt)}`, "ok") : ""}
          ${badge(`${feedback.recordCount ?? 0} feedback records`)}
          ${badge(`${feedback.operatorPositive ?? 0} positive`)}
          ${badge(`${feedback.operatorNegative ?? 0} negative`, feedback.operatorNegative ? "warn" : "ok")}
          ${deepValidation ? badge(`deep skills ${deepValidation.passed}/${deepValidation.skillCount}`, deepValidation.status === "all_passed" ? "ok" : "warn") : ""}
        </div>
        <p class="muted">Scan refreshes detected local applications/browsers and normalizes them into governed capabilities. It does not add new authority by itself.</p>
        ${operationalDeep ? `
          <div class="capability-drilldown">
            <div><span>JON depth</span><strong>${escapeHtml(operationalDeep.classification?.implementationStatus ?? "unknown")}</strong></div>
            <div><span>Field proof</span><strong>${escapeHtml(operationalDeep.classification?.fieldProofStatus ?? "unknown")}</strong></div>
            <div><span>Contracts</span><strong>${escapeHtml(`${operationalDeep.skillValidation?.passed ?? 0}/${operationalDeep.skillValidation?.skillCount ?? 0}`)}</strong></div>
            <div><span>Next proof</span><strong>${escapeHtml(`${operationalDeep.nextRequiredProof?.length ?? 0} scenario(s)`)}</strong></div>
          </div>
          <p class="muted">Operational deep is a product implementation status, not a user autonomy setting. Field proof remains separate.</p>
        ` : ""}
        <div class="card-actions">
          <button type="button" data-action="refresh-capability-graph" ${state.busy.capabilityGraph ? "disabled" : ""}>
            ${state.busy.capabilityGraph ? "Scanning..." : "Scan machine"}
          </button>
          <button type="button" class="secondary" data-action="generate-capability-descriptions" ${state.busy.capabilityGraph ? "disabled" : ""}>
            ${state.busy.capabilityGraph ? "Generating..." : "Generate descriptions"}
          </button>
        </div>
      </article>
      <article class="card">
        <h3>Skill manifests</h3>
        <div class="skill-manifest-list">
          ${[...skillManifests, ...userSkills].map((skill) => `
            <div class="skill-manifest-row">
              <strong>${escapeHtml(skill.label)}</strong>
              <span>${escapeHtml(skill.category ?? "skill")}</span>
              ${badge(skill.implementationStatus, skillStatusTone(skill.implementationStatus))}
              ${skill.capabilityDepth ? badge(skill.capabilityDepth, skill.capabilityDepth === "operational_deep" ? "ok" : "") : ""}
              ${skill.deepValidation ? badge(skill.deepValidation.status === "pass" ? "deep checks pass" : "deep checks fail", skill.deepValidation.status === "pass" ? "ok" : "warn") : ""}
              <span>${escapeHtml(`${skill.supportedWorkflowCount ?? 0} workflows · ${skill.verifierCount ?? 0} verifiers · ${skill.recoveryStrategyCount ?? 0} recoveries`)}</span>
              ${skill.activationStatus ? badge(skill.activationStatus, "warn") : ""}
            </div>
          `).join("")}
        </div>
        <p class="muted">Built-in foundation skills now carry operational-deep contracts validated in-repo. This is not a substitute for long real-user desktop validation.</p>
        <details class="technical-activity-drawer slim">
          <summary>Add user-defined skill draft <span>${escapeHtml(userSkills.length)} draft(s)</span></summary>
          <div class="stack">
            <textarea data-capability-panel-field="userSkillJson" rows="8" placeholder='{"id":"skill.my_app","label":"My App","primitives":["launch_application"],"policyHooks":["local_app_launch"],"evidenceHooks":["visible_window_after_launch"]}'>${escapeHtml(state.capabilityPanel.userSkillJson)}</textarea>
            <button type="button" class="secondary" data-action="save-user-skill-manifest">Save skill draft</button>
            <p class="muted">Draft skills are persisted and reviewable, but not executable until a validation harness promotes them.</p>
          </div>
        </details>
      </article>
    </div>
    <article class="card capability-cockpit">
      <div class="timeline-header">
        <h3>Capability cockpit</h3>
        <span class="meta">${editableNodes.length}/${allNodes.length} shown</span>
      </div>
      <div class="settings-grid">
        <label class="settings-field">
          Search
          <input data-capability-panel-field="query" value="${escapeHtml(state.capabilityPanel.query)}" placeholder="browser, file, notepad, risk, affordance...">
        </label>
        <label class="settings-field">
          Kind
          <select data-capability-panel-field="kind">${optionList(kinds, state.capabilityPanel.kind)}</select>
        </label>
        <label class="settings-field">
          Skill
          <select data-capability-panel-field="skillId">${optionList(skills, state.capabilityPanel.skillId)}</select>
        </label>
        <label class="settings-field">
          Risk
          <select data-capability-panel-field="riskLevel">${optionList(risks, state.capabilityPanel.riskLevel)}</select>
        </label>
      </div>
      <div class="capability-ranking-box">
        <label class="settings-field">
          Test mission ranking
          <input data-capability-panel-field="rankingMission" value="${escapeHtml(state.capabilityPanel.rankingMission)}" placeholder="ex: ouvre mon navigateur et cherche cinestar">
        </label>
        <button type="button" data-action="simulate-capability-ranking" ${state.busy.capabilityGraph ? "disabled" : ""}>Simulate ranking</button>
      </div>
      ${renderRankingResult()}
    </article>
    <div class="list">
      ${editableNodes.map((node) => `
        <article class="card">
          <div class="timeline-header">
            <label class="settings-field compact-field">
              Label
              <input data-capability-field="label" data-node-id="${escapeHtml(node.id)}" value="${escapeHtml(node.label)}" ${state.busy.capabilityGraph ? "disabled" : ""}>
            </label>
            <span class="meta">${escapeHtml(node.kind)} · ${escapeHtml(node.id)}</span>
          </div>
          <div class="capability-drilldown">
            <div><span>Source</span><strong>${escapeHtml(node.sourceKind ?? "unknown")}</strong></div>
            <div><span>Skill</span><strong>${escapeHtml(node.skillId ?? "none")}</strong></div>
            <div><span>Policy</span><strong>${escapeHtml((node.policyHooks ?? []).join(", ") || (node.approvalRequired ? "approval required" : "auto"))}</strong></div>
            <div><span>Evidence</span><strong>${escapeHtml((node.evidenceExpected ?? []).join(", ") || "unspecified")}</strong></div>
            <div><span>Deep</span><strong>${escapeHtml(`${node.supportedWorkflows?.length ?? 0} workflows · ${node.verifiers?.length ?? 0} verifiers`)}</strong></div>
          </div>
          <label class="settings-field">
            Description
            <textarea data-capability-field="description" data-node-id="${escapeHtml(node.id)}" rows="3" ${state.busy.capabilityGraph ? "disabled" : ""}>${escapeHtml(node.description ?? "")}</textarea>
          </label>
          <div class="settings-grid">
            <label class="settings-field">
              Affordances
              <textarea data-capability-field="affordances" data-node-id="${escapeHtml(node.id)}" rows="4" ${state.busy.capabilityGraph ? "disabled" : ""}>${escapeHtml((node.affordances ?? []).join("\n"))}</textarea>
            </label>
            <label class="settings-field">
              Known limits
              <textarea data-capability-field="knownLimits" data-node-id="${escapeHtml(node.id)}" rows="4" ${state.busy.capabilityGraph ? "disabled" : ""}>${escapeHtml((node.knownLimits ?? []).join("\n"))}</textarea>
            </label>
          </div>
          <div class="pill-row">
            ${node.skillId ? badge(node.skillId) : ""}
            ${node.implementationStatus ? badge(node.implementationStatus, skillStatusTone(node.implementationStatus)) : ""}
            ${node.capabilityDepth ? badge(node.capabilityDepth, node.capabilityDepth === "operational_deep" ? "ok" : "") : ""}
            ${node.deepValidation ? badge(node.deepValidation.status === "pass" ? "deep checks pass" : "deep checks fail", node.deepValidation.status === "pass" ? "ok" : "warn") : ""}
            ${badge(`risk ${node.riskLevel}`, node.riskLevel === "high" ? "warn" : "ok")}
            ${badge(node.approvalRequired ? "approval" : "auto")}
            ${node.rollbackPossible ? badge("rollback", "ok") : ""}
            ${capabilityFeedbackForNode(graph, node.id) ? badge(`${capabilityFeedbackForNode(graph, node.id).successes}/${capabilityFeedbackForNode(graph, node.id).total} success`) : ""}
          </div>
          <div class="card-actions">
            <label class="checkbox-row">
              <input type="checkbox" data-capability-select="${escapeHtml(node.id)}" ${state.busy.capabilityGraph ? "disabled" : ""}>
              Include in generation
            </label>
            <button type="button" class="secondary" data-action="save-capability-node" data-node-id="${escapeHtml(node.id)}" ${state.busy.capabilityGraph ? "disabled" : ""}>
              Save capability
            </button>
            <button type="button" class="ghost small" data-action="capability-feedback-positive" data-node-id="${escapeHtml(node.id)}">Good choice</button>
            <button type="button" class="ghost small" data-action="capability-feedback-negative" data-node-id="${escapeHtml(node.id)}">Bad choice</button>
          </div>
        </article>
      `).join("") || `<div class="empty">No capability preview available. Run a machine scan from this panel.</div>`}
    </div>
  `;
}

function capabilityFormField(nodeId, fieldName) {
  return Array.from(document.querySelectorAll(`[data-capability-field="${fieldName}"]`))
    .find((field) => field.dataset.nodeId === nodeId);
}

function textareaList(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function selectedCapabilityNodeIds() {
  return Array.from(document.querySelectorAll("[data-capability-select]:checked"))
    .map((checkbox) => checkbox.dataset.capabilitySelect)
    .filter(Boolean);
}

async function refreshCapabilityGraph() {
  state.busy.capabilityGraph = true;
  render();
  try {
    await api("/api/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    await refreshDashboard({ preserveRun: true });
    setFeedback("Machine capability scan completed.", "ok");
  } finally {
    state.busy.capabilityGraph = false;
  }
}

async function generateCapabilityDescriptions() {
  state.busy.capabilityGraph = true;
  render();
  try {
    const nodeIds = selectedCapabilityNodeIds();
    const payload = await api("/api/capabilities/descriptions/generate", {
      method: "POST",
      body: JSON.stringify({
        nodeIds,
        limit: nodeIds.length > 0 ? nodeIds.length : 12
      })
    });
    await refreshDashboard({ preserveRun: true });
    setFeedback(`Generated ${payload.updatedCount ?? 0} capability descriptions (${payload.generationMode}).`, payload.generationMode === "llm" ? "ok" : "warn");
  } finally {
    state.busy.capabilityGraph = false;
  }
}

async function saveCapabilityNode(nodeId) {
  const payload = {
    label: capabilityFormField(nodeId, "label")?.value ?? "",
    description: capabilityFormField(nodeId, "description")?.value ?? "",
    affordances: textareaList(capabilityFormField(nodeId, "affordances")?.value),
    knownLimits: textareaList(capabilityFormField(nodeId, "knownLimits")?.value)
  };
  state.busy.capabilityGraph = true;
  render();
  try {
    await api(`/api/capabilities/${encodeURIComponent(nodeId)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await refreshDashboard({ preserveRun: true });
    setFeedback("Capability description saved.", "ok");
  } finally {
    state.busy.capabilityGraph = false;
  }
}

async function simulateCapabilityRanking() {
  const mission = state.capabilityPanel.rankingMission.trim();
  if (!mission) {
    setFeedback("Enter a mission to simulate capability ranking.", "warn");
    return;
  }
  state.busy.capabilityGraph = true;
  render();
  try {
    state.capabilityPanel.rankingResult = await api("/api/capabilities/rank", {
      method: "POST",
      body: JSON.stringify({
        mission,
        limit: 10
      })
    });
    setFeedback("Capability ranking simulated with explanation.", "ok");
  } finally {
    state.busy.capabilityGraph = false;
  }
}

async function recordCapabilityPanelFeedback(nodeId, outcomeStatus, selectedScore = null) {
  state.busy.capabilityGraph = true;
  render();
  try {
    await api("/api/capabilities/feedback", {
      method: "POST",
      body: JSON.stringify({
        nodeId,
        outcomeStatus,
        selectedScore: selectedScore == null || selectedScore === "" ? null : Number(selectedScore),
        mission: state.capabilityPanel.rankingMission || null,
        reason: "admin_capability_panel"
      })
    });
    await refreshDashboard({ preserveRun: true });
    setFeedback("Capability feedback recorded.", "ok");
  } finally {
    state.busy.capabilityGraph = false;
  }
}

async function saveUserSkillManifestDraft() {
  let manifest;
  try {
    manifest = JSON.parse(state.capabilityPanel.userSkillJson || "{}");
  } catch {
    setFeedback("Skill draft must be valid JSON.", "danger");
    return;
  }
  state.busy.capabilityGraph = true;
  render();
  try {
    await api("/api/skills/user-defined", {
      method: "POST",
      body: JSON.stringify({ manifest })
    });
    state.capabilityPanel.userSkillJson = "";
    await refreshDashboard({ preserveRun: true });
    setFeedback("User-defined skill draft saved. It remains non-executable until validated.", "ok");
  } finally {
    state.busy.capabilityGraph = false;
  }
}

function renderLlmCalls() {
  if (!hasElement(elements.llmCalls)) {
    return;
  }
  const llmCalls = state.runDetail?.llmCalls ?? [];
  const llmGatewayStatus = state.dashboard?.llmGatewayStatus ?? null;
  if (llmCalls.length === 0) {
    elements.llmCalls.innerHTML = `
      <div class="stack">
        ${llmGatewayStatus ? `
          <article class="card ${llmGatewayStatus.configIssues?.length ? "warning" : ""}">
            <h3>AI gateway status</h3>
            <div class="pill-row">
              ${badge(`mode ${llmGatewayStatus.providerMode}`)}
              ${badge(`effective ${llmGatewayStatus.effectiveMode ?? "unknown"}`, llmModeTone(llmGatewayStatus.effectiveMode))}
              ${badge(`session calls ${llmGatewayStatus.sessionUsage?.callCount ?? 0}`)}
              ${llmGatewayStatus?.providerDetails?.openaiCompatible?.providerLabel ? badge(llmGatewayStatus.providerDetails.openaiCompatible.providerLabel) : ""}
              ${llmGatewayStatus?.providerDetails?.openaiCompatible ? badge(llmGatewayStatus.providerDetails.openaiCompatible.configured ? "live configured" : "live not configured", llmGatewayStatus.providerDetails.openaiCompatible.configured ? "ok" : "warn") : ""}
              ${llmGatewayStatus?.providerDetails?.openaiCompatible?.secretStoreActive ? badge("OS secret store", "ok") : ""}
              ${llmGatewayStatus?.providerDetails?.openaiCompatible?.envFallbackActive ? badge("env fallback", "warn") : ""}
            </div>
            ${llmGatewayStatus.configIssues?.length ? `
              <ul class="compact-list">
                ${llmGatewayStatus.configIssues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
              </ul>
            ` : `<p class="muted">No AI gateway issue reported.</p>`}
          </article>
        ` : ""}
        <div class="empty">No AI call was recorded for this run. This can be normal when the run stays deterministic or skips optional stages.</div>
      </div>
    `;
    return;
  }
  elements.llmCalls.innerHTML = `
    <div class="list">
      ${llmGatewayStatus ? `
        <article class="card ${llmGatewayStatus.configIssues?.length ? "warning" : ""}">
          <div class="timeline-header">
            <h3>AI gateway status</h3>
            <span class="meta">${escapeHtml(llmGatewayStatus.promptEnvironment ?? "n/a")}</span>
          </div>
          <div class="pill-row">
            ${badge(`mode ${llmGatewayStatus.providerMode}`)}
            ${badge(`effective ${llmGatewayStatus.effectiveMode ?? "unknown"}`, llmModeTone(llmGatewayStatus.effectiveMode))}
            ${badge(`session calls ${llmGatewayStatus.sessionUsage?.callCount ?? 0}`)}
            ${badge(`session tokens ${llmGatewayStatus.sessionUsage?.totalTokens ?? 0}`)}
            ${llmGatewayStatus?.providerDetails?.openaiCompatible?.providerLabel ? badge(llmGatewayStatus.providerDetails.openaiCompatible.providerLabel) : ""}
            ${llmGatewayStatus?.providerDetails?.openaiCompatible ? badge(llmGatewayStatus.providerDetails.openaiCompatible.configured ? "live configured" : "live not configured", llmGatewayStatus.providerDetails.openaiCompatible.configured ? "ok" : "warn") : ""}
            ${llmGatewayStatus?.providerDetails?.openaiCompatible?.secretStoreActive ? badge("OS secret store", "ok") : ""}
            ${llmGatewayStatus?.providerDetails?.openaiCompatible?.envFallbackActive ? badge("env fallback", "warn") : ""}
            ${llmGatewayStatus?.tokenGovernance?.reusedCalls ? badge(`reuse ${llmGatewayStatus.tokenGovernance.reusedCalls}`) : ""}
            ${llmGatewayStatus?.tokenGovernance?.suppressedCalls ? badge(`suppressed ${llmGatewayStatus.tokenGovernance.suppressedCalls}`, "warn") : ""}
            ${llmGatewayStatus?.tokenGovernance?.blockedCalls ? badge(`blocked ${llmGatewayStatus.tokenGovernance.blockedCalls}`, "warn") : ""}
          </div>
          ${llmGatewayStatus.configIssues?.length ? `
            <ul class="compact-list">
              ${llmGatewayStatus.configIssues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
            </ul>
          ` : `<p class="muted">No AI gateway issue reported.</p>`}
        </article>
      ` : ""}
      ${llmCalls.map((call) => `
        <article class="card ${call.resultStatus === "failed" ? "danger" : call.metadata?.degradedModeUsed ? "warning" : ""}">
          <div class="timeline-header">
            <h3>${escapeHtml(call.callType)}</h3>
            <span class="meta">${escapeHtml(call.providerAlias)} • ${escapeHtml(call.modelAlias)} • ${formatDate(call.createdAt)}</span>
          </div>
          <div class="pill-row">
            ${badge(call.resultStatus, statusPill(call.resultStatus))}
            ${badge(`latency ${call.latencyMs ?? "n/a"} ms`)}
            ${badge(`prompts ${call.promptRefs.length}`)}
            ${call.metadata?.reasoningStage ? badge(`stage ${call.metadata.reasoningStage}`) : ""}
            ${call.metadata?.tokenGovernance?.executionMode === "reused" ? badge("reused", "ok") : ""}
            ${call.metadata?.tokenGovernance?.executionMode === "suppressed" ? badge("suppressed", "warn") : ""}
            ${call.metadata?.tokenGovernance?.liveProviderBlocked ? badge("live blocked", "warn") : ""}
            ${call.metadata?.tokenGovernance?.downgraded ? badge("downgraded", "warn") : ""}
            ${call.estimatedCost != null ? badge(`cost ${call.estimatedCost}`) : ""}
            ${call.metadata?.tokenGovernance?.estimatedTotalTokens ? badge(`est ${call.metadata.tokenGovernance.estimatedTotalTokens} tok`) : ""}
            ${call.metadata?.requestId ? badge(`request ${call.metadata.requestId}`) : ""}
            ${call.metadata?.fallbackUsed ? badge("fallback", "warn") : ""}
            ${call.metadata?.degradedModeUsed ? badge("degraded", "danger") : ""}
          </div>
          <p class="muted">fallback chain: ${escapeHtml(JSON.stringify(call.fallbackChain ?? []))}</p>
          ${call.linkedReasoningSnapshot ? `
            <p class="muted">
              reasoning snapshot: ${escapeHtml(call.linkedReasoningSnapshot.id)}
              • observations ${call.linkedReasoningSnapshot.observations?.length ?? 0}
              • guidelines ${call.linkedReasoningSnapshot.guidelines?.length ?? 0}
            </p>
          ` : ""}
          ${call.metadata?.usageSnapshotAfter ? `
            <p class="muted">
              run usage: ${escapeHtml(JSON.stringify(call.metadata.usageSnapshotAfter.run))}
              • session usage: ${escapeHtml(JSON.stringify(call.metadata.usageSnapshotAfter.session))}
            </p>
          ` : ""}
          <div class="card-actions">
            <button type="button" class="ghost" data-action="view-llm-call" data-llm-call-id="${escapeHtml(call.id)}">Inspect call</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSources() {
  if (!hasElement(elements.sources)) {
    return;
  }
  const sources = state.runDetail?.sources ?? [];
  const runId = currentRun()?.id;
  elements.sources.innerHTML = sources.length === 0
    ? `<div class="empty">No source has been recorded for this run yet.</div>`
    : `
      <div class="list">
        ${sources.map((source) => `
          <article class="card">
            <div class="timeline-header">
              <h3>${escapeHtml(source.title)}</h3>
              <span class="meta">${formatDate(source.createdAt)}</span>
            </div>
            <p class="meta">${escapeHtml(source.trustClassification)}</p>
            <p><a href="${escapeHtml(source.canonicalRef)}" target="_blank" rel="noreferrer">${escapeHtml(source.canonicalRef)}</a></p>
            <div class="pill-row">
              ${badge(`${source.linkedEvidence.length} linked proof item(s)`)}
            </div>
            <div class="card-actions">
              ${source.linkedEvidence.map((entry) => `
                <button type="button" class="ghost small" data-action="view-evidence" data-run-id="${escapeHtml(runId)}" data-evidence-id="${escapeHtml(entry.id)}">
                  ${escapeHtml(entry.label)}
                </button>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    `;
}

function renderEvidence() {
  if (!hasElement(elements.evidence)) {
    return;
  }
  const evidence = state.runDetail?.evidence ?? [];
  const runId = currentRun()?.id;
  elements.evidence.innerHTML = evidence.length === 0
    ? `<div class="empty">No proof item has been captured for this run yet.</div>`
    : `
      <div class="list">
        ${evidence.map((entry) => `
          <article class="card">
            <div class="timeline-header">
              <h3>${escapeHtml(entry.label)}</h3>
              <span class="meta">${escapeHtml(entry.evidenceType)} • ${formatDate(entry.createdAt)}</span>
            </div>
            <p><strong>Surface:</strong> ${escapeHtml(entry.linkedSurface ?? "No linked surface")}</p>
            <p><strong>Linked source:</strong> ${escapeHtml(entry.linkedSource?.title ?? "n/a")}</p>
            <p><strong>Linked event:</strong> ${escapeHtml(entry.linkedEvent?.type ?? "n/a")}</p>
            <div class="card-actions">
              <button type="button" class="ghost" data-action="view-evidence" data-run-id="${escapeHtml(runId)}" data-evidence-id="${escapeHtml(entry.id)}">Open proof item</button>
              ${entry.hasScreenshot ? `<a href="/api/runs/${escapeHtml(runId)}/evidence/${escapeHtml(entry.id)}/screenshot" target="_blank" rel="noreferrer">Open screenshot</a>` : ""}
              <button
                type="button"
                class="danger"
                data-action="delete-evidence"
                data-run-id="${escapeHtml(runId)}"
                data-evidence-id="${escapeHtml(entry.id)}"
                ${state.busy.cleanup ? "disabled" : ""}
              >Delete evidence</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
}

function renderArtifacts() {
  if (!hasElement(elements.artifacts)) {
    return;
  }
  const artifacts = state.runDetail?.artifacts ?? [];
  const runId = currentRun()?.id;
  elements.artifacts.innerHTML = artifacts.length === 0
    ? `<div class="empty">No result has been created for this run yet.</div>`
    : `
      <div class="list">
        ${artifacts.map((artifact) => `
          <article class="card">
            <div class="timeline-header">
              <h3>${escapeHtml(artifact.title)}</h3>
              <span class="meta">${escapeHtml(artifact.artifactType)} • ${formatDate(artifact.createdAt)}</span>
            </div>
            <div class="pill-row">
              ${badge(artifact.status)}
              ${artifact.metadata?.validationState ? badge(`validation ${artifact.metadata.validationState}`) : ""}
              ${artifact.metadata?.overallConfidence ? badge(`confidence ${artifact.metadata.overallConfidence}`) : ""}
              ${badge(`${artifact.linkedSources.length} sources`)}
              ${badge(`${artifact.linkedEvidence.length} proof item(s)`)}
              ${artifact.linkedReasoningSnapshots?.length ? badge(`${artifact.linkedReasoningSnapshots.length} reasoning snapshot(s)`) : ""}
            </div>
            <p><strong>Sources:</strong> ${escapeHtml(artifact.linkedSources.map((source) => source.title).join(", ") || "n/a")}</p>
            <div class="card-actions">
              <button type="button" class="ghost" data-action="view-artifact" data-run-id="${escapeHtml(runId)}" data-artifact-id="${escapeHtml(artifact.id)}">Open result</button>
              ${artifact.linkedEvidence.map((entry) => `
                <button type="button" class="ghost small" data-action="view-evidence" data-run-id="${escapeHtml(runId)}" data-evidence-id="${escapeHtml(entry.id)}">
                  ${escapeHtml(entry.label)}
                </button>
              `).join("")}
              <button
                type="button"
                class="danger"
                data-action="delete-artifact"
                data-run-id="${escapeHtml(runId)}"
                data-artifact-id="${escapeHtml(artifact.id)}"
                ${state.busy.cleanup ? "disabled" : ""}
              >Delete artifact</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
}

function renderPreview() {
  if (!hasElement(elements.preview)) {
    return;
  }
  if (!state.preview) {
    elements.preview.innerHTML = `<div class="empty">Open a result or proof item to inspect it here.</div>`;
    return;
  }

  const metaEntries = Object.entries(state.preview.meta ?? {}).filter(([, value]) => value != null && value !== "");
  elements.preview.innerHTML = `
    <div class="preview stack">
      <article class="card">
        <h3>${escapeHtml(state.preview.title)}</h3>
        <p class="meta">${escapeHtml(state.preview.subtitle ?? "")}</p>
        ${metaEntries.length > 0 ? `
          <div class="meta-grid compact">
            ${metaEntries.map(([key, value]) => `
              <div><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></div>
            `).join("")}
          </div>
        ` : ""}
      </article>
      ${state.preview.screenshotUrl ? `<img src="${escapeHtml(state.preview.screenshotUrl)}" alt="Evidence screenshot">` : ""}
      <pre>${escapeHtml(state.preview.content)}</pre>
    </div>
  `;
}

function renderWorkspaceTabs() {
  if (!hasElement(elements.workspaceTabs)) {
    return;
  }
  const tabs = workspaceTabs();
  if (!tabs.some((tab) => tab.id === state.workspaceTab)) {
    state.workspaceTab = tabs[0]?.id ?? "run";
  }
  const shouldShowWorkspace = IS_ADMIN_SURFACE || Boolean(currentRun());
  elements.workspaceTabs.innerHTML = !shouldShowWorkspace && !IS_ADMIN_SURFACE
    ? ""
    : tabs.map((tab) => `
    <button
      type="button"
      class="tab-button ${state.workspaceTab === tab.id ? "active-button" : ""}"
      data-action="select-workspace-tab"
      data-tab-id="${escapeHtml(tab.id)}"
    >
      ${escapeHtml(tab.label)}
    </button>
  `).join("");

  if (hasElement(elements.runWorkspace)) {
    elements.runWorkspace.classList.toggle("hidden", !shouldShowWorkspace || state.workspaceTab !== "run");
  }
  if (hasElement(elements.outputsWorkspace)) {
    elements.outputsWorkspace.classList.toggle("hidden", !shouldShowWorkspace || state.workspaceTab !== "outputs");
  }
  if (hasElement(elements.diagnosticsWorkspace)) {
    elements.diagnosticsWorkspace.classList.toggle("hidden", !IS_ADMIN_SURFACE || state.workspaceTab !== "diagnostics");
  }
}

function renderBenchmarks() {
  if (!hasElement(elements.benchmarks)) {
    return;
  }
  const report = selectedBenchmarkReport();
  const history = benchmarkReports();

  if (!report) {
    elements.benchmarks.innerHTML = `
      <div class="stack">
        <article class="card">
          <h3>Benchmark suite</h3>
          <div class="empty">No benchmark report recorded yet.</div>
          <div class="card-actions">
            <button type="button" data-action="run-benchmarks" ${state.busy.benchmark ? "disabled" : ""}>
              ${state.busy.benchmark ? "Running..." : "Run benchmark suite"}
            </button>
          </div>
        </article>
      </div>
    `;
    return;
  }

  elements.benchmarks.innerHTML = `
    <div class="stack">
      <article class="card">
        <div class="timeline-header">
          <h3>Selected benchmark report</h3>
          <span class="meta">${formatDate(report.createdAt)}</span>
        </div>
        <div class="pill-row">
          ${badge(report.review?.overallStatus ?? report.summary?.overallStatus ?? "unknown", statusPill(report.review?.overallStatus ?? report.summary?.overallStatus ?? ""))}
          ${badge(`Browser ${report.summary.browserAssertions.passed}/${report.summary.browserAssertions.total}`, report.summary.browserPassed ? "ok" : "danger")}
          ${badge(`Computer ${report.summary.computerAssertions.passed}/${report.summary.computerAssertions.total}`, report.summary.computerPassed ? "ok" : "danger")}
          ${report.summary.windowsProviderStatus ? badge(`Windows ${report.summary.windowsProviderStatus}`, statusPill(report.summary.windowsProviderStatus)) : ""}
          ${report.review?.humanReviewSummary ? badge(`${report.review.humanReviewSummary.reviewedSuites}/${report.review.humanReviewSummary.totalSuites} suites reviewed`, report.review.humanReviewSummary.pendingSuites === 0 ? "ok" : "warn") : ""}
        </div>
        <p class="muted">Human review remains required before counting a benchmark as a real success.</p>
        <div class="card-actions">
          <button type="button" data-action="run-benchmarks" ${state.busy.benchmark ? "disabled" : ""}>
            ${state.busy.benchmark ? "Running..." : "Run benchmark suite"}
          </button>
        </div>
      </article>

      <article class="card">
        <h3>Suite review</h3>
        <div class="stack">
          ${(report.review?.suites ?? []).map((suite) => `
            <article class="card ${suite.status === "fail" ? "danger" : suite.status === "skipped" ? "warning" : ""}">
              <div class="timeline-header">
                <h4>${escapeHtml(suite.label)}</h4>
                <span class="meta">${escapeHtml(suite.gating ? "gating" : "diagnostic")}</span>
              </div>
              <div class="pill-row">
                ${badge(suite.status, statusPill(suite.status))}
                ${badge(`${suite.assertionSummary.passed}/${suite.assertionSummary.total} assertions`)}
                ${badge(suite.humanReviewStatus)}
              </div>
              ${suite.failureReasons.length > 0 ? `
                <ul class="compact-list">
                  ${suite.failureReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
                </ul>
              ` : `<p class="muted">No automated failure reason recorded.</p>`}
              ${suite.cases.length > 0 ? `
                <div class="stack nested-stack">
                  ${suite.cases.map((benchmarkCase) => `
                    <article class="card inner-card">
                      <div class="timeline-header">
                        <h4>${escapeHtml(benchmarkCase.label)}</h4>
                        <span class="meta">${escapeHtml(benchmarkCase.status)}</span>
                      </div>
                      <p>${escapeHtml(benchmarkCase.summary)}</p>
                      <div class="pill-row">
                        ${badge(`${benchmarkCase.assertionSummary.passed}/${benchmarkCase.assertionSummary.total} assertions`)}
                        ${benchmarkCase.relatedRunId ? `<button type="button" class="ghost small" data-action="inspect-run-ref" data-run-id="${escapeHtml(benchmarkCase.relatedRunId)}">Inspect run</button>` : ""}
                      </div>
                      <ul class="assertion-list">
                        ${benchmarkCase.assertions.map((assertion) => `
                          <li class="${assertion.passed ? "ok-line" : "danger-line"}">
                            <strong>${escapeHtml(assertion.label)}</strong>
                            <span>${escapeHtml(assertion.reason)}</span>
                            ${assertion.expected != null ? `<span class="muted">Expected: ${escapeHtml(JSON.stringify(assertion.expected))}</span>` : ""}
                            ${assertion.observed != null ? `<span class="muted">Observed: ${escapeHtml(JSON.stringify(assertion.observed))}</span>` : ""}
                          </li>
                        `).join("")}
                      </ul>
                    </article>
                  `).join("")}
                </div>
              ` : ""}
              <div class="card-actions">
                <select id="benchmark-review-${escapeHtml(suite.id)}" ${state.busy.benchmarkReviewSuiteId === suite.id ? "disabled" : ""}>
                  <option value="">Set human review classification</option>
                  <option value="real_success" ${suite.humanReviewClassification === "real_success" ? "selected" : ""}>Real success</option>
                  <option value="partial_success" ${suite.humanReviewClassification === "partial_success" ? "selected" : ""}>Partial success</option>
                  <option value="false_positive" ${suite.humanReviewClassification === "false_positive" ? "selected" : ""}>False positive</option>
                  <option value="acceptable_failure" ${suite.humanReviewClassification === "acceptable_failure" ? "selected" : ""}>Acceptable failure</option>
                  <option value="blocking_failure" ${suite.humanReviewClassification === "blocking_failure" ? "selected" : ""}>Blocking failure</option>
                </select>
                <textarea id="benchmark-review-notes-${escapeHtml(suite.id)}" placeholder="Review notes for audit and gate decisions">${escapeHtml(suite.humanReviewNotes ?? "")}</textarea>
                <button
                  type="button"
                  class="secondary"
                  data-action="submit-benchmark-review"
                  data-created-at="${escapeHtml(report.createdAt)}"
                  data-suite-id="${escapeHtml(suite.id)}"
                  ${state.busy.benchmarkReviewSuiteId === suite.id ? "disabled" : ""}
                >
                  ${state.busy.benchmarkReviewSuiteId === suite.id ? "Saving..." : "Save review"}
                </button>
              </div>
              <p class="muted">
                Human review: ${escapeHtml(suite.humanReviewLabel ?? "Pending review")}
                ${suite.humanReviewReviewer ? ` • reviewer ${escapeHtml(suite.humanReviewReviewer)}` : ""}
                ${suite.humanReviewReviewedAt ? ` • ${escapeHtml(formatDate(suite.humanReviewReviewedAt))}` : ""}
              </p>
            </article>
          `).join("")}
        </div>
      </article>

      <article class="card">
        <h3>Recent reports</h3>
        ${history.length === 0 ? `<div class="empty">No benchmark history available.</div>` : `
          <div class="list">
            ${history.map((entry) => `
              <article class="card ${entry.createdAt === state.selectedBenchmarkCreatedAt ? "active" : ""}">
                <div class="timeline-header">
                  <strong>${formatDate(entry.createdAt)}</strong>
                  <span class="meta">${escapeHtml(entry.review?.overallStatus ?? entry.summary?.overallStatus ?? "unknown")}</span>
                </div>
                <div class="pill-row">
                  ${badge(`Browser ${entry.summary.browserAssertions.passed}/${entry.summary.browserAssertions.total}`, entry.summary.browserPassed ? "ok" : "danger")}
                  ${badge(`Computer ${entry.summary.computerAssertions.passed}/${entry.summary.computerAssertions.total}`, entry.summary.computerPassed ? "ok" : "danger")}
                  ${entry.summary.windowsProviderStatus ? badge(`Windows ${entry.summary.windowsProviderStatus}`, statusPill(entry.summary.windowsProviderStatus)) : ""}
                </div>
                <div class="card-actions">
                  <button type="button" class="ghost" data-action="select-benchmark" data-created-at="${escapeHtml(entry.createdAt)}">
                    ${entry.createdAt === state.selectedBenchmarkCreatedAt ? "Selected" : "Inspect report"}
                  </button>
                </div>
              </article>
            `).join("")}
          </div>
        `}
      </article>
    </div>
  `;
}

function render() {
  document.body.classList.toggle("has-run", Boolean(currentRun()));
  document.body.classList.toggle("has-preflight", Boolean(state.missionPreflight));
  renderFlashBanner();
  renderMissionOnboarding();
  renderProjects();
  renderMissionEntry();
  renderWorkspaceTabs();
  renderScenarios();
  renderRuns();
  renderStatusAndSummary();
  renderApprovals();
  renderApprovalHistory();
  renderEvents();
  renderLlmDashboard();
  renderAgentConfiguration();
  renderGuardrails();
  renderCapabilityGraph();
  renderLlmCalls();
  renderSources();
  renderEvidence();
  renderArtifacts();
  renderPreview();
  renderBenchmarks();
}

document.body.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;

  try {
    if (action === "refresh") {
      await refreshDashboard({ preserveRun: true });
      setFeedback("Workspace refreshed.", "info");
      render();
      return;
    }

    if (action === "open-live-run") {
      state.workspaceTab = "run";
      render();
      return;
    }

    if (action === "open-admin-console") {
      window.location.assign("/admin");
      return;
    }

    if (action === "open-user-home") {
      window.location.assign("/");
      return;
    }

    if (action === "open-results") {
      state.workspaceTab = "outputs";
      render();
      return;
    }

    if (action === "open-diagnostics") {
      state.workspaceTab = "diagnostics";
      render();
      return;
    }

    if (action === "select-workspace-tab") {
      state.workspaceTab = actionTarget.dataset.tabId;
      render();
      return;
    }

    if (action === "clear-temp-state") {
      await clearTempState();
      return;
    }

    if (action === "save-agent-config") {
      await saveAgentConfiguration();
      return;
    }

    if (action === "reset-agent-config") {
      await resetAgentConfiguration();
      return;
    }

    if (action === "preview-agent-config") {
      await previewAgentConfiguration();
      return;
    }

    if (action === "refresh-capability-graph") {
      await refreshCapabilityGraph();
      render();
      return;
    }

    if (action === "generate-capability-descriptions") {
      await generateCapabilityDescriptions();
      render();
      return;
    }

    if (action === "save-capability-node") {
      await saveCapabilityNode(actionTarget.dataset.nodeId);
      render();
      return;
    }

    if (action === "simulate-capability-ranking") {
      await simulateCapabilityRanking();
      render();
      return;
    }

    if (action === "capability-feedback-positive") {
      await recordCapabilityPanelFeedback(actionTarget.dataset.nodeId, "operator_positive", actionTarget.dataset.score);
      render();
      return;
    }

    if (action === "capability-feedback-negative") {
      await recordCapabilityPanelFeedback(actionTarget.dataset.nodeId, "operator_negative", actionTarget.dataset.score);
      render();
      return;
    }

    if (action === "capability-feedback-expected") {
      await recordCapabilityPanelFeedback(actionTarget.dataset.nodeId, "expected_selection", actionTarget.dataset.score);
      render();
      return;
    }

    if (action === "save-user-skill-manifest") {
      await saveUserSkillManifestDraft();
      render();
      return;
    }

    if (action === "dismiss-feedback") {
      clearFeedback();
      render();
      return;
    }

    if (action === "select-project") {
      state.selectedProjectId = actionTarget.dataset.projectId;
      state.selectedRunId = null;
      clearMissionPreflight();
      await refreshDashboard({ preserveRun: false });
      state.preview = null;
      setFeedback("Project opened.", "info");
      render();
      return;
    }

    if (action === "delete-project") {
      await deleteResource(`/api/projects/${encodeURIComponent(actionTarget.dataset.projectId)}`, `project ${actionTarget.dataset.projectId}`);
      return;
    }

    if (action === "select-run") {
      state.selectedRunId = actionTarget.dataset.runId;
      state.workspaceTab = "run";
      await refreshDashboard({ preserveRun: true });
      setFeedback("Run opened.", "info");
      render();
      return;
    }

    if (action === "delete-run") {
      await deleteResource(`/api/runs/${encodeURIComponent(actionTarget.dataset.runId)}`, `run ${actionTarget.dataset.runId}`);
      return;
    }

    if (action === "inspect-run-ref") {
      state.selectedRunId = actionTarget.dataset.runId;
      state.workspaceTab = "run";
      await refreshDashboard({ preserveRun: true });
      setFeedback("Linked run opened.", "info");
      render();
      return;
    }

    if (action === "apply-mission-example") {
      const template = missionStarterTemplate(actionTarget.dataset.exampleId);
      if (template) {
        populateMissionDraftFromTemplate(template);
        clearMissionPreflight();
        setFeedback(`Starter mission loaded: ${template.label}.`, "info");
      }
      render();
      return;
    }

    if (action === "select-mission-mode") {
      state.missionDraft.mode = actionTarget.dataset.modeId;
      state.missionDraft.modeTouched = true;
      clearMissionPreflight();
      const defaults = missionEntryContract().formDefaults ?? {};
      if (!state.missionDraft.formName) {
        state.missionDraft.formName = defaults.name ?? "Jordan Labry";
      }
      if (!state.missionDraft.formRole) {
        state.missionDraft.formRole = defaults.role ?? "operator";
      }
      render();
      return;
    }

    if (action === "clear-mission-mode") {
      state.missionDraft.mode = "";
      state.missionDraft.modeTouched = false;
      clearMissionPreflight();
      render();
      return;
    }

    if (action === "start-scenario") {
      await startScenario(actionTarget.dataset.scenarioId);
      render();
      return;
    }

    if (action === "apply-browser-clarification") {
      state.missionDraft.browserId = actionTarget.dataset.browserId ?? "";
      clearMissionPreflight();
      await reviewMission();
      setFeedback("Browser choice applied. Review the updated bounded run, then confirm it.", "ok");
      render();
      return;
    }

    if (action === "review-mission") {
      await reviewMission();
      render();
      return;
    }

    if (action === "confirm-mission-preflight") {
      await startMission();
      render();
      return;
    }

    if (action === "prepare-follow-up-mission") {
      const outcome = currentOutcomeSummary();
      const recommendation = actionTarget.dataset.recommendationKind === "later"
        ? outcome?.maybeLater?.recommendation ?? null
        : outcome?.recommendedNextStep?.recommendation ?? null;
      await prepareMissionRecommendation(recommendation, {
        autoReview: actionTarget.dataset.recommendationKind !== "later"
      });
      render();
      return;
    }

    if (action === "clear-mission-preflight") {
      clearMissionPreflight();
      setFeedback("Mission review cleared. Adjust the request, then review it again.", "info");
      render();
      return;
    }

    if (action === "approval-decision") {
      await resolveApproval(actionTarget.dataset.approvalId, actionTarget.dataset.decision);
      render();
      return;
    }

    if (action === "view-artifact") {
      await viewArtifact(actionTarget.dataset.runId, actionTarget.dataset.artifactId);
      return;
    }

    if (action === "view-evidence") {
      await viewEvidence(actionTarget.dataset.runId, actionTarget.dataset.evidenceId);
      return;
    }

    if (action === "view-llm-call") {
      viewLlmCall(actionTarget.dataset.llmCallId);
      return;
    }

    if (action === "delete-evidence") {
      await deleteResource(
        `/api/runs/${encodeURIComponent(actionTarget.dataset.runId)}/evidence/${encodeURIComponent(actionTarget.dataset.evidenceId)}`,
        `evidence ${actionTarget.dataset.evidenceId}`
      );
      return;
    }

    if (action === "delete-artifact") {
      await deleteResource(
        `/api/runs/${encodeURIComponent(actionTarget.dataset.runId)}/artifacts/${encodeURIComponent(actionTarget.dataset.artifactId)}`,
        `artifact ${actionTarget.dataset.artifactId}`
      );
      return;
    }

    if (action === "run-benchmarks") {
      state.workspaceTab = "diagnostics";
      await runBenchmarks();
      render();
      return;
    }

    if (action === "submit-benchmark-review") {
      state.workspaceTab = "diagnostics";
      await submitBenchmarkReview(actionTarget.dataset.createdAt, actionTarget.dataset.suiteId);
      return;
    }

    if (action === "select-benchmark") {
      state.workspaceTab = "diagnostics";
      state.selectedBenchmarkCreatedAt = actionTarget.dataset.createdAt;
      render();
    }
  } catch (error) {
    state.workspaceTab = "outputs";
    setFeedback(error.message, "danger");
    state.preview = {
      kind: "error",
      title: "Action failed",
      subtitle: "runtime_error",
      content: error.message
    };
    render();
  }
});

document.body.addEventListener("input", (event) => {
  const capabilityField = event.target.closest("[data-capability-panel-field]");
  if (capabilityField) {
    state.capabilityPanel[capabilityField.dataset.capabilityPanelField] = capabilityField.value;
    if (!["rankingMission", "userSkillJson"].includes(capabilityField.dataset.capabilityPanelField)) {
      render();
    }
    return;
  }

  const field = event.target.closest("[data-mission-field]");
  if (!field) {
    return;
  }

  const { missionField } = field.dataset;
  if (field.type === "checkbox") {
    state.missionDraft[missionField] = field.checked;
  } else {
    state.missionDraft[missionField] = field.value;
  }
  if (missionField === "objective") {
    state.missionDraft.browserSearchQuery = "";
    state.missionDraft.browserLaunchUrl = "";
    state.missionDraft.computerActionType = "";
  }
  clearMissionPreflight();
});

document.body.addEventListener("change", (event) => {
  const capabilityField = event.target.closest("[data-capability-panel-field]");
  if (capabilityField) {
    state.capabilityPanel[capabilityField.dataset.capabilityPanelField] = capabilityField.value;
    render();
    return;
  }

  const field = event.target.closest("[data-mission-field]");
  if (!field) {
    return;
  }

  const { missionField } = field.dataset;
  if (field.type === "checkbox") {
    state.missionDraft[missionField] = field.checked;
  } else {
    state.missionDraft[missionField] = field.value;
  }
  if (missionField === "objective") {
    state.missionDraft.browserSearchQuery = "";
    state.missionDraft.browserLaunchUrl = "";
    state.missionDraft.computerActionType = "";
  }
  clearMissionPreflight();

  if (missionField === "mode") {
    state.missionDraft.modeTouched = true;
    const defaults = missionEntryContract().formDefaults ?? {};
    if (!state.missionDraft.formName) {
      state.missionDraft.formName = defaults.name ?? "Jordan Labry";
    }
    if (!state.missionDraft.formRole) {
      state.missionDraft.formRole = defaults.role ?? "operator";
    }
    render();
  }
});

function scheduleRefresh(delayMs = 150) {
  if (scheduleRefresh.timer) {
    window.clearTimeout(scheduleRefresh.timer);
  }
  scheduleRefresh.timer = window.setTimeout(async () => {
    try {
      await refreshDashboard({ preserveRun: true });
      render();
    } catch {
      state.liveUpdates = "degraded";
      render();
    }
  }, delayMs);
}

function setupLiveUpdates() {
  if (!window.EventSource) {
    state.liveUpdates = "degraded";
    window.setInterval(() => {
      scheduleRefresh(0);
    }, 5000);
    return;
  }

  const stream = new EventSource("/api/events");
  stream.onopen = () => {
    state.liveUpdates = "live";
    render();
  };
  stream.onmessage = (message) => {
    state.liveUpdates = "live";
    try {
      pushLiveFeed(JSON.parse(message.data));
    } catch {
      pushLiveFeed({ type: "stream.message", createdAt: new Date().toISOString(), payload: {} });
    }
    scheduleRefresh(100);
    render();
  };
  stream.onerror = () => {
    state.liveUpdates = "degraded";
    render();
  };

  window.setInterval(() => {
    scheduleRefresh(0);
  }, 15000);
}

async function boot() {
  await refreshDashboard({ preserveRun: false });
  setupLiveUpdates();
  render();
}

await boot();
