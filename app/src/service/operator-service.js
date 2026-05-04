import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  auditConversationTurn,
  auditTerminalReasoning,
  auditApprovalDecision
} from "../observability/audit-logger.js";
import { createFixtureServer } from "../fixtures/fixture-server.js";
import { createPrototypeRuntime } from "../runtime/create-prototype-runtime.js";
import { ApprovalBroker } from "../runtime/approval-broker.js";
import { BenchmarkService } from "./benchmark-service.js";
import { summarizeLlmCalls } from "./llm-analytics.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";
import { createEvent } from "../runtime/events.js";
import {
  APPROVAL_CATEGORY,
  APPROVAL_DECISION,
  DATA_ROOT,
  DEFAULT_LLM_BUDGETS,
  EVENT_ACTOR,
  LOGS_ROOT,
  LLM_CALL_TYPE,
  LLM_MODEL_ALIAS,
  REASONING_STAGE,
  RUN_STATUS,
  TEMP_RUNTIME_ROOT
} from "../config.js";
import { createId, nowIso } from "../utils/ids.js";
import { buildRunReviewModel } from "./run-review-model.js";
import { buildOperationalDeepReadinessReport } from "../release/operational-deep-readiness.js";
import { ensureDir, isPathInside, removePathIfExists } from "../utils/files.js";
import {
  buildComputerObservationScenarioDefinition,
  buildProjectAllowlistedDomains,
  buildResearchScenarioDefinition,
  describeWindowMatch,
  loadRealSurfaceRuntimeConfig,
  matchesWindowMatch,
  selectAllowlistedWindow
} from "../validation/real-surface-runtime-config.js";
import {
  buildMissionEntryContract,
  normalizeMissionDraft,
  buildMissionStatement,
  normalizeMissionSpec
} from "./mission-entry.js";
import { missionModeToScenarioType, scenarioTypeToMissionMode, validateMissionUnderstandingOutput } from "../mission/mission-understanding.js";
import {
  SAFE_CAPABILITY_IDS,
  validateConversationTurnOutput
} from "../conversation/conversation-turn.js";
import {
  executeSafeConversationCapabilities,
  readConversationArtifact
} from "../conversation/safe-capabilities.js";
import {
  AGENT_CONFIG_SETTING_KEY,
  defaultAgentConfiguration,
  normalizeAgentConfiguration,
  summarizeAgentConfiguration
} from "../conversation/agent-config.js";
import {
  defaultProjectMemory,
  normalizeProjectMemory,
  projectMemorySettingKey,
  summarizeProjectMemory
} from "../memory/project-memory.js";
import {
  USER_MEMORY_SETTING_KEY,
  defaultUserMemory,
  extractUserMemoryRecordsFromConversationTurn,
  normalizeUserMemory,
  summarizeUserMemory,
  updateUserMemoryFromConversationTurn
} from "../memory/user-memory.js";
import {
  applyCapabilityOverrides,
  buildCapabilityFeedbackStats,
  compactCapabilityGraphForPrompt,
  explainCapabilityRankingForMission,
  refreshCapabilityGraph,
  scoreCapabilityNodesForMission,
  summarizeCapabilityGraph
} from "../capabilities/capability-graph.js";
import {
  buildCapabilityBuildProposal,
  validateCapabilityBuildProposal
} from "../capabilities/capability-builder.js";
import {
  CAPABILITY_CANDIDATE_STATUS,
  checkCapabilityCircuitBreaker,
  createCapabilityCandidateArtifact,
  createDraftCapabilityProposal,
  disableStoredCapabilityCandidate,
  enableStoredCapabilityCandidate,
  executeStoredWebDataAdapterOnHtml,
  generatedCandidatesToExternalToolProvider,
  getCapabilityCandidateStats,
  listCapabilityCandidates,
  recordCapabilityRunOutcome,
  selectEnabledCapabilityForMission,
  upsertCapabilityCandidate,
  validateStoredCapabilityCandidate
} from "../capabilities/capability-candidate-workspace.js";
import { buildDeterministicCapabilityDescriptionOutput } from "../llm/deterministic-fallbacks.js";
import {
  BUILTIN_SKILL_MANIFESTS,
  USER_SKILL_MANIFESTS_SETTING_KEY,
  normalizeUserDefinedSkillManifest,
  serializeSkillManifest,
  validateSkillManifest
} from "../capabilities/skill-manifest.js";
import { validateOperationalDeepSkills } from "../capabilities/skill-validation-harness.js";
import {
  buildWorkspaceMissionBrief,
  buildWorkspaceStateSummary,
  TERMINAL_AGENT_KIND,
  TERMINAL_STATUS,
  detectCliAgentKind,
  detectTerminalState,
  evaluateTerminalIntervention,
  normalizeTerminalSession
} from "../workspace/terminal-orchestration.js";
import { getTokenGovernancePolicy } from "../llm/token-governance.js";
import {
  CliTerminalSupervisor,
  hasSensitiveTerminalInput,
  normalizeCliLaunchRequest
} from "../workspace/cli-terminal-supervisor.js";
import { PtyTerminalSupervisor } from "../workspace/pty-terminal-supervisor.js";
import {
  listAllowlistedCliCommandsFromCatalog,
  listAvailableCliAgents
} from "../workspace/cli-command-catalog.js";
import { WorkspaceBrowserProvider } from "../browser/workspace-browser-provider.js";
import { MobileDeviceRegistry } from "../mobile/mobile-device-registry.js";
import { MobileGateway, MobileAuditLog } from "../mobile/mobile-gateway.js";
import { MobileEventBuffer } from "../mobile/mobile-event-stream.js";

function buildScenarioCatalog({ researchDefinition, computerDefinition }) {
  return [
    {
      id: "research",
      label: "Recherche multi-pages",
      description: researchDefinition.mode === "allowlisted_real_web"
        ? "Lecture multi-pages sur surfaces web externes explicitement allowlistees, collecte structuree, puis generation des deux artefacts MVP."
        : "Lecture multi-tabs sur fixtures controlees, collecte structuree, puis generation des deux artefacts MVP.",
      writeBoundary: "read_only",
      evidenceFocus: researchDefinition.mode
    },
    {
      id: "form",
      label: "Preparation de formulaire",
      description: "Remplissage partiel d'un formulaire controle, avec approvals explicites et arret avant soumission.",
      writeBoundary: "bounded_edit_without_submit",
      evidenceFocus: "form_preparation_evidence"
    },
    {
      id: "computer",
      label: "Desktop step",
      description: computerDefinition.mode === "real_local_window"
        ? "Action desktop locale bornee: observation, focus gouverne, ou initiation d'un navigateur local avec verification visible."
        : "Action desktop locale bornee sur surface controlee: observation, focus gouverne, ou initiation de navigateur simulee.",
      writeBoundary: "bounded_local_desktop_step",
      evidenceFocus: computerDefinition.mode
    }
  ];
}

function controlledComputerProvider() {
  return new FakeWindowProvider([
    {
      id: "win_hub",
      title: "Controlled Browser Fixture Window",
      active: false,
      allowlisted: true,
      content: "state=loading"
    },
    {
      id: "win_notes",
      title: "Operator Notes Window",
      active: true,
      allowlisted: false,
      content: "notes"
    }
  ]);
}

function sameStringSet(left = [], right = []) {
  const normalize = (value) => Array.from(new Set(value.map((entry) => String(entry).trim()).filter(Boolean))).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function deletionRoots() {
  return [DATA_ROOT, TEMP_RUNTIME_ROOT];
}

function uniquePaths(paths) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function safeDeletionPaths(paths) {
  return uniquePaths(paths).filter((candidate) => deletionRoots().some((root) => isPathInside(root, candidate)));
}

function evidenceFilePaths(evidence) {
  return safeDeletionPaths([
    evidence.storagePath,
    evidence.metadata?.screenshotPath,
    evidence.metadata?.beforeCapturePath,
    evidence.metadata?.afterCapturePath,
    evidence.metadata?.outputPath
  ]);
}

function artifactFilePaths(artifact) {
  return safeDeletionPaths([artifact.storagePath]);
}

function findScenarioDescriptor(scenarios, scenarioId) {
  return scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
}

function normalizeMissionOrchestration(input = {}) {
  const autoContinue = input?.autoContinue === true;
  const requestedMax = Number.parseInt(String(input?.maxAutoRuns ?? (autoContinue ? 2 : 1)), 10);
  const boundedMax = Number.isFinite(requestedMax)
    ? Math.min(3, Math.max(1, requestedMax))
    : (autoContinue ? 2 : 1);
  return {
    autoContinue,
    maxAutoRuns: autoContinue ? boundedMax : 1,
    continuationMode: autoContinue ? "agent_handoff" : "manual_only"
  };
}

function searchUrlFromQuery(query = "") {
  const normalized = String(query ?? "").trim();
  if (!normalized) {
    return null;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
}

function recommendationMissionRequest(recommendation, orchestration = {}) {
  if (!recommendation) {
    return null;
  }
  return {
    missionSpec: {
      mode: recommendation.preferredMode ?? "",
      objective: recommendation.objective ?? "",
      deliverable: recommendation.deliverable ?? "",
      parameters: recommendation.parameters ?? {}
    },
    orchestration
  };
}

function compactConversationMessage(message) {
  return String(message ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function safeCapabilitiesDescriptor() {
  return SAFE_CAPABILITY_IDS.map((id) => {
    switch (id) {
      case "inspect_desktop_folders":
        return {
          id,
          boundary: "read_only",
          description: "List top-level folders on the current user's Desktop without opening file contents."
        };
      case "list_installed_applications":
        return {
          id,
          boundary: "read_only",
          description: "List locally detected applications from the current desktop provider without launching them."
        };
      case "list_installed_browsers":
        return {
          id,
          boundary: "read_only",
          description: "List locally detected browsers from the current desktop provider without launching them."
        };
      case "generate_report_preview":
        return {
          id,
          boundary: "local_artifact_write",
          description: "Generate a controlled Markdown and sandboxed HTML report preview with structured UI blocks; no arbitrary LLM-authored HTML."
        };
      default:
        return { id, boundary: "unknown", description: id };
    }
  });
}

function buildWorkspaceTerminalsContext(terminals = []) {
  const sessions = terminals
    .filter((t) => !["detached"].includes(t.status))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      label: t.label,
      agentKind: t.agentKind,
      status: t.status,
      autonomyMode: t.autonomyMode,
      recentOutput: String(t.recentOutput ?? "").slice(-200).trim()
    }));
  if (sessions.length === 0) return { sessions: [], hasWaitingInput: false, hasErrors: false, count: 0 };
  return {
    sessions,
    hasWaitingInput: sessions.some((t) => t.status === "waiting_for_input"),
    hasErrors: sessions.some((t) => t.status === "error"),
    count: sessions.length
  };
}

function buildActiveRunState(activeRunIds = [], database) {
  const activeRuns = activeRunIds
    .map((runId) => database.getRun(runId))
    .filter(Boolean)
    .map((run) => ({
      runId: run.id,
      status: run.status,
      lifecycleStage: run.lifecycleStage,
      summary: run.summary,
      mission: run.metadata?.missionSpec?.objective ?? run.mission
    }));
  return activeRuns.length > 0
    ? { activeRuns }
    : null;
}

function surfaceLockForScenario({ type = null, computerActionType = null } = {}) {
  if (["research", "form_preparation"].includes(type)) {
    return "browser";
  }
  if (type === "computer_observation") {
    return computerActionType === "browser_autonomy" ? "browser" : "desktop";
  }
  return null;
}

function surfaceLockForRun(run = null) {
  if (!run) {
    return null;
  }
  return surfaceLockForScenario({
    type: run.metadata?.type ?? null,
    computerActionType: run.metadata?.computerActionType ?? run.metadata?.missionUnderstanding?.computerActionType ?? null
  });
}

function surfaceLockForPreflight(preflight = null) {
  const understanding = preflight?.understanding ?? preflight ?? {};
  return surfaceLockForScenario({
    type: understanding.chosenExecutionFrame ?? null,
    computerActionType: understanding.computerActionType ?? null
  });
}

function compactConversationHistory(turns = []) {
  return turns.slice(-12).map((turn) => ({
    role: turn.role,
    kind: turn.kind,
    content: compactConversationMessage(turn.content).slice(0, 2000),
    intentType: turn.payload?.intentType ?? null,
    action: turn.payload?.action ?? null,
    createdAt: turn.createdAt
  }));
}

function conversationTurnRecord({ projectId, conversationId = null, role, kind, content, payload = null, metadata = {} }) {
  return {
    id: createId("cturn"),
    projectId,
    conversationId,
    role,
    kind,
    content: compactConversationMessage(content).slice(0, 4000),
    payload,
    metadata,
    createdAt: nowIso()
  };
}

function summarizeConversationTurn({ message, reply, intentType, action }) {
  const parts = [
    intentType ? `intent=${compactConversationMessage(intentType).slice(0, 60)}` : null,
    action ? `action=${compactConversationMessage(action).slice(0, 80)}` : null,
    compactConversationMessage(message).slice(0, 220),
    reply ? `-> ${compactConversationMessage(reply).slice(0, 220)}` : null
  ].filter(Boolean);
  return parts.join(" ").slice(0, 700);
}

function mergeConversationSummary(existingSummary, turnSummary) {
  const next = compactConversationMessage(turnSummary).slice(0, 700);
  if (!next) {
    return compactConversationMessage(existingSummary).slice(0, 3000);
  }
  const previousEntries = String(existingSummary ?? "")
    .split(/\n+/)
    .map((entry) => compactConversationMessage(entry).slice(0, 700))
    .filter(Boolean);
  return [...previousEntries, next].slice(-6).join("\n").slice(0, 3000);
}

function normalizeClarificationOption(option) {
  if (!option || typeof option !== "object") {
    const label = compactConversationMessage(option);
    return label ? { id: "", label, value: label, aliases: [] } : null;
  }
  const id = compactConversationMessage(option.id ?? option.value ?? "");
  const label = compactConversationMessage(option.label ?? option.name ?? option.title ?? id);
  if (!id && !label) {
    return null;
  }
  const aliases = Array.isArray(option.aliases)
    ? option.aliases.map(compactConversationMessage).filter(Boolean).slice(0, 8)
    : [];
  return {
    ...option,
    id,
    label,
    value: compactConversationMessage(option.value ?? id ?? label),
    aliases
  };
}

function normalizeClarificationOptions(options) {
  return Array.isArray(options)
    ? options.map(normalizeClarificationOption).filter(Boolean).slice(0, 8)
    : [];
}

function normalizeChoiceRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const options = normalizeClarificationOptions(value.options);
  const question = compactConversationMessage(value.question ?? "");
  if (!question || options.length === 0) {
    return null;
  }
  const resolutionTarget = value.resolutionTarget && typeof value.resolutionTarget === "object" && !Array.isArray(value.resolutionTarget)
    ? {
      parameterPath: compactConversationMessage(value.resolutionTarget.parameterPath ?? ""),
      labelPath: compactConversationMessage(value.resolutionTarget.labelPath ?? "")
    }
    : null;
  return {
    id: compactConversationMessage(value.id ?? "choice_request"),
    kind: compactConversationMessage(value.kind ?? "generic"),
    title: compactConversationMessage(value.title ?? ""),
    question,
    required: value.required !== false,
    resolutionTarget,
    options
  };
}

function choiceRequestFromPreflight(preflight) {
  const understanding = preflight?.understanding ?? preflight ?? {};
  const existing = normalizeChoiceRequest(understanding.choiceRequest);
  if (existing) {
    return existing;
  }
  const options = normalizeClarificationOptions(understanding.clarificationOptions);
  if (options.length === 0) {
    return null;
  }
  return normalizeChoiceRequest({
    id: "choice_browser_launch",
    kind: "browser",
    title: "Choisis le navigateur",
    question: understanding.clarificationQuestion || "Quel navigateur veux-tu ouvrir ?",
    required: true,
    resolutionTarget: {
      parameterPath: "parameters.browserLaunch.browserId",
      labelPath: "parameters.browserLaunch.browserLabel"
    },
    options: options.map((option) => ({
      ...option,
      description: option.description ?? "Navigateur détecté sur cette machine."
    }))
  });
}

function normalizeMatchText(value) {
  return compactConversationMessage(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchClarificationOption(answer, options = []) {
  const normalizedAnswer = normalizeMatchText(answer);
  if (!normalizedAnswer) {
    return null;
  }
  const answerTokens = new Set(normalizedAnswer.split(/\s+/).filter(Boolean));
  for (const option of normalizeClarificationOptions(options)) {
    const candidates = [
      option.id,
      option.label,
      option.value,
      ...(option.aliases ?? [])
    ].map(normalizeMatchText).filter(Boolean);
    if (candidates.some((candidate) => candidate === normalizedAnswer || normalizedAnswer.includes(candidate))) {
      return option;
    }
    if (candidates.some((candidate) => candidate.split(/\s+/).some((token) => token.length >= 3 && answerTokens.has(token)))) {
      return option;
    }
  }
  return null;
}

function clarificationQuestionFrom({ plannerOutput = null, preflight = null } = {}) {
  const understanding = preflight?.understanding ?? preflight ?? {};
  return compactConversationMessage(
    plannerOutput?.clarificationQuestion
      ?? understanding.clarificationQuestion
      ?? ""
  );
}

function clarificationOptionsFrom(preflight) {
  const understanding = preflight?.understanding ?? preflight ?? {};
  return normalizeClarificationOptions(understanding.choiceRequest?.options ?? understanding.clarificationOptions);
}

function applicationLaunchIntent(text) {
  const normalized = normalizeMatchText(text);
  return /\b(open|launch|start|ouvrir|ouvre|lance|demarre|démarre)\b/i.test(text)
    && /\b(app|application|logiciel|editeur|editor|note|notes|bloc notes|bloc-notes|outil)\b/.test(normalized);
}

function applicationChoiceKeywords(text) {
  const normalized = normalizeMatchText(text);
  if (/\b(note|notes|editeur|editor|texte|text)\b/.test(normalized)) {
    return ["note", "notes", "notepad", "obsidian", "notion", "editor", "editeur", "text", "texte", "code", "word"];
  }
  if (/\b(calculatrice|calculator|calc)\b/.test(normalized)) {
    return ["calculator", "calculatrice", "calc"];
  }
  return normalized.split(/\s+/).filter((token) => token.length >= 4).slice(0, 8);
}

function normalizedApplicationOption(application) {
  if (!application || typeof application !== "object") {
    return null;
  }
  const id = compactConversationMessage(application.id ?? "");
  const label = compactConversationMessage(application.label ?? application.name ?? id);
  if (!id || !label) {
    return null;
  }
  return {
    id,
    label,
    value: id,
    description: compactConversationMessage(application.kind ?? application.source ?? "Application détectée"),
    aliases: [
      application.processName,
      application.executablePath,
      application.kind,
      application.source
    ].map(compactConversationMessage).filter(Boolean)
  };
}

function compactApplicationCatalogForPrompt(applications = [], limit = 16) {
  return applications.slice(0, limit).map((application) => ({
    id: compactConversationMessage(application.id ?? ""),
    label: compactConversationMessage(application.label ?? application.name ?? application.id ?? "").slice(0, 80),
    kind: compactConversationMessage(application.kind ?? application.source ?? "").slice(0, 60),
    processName: compactConversationMessage(application.processName ?? "").slice(0, 80)
  })).filter((application) => application.id && application.label);
}

function compactBrowserCatalogForPrompt(browsers = [], limit = 8) {
  return browsers.slice(0, limit).map((browser) => ({
    id: compactConversationMessage(browser.id ?? ""),
    label: compactConversationMessage(browser.label ?? browser.name ?? browser.id ?? "").slice(0, 80),
    processName: compactConversationMessage(browser.processName ?? "").slice(0, 80)
  })).filter((browser) => browser.id && browser.label);
}

function compactCapabilityGraphForConversation(capabilityGraph) {
  const topCapabilities = (capabilityGraph?.topCapabilities ?? []).slice(0, 8).map((capability) => ({
    id: capability.id,
    label: compactConversationMessage(capability.label ?? capability.id ?? "").slice(0, 100),
    skillId: capability.skillId ?? null,
    riskLevel: capability.riskLevel ?? null,
    approvalRequired: Boolean(capability.approvalRequired),
    score: capability.score ?? 0,
    affordances: (capability.affordances ?? []).slice(0, 3).map((item) => compactConversationMessage(item).slice(0, 120)),
    knownLimits: (capability.knownLimits ?? []).slice(0, 2).map((item) => compactConversationMessage(item).slice(0, 120))
  }));
  return {
    nodeCount: capabilityGraph?.nodeCount ?? topCapabilities.length,
    topCapabilities
  };
}

function compactExternalConversationContext(context = {}) {
  const recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages.slice(-4).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    kind: compactConversationMessage(message.kind ?? "").slice(0, 40),
    text: compactConversationMessage(message.text ?? "").slice(0, 420)
  })) : [];
  return {
    source: compactConversationMessage(context.source ?? "").slice(0, 80),
    conversationId: compactConversationMessage(context.conversationId ?? "").slice(0, 80),
    recentMessages
  };
}

function timeoutError(message, metadata = {}) {
  return Object.assign(new Error(message), {
    code: "RUN_WAIT_TIMEOUT",
    ...metadata
  });
}

function waitWithTimeout(promise, timeoutMs, message, metadata = {}) {
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) {
    return promise;
  }
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(message, metadata)), Number(timeoutMs));
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function scoreApplicationForMessage(application, message) {
  const keywords = applicationChoiceKeywords(message);
  const haystack = normalizeMatchText([
    application.id,
    application.label,
    application.kind,
    application.processName,
    application.executablePath,
    application.source
  ].join(" "));
  return keywords.reduce((score, keyword) => score + (haystack.includes(normalizeMatchText(keyword)) ? 1 : 0), 0);
}

function buildApplicationChoiceRequest({ message, missionDraft, availableApplications = [] }) {
  if (!applicationLaunchIntent(message) || missionDraft?.parameters?.applicationLaunch?.applicationId) {
    return null;
  }
  const candidates = availableApplications
    .map(normalizedApplicationOption)
    .filter(Boolean)
    .map((application) => ({
      application,
      score: scoreApplicationForMessage(application, message)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.application.label.localeCompare(right.application.label))
    .slice(0, 6)
    .map((entry) => entry.application);
  if (candidates.length <= 1) {
    return null;
  }
  return normalizeChoiceRequest({
    id: "choice_application_launch",
    kind: "application",
    title: "Choisis l’application",
    question: "Quelle application veux-tu ouvrir ?",
    required: true,
    resolutionTarget: {
      parameterPath: "parameters.applicationLaunch.applicationId",
      labelPath: "parameters.applicationLaunch.applicationLabel"
    },
    options: candidates
  });
}

function preflightWithChoiceRequest(preflight, choiceRequest) {
  const normalized = normalizeChoiceRequest(choiceRequest);
  if (!preflight || !normalized) {
    return preflight;
  }
  const understanding = preflight.understanding ?? preflight;
  return {
    ...preflight,
    understanding: {
      ...understanding,
      coverageStatus: "clarification_needed",
      requiresClarification: true,
      clarificationQuestion: normalized.question,
      clarificationOptions: normalized.options.map((option) => ({
        id: option.id,
        label: option.label
      })),
      choiceRequest: normalized,
      nextRunRecommendation: null
    }
  };
}

function enrichPreflightWithChoiceRequest({ message, missionDraft, preflight, availableApplications }) {
  const existing = choiceRequestFromPreflight(preflight);
  if (existing) {
    return preflightWithChoiceRequest(preflight, existing);
  }
  const applicationChoice = buildApplicationChoiceRequest({
    message,
    missionDraft,
    availableApplications
  });
  return applicationChoice ? preflightWithChoiceRequest(preflight, applicationChoice) : preflight;
}

function setNestedValue(target, dottedPath, value) {
  const parts = compactConversationMessage(dottedPath).split(".").filter(Boolean);
  if (parts[0] === "missionSpec") {
    parts.shift();
  }
  if (parts.length === 0) {
    return;
  }
  let cursor = target;
  while (parts.length > 1) {
    const part = parts.shift();
    cursor[part] = cursor[part] && typeof cursor[part] === "object" && !Array.isArray(cursor[part])
      ? cursor[part]
      : {};
    cursor = cursor[part];
  }
  cursor[parts[0]] = value;
}

function buildPendingClarificationState({ sourceTurnId, message, plannerOutput, missionDraft, preflight }) {
  const understanding = preflight?.understanding ?? preflight ?? {};
  const requiresClarification = Boolean(plannerOutput?.requiresClarification || understanding.requiresClarification);
  if (!requiresClarification) {
    return null;
  }
  const question = clarificationQuestionFrom({ plannerOutput, preflight });
  return {
    id: createId("clarify"),
    status: "awaiting_user",
    sourceTurnId,
    originalMessage: compactConversationMessage(message),
    question,
    options: clarificationOptionsFrom(preflight),
    choiceRequest: choiceRequestFromPreflight(preflight),
    missionDraft: missionDraft ?? plannerOutput?.missionDraft ?? null,
    preflight: preflight ?? null,
    createdAt: nowIso()
  };
}

function normalizePendingClarificationState(value) {
  if (!value || typeof value !== "object" || value.status !== "awaiting_user") {
    return null;
  }
  const question = compactConversationMessage(value.question ?? "");
  const originalMessage = compactConversationMessage(value.originalMessage ?? "");
  if (!question && !originalMessage) {
    return null;
  }
  return {
    id: compactConversationMessage(value.id ?? createId("clarify")),
    status: "awaiting_user",
    sourceTurnId: compactConversationMessage(value.sourceTurnId ?? ""),
    originalMessage,
    question,
    options: normalizeClarificationOptions(value.options),
    choiceRequest: normalizeChoiceRequest(value.choiceRequest),
    missionDraft: value.missionDraft && typeof value.missionDraft === "object" ? value.missionDraft : null,
    preflight: value.preflight && typeof value.preflight === "object" ? value.preflight : null,
    createdAt: compactConversationMessage(value.createdAt ?? "")
  };
}

function compactPendingClarificationForPrompt(pendingClarification) {
  if (!pendingClarification) {
    return null;
  }
  return {
    id: pendingClarification.id,
    originalMessage: pendingClarification.originalMessage,
    question: pendingClarification.question,
    choiceRequest: pendingClarification.choiceRequest ? {
      id: pendingClarification.choiceRequest.id,
      kind: pendingClarification.choiceRequest.kind,
      question: pendingClarification.choiceRequest.question,
      options: pendingClarification.choiceRequest.options.map((option) => ({
        id: option.id,
        label: option.label
      }))
    } : null,
    options: pendingClarification.options.map((option) => ({
      id: option.id,
      label: option.label
    })),
    expectedUserResponse: "Treat the current user message as an answer to this pending clarification unless it clearly starts a new unrelated request."
  };
}

function buildClarifiedMissionSpec(pendingClarification, selectedOption) {
  const draft = pendingClarification?.missionDraft ?? {};
  const missionSpec = {
    objective: compactConversationMessage(draft.objective ?? pendingClarification?.originalMessage ?? ""),
    deliverable: compactConversationMessage(draft.deliverable ?? ""),
    constraints: Array.isArray(draft.constraints) ? draft.constraints : [],
    forbiddenActions: Array.isArray(draft.forbiddenActions) ? draft.forbiddenActions : [],
    mode: compactConversationMessage(draft.mode ?? ""),
    parameters: {
      ...(draft.parameters && typeof draft.parameters === "object" ? draft.parameters : {})
    }
  };
  const choiceRequest = normalizeChoiceRequest(pendingClarification.choiceRequest);
  const parameterPath = choiceRequest?.resolutionTarget?.parameterPath || "parameters.browserLaunch.browserId";
  const labelPath = choiceRequest?.resolutionTarget?.labelPath || "";
  setNestedValue(missionSpec, parameterPath, selectedOption.id || selectedOption.value || selectedOption.label);
  if (labelPath) {
    setNestedValue(missionSpec, labelPath, selectedOption.label);
  }
  return missionSpec;
}

function conversationTitleFromMessage(message) {
  const title = compactConversationMessage(message).replace(/\s+/g, " ").slice(0, 64);
  return title || "Nouvelle conversation";
}

function combineConversationReply({ plannerReply, capabilityText, action, generationMode }) {
  const planned = compactConversationMessage(plannerReply);
  const capability = compactConversationMessage(capabilityText);
  if (!capability) {
    return planned;
  }
  if (generationMode === "llm") {
    return planned || capability;
  }
  if (["inspect_then_answer", "generate_structured_response"].includes(action)) {
    return capability;
  }
  return [planned, capability].filter(Boolean).join(" ");
}

function visibleUiBlocksForTurn({ plannerOutput, capabilityExecution, agentConfig }) {
  const showInternalPlans = Boolean(agentConfig?.guardrails?.showInternalPlansInChat);
  const plannerBlocks = (plannerOutput.uiBlocks ?? []).filter((block) => {
    if (block.type === "actionPlan" && !showInternalPlans) {
      return false;
    }
    return true;
  });
  return [
    ...plannerBlocks,
    ...(capabilityExecution.uiBlocks ?? [])
  ].slice(0, 16);
}

function compactCapabilityForDescription(node) {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    sourceKind: node.sourceKind,
    sourceId: node.sourceId,
    skillId: node.skillId,
    riskLevel: node.riskLevel,
    approvalRequired: node.approvalRequired,
      rollbackPossible: node.rollbackPossible,
      description: node.payload?.description ?? "",
      category: node.payload?.category ?? null,
      implementationStatus: node.payload?.implementationStatus ?? null,
      capabilityDepth: node.payload?.capabilityDepth ?? null,
      supportedWorkflows: (node.payload?.supportedWorkflows ?? []).slice(0, 6),
      verifiers: (node.payload?.verifiers ?? []).slice(0, 6),
      recoveryStrategies: (node.payload?.recoveryStrategies ?? []).slice(0, 6),
      evidenceRequirements: (node.payload?.evidenceRequirements ?? []).slice(0, 6),
      deepValidation: node.payload?.deepValidation ?? null,
      policyHooks: (node.payload?.policyHooks ?? []).slice(0, 8),
      affordances: (node.payload?.affordances ?? []).slice(0, 8),
      knownLimits: (node.payload?.knownLimits ?? []).slice(0, 6),
      evidenceExpected: (node.payload?.evidenceExpected ?? []).slice(0, 5)
  };
}

function stringList(value, { maxItems = 10, maxLength = 180 } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => compactConversationMessage(entry).slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function validateCapabilityDescriptionOutput(output, { allowedNodeIds = new Set() } = {}) {
  const descriptions = Array.isArray(output?.descriptions) ? output.descriptions : [];
  return {
    descriptions: descriptions
      .map((entry) => ({
        nodeId: compactConversationMessage(entry?.nodeId ?? ""),
        label: compactConversationMessage(entry?.label ?? "").slice(0, 180),
        description: compactConversationMessage(entry?.description ?? "").slice(0, 1200),
        affordances: stringList(entry?.affordances),
        knownLimits: stringList(entry?.knownLimits)
      }))
      .filter((entry) => entry.nodeId && allowedNodeIds.has(entry.nodeId) && entry.description)
      .slice(0, 24)
  };
}

function rootRunIdFor(run) {
  return run?.metadata?.orchestration?.rootRunId ?? run?.id ?? null;
}

function sortChainRuns(runs = []) {
  return [...runs].sort((left, right) => {
    const leftIndex = Number(left.metadata?.orchestration?.runIndex ?? 0);
    const rightIndex = Number(right.metadata?.orchestration?.runIndex ?? 0);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left.createdAt).localeCompare(String(right.createdAt));
  });
}

async function launchScenarioForService(service, {
  projectId,
  scenarioId,
  mission = null,
  missionSpec = null,
  preflight = null,
  entryPoint = "scenario_catalog",
  orchestration = null
}) {
  const researchScenario = buildResearchScenarioDefinition({
    fixtureManifest: service.fixtureManifest,
    runtimeConfig: service.realSurfaceRuntimeConfig
  });
  const computerScenario = buildComputerObservationScenarioDefinition({
    runtimeConfig: service.realSurfaceRuntimeConfig
  });

  switch (scenarioId) {
    case "research":
      return service.runtimeHandle.runtime.startResearchMission({
        projectId,
        mission: mission ?? researchScenario.mission,
        hubUrl: researchScenario.hubUrl,
        linkSpecs: researchScenario.linkSpecs,
        fieldMap: researchScenario.fieldMap,
        sourceTargets: researchScenario.targets,
        sourceTrustClassification: researchScenario.sourceTrustClassification,
        evidenceSensitivity: researchScenario.evidenceSensitivity,
        missionSpec,
        preflight,
        orchestration,
        entryPoint,
        requestedScenarioId: scenarioId
      });
    case "form":
      return service.runtimeHandle.runtime.startFormPreparationMission({
        projectId,
        mission: mission ?? "Prepare the controlled form without submission.",
        formUrl: service.fixtureManifest.form,
        values: missionSpec?.parameters?.formValues ?? {
          name: "Jordan Labry",
          role: "operator",
          subscribe: false
        },
        missionSpec,
        preflight,
        orchestration,
        entryPoint,
        requestedScenarioId: scenarioId
      });
    case "computer": {
      const computerActionType = preflight?.understanding?.computerActionType
        ?? missionSpec?.parameters?.computerAction?.type
        ?? null;
      const requestedBrowserId = preflight?.understanding?.selectedBrowser?.id
        ?? missionSpec?.parameters?.browserLaunch?.browserId
        ?? null;
      const requestedSearchQuery = preflight?.understanding?.browserSearchQuery
        ?? missionSpec?.parameters?.browserLaunch?.searchQuery
        ?? "";
      const requestedLaunchUrl = preflight?.understanding?.browserLaunchUrl
        ?? missionSpec?.parameters?.browserLaunch?.searchUrl
        ?? missionSpec?.parameters?.browserLaunch?.url
        ?? searchUrlFromQuery(requestedSearchQuery);
      const browserActionRequested = ["launch_browser", "launch_browser_search", "capture_browser_window"].includes(computerActionType);
      const browserLaunchRequest = browserActionRequested && requestedBrowserId
        ? { id: requestedBrowserId }
        : null;
      if (browserLaunchRequest || browserActionRequested) {
        const availableBrowsers = await service.listInstalledBrowsers();
        if (computerActionType === "capture_browser_window" && !requestedBrowserId && availableBrowsers.length !== 1) {
          throw new Error("The browser capture step needs one concrete browser choice before it can start.");
        }
        const browserLaunch = requestedBrowserId
          ? availableBrowsers.find((browser) => browser.id === requestedBrowserId) ?? null
          : availableBrowsers[0] ?? null;
        if (!browserLaunch) {
          throw new Error("The selected browser is no longer available on this machine.");
        }
        return service.runtimeHandle.runtime.startComputerObservationScenario({
          projectId,
          mission: mission ?? (
            computerActionType === "launch_browser_search"
              ? `Open ${browserLaunch.label} on this machine, load the requested search page, and verify that it becomes visible.`
              : computerActionType === "capture_browser_window"
                ? `Capture visible proof from ${browserLaunch.label} and verify that the screenshot was saved for this run.`
                : `Open ${browserLaunch.label} on this machine and verify that it becomes visible.`
          ),
          desktopAction: {
            type: computerActionType ?? "launch_browser",
            browser: browserLaunch,
            searchQuery: requestedSearchQuery || null,
            url: requestedLaunchUrl ?? null
          },
          surfaceClassification: "real_local_browser",
          evidenceSensitivity: "real_local_browser",
          targetWindowLabel: browserLaunch.label,
          targetWindowRule: `process=${browserLaunch.id}`,
          missionSpec,
          preflight,
          orchestration,
          entryPoint,
          requestedScenarioId: scenarioId
        });
      }
      if (computerActionType === "capture_active_window") {
        return service.runtimeHandle.runtime.startComputerObservationScenario({
          projectId,
          mission: mission ?? "Capture visible proof from the active local window and verify that the screenshot was saved for this run.",
          desktopAction: {
            type: "capture_active_window"
          },
          surfaceClassification: "real_local_window",
          evidenceSensitivity: "real_local_window",
          targetWindowLabel: "active window",
          targetWindowRule: "active_window",
          missionSpec,
          preflight,
          orchestration,
          entryPoint,
          requestedScenarioId: scenarioId
        });
      }
      if (computerActionType === "desktop_autonomy") {
        return service.runtimeHandle.runtime.startComputerObservationScenario({
          projectId,
          mission: mission ?? "Use governed desktop primitives to execute the requested local desktop step.",
          desktopAction: {
            type: "desktop_autonomy"
          },
          surfaceClassification: "real_local_desktop",
          evidenceSensitivity: "real_local_desktop",
          targetWindowLabel: "desktop",
          targetWindowRule: "agent_selected_desktop_target",
          missionSpec,
          preflight,
          orchestration,
          entryPoint,
          requestedScenarioId: scenarioId
        });
      }
      if (computerActionType === "browser_autonomy") {
        const allowlistedHosts = preflight?.understanding?.allowlistedHosts
          ?? missionSpec?.parameters?.browserAutonomy?.allowlistedHosts
          ?? (project?.allowlistedDomains ?? []);
        const startUrl = preflight?.understanding?.browserLaunchUrl
          ?? missionSpec?.parameters?.browserAutonomy?.startUrl
          ?? null;
        return service.runtimeHandle.runtime.startComputerObservationScenario({
          projectId,
          mission: mission ?? "Use governed browser automation to execute the requested web task.",
          desktopAction: {
            type: "browser_autonomy",
            allowlistedHosts,
            startUrl
          },
          surfaceClassification: "real_local_browser",
          evidenceSensitivity: "real_local_browser",
          targetWindowLabel: startUrl ?? "browser",
          targetWindowRule: "agent_selected_browser_target",
          missionSpec,
          preflight,
          orchestration,
          entryPoint,
          requestedScenarioId: scenarioId
        });
      }
      if (computerScenario.mode === "real_local_window") {
        const visibleWindows = await service.computerProvider.listVisibleWindows();
        const targetWindow = selectAllowlistedWindow(visibleWindows, computerScenario.windowMatch);
        if (!targetWindow) {
          throw new Error(`No allowlisted real local window matched ${describeWindowMatch(computerScenario.windowMatch)}.`);
        }
        return service.runtimeHandle.runtime.startComputerObservationScenario({
          projectId,
          mission: mission ?? computerScenario.mission,
          allowlistedWindowId: targetWindow.id,
          expectedMatcher: (inspection) => matchesWindowMatch({
            id: inspection.windowId ?? inspection.id ?? null,
            title: inspection.title ?? inspection.content ?? null
          }, computerScenario.windowMatch),
          surfaceClassification: computerScenario.surfaceClassification,
          evidenceSensitivity: computerScenario.evidenceSensitivity,
          targetWindowLabel: targetWindow.title,
          targetWindowRule: describeWindowMatch(computerScenario.windowMatch),
          missionSpec,
          preflight,
          orchestration,
          entryPoint,
          requestedScenarioId: scenarioId
        });
      }

      service.computerProvider.focusWindow(computerScenario.fixtureWindows.prerequisiteWindowId);
      service.computerProvider.mutateWindow(computerScenario.fixtureWindows.allowlistedWindowId, {
        active: false,
        content: "state=loading"
      });
      setTimeout(() => {
        service.computerProvider.mutateWindow(computerScenario.fixtureWindows.allowlistedWindowId, {
          content: "state=ready"
        });
      }, 350);
      return service.runtimeHandle.runtime.startComputerObservationScenario({
        projectId,
        mission: mission ?? computerScenario.mission,
        allowlistedWindowId: computerScenario.fixtureWindows.allowlistedWindowId,
        expectedMatcher: (inspection) => inspection.content?.includes("ready"),
        surfaceClassification: computerScenario.surfaceClassification,
        evidenceSensitivity: computerScenario.evidenceSensitivity,
        targetWindowLabel: "Controlled Browser Fixture Window",
        targetWindowRule: describeWindowMatch(computerScenario.windowMatch),
        missionSpec,
        preflight,
        orchestration,
        entryPoint,
        requestedScenarioId: scenarioId
      });
    }
    default:
      throw new Error(`Unsupported scenario: ${scenarioId}`);
  }
}

export class OperatorService extends EventEmitter {
  static async create({
    env = process.env,
    dbPath = undefined,
    browserOptions = undefined,
    fixtureServer = null,
    realSurfaceRuntimeConfig = null,
    realSurfaceConfigPath = null,
    computerProvider = null,
    cliAllowedCommands = null
  } = {}) {
    const resolvedFixtureServer = fixtureServer ?? await createFixtureServer();
    const resolvedRuntimeConfig = realSurfaceRuntimeConfig ?? await loadRealSurfaceRuntimeConfig({
      env,
      filePath: realSurfaceConfigPath ?? env.COWORK_REAL_SURFACE_CONFIG_PATH
    });
    const approvalBroker = new ApprovalBroker();
    const resolvedComputerDefinition = buildComputerObservationScenarioDefinition({
      runtimeConfig: resolvedRuntimeConfig
    });
    const resolvedComputerProvider = computerProvider ?? (
      resolvedComputerDefinition.mode === "real_local_window"
        ? new PowerShellWindowProvider()
        : controlledComputerProvider()
    );
    const cliAgentCatalog = listAvailableCliAgents({ env });
    const resolvedCliAllowedCommands = cliAllowedCommands ?? (
      cliAgentCatalog.length > 0
        ? listAllowlistedCliCommandsFromCatalog(cliAgentCatalog)
        : null
    );
    let service = null;

    let runtimeHandle;
    runtimeHandle = await createPrototypeRuntime({
      dbPath,
      browserOptions,
      approvalResolver: (request) => approvalBroker.requestApproval(request),
      computerProvider: resolvedComputerProvider,
      workspaceLauncher: (projectId, payload) => service?.startWorkspaceTerminalProcess(projectId, payload),
      browserLauncher: async (projectId, payload) => service?.browserProvider.createSession({ projectId, ...payload }),
      policyHooks: {
        onApprovalRequested: async (approvalRecord, action) => {
          runtimeHandle.database.insertApproval(action.runId, approvalRecord);
          const isManualAction = approvalRecord.category === APPROVAL_CATEGORY.MANUAL_USER_ACTION;
          runtimeHandle.database.updateRun(action.runId, {
            status: RUN_STATUS.PAUSED,
            lifecycleStage: isManualAction ? "awaiting_manual_action" : "approval_pending",
            summary: isManualAction
              ? `JON attend une action manuelle : ${approvalRecord.actionLabel}`
              : `Awaiting approval: ${approvalRecord.actionLabel}`,
            updatedAt: nowIso()
          });
          runtimeHandle.database.insertEvent(action.runId, createEvent("approval.requested", EVENT_ACTOR.POLICY, `Approval requested: ${approvalRecord.actionLabel}.`, {
            approvalId: approvalRecord.id,
            category: approvalRecord.category,
            riskLevel: approvalRecord.riskLevel
          }));
          runtimeHandle.database.insertEvent(action.runId, createEvent("run.paused", EVENT_ACTOR.POLICY, "Run paused pending operator approval.", {
            approvalId: approvalRecord.id
          }));
          if (isManualAction) {
            try {
              const run = runtimeHandle.database.getRun(action.runId);
              const conversationId = run?.conversationId
                ?? runtimeHandle.database.listConversations(run?.projectId, { limit: 1 })[0]?.id
                ?? null;
              if (conversationId && run?.projectId) {
                const pauseText = `⏸ **JON est en pause** — une action manuelle est requise :\n\n**${approvalRecord.actionLabel}**\n\n${approvalRecord.reason ?? ""}\n\nUne fois l'action effectuée, clique sur **Continuer** dans le panneau de mission.`;
                runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
                  projectId: run.projectId,
                  conversationId,
                  role: "assistant",
                  kind: "mission_paused",
                  content: pauseText,
                  payload: {
                    runId: action.runId,
                    approvalId: approvalRecord.id,
                    actionLabel: approvalRecord.actionLabel,
                    reason: approvalRecord.reason ?? null
                  }
                }));
                service?.emitStateChanged("mission.paused_for_manual_action", {
                  runId: action.runId,
                  approvalId: approvalRecord.id,
                  conversationId,
                  actionLabel: approvalRecord.actionLabel
                });
              }
            } catch { /* absorb */ }
          }
          service?.emitStateChanged("approval.requested", {
            runId: action.runId,
            approvalId: approvalRecord.id
          });
        },
        onApprovalResolved: async (approvalRecord, action) => {
          runtimeHandle.database.updateApproval(approvalRecord.id, {
            decision: approvalRecord.decision,
            metadata: approvalRecord.metadata
          });

          auditApprovalDecision({
            runId: action.runId,
            projectId: runtimeHandle.database.getRun(action.runId)?.projectId ?? null,
            approvalId: approvalRecord.id,
            decision: approvalRecord.decision,
            actionLabel: approvalRecord.actionLabel,
            category: approvalRecord.category ?? null,
            riskLevel: approvalRecord.riskLevel ?? null,
            rationale: approvalRecord.metadata?.rationale ?? approvalRecord.rationale ?? null
          });

          const decisionEventType = approvalRecord.decision === APPROVAL_DECISION.APPROVED_ONCE
            ? "approval.granted"
            : "approval.denied";

          runtimeHandle.database.insertEvent(action.runId, createEvent(decisionEventType, EVENT_ACTOR.OPERATOR, `Approval resolved: ${approvalRecord.actionLabel}.`, {
            approvalId: approvalRecord.id,
            decision: approvalRecord.decision
          }));

          if (approvalRecord.decision === APPROVAL_DECISION.APPROVED_ONCE) {
            runtimeHandle.database.updateRun(action.runId, {
              status: RUN_STATUS.RUNNING,
              lifecycleStage: "executing",
              summary: `Approval granted: ${approvalRecord.actionLabel}`,
              updatedAt: nowIso()
            });
            runtimeHandle.database.insertEvent(action.runId, createEvent("run.resumed", EVENT_ACTOR.OPERATOR, "Run resumed after operator approval.", {
              approvalId: approvalRecord.id
            }));
          } else if (approvalRecord.decision === APPROVAL_DECISION.STOP_RUN) {
            runtimeHandle.database.updateRun(action.runId, {
              status: RUN_STATUS.STOPPED,
              lifecycleStage: "stopped",
              summary: `Run stopped by operator during approval: ${approvalRecord.actionLabel}`,
              updatedAt: nowIso()
            });
          }
          service?.emitStateChanged("approval.resolved", {
            runId: action.runId,
            approvalId: approvalRecord.id,
            decision: approvalRecord.decision
          });
        }
      }
    });

    service = new OperatorService({
      fixtureServer: resolvedFixtureServer,
      approvalBroker,
      runtimeHandle,
      computerProvider: resolvedComputerProvider,
      benchmarkService: new BenchmarkService(),
      realSurfaceRuntimeConfig: resolvedRuntimeConfig,
      cliAllowedCommands: resolvedCliAllowedCommands,
      cliAgentCatalog
    });
    await service.ensureDemoProject();
    service.startWorkspaceMonitoring();
    return service;
  }

  constructor({
    fixtureServer,
    approvalBroker,
    runtimeHandle,
    computerProvider,
    benchmarkService,
    realSurfaceRuntimeConfig,
    cliAllowedCommands = null,
    cliAgentCatalog = null
  }) {
    super();
    this.fixtureServer = fixtureServer;
    this.approvalBroker = approvalBroker;
    this.runtimeHandle = runtimeHandle;
    this.computerProvider = computerProvider;
    this.benchmarkService = benchmarkService;
    this.realSurfaceRuntimeConfig = realSurfaceRuntimeConfig;
    this.activeRuns = new Map();
    this.isClosing = false;
    this.workspaceMonitoringInterval = null;
    this.cliAllowedCommands = cliAllowedCommands ?? undefined;
    this.cliAgentCatalog = Array.isArray(cliAgentCatalog) ? cliAgentCatalog : listAvailableCliAgents();
    this.cliTerminalSupervisor = new CliTerminalSupervisor({
      allowedCommands: this.cliAllowedCommands
    });
    this.cliTerminalSupervisor.on("started", (event) => this.#recordCliTerminalStarted(event));
    this.cliTerminalSupervisor.on("output", (event) => this.#recordCliTerminalOutput(event));
    this.cliTerminalSupervisor.on("input", (event) => this.#recordCliTerminalInput(event));
    this.cliTerminalSupervisor.on("exit", (event) => this.#recordCliTerminalExit(event));
    this.cliTerminalSupervisor.on("error", (event) => this.#recordCliTerminalError(event));
    this.ptyTerminalSupervisor = new PtyTerminalSupervisor({
      allowedCommands: this.cliAllowedCommands
    });
    this.ptyTerminalSupervisor.on("started", (event) => this.#recordCliTerminalStarted(event));
    this.ptyTerminalSupervisor.on("output", (event) => this.#recordCliTerminalOutput(event));
    this.ptyTerminalSupervisor.on("input", (event) => this.#recordCliTerminalInput(event));
    this.ptyTerminalSupervisor.on("exit", (event) => this.#recordCliTerminalExit(event));
    this.ptyTerminalSupervisor.on("error", (event) => this.#recordCliTerminalError(event));
    this.browserProvider = new WorkspaceBrowserProvider({
      defaultHeadless: true,
      onEvent: (event) => this.#handleBrowserEvent(event)
    });
    this.mobileDeviceRegistry = new MobileDeviceRegistry();
    this.mobileAuditLog = new MobileAuditLog();
    this.mobileEventBuffer = new MobileEventBuffer();
    this.mobileGateway = new MobileGateway({
      deviceRegistry: this.mobileDeviceRegistry,
      auditLog: this.mobileAuditLog,
      operatorService: this
    });
  }

  get fixtureManifest() {
    return this.fixtureServer.manifest;
  }

  async close({ timeoutMs = 0 } = {}) {
    const activeRunSettlement = Promise.allSettled(this.activeRuns.values());
    try {
      await waitWithTimeout(
        activeRunSettlement,
        timeoutMs,
        "Timed out while waiting for active runs during service close."
      );
    } catch (error) {
      if (error.code !== "RUN_WAIT_TIMEOUT") {
        throw error;
      }
    }
    this.isClosing = true;
    this.stopWorkspaceMonitoring();
    this.cliTerminalSupervisor.close();
    this.ptyTerminalSupervisor.close();
    await this.runtimeHandle.close();
    await this.fixtureServer.close();
  }

  getUserMemory() {
    return normalizeUserMemory(
      this.runtimeHandle.database.getAppSetting(
        USER_MEMORY_SETTING_KEY,
        defaultUserMemory()
      ).value
    );
  }

  getUserMemorySummary() {
    return summarizeUserMemory(this.getUserMemory());
  }

  listUserMemoryRecords({ projectId = null, category = null, limit = 50 } = {}) {
    return this.runtimeHandle.database.listMemoryRecords?.({
      scope: "user",
      projectId,
      category,
      limit
    }) ?? [];
  }

  searchUserMemoryRecords({ query = "", projectId = null, category = null, limit = 25 } = {}) {
    return this.runtimeHandle.database.searchMemoryRecords?.({
      query,
      scope: "user",
      projectId,
      category,
      limit
    }) ?? [];
  }

  getStartupMemoryContext(projectId = null) {
    const selectedProjectId = projectId ?? this.listProjects()[0]?.id ?? null;
    const projectMemory = selectedProjectId
      ? summarizeProjectMemory(normalizeProjectMemory(
        this.runtimeHandle.database.getAppSetting(
          projectMemorySettingKey(selectedProjectId),
          defaultProjectMemory(selectedProjectId)
        ).value,
        selectedProjectId
      ))
      : null;
    const conversations = selectedProjectId
      ? this.runtimeHandle.database.listConversations(selectedProjectId, { limit: 8 })
      : [];
    const memoryRecords = selectedProjectId
      ? this.listUserMemoryRecords({ projectId: selectedProjectId, limit: 30 })
      : this.listUserMemoryRecords({ limit: 30 });
    return {
      loadedAt: nowIso(),
      projectId: selectedProjectId,
      userMemory: this.getUserMemorySummary(),
      memoryRecords,
      projectMemory,
      recentSessionSummaries: conversations
        .filter((conversation) => conversation.summary)
        .map((conversation) => ({
          conversationId: conversation.id,
          title: conversation.title,
          summary: conversation.summary,
          updatedAt: conversation.updatedAt
        }))
    };
  }

  listProjectMemoryRecords({ projectId = null, category = null, limit = 50 } = {}) {
    return this.runtimeHandle.database.listMemoryRecords?.({
      scope: "project",
      projectId,
      category,
      limit
    }) ?? [];
  }

  #buildRecentRunContext(projectId, missionText = "") {
    if (!projectId) return null;
    const records = this.listProjectMemoryRecords({ projectId, limit: 20 });
    if (records.length === 0) return null;
    const missionTokens = new Set(
      String(missionText ?? "").toLowerCase().split(/\W+/).filter((t) => t.length >= 3)
    );
    const scored = records.map((record) => {
      const recordTokens = record.text.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);
      const overlap = recordTokens.filter((t) => missionTokens.has(t)).length;
      return { record, score: overlap + (record.confidence ?? 0.5) };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
    const lines = scored.map(({ record }) => {
      const prefix = record.category === "capability_usage" ? "[capability]"
        : record.category === "surface_preference" ? "[surface]"
        : "[run]";
      return `${prefix} ${String(record.text ?? "").slice(0, 200)}`;
    });
    if (lines.length === 0) return null;
    return {
      projectId,
      recordCount: lines.length,
      summary: lines.join("\n").slice(0, 2000)
    };
  }

  #saveUserMemory(memory) {
    this.runtimeHandle.database.upsertAppSetting(
      USER_MEMORY_SETTING_KEY,
      normalizeUserMemory(memory)
    );
  }

  #recordUserMemoryFromConversationTurn({ projectId, conversationId, message, turn }) {
    const current = this.getUserMemory();
    const updated = updateUserMemoryFromConversationTurn(current, {
      projectId,
      conversationId,
      userMessage: message,
      assistantReply: turn?.reply ?? "",
      intentType: turn?.intentType ?? null,
      action: turn?.action ?? null
    });
    if (updated !== current) {
      this.#saveUserMemory(updated);
    }
    const records = extractUserMemoryRecordsFromConversationTurn({
      projectId,
      conversationId,
      userMessage: message,
      assistantReply: turn?.reply ?? "",
      intentType: turn?.intentType ?? null,
      action: turn?.action ?? null
    });
    for (const record of records) {
      const createdAt = nowIso();
      this.runtimeHandle.database.insertMemoryRecord?.({
        id: createId("mem"),
        ...record,
        createdAt,
        updatedAt: createdAt
      });
    }
    return updated;
  }

  #appendTerminalOutput(existingOutput, chunk) {
    return `${existingOutput ?? ""}${chunk ?? ""}`.slice(-4000);
  }

  #recordTerminalEvent(terminal, event) {
    if (!terminal) {
      return null;
    }
    return this.runtimeHandle.database.insertWorkspaceTerminalEvent({
      id: createId("wte"),
      terminalId: terminal.id,
      projectId: terminal.projectId,
      conversationId: terminal.conversationId,
      eventType: event.eventType,
      stream: event.stream ?? null,
      content: event.content ?? "",
      metadata: event.metadata ?? {},
      createdAt: event.createdAt ?? nowIso()
    });
  }

  #injectTerminalConversationAlert(terminal, decision, detection, suggestion = null) {
    if (this.isClosing) {
      return;
    }
    const statusLabel = {
      waiting_for_input: "attend une entrée utilisateur",
      needs_attention: "nécessite votre attention",
      error: "est en erreur"
    }[detection?.status] ?? detection?.status ?? "a changé d'état";
    const actionLabel = {
      request_human_approval: "Votre accord est requis avant que JON n'agisse.",
      suggest_user_reply: "Vous pouvez répondre directement au terminal.",
      escalate_human: "Vérifiez le terminal : JON ne peut pas répondre automatiquement.",
      auto_inject_context: "JON va injecter un contexte autorisé dans le terminal.",
      observe_only: "JON surveille l'état."
    }[decision?.action] ?? "";
    const recentSnippet = String(terminal.recentOutput ?? "").slice(-240).trim();
    const suggestionLine = suggestion?.suggestedInput
      ? `Réponse suggérée par JON : \`${String(suggestion.suggestedInput).slice(0, 120)}\`${suggestion.reasoning ? ` — ${suggestion.reasoning}` : ""}`
      : null;
    const alertText = [
      `Le terminal **${terminal.label}** (${terminal.agentKind}) ${statusLabel}.`,
      recentSnippet ? `Dernière sortie : \`${recentSnippet}\`` : null,
      actionLabel,
      suggestionLine
    ].filter(Boolean).join("\n\n");

    const projectId = terminal.projectId;
    const conversationId = terminal.conversationId
      ?? this.runtimeHandle.database.listConversations(projectId, { limit: 1 })[0]?.id
      ?? null;
    const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId, {
      conversationId: terminal.conversationId
    });
    const missionObjective = missionBrief?.objective ?? null;

    const alertPayload = {
      terminalId: terminal.id,
      terminalLabel: terminal.label,
      terminalStatus: detection?.status ?? terminal.status,
      agentKind: terminal.agentKind,
      decisionAction: decision?.action ?? null,
      requiresApproval: decision?.requiresApproval ?? false,
      reason: decision?.reason ?? detection?.reason ?? "",
      recentOutput: recentSnippet,
      autonomyMode: terminal.autonomyMode,
      missionObjective,
      suggestedInput: suggestion?.suggestedInput ?? null,
      suggestionReasoning: suggestion?.reasoning ?? null
    };

    if (conversationId) {
      this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
        projectId,
        conversationId,
        role: "assistant",
        kind: "terminal_alert",
        content: alertText,
        payload: alertPayload
      }));
    }

    this.emitStateChanged("workspace.terminal.conversation_alert", {
      projectId,
      conversationId,
      ...alertPayload,
      alertText,
      createdAt: nowIso()
    });
  }

  #updateMissionBriefFromTerminalEvent(terminal, detection) {
    if (this.isClosing) {
      return;
    }
    const projectId = terminal.projectId;
    const brief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId, {
      conversationId: terminal.conversationId
    });
    if (!brief) {
      return;
    }
    const label = terminal.label ?? terminal.id;
    const ts = new Date().toISOString().slice(11, 19);
    const status = detection?.status ?? terminal.status;
    let progress = Array.isArray(brief.progress) ? [...brief.progress] : [];
    let blockers = Array.isArray(brief.blockers) ? [...brief.blockers] : [];
    let nextSteps = Array.isArray(brief.nextSteps) ? [...brief.nextSteps] : [];

    if (status === TERMINAL_STATUS.COMPLETED) {
      progress = [`[${ts}] Terminal ${label} terminé.`, ...progress].slice(0, 20);
      blockers = blockers.filter((b) => !String(b).includes(label));
      nextSteps = nextSteps.filter((s) => !String(s).includes(label));
    } else if (status === TERMINAL_STATUS.ERROR) {
      const entry = `[${ts}] Erreur terminal ${label} : ${detection?.reason ?? ""}`.trim();
      blockers = [entry, ...blockers.filter((b) => !String(b).includes(label))].slice(0, 10);
    } else if (status === TERMINAL_STATUS.RUNNING) {
      // Terminal resumed — clear stale waiting/attention blockers so the brief stays accurate.
      blockers = blockers.filter((b) => !String(b).includes(label));
      nextSteps = nextSteps.filter((s) => !String(s).includes(label));
    } else if (status === TERMINAL_STATUS.WAITING_FOR_INPUT) {
      const entry = `[${ts}] Terminal ${label} attend une réponse utilisateur.`;
      blockers = [entry, ...blockers.filter((b) => !String(b).includes(label))].slice(0, 10);
      nextSteps = [`Répondre au terminal ${label}`, ...nextSteps.filter((s) => !String(s).includes(label))].slice(0, 10);
    } else if (status === TERMINAL_STATUS.NEEDS_ATTENTION) {
      const entry = `[${ts}] Terminal ${label} nécessite attention.`;
      blockers = [entry, ...blockers.filter((b) => !String(b).includes(label))].slice(0, 10);
    }

    this.runtimeHandle.database.upsertWorkspaceMissionBrief({
      ...brief,
      progress,
      blockers,
      nextSteps,
      metadata: { ...(brief.metadata ?? {}), lastTerminalUpdate: new Date().toISOString() }
    });
  }

  // ── Workspace AI conversation notifications ─────────────────────────────────

  #injectTerminalStartMessage(terminal) {
    if (this.isClosing) return;
    try {
      const projectId = terminal.projectId;
      const conversationId = terminal.conversationId
        ?? this.runtimeHandle.database.listConversations(projectId, { limit: 1 })[0]?.id
        ?? null;
      if (!conversationId) return;
      const agentLabel = terminal.agentKind ?? terminal.label ?? "terminal";
      const startText = `Terminal **${terminal.label}** (${agentLabel}) démarré — JON surveille maintenant cette session.`;
      this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
        projectId,
        conversationId,
        role: "assistant",
        kind: "terminal_started",
        content: startText,
        payload: {
          terminalId: terminal.id,
          terminalLabel: terminal.label,
          agentKind: terminal.agentKind,
          autonomyMode: terminal.autonomyMode
        }
      }));
      this.emitStateChanged("workspace.terminal.conversation_started", {
        projectId,
        conversationId,
        terminalId: terminal.id,
        terminalLabel: terminal.label,
        agentKind: terminal.agentKind,
        autonomyMode: terminal.autonomyMode,
        startText,
        createdAt: nowIso()
      });
    } catch { /* absorb */ }
  }

  // ── Workspace AI agentic reasoning ─────────────────────────────────────────

  async #reasonAboutTerminalInput(terminal, missionBrief) {
    try {
      const result = await this.runtimeHandle.llmGateway.generateStructured({
        runId: createId("tmreason"),
        projectId: terminal.projectId,
        callType: LLM_CALL_TYPE.WORKSPACE_TERMINAL_REASONING,
        modelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
        promptRefs: [
          {
            promptId: "workspace.terminal_input_suggestion",
            version: "1.0.0",
            bindings: {
              terminalLabel: String(terminal.label ?? terminal.id),
              agentKind: String(terminal.agentKind ?? "unknown"),
              terminalStatus: String(terminal.status ?? "unknown"),
              autonomyMode: String(terminal.autonomyMode ?? "assisted"),
              recentOutput: String(terminal.recentOutput ?? "").slice(-2000),
              missionObjective: String(missionBrief?.objective ?? "Aucune mission active."),
              missionContext: JSON.stringify({
                progress: (missionBrief?.progress ?? []).slice(0, 5),
                nextSteps: (missionBrief?.nextSteps ?? []).slice(0, 3),
                blockers: (missionBrief?.blockers ?? []).slice(0, 3)
              })
            }
          }
        ],
        input: {
          terminalLabel: terminal.label,
          agentKind: terminal.agentKind,
          terminalStatus: terminal.status,
          recentOutput: String(terminal.recentOutput ?? "").slice(-2000),
          missionObjective: missionBrief?.objective ?? "Aucune mission active."
        },
        metadata: {
          reasoningStage: REASONING_STAGE.WORKSPACE_TERMINAL_REASONING,
          terminalId: terminal.id,
          terminalLabel: terminal.label
        },
        validateOutput: (output) => {
          if (typeof output !== "object" || output === null) {
            throw Object.assign(new Error("Terminal reasoning output must be an object."), { category: "malformed_output" });
          }
          return {
            shouldInject: Boolean(output.shouldInject),
            suggestedInput: String(output.suggestedInput ?? "").trim(),
            reasoning: String(output.reasoning ?? "").slice(0, 200),
            confidence: Math.max(0, Math.min(1, Number(output.confidence ?? 0)))
          };
        }
      });
      return result.output;
    } catch {
      return null;
    }
  }

  async #handleTerminalWaitingForInput(terminal, detection, decision) {
    if (this.isClosing) return;
    try {
      const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(terminal.projectId, {
        conversationId: terminal.conversationId
      });
      const suggestion = await this.#reasonAboutTerminalInput(terminal, missionBrief);
      const canAutoInject = suggestion?.shouldInject
        && suggestion.confidence >= 0.7
        && terminal.autonomyMode === "supervised_autonomy"
        && terminal.authorized;

      auditTerminalReasoning({
        projectId: terminal.projectId,
        terminalId: terminal.id,
        terminalLabel: terminal.label,
        agentKind: terminal.agentKind,
        terminalStatus: terminal.status,
        missionObjective: missionBrief?.objective ?? null,
        suggestion,
        actionTaken: canAutoInject ? "auto_inject" : "alert_only"
      });

      if (canAutoInject) {
        try {
          const inputToSend = suggestion.suggestedInput.endsWith("\n")
            ? suggestion.suggestedInput
            : `${suggestion.suggestedInput}\n`;
          this.writeWorkspaceTerminalInput(terminal.projectId, terminal.id, {
            input: inputToSend,
            approved: true,
            source: "llm_reasoning"
          });
          const projectId = terminal.projectId;
          const conversationId = terminal.conversationId
            ?? this.runtimeHandle.database.listConversations(projectId, { limit: 1 })[0]?.id
            ?? null;
          if (conversationId) {
            const autoText = `JON a répondu automatiquement au terminal **${terminal.label}** : \`${suggestion.suggestedInput.slice(0, 80)}\`\n\n${suggestion.reasoning ? `_${suggestion.reasoning}_` : ""}`;
            this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
              projectId,
              conversationId,
              role: "assistant",
              kind: "terminal_auto_action",
              content: autoText,
              payload: {
                terminalId: terminal.id,
                terminalLabel: terminal.label,
                injectedInput: suggestion.suggestedInput,
                reasoning: suggestion.reasoning,
                confidence: suggestion.confidence,
                source: "llm_reasoning"
              }
            }));
            this.emitStateChanged("workspace.terminal.auto_action", {
              projectId,
              conversationId,
              terminalId: terminal.id,
              terminalLabel: terminal.label,
              injectedInput: suggestion.suggestedInput,
              createdAt: nowIso()
            });
          }
        } catch {
          this.#injectTerminalConversationAlert(terminal, decision, detection, suggestion);
        }
      } else {
        this.#injectTerminalConversationAlert(terminal, decision, detection, suggestion);
      }
    } catch {
      this.#injectTerminalConversationAlert(terminal, decision, detection);
    }
  }

  async #handleTerminalError(terminal, detection, decision) {
    if (this.isClosing) return;
    try {
      const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(terminal.projectId, {
        conversationId: terminal.conversationId
      });
      // Reuse terminal reasoning with error status — the LLM can suggest a recovery command
      const suggestion = await this.#reasonAboutTerminalInput(terminal, missionBrief);
      const canAutoRecover = suggestion?.shouldInject
        && suggestion.confidence >= 0.8
        && terminal.autonomyMode === "supervised_autonomy"
        && terminal.authorized;
      if (canAutoRecover) {
        try {
          const inputToSend = suggestion.suggestedInput.endsWith("\n")
            ? suggestion.suggestedInput
            : `${suggestion.suggestedInput}\n`;
          this.writeWorkspaceTerminalInput(terminal.projectId, terminal.id, {
            input: inputToSend,
            approved: true,
            source: "llm_recovery"
          });
          const projectId = terminal.projectId;
          const conversationId = terminal.conversationId
            ?? this.runtimeHandle.database.listConversations(projectId, { limit: 1 })[0]?.id
            ?? null;
          if (conversationId) {
            const text = `JON a tenté une récupération automatique du terminal **${terminal.label}** : \`${suggestion.suggestedInput.slice(0, 80)}\`\n\n${suggestion.reasoning ? `_${suggestion.reasoning}_` : ""}`;
            this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
              projectId,
              conversationId,
              role: "assistant",
              kind: "terminal_recovery",
              content: text,
              payload: {
                terminalId: terminal.id,
                terminalLabel: terminal.label,
                suggestedInput: suggestion.suggestedInput,
                source: "llm_recovery"
              }
            }));
            this.emitStateChanged("conversation.turn.added", { projectId, conversationId });
          }
          return;
        } catch {
          // fall through to alert
        }
      }
      this.#injectTerminalConversationAlert(terminal, decision, detection, suggestion);
    } catch {
      this.#injectTerminalConversationAlert(terminal, decision, detection);
    }
  }

  #injectTerminalCompletionMessage(terminal) {
    if (this.isClosing) return;
    try {
      const projectId = terminal.projectId;
      const conversationId = terminal.conversationId
        ?? this.runtimeHandle.database.listConversations(projectId, { limit: 1 })[0]?.id
        ?? null;
      if (!conversationId) return;
      const recentSnippet = String(terminal.recentOutput ?? "").slice(-400).trim();
      const completionText = [
        `Le terminal **${terminal.label}** (${terminal.agentKind}) a terminé sa tâche.`,
        recentSnippet ? `Résumé de la sortie :\n\`\`\`\n${recentSnippet}\n\`\`\`` : null
      ].filter(Boolean).join("\n\n");
      this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
        projectId,
        conversationId,
        role: "assistant",
        kind: "terminal_completion",
        content: completionText,
        payload: {
          terminalId: terminal.id,
          terminalLabel: terminal.label,
          agentKind: terminal.agentKind,
          exitCode: terminal.metadata?.exitCode ?? null,
          recentOutput: recentSnippet
        }
      }));
      this.emitStateChanged("workspace.terminal.conversation_completion", {
        projectId,
        conversationId,
        terminalId: terminal.id,
        terminalLabel: terminal.label,
        createdAt: nowIso()
      });
    } catch { /* absorb */ }
  }

  startWorkspaceMonitoring() {
    if (this.workspaceMonitoringInterval) return;
    this.workspaceMonitoringInterval = setInterval(() => {
      this.#checkStuckTerminals().catch((err) => {
        console.warn("[workspace] checkStuckTerminals error:", err?.message ?? err);
      });
    }, 60_000);
  }

  stopWorkspaceMonitoring() {
    if (this.workspaceMonitoringInterval) {
      clearInterval(this.workspaceMonitoringInterval);
      this.workspaceMonitoringInterval = null;
    }
  }

  async #checkStuckTerminals() {
    if (this.isClosing) return;
    try {
      const projects = this.runtimeHandle.database.listProjects();
      const now = Date.now();
      for (const project of projects) {
        let workspace;
        try { workspace = this.getWorkspaceState(project.id); } catch { continue; }
        for (const terminal of workspace.terminals ?? []) {
          if (terminal.status !== TERMINAL_STATUS.WAITING_FOR_INPUT) continue;
          const updatedAt = new Date(terminal.updatedAt ?? terminal.createdAt ?? 0).getTime();
          if (now - updatedAt < 5 * 60 * 1000) continue;
          const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(project.id, {
            conversationId: terminal.conversationId
          });
          const suggestion = await this.#reasonAboutTerminalInput(terminal, missionBrief);
          if (!suggestion) continue;
          if (suggestion.shouldInject && suggestion.confidence >= 0.7 && terminal.autonomyMode === "supervised_autonomy" && terminal.authorized) {
            try {
              const inputToSend = suggestion.suggestedInput.endsWith("\n")
                ? suggestion.suggestedInput
                : `${suggestion.suggestedInput}\n`;
              this.writeWorkspaceTerminalInput(project.id, terminal.id, {
                input: inputToSend,
                approved: true,
                source: "llm_reasoning_monitor"
              });
            } catch { /* absorb */ }
          }
        }
      }
    } catch { /* absorb */ }
  }

  // ── End workspace AI agentic reasoning ──────────────────────────────────────

  #recordTerminalDecision(terminal, detection, metadata = {}) {
    const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(terminal.projectId, {
      conversationId: terminal.conversationId
    });
    const intervention = evaluateTerminalIntervention({ terminal, missionBrief, detection });
    const decision = this.runtimeHandle.database.insertWorkspaceTerminalDecision({
      id: createId("wtd"),
      terminalId: terminal.id,
      projectId: terminal.projectId,
      conversationId: terminal.conversationId,
      decisionType: intervention.decisionType,
      action: intervention.action,
      reason: intervention.reason,
      requiresApproval: intervention.requiresApproval,
      payload: {
        detection,
        confidence: intervention.confidence,
        ...(intervention.payload ?? {}),
        ...metadata
      },
      createdAt: nowIso()
    });
    return decision;
  }

  #recordCliTerminalStarted(event) {
    try {
      if (this.isClosing) {
        return;
      }
      const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(event.terminalId);
      if (!terminal) {
        return;
      }
      this.#recordTerminalEvent(terminal, {
        eventType: "process.started",
        metadata: {
          snapshot: event.snapshot
        },
        createdAt: event.createdAt
      });
      this.emitStateChanged("workspace.terminal.process.started", {
        projectId: terminal.projectId,
        conversationId: terminal.conversationId,
        terminalId: terminal.id,
        pid: event.snapshot?.pid ?? null
      });
      this.#injectTerminalStartMessage(terminal);
    } catch { /* absorb — terminal event handler must not crash the process */ }
  }

  #recordCliTerminalOutput(event) {
    try { this.#recordCliTerminalOutputInner(event); } catch { /* absorb */ }
  }

  #recordCliTerminalOutputInner(event) {
    if (this.isClosing) {
      return;
    }
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(event.terminalId);
    if (!terminal) {
      return;
    }
    this.#recordTerminalEvent(terminal, {
      eventType: "process.output",
      stream: event.stream,
      content: event.text,
      createdAt: event.createdAt
    });
    const recentOutput = this.#appendTerminalOutput(terminal.recentOutput, event.text);
    // For generic shells (bash, powershell, cmd) never change status from output
    // content — only process exit determines completion/error. Text heuristics fire
    // on ordinary shell output ("exception", "done"...) and kill the input field.
    const detection = terminal.agentKind === TERMINAL_AGENT_KIND.GENERIC_CLI
      ? { status: TERMINAL_STATUS.RUNNING, reason: "Shell running — status preserved until process exit.", confidence: 1 }
      : detectTerminalState({ recentOutput, processRunning: true });
    const updated = this.runtimeHandle.database.updateWorkspaceTerminalSession(terminal.id, {
      recentOutput,
      status: detection.status,
      metadata: {
        lastDetection: detection,
        lastOutputAt: event.createdAt
      },
      updatedAt: nowIso()
    });
    const isNewTransition = terminal.status !== detection.status
      && ["waiting_for_input", "needs_attention", "error"].includes(detection.status);
    // Re-trigger reasoning when new output arrives and terminal is already waiting_for_input
    // (e.g. JON injected a response but agent asked another question immediately after)
    const isRepeatedWait = terminal.status === TERMINAL_STATUS.WAITING_FOR_INPUT
      && detection.status === TERMINAL_STATUS.WAITING_FOR_INPUT;
    const isSignificantTransition = isNewTransition || isRepeatedWait;
    const shouldRecordDecision = terminal.status !== detection.status
      || ["waiting_for_input", "needs_attention", "error"].includes(detection.status);
    let decision = null;
    if (shouldRecordDecision) {
      decision = this.#recordTerminalDecision(updated, detection, {
        source: "process.output",
        stream: event.stream
      });
    }
    if (isSignificantTransition && decision) {
      this.#updateMissionBriefFromTerminalEvent(updated, detection);
      if (detection.status === TERMINAL_STATUS.WAITING_FOR_INPUT) {
        this.#handleTerminalWaitingForInput(updated, detection, decision).catch((err) => {
          console.warn("[workspace] handleTerminalWaitingForInput failed:", err?.message ?? err);
        });
      } else if (detection.status === TERMINAL_STATUS.ERROR) {
        // Run recovery reasoning — JON may be able to suggest a fix command
        this.#handleTerminalError(updated, detection, decision).catch((err) => {
          console.warn("[workspace] handleTerminalError failed:", err?.message ?? err);
        });
      } else {
        this.#injectTerminalConversationAlert(updated, decision, detection);
      }
    }
    this.emitStateChanged("workspace.terminal.output", {
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      terminalId: updated.id,
      status: updated.status,
      stream: event.stream,
      decisionAction: decision?.action ?? null
    });
  }

  #recordCliTerminalInput(event) {
    try { this.#recordCliTerminalInputInner(event); } catch { /* absorb */ }
  }

  #recordCliTerminalInputInner(event) {
    if (this.isClosing) {
      return;
    }
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(event.terminalId);
    if (!terminal) {
      return;
    }
    this.#recordTerminalEvent(terminal, {
      eventType: "process.input",
      stream: "stdin",
      content: event.text,
      createdAt: event.createdAt
    });
    const updated = this.runtimeHandle.database.updateWorkspaceTerminalSession(terminal.id, {
      lastPrompt: event.text,
      metadata: {
        lastInputAt: event.createdAt
      },
      updatedAt: nowIso()
    });
    this.emitStateChanged("workspace.terminal.input", {
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      terminalId: updated.id
    });
  }

  #recordCliTerminalExit(event) {
    try { this.#recordCliTerminalExitInner(event); } catch { /* absorb */ }
  }

  #recordCliTerminalExitInner(event) {
    if (this.isClosing) {
      return;
    }
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(event.terminalId);
    if (!terminal) {
      return;
    }
    this.#recordTerminalEvent(terminal, {
      eventType: "process.exit",
      metadata: {
        exitCode: event.exitCode,
        signal: event.signal,
        snapshot: event.snapshot
      },
      createdAt: event.createdAt
    });
    const detection = detectTerminalState({
      recentOutput: terminal.recentOutput,
      processRunning: false,
      exitCode: event.exitCode
    });
    const updated = this.runtimeHandle.database.updateWorkspaceTerminalSession(terminal.id, {
      status: detection.status,
      metadata: {
        lastDetection: detection,
        exitCode: event.exitCode,
        signal: event.signal,
        exitedAt: event.createdAt
      },
      updatedAt: nowIso()
    });
    const decision = this.#recordTerminalDecision(updated, detection, {
      source: "process.exit",
      exitCode: event.exitCode,
      signal: event.signal
    });
    this.#updateMissionBriefFromTerminalEvent(updated, detection);
    if (detection.status === TERMINAL_STATUS.ERROR) {
      this.#injectTerminalConversationAlert(updated, decision, detection);
    } else if (detection.status === TERMINAL_STATUS.COMPLETED) {
      this.#injectTerminalCompletionMessage(updated);
    }
    this.emitStateChanged("workspace.terminal.process.exited", {
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      terminalId: updated.id,
      status: updated.status,
      decisionAction: decision.action
    });
  }

  #recordCliTerminalError(event) {
    try { this.#recordCliTerminalErrorInner(event); } catch { /* absorb */ }
  }

  #recordCliTerminalErrorInner(event) {
    if (this.isClosing) {
      return;
    }
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(event.terminalId);
    if (!terminal) {
      return;
    }
    this.#recordTerminalEvent(terminal, {
      eventType: "process.error",
      content: event.message,
      createdAt: event.createdAt
    });
    const detection = {
      status: "error",
      reason: event.message,
      confidence: 0.95
    };
    const updated = this.runtimeHandle.database.updateWorkspaceTerminalSession(terminal.id, {
      status: "error",
      metadata: {
        lastDetection: detection,
        processError: event.message
      },
      updatedAt: nowIso()
    });
    const decision = this.#recordTerminalDecision(updated, detection, {
      source: "process.error"
    });
    this.emitStateChanged("workspace.terminal.process.error", {
      projectId: updated.projectId,
      conversationId: updated.conversationId,
      terminalId: updated.id,
      status: updated.status,
      decisionAction: decision.action
    });
  }

  async ensureDemoProject() {
    const desiredAllowlistedDomains = buildProjectAllowlistedDomains({
      fixtureManifest: this.fixtureManifest,
      runtimeConfig: this.realSurfaceRuntimeConfig
    });
    const projects = this.runtimeHandle.database.listProjects();
    if (projects.length > 0) {
      const project = projects[0];
      if (!sameStringSet(project.allowlistedDomains, desiredAllowlistedDomains)) {
        this.runtimeHandle.database.updateProject(project.id, {
          allowlistedDomains: desiredAllowlistedDomains
        });
        return this.runtimeHandle.database.getProject(project.id);
      }
      return project;
    }
    return this.runtimeHandle.runtime.createProject({
      name: "Controlled Prototype Project",
      description: "Default project for the authorized browser-first prototype slice.",
      allowlistedDomains: desiredAllowlistedDomains
    });
  }

  listProjects() {
    return this.runtimeHandle.database.listProjects();
  }

  listScenarios() {
    return buildScenarioCatalog({
      researchDefinition: buildResearchScenarioDefinition({
        fixtureManifest: this.fixtureManifest,
        runtimeConfig: this.realSurfaceRuntimeConfig
      }),
      computerDefinition: buildComputerObservationScenarioDefinition({
        runtimeConfig: this.realSurfaceRuntimeConfig
      })
    });
  }

  getMissionEntryContract() {
    return buildMissionEntryContract({
      scenarios: this.listScenarios()
    });
  }

  getAgentConfiguration() {
    const setting = this.runtimeHandle.database.getAppSetting(
      AGENT_CONFIG_SETTING_KEY,
      defaultAgentConfiguration()
    );
    return summarizeAgentConfiguration(normalizeAgentConfiguration({
      ...setting.value,
      updatedAt: setting.updatedAt ?? setting.value?.updatedAt ?? null
    }));
  }

  updateAgentConfiguration(patch = {}) {
    const existing = this.getAgentConfiguration();
    const next = normalizeAgentConfiguration({
      ...existing,
      ...patch,
      guardrails: {
        ...existing.guardrails,
        ...(patch.guardrails ?? {}),
        approvalModeByAction: {
          ...existing.guardrails.approvalModeByAction,
          ...(patch.guardrails?.approvalModeByAction ?? {})
        }
      },
      updatedAt: nowIso()
    });
    const setting = this.runtimeHandle.database.upsertAppSetting(AGENT_CONFIG_SETTING_KEY, next);
    return summarizeAgentConfiguration({
      ...setting.value,
      updatedAt: setting.updatedAt
    });
  }

  resetAgentConfiguration() {
    this.runtimeHandle.database.deleteAppSetting(AGENT_CONFIG_SETTING_KEY);
    return this.getAgentConfiguration();
  }

  async refreshCapabilityGraph() {
    const [availableBrowsers, availableApplications] = await Promise.all([
      this.listInstalledBrowsers(),
      this.listInstalledApplications()
    ]);
    const generatedProvider = generatedCandidatesToExternalToolProvider(
      this.listCapabilityCandidates({ status: CAPABILITY_CANDIDATE_STATUS.ENABLED })
    );
    const graph = refreshCapabilityGraph(this.runtimeHandle.database, {
      applications: availableApplications,
      browsers: availableBrowsers,
      agentConfiguration: this.getAgentConfiguration(),
      externalToolProviders: generatedProvider.tools.length > 0 ? [generatedProvider] : []
    });
    const overrides = this.runtimeHandle.database.listCapabilityGraphOverrides();
    const feedbackRecords = this.runtimeHandle.database.listCapabilityFeedback({ limit: 500 });
    const nodes = applyCapabilityOverrides(graph.nodes, overrides);
    return {
      summary: summarizeCapabilityGraph(nodes, feedbackRecords),
      graph: {
        ...graph,
        nodes
      },
      overrides,
      feedback: Array.from(buildCapabilityFeedbackStats(feedbackRecords).values())
    };
  }

  async getCapabilityGraph({ refreshIfEmpty = true } = {}) {
    let nodes = this.runtimeHandle.database.listCapabilityGraphNodes();
    if (refreshIfEmpty && nodes.length === 0) {
      const refreshed = await this.refreshCapabilityGraph();
      nodes = refreshed.graph.nodes;
    }
    const overrides = this.runtimeHandle.database.listCapabilityGraphOverrides();
    const feedbackRecords = this.runtimeHandle.database.listCapabilityFeedback({ limit: 500 });
    nodes = applyCapabilityOverrides(nodes, overrides);
    return {
      summary: summarizeCapabilityGraph(nodes, feedbackRecords),
      nodes,
      overrides,
      feedback: Array.from(buildCapabilityFeedbackStats(feedbackRecords).values()),
      feedbackRecords
    };
  }

  getSkillRegistry() {
    const setting = this.runtimeHandle.database.getAppSetting(USER_SKILL_MANIFESTS_SETTING_KEY, {
      manifests: []
    });
    const userManifests = Array.isArray(setting.value?.manifests)
      ? setting.value.manifests.map(normalizeUserDefinedSkillManifest)
      : [];
    return {
      version: "1.0.0",
      updatedAt: setting.updatedAt ?? null,
      builtin: BUILTIN_SKILL_MANIFESTS.map(serializeSkillManifest),
      userDefined: userManifests.map(serializeSkillManifest)
    };
  }

  getDeepSkillValidation() {
    return validateOperationalDeepSkills(BUILTIN_SKILL_MANIFESTS);
  }

  async getOperationalDeepReadiness() {
    return buildOperationalDeepReadinessReport();
  }

  upsertUserSkillManifest(manifest = {}) {
    const normalized = normalizeUserDefinedSkillManifest(manifest);
    const validation = validateSkillManifest(normalized);
    if (!validation.valid) {
      throw new Error(`Invalid skill manifest: ${validation.errors.join("; ")}`);
    }
    const current = this.getSkillRegistry().userDefined;
    const next = [
      ...current.filter((skill) => skill.id !== normalized.id),
      serializeSkillManifest(normalized)
    ].sort((left, right) => left.label.localeCompare(right.label));
    this.runtimeHandle.database.upsertAppSetting(USER_SKILL_MANIFESTS_SETTING_KEY, {
      manifests: next
    });
    return this.getSkillRegistry();
  }

  async selectCapabilitiesForMission(mission, { limit = 16 } = {}) {
    const graph = await this.getCapabilityGraph();
    return scoreCapabilityNodesForMission(graph.nodes, mission, {
      limit,
      feedbackRecords: graph.feedbackRecords
    });
  }

  async explainCapabilityRanking(mission, { limit = 12 } = {}) {
    const graph = await this.getCapabilityGraph();
    return explainCapabilityRankingForMission(graph.nodes, mission, {
      limit,
      feedbackRecords: graph.feedbackRecords
    });
  }

  async proposeCapabilityBuild({
    mission = "",
    desiredOutcome = "",
    failureContext = null,
    registerDraftSkill = false,
    persistDraft = true
  } = {}) {
    const graph = await this.getCapabilityGraph();
    const proposal = buildCapabilityBuildProposal({
      mission,
      desiredOutcome,
      capabilityGraph: graph.nodes,
      failureContext
    });
    const validation = validateCapabilityBuildProposal(proposal);
    let draftCandidate = null;
    if (persistDraft && proposal.status === "draft_proposed" && validation.valid) {
      draftCandidate = createDraftCapabilityProposal(this.runtimeHandle.database, proposal);
    }
    let skillRegistry = null;
    if (registerDraftSkill && proposal.proposedSkillManifest) {
      if (!validation.valid) {
        throw new Error(`Invalid capability build proposal: ${validation.errors.join("; ")}`);
      }
      skillRegistry = this.upsertUserSkillManifest(proposal.proposedSkillManifest);
    }
    return {
      proposal,
      validation,
      draftCandidate,
      registeredDraftSkill: Boolean(skillRegistry),
      ...(skillRegistry ? { skillRegistry } : {})
    };
  }

  selectEnabledCapabilityForMission(mission, desiredOutcome = "") {
    return selectEnabledCapabilityForMission(this.runtimeHandle.database, mission, desiredOutcome);
  }

  async autoHandleRunFailure({ runId, mission, desiredOutcome = "", failureSummary = null }) {
    const failureContext = failureSummary ? {
      status: "failed",
      summary: String(failureSummary),
      runId
    } : null;
    const proposalResult = await this.proposeCapabilityBuild({
      mission,
      desiredOutcome,
      failureContext,
      persistDraft: true
    });
    return {
      runId,
      proposalCreated: proposalResult.proposal.status === "draft_proposed",
      draftCandidate: proposalResult.draftCandidate,
      proposal: proposalResult.proposal
    };
  }

  listCapabilityCandidates({ status = null } = {}) {
    return listCapabilityCandidates(this.runtimeHandle.database, { status });
  }

  getCapabilityCandidate(candidateId) {
    return this.listCapabilityCandidates().find((candidate) => candidate.id === candidateId) ?? null;
  }

  async createCapabilityCandidate({
    mission = "",
    desiredOutcome = "",
    failureContext = null,
    registerDraftSkill = true
  } = {}) {
    const proposalResult = await this.proposeCapabilityBuild({
      mission,
      desiredOutcome,
      failureContext,
      registerDraftSkill: false
    });
    if (proposalResult.proposal.status !== "draft_proposed") {
      return {
        ...proposalResult,
        candidate: null,
        created: false,
        reason: "existing_capabilities_sufficient"
      };
    }
    const artifactResult = await createCapabilityCandidateArtifact({
      proposal: proposalResult.proposal
    });
    const candidate = upsertCapabilityCandidate(this.runtimeHandle.database, artifactResult.candidate);
    let skillRegistry = null;
    if (registerDraftSkill && candidate.skillManifest) {
      skillRegistry = this.upsertUserSkillManifest(candidate.skillManifest);
    }
    return {
      ...proposalResult,
      candidate,
      artifact: artifactResult.artifact,
      created: true,
      registeredDraftSkill: Boolean(skillRegistry),
      ...(skillRegistry ? { skillRegistry } : {})
    };
  }

  async validateCapabilityCandidate(candidateId) {
    return validateStoredCapabilityCandidate(this.runtimeHandle.database, candidateId);
  }

  async enableCapabilityCandidate(candidateId, {
    approvedBy = "operator",
    rationale = ""
  } = {}) {
    const candidate = enableStoredCapabilityCandidate(this.runtimeHandle.database, candidateId, {
      approvedBy,
      rationale
    });
    await this.refreshCapabilityGraph();
    return {
      candidate,
      capabilityGraph: await this.getCapabilityGraph({ refreshIfEmpty: false })
    };
  }

  async disableCapabilityCandidate(candidateId, {
    rationale = ""
  } = {}) {
    const candidate = disableStoredCapabilityCandidate(this.runtimeHandle.database, candidateId, {
      rationale
    });
    await this.refreshCapabilityGraph();
    return {
      candidate,
      capabilityGraph: await this.getCapabilityGraph({ refreshIfEmpty: false })
    };
  }

  async executeCapabilityCandidateOnHtml(candidateId, input = {}) {
    return executeStoredWebDataAdapterOnHtml(this.runtimeHandle.database, candidateId, input);
  }

  recordCapabilityRunOutcome(candidateId, { runId = null, projectId = null, mission = null, outcomeStatus, approvalCount = 0, evidenceCount = 0 } = {}) {
    return recordCapabilityRunOutcome(this.runtimeHandle.database, candidateId, {
      runId,
      projectId,
      mission,
      outcomeStatus,
      approvalCount,
      evidenceCount
    });
  }

  getCapabilityCandidateStats(candidateId) {
    return getCapabilityCandidateStats(this.runtimeHandle.database, candidateId);
  }

  getCapabilityCircuitBreakerStatus(candidateId) {
    return checkCapabilityCircuitBreaker(this.runtimeHandle.database, candidateId);
  }

  async recoverIncompleteMission(runId) {
    const run = this.runtimeHandle.database.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (run.metadata?.orchestrationRecovery?.status) {
      return {
        recovered: false,
        reason: "already_recovered",
        recovery: run.metadata.orchestrationRecovery,
        run: await this.getRunDetail(runId)
      };
    }
    const result = await this.#maybeRecoverIncompleteMission(runId);
    const updatedRun = this.runtimeHandle.database.getRun(runId);
    return {
      recovered: Boolean(result),
      recovery: updatedRun?.metadata?.orchestrationRecovery ?? null,
      result,
      run: await this.getRunDetail(runId)
    };
  }

  async updateCapabilityNode(nodeId, patch = {}) {
    const graph = this.runtimeHandle.database.listCapabilityGraphNodes();
    if (!graph.some((node) => node.id === nodeId)) {
      throw new Error(`Capability not found: ${nodeId}`);
    }
    const override = this.runtimeHandle.database.upsertCapabilityGraphOverride(nodeId, {
      label: compactConversationMessage(patch.label ?? "").slice(0, 180) || undefined,
      description: compactConversationMessage(patch.description ?? "").slice(0, 1200) || undefined,
      affordances: stringList(patch.affordances),
      knownLimits: stringList(patch.knownLimits),
      metadata: {
        source: "operator_override",
        updatedBy: "admin_ui"
      }
    });
    return {
      override,
      capabilityGraph: await this.getCapabilityGraph({ refreshIfEmpty: false })
    };
  }

  async generateCapabilityDescriptions({ nodeIds = [], limit = 12 } = {}) {
    const capabilityGraph = await this.getCapabilityGraph();
    const requestedIds = new Set(Array.isArray(nodeIds) ? nodeIds.map((id) => String(id)) : []);
    const targetNodes = (requestedIds.size > 0
      ? capabilityGraph.nodes.filter((node) => requestedIds.has(node.id))
      : capabilityGraph.nodes
    ).slice(0, Math.max(1, Math.min(24, Number(limit) || 12)));
    if (targetNodes.length === 0) {
      throw new Error("No capability nodes selected for description generation.");
    }
    const input = {
      capabilities: targetNodes.map(compactCapabilityForDescription),
      guardrails: this.getAgentConfiguration().guardrails
    };
    const allowedNodeIds = new Set(targetNodes.map((node) => node.id));
    const promptRefs = [
      {
        promptId: "system.primary_reasoning",
        version: "1.0.0"
      },
      {
        promptId: "task.capability_description",
        version: "1.0.0",
        bindings: {
          capabilities: JSON.stringify(input.capabilities),
          guardrails: JSON.stringify(input.guardrails)
        }
      }
    ];
    let output;
    let generationMode = "llm";
    let fallbackReason = null;
    try {
      const result = await this.runtimeHandle.llmGateway.generateStructured({
        runId: createId("cap"),
        projectId: this.listProjects()[0]?.id ?? (await this.ensureDemoProject()).id,
        callType: LLM_CALL_TYPE.CAPABILITY_DESCRIPTION,
        modelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
        promptRefs,
        input,
        metadata: {
          reasoningStage: REASONING_STAGE.CAPABILITY_DESCRIPTION,
          adminTriggered: true,
          selectedNodeCount: targetNodes.length
        },
        validateOutput: (candidate) => validateCapabilityDescriptionOutput(candidate, { allowedNodeIds })
      });
      output = result.output;
      if (output.descriptions.length === 0) {
        throw Object.assign(new Error("Capability description generation returned no usable descriptions."), {
          category: "malformed_output"
        });
      }
    } catch (error) {
      if (this.runtimeHandle.llmGateway?.getStatus?.().deterministicFallback === false) {
        throw error;
      }
      output = validateCapabilityDescriptionOutput(
        buildDeterministicCapabilityDescriptionOutput(input),
        { allowedNodeIds }
      );
      generationMode = "deterministic_fallback";
      fallbackReason = error.category ?? error.message;
    }
    const overrides = output.descriptions.map((description) => this.runtimeHandle.database.upsertCapabilityGraphOverride(description.nodeId, {
      label: description.label,
      description: description.description,
      affordances: description.affordances,
      knownLimits: description.knownLimits,
      metadata: {
        source: generationMode === "llm" ? "llm_generated" : "deterministic_fallback",
        generatedBy: "admin_description_generator",
        fallbackReason
      }
    }));
    return {
      generationMode,
      fallbackReason,
      updatedCount: overrides.length,
      overrides,
      capabilityGraph: await this.getCapabilityGraph({ refreshIfEmpty: false })
    };
  }

  recordCapabilityFeedback(record = {}) {
    if (!record.nodeId || !record.outcomeStatus) {
      return null;
    }
    const feedback = {
      id: createId("capfb"),
      nodeId: record.nodeId,
      skillId: record.skillId ?? null,
      mission: record.mission ?? null,
      projectId: record.projectId ?? null,
      runId: record.runId ?? null,
      conversationTurnId: record.conversationTurnId ?? null,
      selectedScore: record.selectedScore ?? null,
      outcomeStatus: record.outcomeStatus,
      approvalCount: record.approvalCount ?? 0,
      evidenceCount: record.evidenceCount ?? 0,
      rollbackCount: record.rollbackCount ?? 0,
      notes: record.notes ?? null,
      metadata: record.metadata ?? {},
      createdAt: nowIso()
    };
    this.runtimeHandle.database.insertCapabilityFeedback(feedback);
    return feedback;
  }

  async recordOperatorCapabilityFeedback(record = {}) {
    const graph = await this.getCapabilityGraph();
    const node = graph.nodes.find((candidate) => candidate.id === record.nodeId);
    if (!node) {
      throw new Error(`Capability not found: ${record.nodeId}`);
    }
    const allowed = new Set(["operator_positive", "operator_negative", "expected_selection"]);
    const outcomeStatus = allowed.has(record.outcomeStatus) ? record.outcomeStatus : "operator_positive";
    const feedback = this.recordCapabilityFeedback({
      nodeId: node.id,
      skillId: node.skillId ?? null,
      mission: record.mission ?? null,
      selectedScore: record.selectedScore ?? null,
      outcomeStatus,
      notes: record.notes ?? null,
      metadata: {
        source: "operator_admin_feedback",
        reason: record.reason ?? null
      }
    });
    return {
      feedback,
      capabilityGraph: await this.getCapabilityGraph({ refreshIfEmpty: false })
    };
  }

  previewAgentConfiguration(message = "") {
    const config = this.getAgentConfiguration();
    return {
      message: compactConversationMessage(message || "ouvre mon éditeur de note"),
      preview: "Confirme et je lance l’application.",
      visibleSystemPrompt: config.conversationalSystemPrompt,
      hiddenLayers: [
        "classification",
        "mission preflight",
        "approval policy",
        "desktop autonomy policy",
        "tool plan",
        "audit trace"
      ],
      visibleLayers: [
        "natural reply",
        "short clarification",
        "compact approval card",
        "brief result"
      ]
    };
  }

  listRuns(projectId) {
    return this.runtimeHandle.database.listRuns(projectId);
  }

  async extractRunAudit(runId) {
    const db = this.runtimeHandle.database;
    const run = db.getRun(runId);
    if (!run) return null;

    const [events, llmCalls, approvals, artifacts, evidence, sources, reasoningSnapshots] = [
      db.listEvents(runId),
      db.listLlmCalls(runId),
      db.listApprovals(runId),
      db.listArtifacts(runId),
      db.listEvidence(runId),
      db.listSources(runId),
      db.listReasoningContextSnapshots(runId)
    ];

    const auditEntries = await (async () => {
      try {
        const raw = await fs.readFile(path.join(LOGS_ROOT, "jon-audit.jsonl"), "utf8");
        return raw.split("\n").filter(Boolean)
          .map((line) => { try { return JSON.parse(line); } catch { return null; } })
          .filter((e) => e && e.runId === runId);
      } catch { return []; }
    })();

    const byType = {};
    for (const e of auditEntries) {
      const t = e.type ?? "unknown";
      if (!byType[t]) byType[t] = [];
      byType[t].push(e);
    }

    const tokenTotal = llmCalls.reduce((acc, c) => acc + (c.tokenUsage?.totalTokens ?? 0), 0);
    const costTotal = llmCalls.reduce((acc, c) => acc + (c.estimatedCost ?? 0), 0);
    const durationMs = run.updatedAt && run.createdAt
      ? new Date(run.updatedAt) - new Date(run.createdAt) : null;

    return {
      run: {
        id: run.id, projectId: run.projectId, mission: run.mission,
        status: run.status, lifecycleStage: run.lifecycleStage,
        summary: run.summary, createdAt: run.createdAt, updatedAt: run.updatedAt,
        durationSeconds: durationMs != null ? Math.round(durationMs / 1000) : null,
        metadata: run.metadata
      },
      auditTrail: {
        missionPlan: byType["jon.mission.plan"]?.[0] ?? null,
        missionExecution: byType["jon.mission.execution"] ?? [],
        browserMission: byType["jon.browser.mission"] ?? [],
        stepFailures: byType["jon.step.failure"] ?? [],
        approvalDecisions: byType["jon.approval.decision"] ?? [],
        runStatusChanges: byType["jon.run.status_change"] ?? [],
        llmOutputs: byType["jon.llm.output"] ?? [],
        conversationTurns: byType["jon.conversation.turn"] ?? [],
        terminalReasoning: byType["jon.terminal.reasoning"] ?? []
      },
      events: events.map((e) => ({ type: e.type, actor: e.actor, summary: e.summary, createdAt: e.createdAt, payload: e.payload })),
      llmCalls: llmCalls.map((c) => ({
        callType: c.callType, providerAlias: c.providerAlias, modelAlias: c.modelAlias,
        latencyMs: c.latencyMs, tokenUsage: c.tokenUsage, estimatedCost: c.estimatedCost,
        resultStatus: c.resultStatus, errorCategory: c.errorCategory,
        fallbackUsed: c.metadata?.fallbackUsed ?? false,
        schemaRepairAttempted: c.metadata?.schemaRepairAttempted ?? false,
        reasoningStage: c.metadata?.reasoningStage ?? null, createdAt: c.createdAt
      })),
      approvals: approvals.map((a) => ({ id: a.id, category: a.category, decision: a.decision, riskLevel: a.riskLevel, actionLabel: a.actionLabel, reason: a.reason, createdAt: a.createdAt })),
      artifacts: artifacts.map((a) => ({ id: a.id, artifactType: a.artifactType, title: a.title, status: a.status, storagePath: a.storagePath, createdAt: a.createdAt })),
      evidence: evidence.map((e) => ({ id: e.id, evidenceType: e.evidenceType, label: e.label, storagePath: e.storagePath, linkedSurface: e.linkedSurface, createdAt: e.createdAt })),
      sources: sources.map((s) => ({ id: s.id, title: s.title, canonicalRef: s.canonicalRef, trustClassification: s.trustClassification, createdAt: s.createdAt })),
      reasoningSnapshots,
      summary: {
        totalLlmCalls: llmCalls.length,
        totalTokens: tokenTotal,
        estimatedCostUsd: Math.round(costTotal * 1_000_000) / 1_000_000,
        failedLlmCalls: llmCalls.filter((c) => c.resultStatus === "failed").length,
        fallbackCalls: llmCalls.filter((c) => c.metadata?.fallbackUsed).length,
        totalEvents: events.length,
        totalApprovals: approvals.length,
        approvedCount: approvals.filter((a) => a.decision === "approved_once").length,
        deniedCount: approvals.filter((a) => a.decision !== "approved_once").length,
        stepFailures: (byType["jon.step.failure"] ?? []).length,
        stepFailuresByStatus: {
          failed: (byType["jon.step.failure"] ?? []).filter((e) => e.status === "failed").length,
          blocked: (byType["jon.step.failure"] ?? []).filter((e) => e.status === "blocked").length,
          skipped: (byType["jon.step.failure"] ?? []).filter((e) => e.status === "skipped").length
        },
        artifactsCreated: artifacts.length,
        evidenceRecorded: evidence.length,
        durationSeconds: durationMs != null ? Math.round(durationMs / 1000) : null
      },
      semanticVerification: run.metadata?.semanticVerification ?? null,
      missionProgress: run.metadata?.missionProgress ?? null,
      whereAreWe: run.metadata?.missionProgress?.steps
        ? `${run.metadata.missionProgress.steps.completed ?? 0}/${run.metadata.missionProgress.steps.total ?? "?"} steps — ${run.metadata.semanticVerification?.verificationVerdict ?? "unverified"}`
        : null,
      falseCompletionGuard: {
        verifiedByOutcomes: run.metadata?.semanticVerification?.verifiedByOutcomes ?? null,
        wouldBefalseCompleted: run.status === "completed" && run.metadata?.semanticVerification?.verifiedByOutcomes === false
      }
    };
  }

  listActiveRunIds() {
    return Array.from(this.activeRuns.keys());
  }

  listActiveRunSurfaces(projectId = null) {
    return this.listActiveRunIds()
      .map((runId) => this.runtimeHandle.database.getRun(runId))
      .filter((run) => run && (!projectId || run.projectId === projectId))
      .map((run) => ({
        runId: run.id,
        projectId: run.projectId,
        status: run.status,
        lifecycleStage: run.lifecycleStage,
        surface: surfaceLockForRun(run),
        mission: run.metadata?.missionSpec?.objective ?? run.mission
      }));
  }

  hasActiveRunOnSurface(projectId, surface) {
    if (!surface) {
      return false;
    }
    return this.listActiveRunSurfaces(projectId).some((entry) => entry.surface === surface);
  }

  listPendingApprovals(runId = null) {
    const approvals = this.approvalBroker.listPending();
    if (!runId) {
      return approvals;
    }
    return approvals.filter((approval) => approval.runId === runId);
  }

  getPublicCliAgentCatalog() {
    return this.cliAgentCatalog.map((agent) => ({
      id: agent.id,
      command: agent.command,
      label: agent.label,
      agentKind: agent.agentKind,
      availability: agent.availability
    }));
  }

  async getRunDetail(runId) {
    const bundle = await this.runtimeHandle.runtime.getRunBundle(runId);
    if (!bundle) {
      return null;
    }
    return buildRunReviewModel(bundle, this.listPendingApprovals(runId));
  }

  getWorkspaceState(projectId, { conversationId = null } = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId, { conversationId })
      ?? this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId);
    const terminals = this.runtimeHandle.database.listWorkspaceTerminalSessions(projectId, {
      conversationId,
      limit: 50
    });
    const decisions = this.runtimeHandle.database.listWorkspaceTerminalDecisions(projectId, {
      conversationId,
      limit: 80
    });
    const terminalEvents = this.runtimeHandle.database.listWorkspaceTerminalEvents(projectId, {
      conversationId,
      limit: 120
    });
    const alerts = decisions
      .filter((decision) => ["request_human_approval", "suggest_user_reply", "escalate_human"].includes(decision.action))
      .slice(-8);
    return {
      missionBrief,
      terminals,
      decisions,
      terminalEvents,
      availableCliAgents: this.getPublicCliAgentCatalog(),
      alerts,
      liveProcesses: this.cliTerminalSupervisor.list(),
      summary: buildWorkspaceStateSummary({ missionBrief, terminals, decisions }),
      browserStrategy: {
        preferredMode: "workspace_browser_mode",
        supportedModes: ["workspace_browser_mode", "system_browser_mode"],
        rationale: "Workspace browser mode is preferred for traceable web work; system browser mode remains available for visible local desktop tasks with approvals."
      },
      autonomyPolicy: {
        defaultMode: "assisted",
        supportedModes: ["assisted", "supervised_autonomy", "manual_only"],
        hardSafetyFloor: [
          "no credential extraction",
          "no payment or purchase automation",
          "no stealth or security bypass",
          "no destructive shell action without approval"
        ]
      }
    };
  }

  upsertWorkspaceMissionBrief(projectId, payload = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    const brief = buildWorkspaceMissionBrief({
      id: payload.id ?? createId("wmb"),
      projectId,
      conversationId: payload.conversationId ?? null,
      objective: payload.objective ?? payload.mission ?? "",
      status: payload.status ?? "active",
      progress: payload.progress ?? [],
      blockers: payload.blockers ?? [],
      decisions: payload.decisions ?? [],
      nextSteps: payload.nextSteps ?? [],
      metadata: payload.metadata ?? {}
    });
    const saved = this.runtimeHandle.database.upsertWorkspaceMissionBrief(brief);
    this.emitStateChanged("workspace.mission_brief.updated", {
      projectId,
      conversationId: saved.conversationId,
      missionBriefId: saved.id,
      status: saved.status
    });
    return {
      missionBrief: saved,
      workspace: this.getWorkspaceState(projectId, { conversationId: saved.conversationId })
    };
  }

  attachWorkspaceTerminal(projectId, payload = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    const session = normalizeTerminalSession({
      ...payload,
      id: payload.id ?? createId("term"),
      projectId,
      agentKind: payload.agentKind ?? detectCliAgentKind(payload),
      status: payload.status ?? "attached",
      authorized: Boolean(payload.authorized),
      autonomyMode: payload.autonomyMode ?? "assisted"
    });
    const saved = this.runtimeHandle.database.insertWorkspaceTerminalSession(session);
    const detection = detectTerminalState({
      recentOutput: saved.recentOutput,
      processRunning: payload.processRunning ?? true,
      exitCode: payload.exitCode ?? null,
      explicitStatus: payload.status ?? null
    });
    const normalizedTerminal = detection.status === saved.status
      ? saved
      : this.runtimeHandle.database.updateWorkspaceTerminalSession(saved.id, {
        status: detection.status,
        metadata: {
          lastDetection: detection
        },
        updatedAt: nowIso()
      });
    const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId, {
      conversationId: normalizedTerminal.conversationId
    });
    const intervention = evaluateTerminalIntervention({
      terminal: normalizedTerminal,
      missionBrief,
      detection
    });
    const decision = this.runtimeHandle.database.insertWorkspaceTerminalDecision({
      id: createId("wtd"),
      terminalId: normalizedTerminal.id,
      projectId,
      conversationId: normalizedTerminal.conversationId,
      decisionType: intervention.decisionType,
      action: intervention.action,
      reason: intervention.reason,
      requiresApproval: intervention.requiresApproval,
      payload: {
        detection,
        confidence: intervention.confidence,
        ...(intervention.payload ?? {})
      },
      createdAt: nowIso()
    });
    this.emitStateChanged("workspace.terminal.attached", {
      projectId,
      conversationId: normalizedTerminal.conversationId,
      terminalId: normalizedTerminal.id,
      status: normalizedTerminal.status,
      action: decision.action
    });
    return {
      terminal: normalizedTerminal,
      decision,
      workspace: this.getWorkspaceState(projectId, { conversationId: normalizedTerminal.conversationId })
    };
  }

  updateWorkspaceTerminal(projectId, terminalId, payload = {}) {
    const existing = this.runtimeHandle.database.getWorkspaceTerminalSession(terminalId);
    if (!existing || existing.projectId !== projectId) {
      throw new Error(`Workspace terminal not found: ${terminalId}.`);
    }
    const detection = detectTerminalState({
      recentOutput: payload.recentOutput ?? existing.recentOutput,
      processRunning: payload.processRunning ?? true,
      exitCode: payload.exitCode ?? null,
      explicitStatus: payload.status ?? null
    });
    const terminal = this.runtimeHandle.database.updateWorkspaceTerminalSession(terminalId, {
      ...payload,
      status: detection.status,
      agentKind: payload.agentKind ?? detectCliAgentKind({
        command: payload.command ?? existing.command,
        title: payload.label ?? existing.label,
        recentOutput: payload.recentOutput ?? existing.recentOutput
      }),
      metadata: {
        ...(payload.metadata ?? {}),
        lastDetection: detection
      },
      updatedAt: nowIso()
    });
    const missionBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId, {
      conversationId: terminal.conversationId
    });
    const intervention = evaluateTerminalIntervention({ terminal, missionBrief, detection });
    const decision = this.runtimeHandle.database.insertWorkspaceTerminalDecision({
      id: createId("wtd"),
      terminalId: terminal.id,
      projectId,
      conversationId: terminal.conversationId,
      decisionType: intervention.decisionType,
      action: intervention.action,
      reason: intervention.reason,
      requiresApproval: intervention.requiresApproval,
      payload: {
        detection,
        confidence: intervention.confidence,
        ...(intervention.payload ?? {})
      },
      createdAt: nowIso()
    });
    this.emitStateChanged("workspace.terminal.updated", {
      projectId,
      conversationId: terminal.conversationId,
      terminalId: terminal.id,
      status: terminal.status,
      action: decision.action,
      requiresApproval: decision.requiresApproval
    });
    return {
      terminal,
      decision,
      workspace: this.getWorkspaceState(projectId, { conversationId: terminal.conversationId })
    };
  }

  startWorkspaceTerminalProcess(projectId, payload = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    const launch = normalizeCliLaunchRequest(payload, {
      allowedCommands: this.cliAllowedCommands
    });
    const now = nowIso();
    // Determine supervisor: PTY for interactive shells, pipe for CLI agents
    const detectedKind = detectCliAgentKind({ command: launch.requestedCommand ?? launch.command });
    const isShell = detectedKind === TERMINAL_AGENT_KIND.GENERIC_CLI;
    const adapter = isShell ? "node_pty" : "child_process_pipe";
    const terminalType = isShell ? "pty" : "pipe";
    const session = normalizeTerminalSession({
      id: payload.id ?? createId("term"),
      projectId,
      conversationId: payload.conversationId ?? null,
      label: payload.label ?? launch.label,
      command: [launch.displayCommand ?? launch.requestedCommand ?? launch.command, ...launch.args].join(" "),
      cwd: launch.cwd,
      title: payload.label ?? launch.label,
      recentOutput: "",
      status: "running",
      authorized: true,
      autonomyMode: payload.autonomyMode ?? "assisted",
      metadata: {
        ...(payload.metadata ?? {}),
        terminalType,
        launch: {
          command: launch.displayCommand ?? launch.requestedCommand ?? launch.command,
          resolvedCommand: launch.command,
          args: launch.args,
          cwd: launch.cwd,
          adapter,
          startedBy: "workspace_api"
        }
      },
      createdAt: now,
      updatedAt: now
    });
    const saved = this.runtimeHandle.database.insertWorkspaceTerminalSession(session);
    const snapshot = isShell
      ? this.ptyTerminalSupervisor.start(saved.id, launch)
      : this.cliTerminalSupervisor.start(saved.id, launch);
    const updated = this.runtimeHandle.database.updateWorkspaceTerminalSession(saved.id, {
      metadata: {
        process: snapshot
      },
      updatedAt: nowIso()
    });
    const detection = detectTerminalState({
      recentOutput: "",
      processRunning: true,
      explicitStatus: "running"
    });
    const decision = this.#recordTerminalDecision(updated, detection, {
      source: "process.start",
      snapshot
    });
    this.emitStateChanged("workspace.terminal.started", {
      projectId,
      conversationId: updated.conversationId,
      terminalId: updated.id,
      status: updated.status,
      pid: snapshot.pid
    });
    return {
      terminal: updated,
      process: snapshot,
      decision,
      workspace: this.getWorkspaceState(projectId, { conversationId: updated.conversationId })
    };
  }

  writeWorkspaceTerminalInput(projectId, terminalId, payload = {}) {
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(terminalId);
    if (!terminal || terminal.projectId !== projectId) {
      throw new Error(`Workspace terminal not found: ${terminalId}.`);
    }
    const isTerminalPty = terminal.metadata?.terminalType === "pty";
    const input = String(payload.input ?? payload.text ?? "");
    if (isTerminalPty) {
      // PTY terminals accept raw keystrokes directly — no approval or sensitivity checks
      this.ptyTerminalSupervisor.write(terminal.id, input);
      return {
        terminal,
        decision: null,
        workspace: this.getWorkspaceState(projectId, { conversationId: terminal.conversationId })
      };
    }
    if (!input.trim()) {
      throw new Error("Terminal input is required.");
    }
    if (hasSensitiveTerminalInput(input)) {
      throw new Error("Terminal input appears to contain a secret or credential and was blocked.");
    }
    const approved = payload.approved === true || terminal.autonomyMode === "supervised_autonomy";
    if (!approved) {
      throw new Error("Terminal input requires explicit approval in assisted mode.");
    }
    if (!terminal.authorized) {
      throw new Error("Terminal is not authorized for JON orchestration.");
    }
    this.cliTerminalSupervisor.write(terminal.id, input);
    const updated = this.runtimeHandle.database.getWorkspaceTerminalSession(terminal.id);
    const decision = this.runtimeHandle.database.insertWorkspaceTerminalDecision({
      id: createId("wtd"),
      terminalId: terminal.id,
      projectId,
      conversationId: terminal.conversationId,
      decisionType: "terminal_input",
      action: "input_sent",
      reason: terminal.autonomyMode === "supervised_autonomy"
        ? "Input sent under supervised autonomy to an authorized terminal."
        : "Input sent after explicit approval to an authorized terminal.",
      requiresApproval: false,
      payload: {
        approved: payload.approved === true,
        autonomyMode: terminal.autonomyMode
      },
      createdAt: nowIso()
    });
    return {
      terminal: updated,
      decision,
      workspace: this.getWorkspaceState(projectId, { conversationId: terminal.conversationId })
    };
  }

  stopWorkspaceTerminalProcess(projectId, terminalId, payload = {}) {
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(terminalId);
    if (!terminal || terminal.projectId !== projectId) {
      throw new Error(`Workspace terminal not found: ${terminalId}.`);
    }
    const isTerminalPty = terminal.metadata?.terminalType === "pty";
    const stopped = isTerminalPty
      ? this.ptyTerminalSupervisor.stop(terminal.id)
      : this.cliTerminalSupervisor.stop(terminal.id, { signal: payload.signal ?? "SIGTERM" });
    const updated = this.runtimeHandle.database.updateWorkspaceTerminalSession(terminal.id, {
      status: "detached",
      metadata: {
        stopRequestedAt: nowIso(),
        stopSignal: payload.signal ?? "SIGTERM",
        stopped
      },
      updatedAt: nowIso()
    });
    this.#recordTerminalEvent(updated, {
      eventType: "process.stop_requested",
      metadata: {
        signal: payload.signal ?? "SIGTERM",
        stopped
      },
      createdAt: nowIso()
    });
    const decision = this.runtimeHandle.database.insertWorkspaceTerminalDecision({
      id: createId("wtd"),
      terminalId: terminal.id,
      projectId,
      conversationId: terminal.conversationId,
      decisionType: "terminal_stop",
      action: "stop_terminal",
      reason: stopped ? "Stop signal sent to active terminal process." : "No active process was registered for this terminal.",
      requiresApproval: false,
      payload: {
        stopped,
        signal: payload.signal ?? "SIGTERM"
      },
      createdAt: nowIso()
    });
    this.emitStateChanged("workspace.terminal.stop_requested", {
      projectId,
      conversationId: terminal.conversationId,
      terminalId: terminal.id,
      stopped
    });
    return {
      terminal: updated,
      decision,
      workspace: this.getWorkspaceState(projectId, { conversationId: terminal.conversationId })
    };
  }

  resizeWorkspaceTerminal(projectId, terminalId, payload = {}) {
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(terminalId);
    if (!terminal || terminal.projectId !== projectId) {
      throw new Error(`Workspace terminal not found: ${terminalId}.`);
    }
    if (terminal.metadata?.terminalType !== "pty") {
      return { resized: false, reason: "Terminal is not PTY-backed." };
    }
    const resized = this.ptyTerminalSupervisor.resize(terminalId, payload);
    return { resized, terminalId };
  }

  subscribeRawTerminalOutput(terminalId, cb) {
    this.ptyTerminalSupervisor.subscribeRaw(terminalId, cb);
  }

  unsubscribeRawTerminalOutput(terminalId, cb) {
    this.ptyTerminalSupervisor.unsubscribeRaw(terminalId, cb);
  }

  isPtyTerminalActive(terminalId) {
    return this.ptyTerminalSupervisor.isActive(terminalId);
  }

  isCliTerminalActive(terminalId) {
    return this.cliTerminalSupervisor.isActive(terminalId);
  }

  subscribePipeTerminalOutput(terminalId, cb) {
    this.cliTerminalSupervisor.subscribeOutput(terminalId, cb);
  }

  unsubscribePipeTerminalOutput(terminalId, cb) {
    this.cliTerminalSupervisor.unsubscribeOutput(terminalId, cb);
  }

  isTerminalTypePipe(terminalId) {
    const terminal = this.runtimeHandle.database.getWorkspaceTerminalSession(terminalId);
    return terminal?.metadata?.terminalType === "pipe";
  }

  getPipeTerminalHistory(projectId, terminalId) {
    return this.runtimeHandle.database.listWorkspaceTerminalEvents(projectId, {
      terminalId,
      limit: 500
    }).filter((ev) => ["process.started", "process.output"].includes(ev.eventType));
  }

  getTokenUsageSummary(projectId) {
    const gatewayStatus = this.runtimeHandle.llmGateway.getStatus();
    const session = gatewayStatus.sessionUsage ?? { totalTokens: 0, estimatedCost: 0, callCount: 0 };
    const budgets = gatewayStatus.budgets ?? DEFAULT_LLM_BUDGETS;
    const activeRunId = this.listActiveRunIds().find((runId) => {
      const run = this.runtimeHandle.database.getRun(runId);
      return run?.projectId === projectId;
    }) ?? null;
    let activeRun = null;
    if (activeRunId) {
      const calls = this.runtimeHandle.database.listLlmCalls(activeRunId);
      const totalTokens = calls.reduce((sum, call) => sum + (call.tokenUsage?.totalTokens ?? 0), 0);
      const estimatedCost = calls.reduce((sum, call) => sum + (call.estimatedCost ?? 0), 0);
      activeRun = {
        runId: activeRunId,
        totalTokens,
        estimatedCost: Number(estimatedCost.toFixed(6))
      };
    }
    return {
      session: {
        totalTokens: session.totalTokens ?? 0,
        estimatedCost: session.estimatedCost ?? 0,
        callCount: session.callCount ?? 0
      },
      activeRun,
      budgets: {
        perRunTokens: budgets.perRunTokens ?? DEFAULT_LLM_BUDGETS.perRunTokens,
        perSessionTokens: budgets.perSessionTokens ?? DEFAULT_LLM_BUDGETS.perSessionTokens,
        perRunUsd: budgets.perRunUsd ?? DEFAULT_LLM_BUDGETS.perRunUsd,
        perSessionUsd: budgets.perSessionUsd ?? DEFAULT_LLM_BUDGETS.perSessionUsd
      }
    };
  }

  getWorkspaceBrowserState(projectId) {
    const activeSession = this.browserProvider.getActiveSessionForProject(projectId);
    const recentSessions = this.runtimeHandle.database.listWorkspaceBrowserSessions(projectId, { limit: 5 });
    return {
      activeSession,
      recentSessions
    };
  }

  async openWorkspaceBrowserSession(projectId, { url = null } = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    const allowlistedHosts = project?.allowlistedDomains ?? [];
    const session = await this.browserProvider.getOrCreateJonSession({ projectId, allowlistedHosts });
    if (url && session?.id) {
      await this.browserProvider.navigate(session.id, url).catch(() => {});
    }
    return session;
  }

  updateProjectAllowlistedDomains(projectId, domains) {
    const cleaned = (Array.isArray(domains) ? domains : [])
      .map((d) => String(d ?? "").trim().toLowerCase())
      .filter(Boolean);
    this.runtimeHandle.database.updateProject(projectId, { allowlistedDomains: cleaned });
    return this.runtimeHandle.database.getProject(projectId);
  }

  // ─── Mobile Gateway ───────────────────────────────────────────────

  startMobilePairing() {
    return this.mobileDeviceRegistry.startPairing();
  }

  confirmMobilePairing(code, deviceMeta) {
    const result = this.mobileDeviceRegistry.confirmPairing(code, deviceMeta);
    this.mobileAuditLog.record({
      deviceId: result.deviceId,
      tokenHash: null,
      commandType: "pairing.confirmed",
      params: { deviceName: result.deviceName },
      status: "ok",
      error: null,
      createdAt: new Date().toISOString()
    });
    return result;
  }

  validateMobileSession(token) {
    return this.mobileDeviceRegistry.validateSession(token);
  }

  revokeMobileDevice(deviceId) {
    const ok = this.mobileDeviceRegistry.revokeDevice(deviceId);
    if (ok) {
      this.mobileAuditLog.record({
        deviceId,
        tokenHash: null,
        commandType: "device.revoked",
        params: {},
        status: "ok",
        error: null,
        createdAt: new Date().toISOString()
      });
    }
    return ok;
  }

  revokeMobileSession(token) {
    return this.mobileDeviceRegistry.revokeSession(token);
  }

  getMobileStatus(projectId) {
    const devices = this.mobileDeviceRegistry.listDevices();
    const recentCommands = this.mobileAuditLog.list({ limit: 20 });
    return { devices, recentCommands, projectId };
  }

  getMobileRuns(projectId) {
    const resolvedId = this.#resolveMobileProjectId(projectId);
    if (!resolvedId) return [];
    const runs = this.listRuns(resolvedId);
    return runs.map((r) => ({
      id: r.id,
      mission: String(r.mission ?? "").slice(0, 120),
      status: r.status,
      lifecycleStage: r.lifecycleStage,
      summary: r.summary ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  }

  getMobileTerminals(projectId) {
    const resolvedId = this.#resolveMobileProjectId(projectId);
    const workspace = this.getWorkspaceState(resolvedId);
    return (workspace?.terminals ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      status: t.status,
      agentKind: t.agentKind,
      recentOutput: t.recentOutput ?? "",
      lastPrompt: t.lastPrompt ?? "",
      waitingForInput: t.status === "waiting_for_input",
      createdAt: t.createdAt
    }));
  }

  async dispatchMobileCommand(commandType, params, sessionContext) {
    // Resolve "default" or any unrecognised projectId to the first real project
    const resolvedProjectId = this.#resolveMobileProjectId(sessionContext.projectId);
    const resolvedContext = resolvedProjectId
      ? { ...sessionContext, projectId: resolvedProjectId }
      : sessionContext;

    if (commandType === "sendChatMessage") {
      if (!resolvedProjectId) throw Object.assign(new Error("No active project."), { code: "NO_PROJECT" });
      this.#processMobileChatMessage(resolvedProjectId, params.message).catch(() => {});
      return { queued: true, projectId: resolvedProjectId, message: params.message };
    }
    return this.mobileGateway.dispatch(commandType, params, resolvedContext);
  }

  #resolveMobileProjectId(projectId) {
    if (projectId && this.runtimeHandle.database.getProject(projectId)) return projectId;
    return this.listProjects()[0]?.id ?? null;
  }

  async #processMobileChatMessage(projectId, message) {
    this.mobileEventBuffer.pushRaw("jon.thinking", { projectId, message: "JON réfléchit…" });
    try {
      const result = await this.handleConversationTurn(projectId, { message, source: "mobile" });
      const reply = result?.turn?.reply ?? "";
      this.mobileEventBuffer.pushRaw("jon.reply", {
        projectId,
        reply,
        message: reply,
        conversationId: result?.turn?.conversationId ?? null,
        intentType: result?.turn?.intentType ?? null,
        uiBlocks: result?.turn?.uiBlocks ?? null
      });
    } catch (err) {
      this.mobileEventBuffer.pushRaw("jon.reply", {
        projectId,
        reply: `Désolé, une erreur est survenue : ${err.message}`,
        message: `Erreur : ${err.message}`,
        error: true
      });
    }
  }

  async startMission(projectId, { objective, constraints = "", source = "desktop" } = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const missionSpec = await this.prepareRunMission(projectId, {
      objective,
      deliverable: "",
      constraints,
      forbiddenActions: "",
      mode: "",
      browserId: "",
      autoContinue: false
    });
    return this.startRun(projectId, missionSpec);
  }

  async requestMobileScreenshot(projectId) {
    const resolvedId = this.#resolveMobileProjectId(projectId) ?? projectId;
    const session = this.browserProvider.getActiveSessionForProject(resolvedId);
    if (session?.id) {
      try {
        return await this.browserProvider.captureScreenshot(session.id);
      } catch {
        return null;
      }
    }
    return null;
  }

  sendTerminalInput(projectId, terminalId, input) {
    const resolvedId = this.#resolveMobileProjectId(projectId) ?? projectId;
    this.writeWorkspaceTerminalInput(resolvedId, terminalId, { input, approved: true });
  }

  pushMobileEvent(type, payload) {
    this.mobileEventBuffer.pushRaw(type, payload);
  }

  subscribeMobileEvents(fn) {
    return this.mobileEventBuffer.subscribe(fn);
  }

  getMobileEventsSince(isoTimestamp) {
    return this.mobileEventBuffer.since(isoTimestamp);
  }

  #handleBrowserEvent(event) {
    const { type, payload } = event;
    if (payload?.sessionId) {
      const session = this.browserProvider.tracker.get(payload.sessionId);
      if (session) {
        try {
          this.runtimeHandle.database.upsertWorkspaceBrowserSession(session);
        } catch {
          // best-effort persistence
        }
      }
    }
    const projectId = payload?.projectId ?? null;
    if (projectId) {
      this.emitStateChanged(projectId, type, payload);
    }
  }

  async getDashboard(projectId = null) {
    const projects = this.listProjects();
    const selectedProjectId = projectId ?? projects[0]?.id ?? null;
    const projectsWithRuns = projects.map((project) => ({
      ...project,
      runs: this.listRuns(project.id)
    }));
    const selectedProjectRuns = projectsWithRuns.find((project) => project.id === selectedProjectId)?.runs ?? [];
    const projectLlmCalls = selectedProjectId
      ? this.runtimeHandle.database.listProjectLlmCalls(selectedProjectId, { limit: 500 })
      : [];
    const projectMemory = selectedProjectId
      ? summarizeProjectMemory(normalizeProjectMemory(
        this.runtimeHandle.database.getAppSetting(
          projectMemorySettingKey(selectedProjectId),
          defaultProjectMemory(selectedProjectId)
        ).value,
        selectedProjectId
      ))
      : null;
    const availableBrowsers = await this.listInstalledBrowsers();
    const availableApplications = await this.listInstalledApplications();
    const capabilityGraph = await this.getCapabilityGraph();
    const operationalDeep = await buildOperationalDeepReadinessReport();
    const workspace = selectedProjectId ? this.getWorkspaceState(selectedProjectId) : null;
    return {
      fixtureManifest: this.fixtureManifest,
      llmGatewayStatus: this.runtimeHandle.runtime.getLlmGatewayStatus(),
      llmDashboard: summarizeLlmCalls(projectLlmCalls, selectedProjectRuns),
      userMemory: this.getUserMemorySummary(),
      userMemoryRecords: selectedProjectId
        ? this.listUserMemoryRecords({ projectId: selectedProjectId, limit: 50 })
        : this.listUserMemoryRecords({ limit: 50 }),
      projectMemory,
      startupMemoryContext: this.getStartupMemoryContext(selectedProjectId),
      agentConfiguration: this.getAgentConfiguration(),
      conversation: selectedProjectId ? {
        conversations: this.runtimeHandle.database.listConversations(selectedProjectId, { limit: 50 }),
        recentTurns: this.runtimeHandle.database.listConversationTurns(selectedProjectId, { limit: 40 })
      } : {
        conversations: [],
        recentTurns: []
      },
      desktopActionSupport: {
        availableBrowsers,
        availableApplications,
        availableCliAgents: this.getPublicCliAgentCatalog(),
        browserLaunchSupported: availableBrowsers.length > 0,
        generalDesktopControlSupported: availableApplications.length > 0,
        cliLaunchSupported: this.cliAgentCatalog.length > 0
      },
      operationalDeep,
      workspace,
        capabilityGraph: {
          summary: capabilityGraph.summary,
          preview: compactCapabilityGraphForPrompt(capabilityGraph.nodes, {
            limit: 24,
            feedbackRecords: capabilityGraph.feedbackRecords
          }),
          nodes: capabilityGraph.nodes.slice(0, 80).map(compactCapabilityForDescription),
          feedback: capabilityGraph.feedback,
          skillRegistry: this.getSkillRegistry(),
          generatedCandidates: this.listCapabilityCandidates()
        },
      projects: projectsWithRuns,
      selectedProjectId,
      pendingApprovals: this.listPendingApprovals(),
      activeRunIds: this.listActiveRunIds(),
      activeRunSurfaces: this.listActiveRunSurfaces(selectedProjectId),
      scenarios: this.listScenarios(),
      missionEntry: this.getMissionEntryContract(),
      latestBenchmark: await this.getLatestBenchmarkReport(),
      benchmarkHistory: await this.benchmarkService.listBenchmarkReports({ limit: 5 }),
      deletedRecords: this.runtimeHandle.database.listDeletedRecords({ limit: 20 })
    };
  }

  async listInstalledBrowsers() {
    try {
      const browsers = await this.computerProvider.listInstalledBrowsers?.();
      return Array.isArray(browsers) ? browsers : [];
    } catch {
      return [];
    }
  }

  async listInstalledApplications() {
    try {
      const applications = await this.computerProvider.listInstalledApplications?.();
      return Array.isArray(applications) ? applications : [];
    } catch {
      return [];
    }
  }

  async startScenario(projectId, scenarioId) {
    const launchResult = await launchScenarioForService(this, {
      projectId,
      scenarioId,
      entryPoint: "scenario_catalog"
    });
    this.#trackRun({
      runId: launchResult.runId,
      completion: launchResult.completion,
      projectId,
      scenarioId,
      entryPoint: "scenario_catalog"
    });

    return {
      runId: launchResult.runId
    };
  }

  async startMission(projectId, missionRequest) {
    const missionEntry = this.getMissionEntryContract();
    const rawMission = missionRequest?.missionSpec ?? missionRequest;
    const availableBrowsers = await this.listInstalledBrowsers();
    const confirmedPreflight = missionRequest?.preflight ? {
      ...missionRequest.preflight,
      understanding: validateMissionUnderstandingOutput(
        missionRequest.preflight.understanding ?? missionRequest.preflight,
        {
          availableBrowsers
        }
      )
    } : null;
    if (confirmedPreflight?.understanding?.requiresClarification) {
      throw new Error(confirmedPreflight.understanding.clarificationQuestion || "Mission clarification is required before this run can start.");
    }
    const preflightMode = confirmedPreflight
      ? scenarioTypeToMissionMode(confirmedPreflight.understanding.chosenExecutionFrame)
      : null;
    const mergedParameters = {
      ...(rawMission?.parameters ?? {}),
      ...((rawMission?.parameters?.browserLaunch
        || confirmedPreflight?.understanding?.selectedBrowser?.id
        || confirmedPreflight?.understanding?.browserSearchQuery
        || confirmedPreflight?.understanding?.browserLaunchUrl)
        ? {
          browserLaunch: {
            ...(rawMission?.parameters?.browserLaunch ?? {}),
            ...(confirmedPreflight?.understanding?.selectedBrowser?.id && !rawMission?.parameters?.browserLaunch?.browserId
              ? { browserId: confirmedPreflight.understanding.selectedBrowser.id }
              : {}),
            ...(confirmedPreflight?.understanding?.browserSearchQuery && !rawMission?.parameters?.browserLaunch?.searchQuery
              ? { searchQuery: confirmedPreflight.understanding.browserSearchQuery }
              : {}),
            ...(confirmedPreflight?.understanding?.browserLaunchUrl && !rawMission?.parameters?.browserLaunch?.url
              ? { url: confirmedPreflight.understanding.browserLaunchUrl }
              : {})
          }
        }
        : {}),
      ...((rawMission?.parameters?.computerAction || confirmedPreflight?.understanding?.computerActionType)
        ? {
          computerAction: {
            ...(rawMission?.parameters?.computerAction ?? {}),
            ...(confirmedPreflight?.understanding?.computerActionType && !rawMission?.parameters?.computerAction?.type
              ? { type: confirmedPreflight.understanding.computerActionType }
              : {})
          }
        }
        : {})
    };
    const missionSpec = normalizeMissionSpec({
      ...rawMission,
      parameters: mergedParameters,
      ...(preflightMode ? { mode: preflightMode } : {})
    }, missionEntry);
    if (confirmedPreflight) {
      missionSpec.routing = {
        ...missionSpec.routing,
        modeSource: "agent_preflight_confirmed",
        preflightId: confirmedPreflight.preflightId ?? null,
        chosenExecutionFrame: confirmedPreflight.understanding.chosenExecutionFrame,
        routingConfidence: confirmedPreflight.understanding.routingConfidence
      };
    }
    const orchestration = normalizeMissionOrchestration(missionRequest?.orchestration);
    const requestedConversationId = compactConversationMessage(
      missionRequest?.conversationId ?? missionRequest?.context?.conversationId ?? ""
    );
    const conversation = requestedConversationId
      ? this.ensureConversation(projectId, { conversationId: requestedConversationId })
      : null;

    const launch = await this.#launchMissionRun({
      projectId,
      missionSpec,
      confirmedPreflight,
      orchestration,
      conversationId: conversation?.id ?? null,
      entryPoint: "mission_entry_gui",
      selectedBy: "user_start"
    });
    if (conversation) {
      const linkedRunIds = Array.from(new Set([
        ...(Array.isArray(conversation.metadata?.linkedRunIds) ? conversation.metadata.linkedRunIds : []),
        launch.runId
      ]));
      this.runtimeHandle.database.updateConversation(conversation.id, {
        metadata: {
          ...(conversation.metadata ?? {}),
          linkedRunIds,
          latestRunId: launch.runId,
          latestRunStartedAt: nowIso()
        },
        updatedAt: nowIso()
      });
    }

    return {
      runId: launch.runId,
      conversation: conversation ? this.runtimeHandle.database.getConversation(conversation.id) : null
    };
  }

  async previewMission(projectId, missionRequest) {
    const missionEntry = this.getMissionEntryContract();
    const missionDraft = normalizeMissionDraft(missionRequest?.missionSpec ?? missionRequest, missionEntry);
    const preflight = await this.runtimeHandle.runtime.previewMissionPreflight({
      projectId,
      missionDraft,
      preferredScenarioType: missionDraft.mode ? missionModeToScenarioType(missionDraft.mode) : null
    });
    return {
      missionDraft,
      preflight
    };
  }

  listConversations(projectId, { limit = 50 } = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    return this.runtimeHandle.database.listConversations(projectId, { limit });
  }

  createConversation(projectId, { title = null, metadata = {} } = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    const now = nowIso();
    const conversation = {
      id: createId("conv"),
      projectId,
      title: conversationTitleFromMessage(title) || "Nouvelle conversation",
      summary: "",
      status: "active",
      metadata,
      createdAt: now,
      updatedAt: now
    };
    this.runtimeHandle.database.insertConversation(conversation);
    return conversation;
  }

  ensureConversation(projectId, { conversationId = null, title = null, metadata = {} } = {}) {
    if (conversationId) {
      const existing = this.runtimeHandle.database.getConversation(conversationId);
      if (!existing || existing.projectId !== projectId) {
        throw new Error(`Conversation not found: ${conversationId}.`);
      }
      return existing;
    }
    return this.createConversation(projectId, { title, metadata });
  }

  listConversationTurns(projectId, { limit = 80, conversationId = null } = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    return this.runtimeHandle.database.listConversationTurns(projectId, { limit, conversationId });
  }

  async #resolvePendingClarification({ projectId, pendingClarification, message }) {
    const selectedOption = matchClarificationOption(message, pendingClarification.options);
    if (!selectedOption?.id) {
      return null;
    }
    const preview = await this.previewMission(projectId, {
      missionSpec: buildClarifiedMissionSpec(pendingClarification, selectedOption)
    });
    const understanding = preview.preflight?.understanding ?? preview.preflight ?? {};
    if (understanding.requiresClarification) {
      return null;
    }
    const reply = `D’accord. J’utiliserai ${selectedOption.label}. Confirme et je lance.`;
    return {
      selectedOption,
      preflight: preview.preflight,
      missionDraft: preview.missionDraft,
      turn: {
        id: createId("turn"),
        projectId,
        conversationId: null,
        message,
        intentType: "desktop_action",
        action: "prepare_mission_preflight",
        reply,
        requiresClarification: false,
        clarificationQuestion: "",
        capabilityRequests: [],
        uiBlocks: [],
        capabilityResults: [],
        missionDraft: preview.missionDraft,
        preflight: preview.preflight,
        generationMode: "clarification_resolution",
        fallbackReason: null,
        llm: {
          providerAlias: "conversation_state",
          modelAlias: null,
          providerModel: null,
          estimatedCost: 0,
          tokenUsage: null,
          tokenGovernance: null
        },
        generatedAt: nowIso()
      }
    };
  }

  async handleConversationTurn(projectId, turnRequest = {}) {
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}.`);
    }
    const message = compactConversationMessage(turnRequest.message ?? turnRequest.objective ?? "");
    if (!message) {
      throw new Error("Conversation message is required.");
    }
    const requestedConversationId = compactConversationMessage(turnRequest.conversationId ?? turnRequest.context?.conversationId ?? "");
    const conversation = this.ensureConversation(projectId, {
      conversationId: requestedConversationId || null,
      title: message,
      metadata: {
        source: "user_home"
      }
    });
    const pendingClarification = normalizePendingClarificationState(conversation.metadata?.pendingClarification);
    const resolvedClarification = pendingClarification
      ? await this.#resolvePendingClarification({ projectId, pendingClarification, message })
      : null;
    this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
      projectId,
      conversationId: conversation.id,
      role: "user",
      kind: "message",
      content: message,
      payload: {
        source: "user_home",
        conversationId: conversation.id,
        clarificationResponseTo: pendingClarification?.id ?? null
      }
    }));
    if (resolvedClarification) {
      const turn = {
        ...resolvedClarification.turn,
        conversationId: conversation.id
      };
      this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
        projectId,
        conversationId: conversation.id,
        role: "assistant",
        kind: "turn",
        content: turn.reply,
        payload: {
          conversationId: conversation.id,
          intentType: turn.intentType,
          action: turn.action,
          uiBlocks: turn.uiBlocks,
          capabilityResults: turn.capabilityResults,
          missionDraft: turn.missionDraft,
          preflight: turn.preflight,
          requiresClarification: false,
          clarificationQuestion: "",
          clarificationOptions: [],
          choiceRequest: null,
          clarificationResolved: {
            pendingClarificationId: pendingClarification.id,
            selectedOption: {
              id: resolvedClarification.selectedOption.id,
              label: resolvedClarification.selectedOption.label
            }
          }
        },
        metadata: {
          conversationId: conversation.id,
          generationMode: turn.generationMode,
          fallbackReason: turn.fallbackReason,
          llm: turn.llm,
          clarificationResolved: true
        }
      }));
      this.runtimeHandle.database.updateConversation(conversation.id, {
        title: conversation.title || conversationTitleFromMessage(pendingClarification.originalMessage || message),
        summary: mergeConversationSummary(
          conversation.summary,
          summarizeConversationTurn({
            message,
            reply: turn.reply,
            intentType: turn.intentType,
            action: turn.action
          })
        ),
        metadata: {
          ...(conversation.metadata ?? {}),
          pendingClarification: null,
          lastIntentType: turn.intentType,
          lastAction: turn.action,
          lastGenerationMode: turn.generationMode,
          lastClarificationResolvedAt: nowIso()
        },
        updatedAt: nowIso()
      });
      this.#recordUserMemoryFromConversationTurn({
        projectId,
        conversationId: conversation.id,
        message,
        turn
      });
      this.emitStateChanged("conversation.turn.completed", {
        projectId,
        conversationId: conversation.id,
        turnId: turn.id,
        intentType: turn.intentType,
        action: turn.action,
        generationMode: turn.generationMode,
        clarificationResolved: true
      });
      return {
        conversation: this.runtimeHandle.database.getConversation(conversation.id),
        turn,
        preflight: turn.preflight,
        missionDraft: turn.missionDraft
      };
    }
    const persistedHistory = this.runtimeHandle.database.listConversationTurns(projectId, {
      limit: 24,
      conversationId: conversation.id
    });
    const availableBrowsers = await this.listInstalledBrowsers();
    const availableApplications = await this.listInstalledApplications();
    const agentConfig = this.getAgentConfiguration();
    const capabilityGraph = await this.getCapabilityGraph();
    const relevantCapabilityGraph = compactCapabilityGraphForPrompt(capabilityGraph.nodes, {
      mission: message,
      limit: 12,
      feedbackRecords: capabilityGraph.feedbackRecords
    });
    const conversationCapabilityGraph = compactCapabilityGraphForConversation(relevantCapabilityGraph);
    const promptBrowsers = compactBrowserCatalogForPrompt(availableBrowsers);
    const promptApplications = compactApplicationCatalogForPrompt(availableApplications);
    const externalContext = compactExternalConversationContext(turnRequest.context && typeof turnRequest.context === "object" ? turnRequest.context : {});
    const availableCliAgents = this.getPublicCliAgentCatalog();
    const userMemory = this.getUserMemorySummary();
    const recentRunContext = this.#buildRecentRunContext(projectId, message);
    let workspaceTerminals = null;
    try {
      const ws = this.getWorkspaceState(projectId, { conversationId: conversation.id });
      workspaceTerminals = buildWorkspaceTerminalsContext(ws.terminals ?? []);
    } catch { /* absorb — workspace state is optional context */ }
    const input = {
      message,
      capabilityGraph: conversationCapabilityGraph,
      userMemory,
      recentRunContext,
      conversationContext: {
        ...externalContext,
        conversation: {
          id: conversation.id,
          title: conversation.title,
          summary: conversation.summary,
          status: conversation.status,
          updatedAt: conversation.updatedAt
        },
        persistedTurns: compactConversationHistory(persistedHistory),
        pendingClarification: compactPendingClarificationForPrompt(pendingClarification)
      },
      safeCapabilities: safeCapabilitiesDescriptor(),
      availableBrowsers: promptBrowsers,
      availableApplications: promptApplications,
      availableCliAgents,
      activeRunState: buildActiveRunState(this.listActiveRunIds(), this.runtimeHandle.database),
      workspaceTerminals
    };
    const promptRefs = [
      {
        promptId: "system.primary_reasoning",
        version: "1.0.0"
      },
      {
        promptId: "task.conversation_turn",
        version: "1.0.0",
        bindings: {
          message,
          visibleAssistantSystemPrompt: agentConfig.conversationalSystemPrompt,
          guardrails: JSON.stringify(agentConfig.guardrails),
          capabilityGraph: JSON.stringify(conversationCapabilityGraph),
          userMemory: JSON.stringify(userMemory),
          conversationContext: JSON.stringify(input.conversationContext ?? null),
          safeCapabilities: JSON.stringify(input.safeCapabilities),
          availableBrowsers: JSON.stringify(promptBrowsers),
          availableApplications: JSON.stringify(promptApplications),
          availableCliAgents: JSON.stringify(availableCliAgents),
          activeRunState: JSON.stringify(input.activeRunState),
          workspaceTerminals: JSON.stringify(workspaceTerminals),
          recentRunContext: JSON.stringify(recentRunContext ?? null)
        }
      }
    ];

    const conversationTurnPolicy = getTokenGovernancePolicy(REASONING_STAGE.CONVERSATION_TURN);
    const conversationTurnResult = await this.runtimeHandle.llmGateway.generateStructured({
      runId: createId("conv"),
      projectId,
      callType: LLM_CALL_TYPE.CONVERSATION_TURN,
      modelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
      promptRefs,
      input,
      metadata: {
        reasoningStage: REASONING_STAGE.CONVERSATION_TURN,
        conversationTurn: true,
        conversationId: conversation.id,
        requestedModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
        tokenGovernancePolicyId: conversationTurnPolicy.id
      },
      validateOutput: (output) => validateConversationTurnOutput({ ...output, _availableCliAgents: availableCliAgents }, { message })
    });
    const plannerResult = {
      output: conversationTurnResult.output,
      callRecord: conversationTurnResult.callRecord,
      generationMode: "llm"
    };

    const capabilityExecution = await executeSafeConversationCapabilities({
      requests: plannerResult.output.capabilityRequests,
      listInstalledApplications: () => this.listInstalledApplications(),
      listInstalledBrowsers: () => this.listInstalledBrowsers()
    }).catch((error) => ({
      text: `Je n’ai pas pu terminer l’inspection : ${error.message}`,
      uiBlocks: [{
        type: "text",
        tone: "warn",
        title: "Inspection incomplète",
        text: error.message
      }],
      capabilityResults: [{
        id: "safe_capability",
        status: "failed",
        error: error.message
      }]
    }));

    let preflight = null;
    let missionDraft = plannerResult.output.missionDraft;
    if (["prepare_mission_preflight", "start_bounded_run_after_confirmation"].includes(plannerResult.output.action) && missionDraft) {
      const preview = await this.previewMission(projectId, {
        missionSpec: {
          objective: missionDraft.objective,
          deliverable: missionDraft.deliverable,
          constraints: missionDraft.constraints,
          forbiddenActions: missionDraft.forbiddenActions,
          mode: missionDraft.mode || "",
          parameters: missionDraft.parameters ?? {}
        }
      });
      preflight = preview.preflight;
      missionDraft = preview.missionDraft;
      preflight = enrichPreflightWithChoiceRequest({
        message,
        missionDraft,
        preflight,
        availableApplications
      });
    }

    // Auto-launch when JON has confirmed the mission spec needs no clarification
    let autoLaunchedRunId = null;
    const requestedSurface = surfaceLockForPreflight(preflight);
    if (
      plannerResult.output.action === "start_bounded_run_after_confirmation"
      && preflight
      && !preflight.understanding?.requiresClarification
      && !plannerResult.output.requiresClarification
      && missionDraft
      && !this.hasActiveRunOnSurface(projectId, requestedSurface)
    ) {
      try {
        const preflightMode = preflight.understanding?.chosenExecutionFrame
          ? scenarioTypeToMissionMode(preflight.understanding.chosenExecutionFrame)
          : null;
        const autoMissionSpec = normalizeMissionSpec({
          objective: missionDraft.objective,
          deliverable: missionDraft.deliverable,
          constraints: missionDraft.constraints,
          forbiddenActions: missionDraft.forbiddenActions,
          mode: preflightMode || missionDraft.mode || "",
          parameters: missionDraft.parameters ?? {}
        }, this.getMissionEntryContract());
        autoMissionSpec.routing = {
          ...autoMissionSpec.routing,
          modeSource: "agent_preflight_auto_confirmed",
          preflightId: preflight.preflightId ?? null,
          chosenExecutionFrame: preflight.understanding?.chosenExecutionFrame,
          routingConfidence: preflight.understanding?.routingConfidence
        };
        const autoLaunch = await this.#launchMissionRun({
          projectId,
          missionSpec: autoMissionSpec,
          confirmedPreflight: preflight,
          orchestration: { autoContinue: false, maxAutoRuns: 1 },
          conversationId: conversation.id,
          entryPoint: "conversation_auto_launch",
          selectedBy: "jon_auto_confirm"
        });
        autoLaunchedRunId = autoLaunch.runId;
        const linkedRunIds = Array.from(new Set([
          ...(Array.isArray(conversation.metadata?.linkedRunIds) ? conversation.metadata.linkedRunIds : []),
          autoLaunch.runId
        ]));
        this.runtimeHandle.database.updateConversation(conversation.id, {
          metadata: {
            ...(conversation.metadata ?? {}),
            linkedRunIds,
            latestRunId: autoLaunch.runId,
            latestRunStartedAt: nowIso()
          },
          updatedAt: nowIso()
        });
        // Clear preflight so UI does not show a stale "confirm" button
        preflight = null;
      } catch (launchError) {
        console.error("[conversation] auto-launch failed:", launchError.message);
      }
    }

    const turn = {
      id: createId("turn"),
      projectId,
      conversationId: conversation.id,
      message,
      ...plannerResult.output,
      reply: combineConversationReply({
        plannerReply: plannerResult.output.reply,
        capabilityText: capabilityExecution.text,
        action: plannerResult.output.action,
        generationMode: plannerResult.generationMode
      }),
      uiBlocks: visibleUiBlocksForTurn({
        plannerOutput: plannerResult.output,
        capabilityExecution,
        agentConfig
      }),
      capabilityResults: capabilityExecution.capabilityResults,
      missionDraft,
      preflight,
      choiceRequest: choiceRequestFromPreflight(preflight),
      generationMode: plannerResult.generationMode,
      fallbackReason: plannerResult.fallbackReason ?? null,
      llm: plannerResult.callRecord ? {
        providerAlias: plannerResult.callRecord.providerAlias,
        modelAlias: plannerResult.callRecord.modelAlias,
        providerModel: plannerResult.callRecord.providerModel,
        estimatedCost: plannerResult.callRecord.estimatedCost,
        tokenUsage: plannerResult.callRecord.tokenUsage,
        tokenGovernance: plannerResult.callRecord.metadata?.tokenGovernance ?? null
      } : {
        providerAlias: "deterministic_fallback",
        modelAlias: null,
        providerModel: null,
        estimatedCost: 0,
        tokenUsage: null,
        tokenGovernance: null
      },
      generatedAt: nowIso()
    };

    // Autonomously launch a workspace CLI terminal when the planner requests it
    let workspaceCliLaunch = null;
    if (turn.action === "launch_workspace_cli" && turn.workspaceCliRequest) {
      try {
        const launchResult = this.startWorkspaceTerminalProcess(projectId, {
          command: turn.workspaceCliRequest.command,
          args: turn.workspaceCliRequest.args ?? [],
          label: turn.workspaceCliRequest.label,
          cwd: turn.workspaceCliRequest.cwd ?? undefined,
          autonomyMode: turn.workspaceCliRequest.autonomyMode ?? "assisted",
          conversationId: conversation.id,
          authorized: true
        });
        workspaceCliLaunch = {
          launched: true,
          terminalId: launchResult.terminal.id,
          command: turn.workspaceCliRequest.command,
          label: launchResult.terminal.label,
          pid: launchResult.process?.pid ?? null
        };
        // Create a mission brief so JON's terminal reasoning has full context.
        // Without this, getLatestWorkspaceMissionBrief() returns null and all
        // LLM reasoning falls back to "Aucune mission active."
        try {
          const existingBrief = this.runtimeHandle.database.getLatestWorkspaceMissionBrief(projectId, {
            conversationId: conversation.id
          });
          const briefObjective = missionDraft?.objective ?? turn.workspaceCliRequest.label ?? message;
          this.runtimeHandle.database.upsertWorkspaceMissionBrief(
            buildWorkspaceMissionBrief({
              id: existingBrief?.id ?? createId("wmb"),
              projectId,
              conversationId: conversation.id,
              objective: briefObjective,
              status: "active",
              progress: existingBrief?.progress ?? [],
              blockers: existingBrief?.blockers ?? [],
              nextSteps: [
                `Terminal ${launchResult.terminal.label} lancé — surveiller la sortie`,
                ...(existingBrief?.nextSteps ?? [])
              ].slice(0, 10),
              decisions: existingBrief?.decisions ?? [],
              metadata: {
                ...(existingBrief?.metadata ?? {}),
                terminalId: launchResult.terminal.id,
                command: turn.workspaceCliRequest.command,
                launchedAt: nowIso()
              }
            })
          );
        } catch { /* mission brief creation is best-effort */ }
      } catch (launchError) {
        workspaceCliLaunch = {
          launched: false,
          error: launchError.message
        };
      }
    }

    const nextPendingClarification = buildPendingClarificationState({
      sourceTurnId: turn.id,
      message,
      plannerOutput: plannerResult.output,
      missionDraft,
      preflight
    });

    this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
      projectId,
      conversationId: conversation.id,
      role: "assistant",
      kind: "turn",
      content: turn.reply,
      payload: {
        conversationId: conversation.id,
        intentType: turn.intentType,
        action: turn.action,
        uiBlocks: turn.uiBlocks,
        capabilityResults: turn.capabilityResults,
        missionDraft: turn.missionDraft,
        preflight: turn.preflight,
        requiresClarification: turn.requiresClarification,
        clarificationQuestion: turn.clarificationQuestion,
        clarificationOptions: clarificationOptionsFrom(turn.preflight),
        choiceRequest: choiceRequestFromPreflight(turn.preflight),
        pendingClarificationId: nextPendingClarification?.id ?? null,
        workspaceCliLaunch: workspaceCliLaunch ?? null
      },
      metadata: {
        conversationId: conversation.id,
        generationMode: turn.generationMode,
        fallbackReason: turn.fallbackReason,
        llm: turn.llm
      }
    }));
    this.runtimeHandle.database.updateConversation(conversation.id, {
      title: conversation.title || conversationTitleFromMessage(message),
      summary: mergeConversationSummary(
        conversation.summary,
        summarizeConversationTurn({
          message,
          reply: turn.reply,
          intentType: turn.intentType,
          action: turn.action
        })
      ),
      metadata: {
        ...(conversation.metadata ?? {}),
        pendingClarification: nextPendingClarification,
        lastIntentType: turn.intentType,
        lastAction: turn.action,
        lastGenerationMode: turn.generationMode
      },
      updatedAt: nowIso()
    });
    this.#recordUserMemoryFromConversationTurn({
      projectId,
      conversationId: conversation.id,
      message,
      turn
    });

    for (const capability of relevantCapabilityGraph.topCapabilities.slice(0, 3)) {
      this.recordCapabilityFeedback({
        nodeId: capability.id,
        skillId: capability.skillId ?? null,
        mission: message,
        projectId,
        conversationTurnId: turn.id,
        selectedScore: capability.score,
        outcomeStatus: "candidate",
        notes: `Conversation planner considered this capability for ${turn.intentType}.`,
        metadata: {
          intentType: turn.intentType,
          action: turn.action,
          generationMode: turn.generationMode
        }
      });
    }

    this.emitStateChanged("conversation.turn.completed", {
      projectId,
      conversationId: conversation.id,
      turnId: turn.id,
      intentType: turn.intentType,
      action: turn.action,
      generationMode: turn.generationMode
    });

    auditConversationTurn({
      projectId,
      conversationId: conversation.id,
      runId: autoLaunchedRunId ?? null,
      userMessage: message,
      jonReply: turn.reply,
      intentType: turn.intentType,
      action: turn.action,
      generationMode: turn.generationMode,
      fallbackReason: turn.fallbackReason,
      missionDraft: turn.missionDraft,
      requiresClarification: turn.requiresClarification,
      clarificationQuestion: turn.clarificationQuestion,
      llm: turn.llm
    });

    return {
      conversation: this.runtimeHandle.database.getConversation(conversation.id),
      turn,
      preflight,
      missionDraft,
      workspaceCliLaunch,
      autoLaunchedRunId
    };
  }

  async readConversationArtifact(artifactId) {
    return readConversationArtifact(artifactId);
  }

  async waitForRun(runId, { timeoutMs = 0 } = {}) {
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) {
      await waitWithTimeout(
        activeRun,
        timeoutMs,
        `Timed out while waiting for run ${runId} to settle.`,
        { runId }
      );
    }
    return this.getRunDetail(runId);
  }

  async waitForMissionChain(rootRunId, { timeoutMs = 8000 } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const rootRun = this.runtimeHandle.database.getRun(rootRunId);
      if (!rootRun) {
        return null;
      }
      const chainRuns = sortChainRuns(
        this.runtimeHandle.database
          .listRuns(rootRun.projectId)
          .filter((candidate) => rootRunIdFor(candidate) === rootRunId)
      );
      const activeChainRun = chainRuns.find((candidate) => this.activeRuns.has(candidate.id));
      if (!activeChainRun) {
        return {
          rootRunId,
          runs: await Promise.all(chainRuns.map((candidate) => this.getRunDetail(candidate.id)))
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out while waiting for the mission chain to settle.");
  }

  async resolveApproval(approvalId, decision, rationale = null) {
    if (decision === APPROVAL_DECISION.APPROVED_ONCE) {
      this.approvalBroker.approveOnce(approvalId, rationale);
    } else if (decision === APPROVAL_DECISION.STOP_RUN) {
      this.approvalBroker.stopRun(approvalId, rationale);
    } else {
      this.approvalBroker.deny(approvalId, rationale);
    }
    return {
      approvalId,
      decision
    };
  }

  async readArtifactContent(runId, artifactId) {
    const artifact = this.runtimeHandle.database.listArtifacts(runId).find((item) => item.id === artifactId);
    if (!artifact) {
      return null;
    }
    return {
      artifact,
      content: await fs.readFile(artifact.storagePath, "utf8")
    };
  }

  async readEvidenceAsset(runId, evidenceId, asset = "manifest") {
    const evidence = this.runtimeHandle.database.listEvidence(runId).find((item) => item.id === evidenceId);
    if (!evidence) {
      return null;
    }

    if (asset === "screenshot") {
      const screenshotPath = evidence.metadata?.screenshotPath;
      if (!screenshotPath) {
        return null;
      }
      return {
        evidence,
        filePath: screenshotPath
      };
    }

    return {
      evidence,
      filePath: evidence.storagePath
    };
  }

  async readEvidenceManifest(runId, evidenceId) {
    const asset = await this.readEvidenceAsset(runId, evidenceId, "manifest");
    if (!asset) {
      return null;
    }
    return {
      evidence: asset.evidence,
      content: JSON.parse(await fs.readFile(asset.filePath, "utf8"))
    };
  }

  async runBenchmarks() {
    const report = await this.benchmarkService.runFullBenchmarkSuite();
    this.emitStateChanged("benchmarks.updated", {
      createdAt: report.createdAt,
      overallStatus: report.summary.overallStatus
    });
    return report;
  }

  async submitBenchmarkReview({ createdAt, suiteId, classification, notes = "", reviewer = "operator" }) {
    const report = await this.benchmarkService.submitSuiteReview({
      createdAt,
      suiteId,
      classification,
      notes,
      reviewer
    });
    this.emitStateChanged("benchmarks.reviewed", {
      createdAt,
      suiteId,
      classification
    });
    return report;
  }

  async getLatestBenchmarkReport() {
    return this.benchmarkService.getLatestBenchmarkReport();
  }

  async listBenchmarkReports({ limit = 5 } = {}) {
    return this.benchmarkService.listBenchmarkReports({ limit });
  }

  async deleteArtifact(runId, artifactId) {
    this.#assertRunNotActive(runId);
    const artifact = this.runtimeHandle.database.getArtifact(artifactId);
    if (!artifact || artifact.runId !== runId) {
      throw new Error("Artifact not found.");
    }
    await this.#removeFileSet(artifactFilePaths(artifact));
    this.runtimeHandle.database.recordDeletion({
      objectType: "artifact",
      objectId: artifact.id,
      runId,
      projectId: this.runtimeHandle.database.getRun(runId)?.projectId ?? null,
      label: artifact.title,
      metadata: {
        artifactType: artifact.artifactType
      },
      deletedAt: nowIso()
    });
    this.runtimeHandle.database.deleteArtifact(artifactId);
    this.emitStateChanged("cleanup.deleted", {
      objectType: "artifact",
      objectId: artifactId,
      runId
    });
    return {
      deleted: true,
      objectType: "artifact",
      objectId: artifactId
    };
  }

  async deleteEvidence(runId, evidenceId) {
    this.#assertRunNotActive(runId);
    const evidence = this.runtimeHandle.database.getEvidence(evidenceId);
    if (!evidence || evidence.runId !== runId) {
      throw new Error("Evidence not found.");
    }
    await this.#removeFileSet(evidenceFilePaths(evidence));
    this.runtimeHandle.database.recordDeletion({
      objectType: "evidence",
      objectId: evidence.id,
      runId,
      projectId: this.runtimeHandle.database.getRun(runId)?.projectId ?? null,
      label: evidence.label,
      metadata: {
        evidenceType: evidence.evidenceType
      },
      deletedAt: nowIso()
    });
    this.runtimeHandle.database.deleteEvidence(evidenceId);
    this.emitStateChanged("cleanup.deleted", {
      objectType: "evidence",
      objectId: evidenceId,
      runId
    });
    return {
      deleted: true,
      objectType: "evidence",
      objectId: evidenceId
    };
  }

  async deleteRun(runId) {
    this.#assertRunNotActive(runId);
    const run = this.runtimeHandle.database.getRun(runId);
    if (!run) {
      throw new Error("Run not found.");
    }
    const artifacts = this.runtimeHandle.database.listArtifacts(runId);
    const evidence = this.runtimeHandle.database.listEvidence(runId);
    const runDir = path.join(DATA_ROOT, "runs", runId);

    for (const artifact of artifacts) {
      this.runtimeHandle.database.recordDeletion({
        objectType: "artifact",
        objectId: artifact.id,
        runId,
        projectId: run.projectId,
        label: artifact.title,
        metadata: {
          artifactType: artifact.artifactType
        },
        deletedAt: nowIso()
      });
    }
    for (const entry of evidence) {
      this.runtimeHandle.database.recordDeletion({
        objectType: "evidence",
        objectId: entry.id,
        runId,
        projectId: run.projectId,
        label: entry.label,
        metadata: {
          evidenceType: entry.evidenceType
        },
        deletedAt: nowIso()
      });
    }
    this.runtimeHandle.database.recordDeletion({
      objectType: "run",
      objectId: run.id,
      runId: run.id,
      projectId: run.projectId,
      label: run.mission,
      metadata: {
        status: run.status,
        lifecycleStage: run.lifecycleStage
      },
      deletedAt: nowIso()
    });

    await this.#removeFileSet([
      ...artifacts.flatMap((artifact) => artifactFilePaths(artifact)),
      ...evidence.flatMap((entry) => evidenceFilePaths(entry))
    ]);
    await removePathIfExists(runDir, { recursive: true });
    this.runtimeHandle.database.deleteRun(runId);
    this.emitStateChanged("cleanup.deleted", {
      objectType: "run",
      objectId: runId,
      projectId: run.projectId
    });
    return {
      deleted: true,
      objectType: "run",
      objectId: runId
    };
  }

  async deleteProject(projectId) {
    const activeRun = this.listActiveRunIds().some((runId) => this.runtimeHandle.database.getRun(runId)?.projectId === projectId);
    if (activeRun) {
      throw new Error("Cannot delete a project with an active run.");
    }
    const project = this.runtimeHandle.database.getProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    const runs = this.runtimeHandle.database.listRuns(projectId);
    for (const run of runs) {
      const artifacts = this.runtimeHandle.database.listArtifacts(run.id);
      const evidence = this.runtimeHandle.database.listEvidence(run.id);
      for (const artifact of artifacts) {
        this.runtimeHandle.database.recordDeletion({
          objectType: "artifact",
          objectId: artifact.id,
          runId: run.id,
          projectId,
          label: artifact.title,
          metadata: {
            artifactType: artifact.artifactType
          },
          deletedAt: nowIso()
        });
      }
      for (const entry of evidence) {
        this.runtimeHandle.database.recordDeletion({
          objectType: "evidence",
          objectId: entry.id,
          runId: run.id,
          projectId,
          label: entry.label,
          metadata: {
            evidenceType: entry.evidenceType
          },
          deletedAt: nowIso()
        });
      }
      this.runtimeHandle.database.recordDeletion({
        objectType: "run",
        objectId: run.id,
        runId: run.id,
        projectId,
        label: run.mission,
        metadata: {
          status: run.status
        },
        deletedAt: nowIso()
      });
      await this.#removeFileSet([
        ...artifacts.flatMap((artifact) => artifactFilePaths(artifact)),
        ...evidence.flatMap((entry) => evidenceFilePaths(entry))
      ]);
      await removePathIfExists(path.join(DATA_ROOT, "runs", run.id), { recursive: true });
    }

    this.runtimeHandle.database.recordDeletion({
      objectType: "project",
      objectId: project.id,
      projectId: project.id,
      label: project.name,
      metadata: {
        runCount: runs.length
      },
      deletedAt: nowIso()
    });
    this.runtimeHandle.database.deleteProject(projectId);
    this.emitStateChanged("cleanup.deleted", {
      objectType: "project",
      objectId: projectId
    });
    return {
      deleted: true,
      objectType: "project",
      objectId: projectId
    };
  }

  async clearTemporaryRuntimeState() {
    await ensureDir(TEMP_RUNTIME_ROOT);
    const entries = await fs.readdir(TEMP_RUNTIME_ROOT).catch(() => []);
    for (const entry of entries) {
      await removePathIfExists(path.join(TEMP_RUNTIME_ROOT, entry), { recursive: true });
    }
    this.runtimeHandle.database.recordDeletion({
      objectType: "temp_runtime_state",
      objectId: "temp-root",
      label: "Temporary runtime state cleared",
      metadata: {
        deletedEntryCount: entries.length
      },
      deletedAt: nowIso()
    });
    this.emitStateChanged("cleanup.cleared", {
      objectType: "temp_runtime_state",
      deletedEntryCount: entries.length
    });
    return {
      cleared: true,
      deletedEntryCount: entries.length
    };
  }

  async #launchMissionRun({
    projectId,
    missionSpec,
    confirmedPreflight,
    orchestration,
    conversationId = null,
    entryPoint,
    chainId = createId("chain"),
    rootRunId = null,
    parentRunId = null,
    runIndex = 1,
    rootMission = null,
    selectedBy = "user_start",
    selectedRecommendationSlot = "none",
    recommendedByRunId = null
  }) {
    const missionEntry = this.getMissionEntryContract();
    const scenarioDescriptor = findScenarioDescriptor(missionEntry.modes, missionSpec.mode);
    if (!scenarioDescriptor) {
      throw new Error(`Unsupported mission mode: ${missionSpec.mode}.`);
    }

    const launchResult = await launchScenarioForService(this, {
      projectId,
      scenarioId: missionSpec.mode,
      mission: buildMissionStatement(missionSpec, scenarioDescriptor),
      missionSpec,
      preflight: confirmedPreflight,
      orchestration: {
        chainId,
        rootRunId,
        parentRunId,
        runIndex,
        maxAutoRuns: orchestration.maxAutoRuns,
        autoContinueRequested: orchestration.autoContinue,
        continuationMode: orchestration.continuationMode,
        rootMission: rootMission ?? missionSpec.objective ?? "",
        selectedBy,
        selectedRecommendationSlot,
        recommendedByRunId
      },
      entryPoint
    });

    const actualRootRunId = rootRunId ?? launchResult.runId;
    this.#patchRunMetadata(launchResult.runId, (metadata) => ({
      ...metadata,
      conversationId: conversationId ?? metadata.conversationId ?? null,
      conversation: conversationId ? {
        id: conversationId,
        role: "source_conversation"
      } : metadata.conversation ?? null,
      orchestration: {
        ...(metadata.orchestration ?? {}),
        chainId,
        rootRunId: actualRootRunId,
        parentRunId,
        runIndex,
        maxAutoRuns: orchestration.maxAutoRuns,
        autoContinueRequested: orchestration.autoContinue,
        continuationMode: orchestration.continuationMode,
        rootMission: rootMission ?? missionSpec.objective ?? "",
        selectedBy,
        selectedRecommendationSlot,
        recommendedByRunId
      }
    }));

    if (actualRootRunId === launchResult.runId) {
      this.#patchRunMetadata(actualRootRunId, (metadata) => ({
        ...metadata,
        conversationId: conversationId ?? metadata.conversationId ?? null,
        orchestration: {
          ...(metadata.orchestration ?? {}),
          latestChainRunId: launchResult.runId
        }
      }));
    } else {
      this.#patchRunMetadata(actualRootRunId, (metadata) => ({
        ...metadata,
        conversationId: conversationId ?? metadata.conversationId ?? null,
        orchestration: {
          ...(metadata.orchestration ?? {}),
          latestChainRunId: launchResult.runId
        }
      }));
    }

    this.#trackRun({
      runId: launchResult.runId,
      completion: launchResult.completion,
      projectId,
      scenarioId: missionSpec.mode,
      entryPoint
    });
    return {
      runId: launchResult.runId
    };
  }

  #trackRun({ runId, completion, projectId, scenarioId, entryPoint }) {
    const tracked = (async () => {
      try {
        await completion;
        await this.#maybePostDegradedModePrompt(runId).catch(() => {});
        await this.#maybeRecoverIncompleteMission(runId).catch((error) => {
          this.runtimeHandle.database.insertEvent(runId, createEvent("run.recovery.error", EVENT_ACTOR.SYSTEM, "Automatic capability recovery stopped after an orchestration error.", {
            error: error.message
          }));
          this.emitStateChanged("run.recovery.error", {
            runId,
            error: error.message
          });
        });
        await this.#maybeContinueMissionChain(runId).catch((error) => {
          this.runtimeHandle.database.insertEvent(runId, createEvent("run.chain.error", EVENT_ACTOR.SYSTEM, "Automatic mission chaining stopped after an orchestration error.", {
            error: error.message
          }));
          this.emitStateChanged("run.chain.error", {
            runId,
            error: error.message
          });
        });
        await this.#maybePostAuthPrompt(runId).catch(() => {});
      } finally {
        this.activeRuns.delete(runId);
        this.emitStateChanged("run.settled", {
          runId
        });
      }
    })();
    this.activeRuns.set(runId, tracked);
    this.emitStateChanged("run.started", {
      projectId,
      runId,
      scenarioId,
      entryPoint
    });
    return tracked;
  }

  async #maybeContinueMissionChain(runId) {
    const completedRun = this.runtimeHandle.database.getRun(runId);
    if (!completedRun || completedRun.status !== RUN_STATUS.COMPLETED) {
      return null;
    }
    const orchestration = completedRun.metadata?.orchestration ?? null;
    if (!orchestration?.autoContinueRequested) {
      return null;
    }

    const rootRunId = orchestration.rootRunId ?? completedRun.id;
    const chainRuns = sortChainRuns(
      this.runtimeHandle.database
        .listRuns(completedRun.projectId)
        .filter((candidate) => rootRunIdFor(candidate) === rootRunId)
    );
    const priorRuns = chainRuns.map((candidate) => ({
      runId: candidate.id,
      mission: candidate.metadata?.missionSpec?.objective ?? candidate.mission,
      runIndex: candidate.metadata?.orchestration?.runIndex ?? null,
      status: candidate.status,
      lifecycleStage: candidate.lifecycleStage
    }));

    const handoff = await this.runtimeHandle.runtime.decideRunHandoff({
      runId,
      chainContext: {
        chainId: orchestration.chainId ?? rootRunId,
        runIndex: orchestration.runIndex ?? chainRuns.length,
        maxAutoRuns: orchestration.maxAutoRuns ?? 1,
        priorRuns
      }
    });

    this.#patchRunMetadata(runId, (metadata) => ({
      ...metadata,
      orchestration: {
        ...(metadata.orchestration ?? {}),
        handoffDecision: {
          ...handoff.output,
          generationMode: handoff.generationMode,
          llmCallId: handoff.callRecord?.id ?? null,
          contextSnapshotId: handoff.reasoningSnapshot?.id ?? null,
          decidedAt: nowIso()
        }
      }
    }));
    this.runtimeHandle.database.insertEvent(runId, createEvent("run.chain.decided", EVENT_ACTOR.AGENT, handoff.output.decisionSummary, {
      decision: handoff.output.decision,
      selectedRecommendationSlot: handoff.output.selectedRecommendationSlot,
      llmCallId: handoff.callRecord?.id ?? null
    }));
    this.emitStateChanged("run.chain.decided", {
      runId,
      decision: handoff.output.decision,
      selectedRecommendationSlot: handoff.output.selectedRecommendationSlot
    });

    if (handoff.output.decision !== "continue_now" || !handoff.output.selectedRecommendation) {
      return handoff.output;
    }

    const followUpMissionRequest = recommendationMissionRequest(handoff.output.selectedRecommendation, {
      autoContinue: orchestration.autoContinueRequested,
      maxAutoRuns: orchestration.maxAutoRuns ?? 1
    });
    if (!followUpMissionRequest) {
      return handoff.output;
    }

    const preview = await this.previewMission(completedRun.projectId, followUpMissionRequest);
    if (preview.preflight.understanding.requiresClarification) {
      this.#patchRunMetadata(runId, (metadata) => ({
        ...metadata,
        orchestration: {
          ...(metadata.orchestration ?? {}),
          handoffDecision: {
            ...((metadata.orchestration ?? {}).handoffDecision ?? {}),
            decision: "needs_clarification",
            clarificationQuestion: preview.preflight.understanding.clarificationQuestion,
            previewBlockedAt: nowIso()
          }
        }
      }));
      this.runtimeHandle.database.insertEvent(runId, createEvent("run.chain.blocked", EVENT_ACTOR.AGENT, "Automatic continuation stopped because the next bounded step now needs a clarification.", {
        clarificationQuestion: preview.preflight.understanding.clarificationQuestion
      }));
      this.emitStateChanged("run.chain.blocked", {
        runId,
        reason: "clarification_required"
      });
      return {
        ...handoff.output,
        decision: "needs_clarification",
        clarificationQuestion: preview.preflight.understanding.clarificationQuestion
      };
    }

    const nextLaunch = await this.#launchMissionRun({
      projectId: completedRun.projectId,
      missionSpec: normalizeMissionSpec(followUpMissionRequest.missionSpec, this.getMissionEntryContract()),
      confirmedPreflight: preview.preflight,
      orchestration: normalizeMissionOrchestration(followUpMissionRequest.orchestration),
      conversationId: completedRun.metadata?.conversationId ?? completedRun.metadata?.conversation?.id ?? null,
      entryPoint: "auto_chain",
      chainId: orchestration.chainId ?? rootRunId,
      rootRunId,
      parentRunId: runId,
      runIndex: Number(orchestration.runIndex ?? 1) + 1,
      rootMission: orchestration.rootMission ?? completedRun.metadata?.missionSpec?.objective ?? completedRun.mission,
      selectedBy: "agent_handoff",
      selectedRecommendationSlot: handoff.output.selectedRecommendationSlot,
      recommendedByRunId: runId
    });
    const conversationId = completedRun.metadata?.conversationId ?? completedRun.metadata?.conversation?.id ?? null;
    if (conversationId) {
      const conversation = this.runtimeHandle.database.getConversation(conversationId);
      if (conversation) {
        this.runtimeHandle.database.updateConversation(conversationId, {
          metadata: {
            ...(conversation.metadata ?? {}),
            linkedRunIds: Array.from(new Set([
              ...(Array.isArray(conversation.metadata?.linkedRunIds) ? conversation.metadata.linkedRunIds : []),
              runId,
              nextLaunch.runId
            ])),
            latestRunId: nextLaunch.runId,
            latestAutoRunStartedAt: nowIso()
          },
          updatedAt: nowIso()
        });
      }
    }

    this.#patchRunMetadata(runId, (metadata) => ({
      ...metadata,
      orchestration: {
        ...(metadata.orchestration ?? {}),
        continuedToRunId: nextLaunch.runId
      }
    }));
    this.runtimeHandle.database.insertEvent(runId, createEvent("run.chain.continued", EVENT_ACTOR.AGENT, "The cowork started the next bounded run automatically.", {
      nextRunId: nextLaunch.runId,
      selectedRecommendationSlot: handoff.output.selectedRecommendationSlot
    }));
    this.emitStateChanged("run.chain.continued", {
      runId,
      nextRunId: nextLaunch.runId
    });
    return {
      ...handoff.output,
      continuedToRunId: nextLaunch.runId
    };
  }

  #missionNeedsCapabilityRecovery(run = null) {
    if (!run || run.metadata?.orchestrationRecovery?.status) {
      return false;
    }
    const verification = run.metadata?.verificationSummary ?? null;
    const failedChecks = Array.isArray(verification?.checks)
      ? verification.checks.filter((check) => check.status !== "pass")
      : [];
    const failedText = [
      run.lifecycleStage,
      run.summary,
      verification?.overallStatus,
      ...failedChecks.map((check) => check.label)
    ].map(compactConversationMessage).join(" ").toLowerCase();
    return run.status === RUN_STATUS.FAILED
      && (
        run.lifecycleStage === "failed_incomplete_deliverable"
        || verification?.overallStatus === "fail"
      )
      && /\b(result|résultat|resultat|extract|extrait|livrable|deliverable|list|liste|row|ligne|profile|profil|job|poste|item|élément|element)\b/.test(failedText);
  }

  async #maybeRecoverIncompleteMission(runId) {
    const failedRun = this.runtimeHandle.database.getRun(runId);
    if (!this.#missionNeedsCapabilityRecovery(failedRun)) {
      return null;
    }

    const verification = failedRun.metadata?.verificationSummary ?? null;
    const failedChecks = (verification?.checks ?? [])
      .filter((check) => check.status !== "pass")
      .map((check) => check.label);
    const missionSpec = failedRun.metadata?.missionSpec ?? {};
    const mission = compactConversationMessage([
      missionSpec.objective,
      missionSpec.deliverable,
      failedRun.mission
    ].filter(Boolean).join(" "));
    const desiredOutcome = compactConversationMessage([
      missionSpec.deliverable,
      ...(verification?.requestedOutcomes ?? [])
    ].filter(Boolean).join(" "));
    const failureContext = {
      status: failedRun.status,
      outcomeStatus: verification?.overallStatus ?? failedRun.status,
      summary: failedRun.summary,
      reason: failedRun.lifecycleStage,
      failedChecks
    };

    this.#patchRunMetadata(runId, (metadata) => ({
      ...metadata,
      orchestrationRecovery: {
        status: "building_candidate",
        startedAt: nowIso(),
        failureContext
      }
    }));
    this.runtimeHandle.database.insertEvent(runId, createEvent("run.recovery.started", EVENT_ACTOR.AGENT, "JON detected an incomplete deliverable and started capability recovery.", {
      lifecycleStage: failedRun.lifecycleStage,
      failedChecks
    }));

    const created = await this.createCapabilityCandidate({
      mission,
      desiredOutcome,
      failureContext,
      registerDraftSkill: true
    });
    if (!created.created || !created.candidate) {
      this.#patchRunMetadata(runId, (metadata) => ({
        ...metadata,
        orchestrationRecovery: {
          ...(metadata.orchestrationRecovery ?? {}),
          status: "not_needed",
          completedAt: nowIso(),
          reason: created.reason ?? "existing_capability_selected"
        }
      }));
      return created;
    }

    this.runtimeHandle.database.insertEvent(runId, createEvent("run.recovery.candidate_created", EVENT_ACTOR.AGENT, "JON created a bounded candidate capability for the missing deliverable.", {
      candidateId: created.candidate.id,
      skillId: created.candidate.skillId,
      artifactKind: created.candidate.artifactKind
    }));
    const validated = await this.validateCapabilityCandidate(created.candidate.id);
    this.runtimeHandle.database.insertEvent(runId, createEvent("run.recovery.candidate_validated", EVENT_ACTOR.AGENT, "JON validated the candidate capability on fixture harness.", {
      candidateId: created.candidate.id,
      validationStatus: validated.validation.status,
      checkCount: validated.validation.checks.length
    }));

    let enabled = null;
    if (validated.validation.status === "pass") {
      enabled = await this.enableCapabilityCandidate(created.candidate.id, {
        approvedBy: "jon_fixture_harness",
        rationale: "Read-only declarative adapter auto-enabled after fixture harness passed for incomplete-deliverable recovery."
      });
      this.runtimeHandle.database.insertEvent(runId, createEvent("run.recovery.candidate_enabled", EVENT_ACTOR.AGENT, "JON enabled the validated read-only candidate capability for retry planning.", {
        candidateId: created.candidate.id,
        skillId: created.candidate.skillId
      }));
    }

    const recovery = {
      status: enabled ? "ready_for_retry" : "validation_failed",
      candidateId: created.candidate.id,
      skillId: created.candidate.skillId,
      artifactKind: created.candidate.artifactKind,
      validationStatus: validated.validation.status,
      enabled: Boolean(enabled),
      completedAt: nowIso(),
      retryPlan: enabled ? {
        type: "browser_structured_extraction_retry",
        action: "extract_structured_rows",
        candidateId: created.candidate.id,
        instruction: "Relancer la mission web en utilisant l'adaptateur validé pour extraire les lignes structurées, puis vérifier le nombre de résultats avant succès."
      } : null
    };
    this.#patchRunMetadata(runId, (metadata) => ({
      ...metadata,
      orchestrationRecovery: {
        ...(metadata.orchestrationRecovery ?? {}),
        ...recovery
      }
    }));
    this.recordCapabilityFeedback({
      nodeId: `generated.${created.candidate.id}`,
      skillId: created.candidate.skillId,
      mission,
      projectId: failedRun.projectId,
      runId,
      outcomeStatus: enabled ? "operator_positive" : "operator_negative",
      evidenceCount: validated.validation?.evidence?.sampleRows?.length ?? 0,
      notes: enabled
        ? "Generated capability candidate validated and enabled for retry after incomplete deliverable."
        : "Generated capability candidate failed validation during recovery.",
      metadata: {
        source: "mission_recovery",
        candidateId: created.candidate.id,
        validationStatus: validated.validation.status
      }
    });

    const conversationId = failedRun.metadata?.conversationId ?? failedRun.metadata?.conversation?.id ?? null;
    if (conversationId) {
      const conversation = this.runtimeHandle.database.getConversation(conversationId);
      if (conversation) {
        const message = enabled
          ? `JON a détecté que le livrable n'était pas extrait. J'ai créé et validé une capacité de récupération (${created.candidate.skillId}) et elle est prête pour relancer l'extraction structurée.`
          : `JON a tenté de créer une capacité de récupération, mais le harness de validation a échoué. Je garde l'échec visible au lieu de relancer sans preuve.`;
        this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
          projectId: failedRun.projectId,
          conversationId,
          role: "assistant",
          kind: "turn",
          content: message,
          payload: {
            conversationId,
            intentType: "mission_recovery",
            action: enabled ? "capability_ready_for_retry" : "capability_validation_failed",
            linkedRunId: runId,
            candidateId: created.candidate.id,
            skillId: created.candidate.skillId,
            validationStatus: validated.validation.status,
            uiBlocks: [{
              type: "text",
              tone: enabled ? "info" : "warning",
              title: enabled ? "Capacité de récupération prête" : "Récupération bloquée",
              text: message
            }]
          },
          metadata: {
            generationMode: "post_run_capability_recovery",
            linkedRunId: runId
          }
        }));
        this.runtimeHandle.database.updateConversation(conversationId, {
          metadata: {
            ...(conversation.metadata ?? {}),
            latestRecovery: recovery,
            linkedCapabilityCandidateIds: Array.from(new Set([
              ...(Array.isArray(conversation.metadata?.linkedCapabilityCandidateIds) ? conversation.metadata.linkedCapabilityCandidateIds : []),
              created.candidate.id
            ]))
          },
          updatedAt: nowIso()
        });
      }
    }

    this.emitStateChanged("run.recovery.completed", {
      runId,
      candidateId: created.candidate.id,
      status: recovery.status
    });
    return {
      created,
      validated,
      enabled,
      recovery
    };
  }

  async #maybePostDegradedModePrompt(runId) {
    const run = this.runtimeHandle.database.getRun(runId);
    if (!run) return;
    if (run.metadata?.degradedModeNoticePostedAt) return;

    const degradedEvents = this.runtimeHandle.database.listEvents(runId)
      .filter((event) => event.type === "llm.degraded_mode.activated" || event.type === "llm.call.fallback_used");
    if (degradedEvents.length === 0) return;

    const conversationId = run.metadata?.conversationId ?? run.metadata?.conversation?.id ?? null;
    const conversation = conversationId ? this.runtimeHandle.database.getConversation(conversationId) : null;
    if (!conversation) return;

    const strategies = Array.from(new Set(degradedEvents.map((event) =>
      compactConversationMessage(event.payload?.strategy ?? event.payload?.callType ?? event.summary ?? "")
    ).filter(Boolean))).slice(0, 3);
    const strategyText = strategies.length > 0 ? ` (${strategies.join(", ")})` : "";
    const degradedMessage = `Mode dégradé: une étape IA est passée sur un fallback déterministe${strategyText}. Je limite donc le résultat à ce qui est vérifié et je signale les parties non couvertes.`;

    this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
      projectId: run.projectId,
      conversationId: conversation.id,
      role: "assistant",
      kind: "turn",
      content: degradedMessage,
      payload: {
        conversationId: conversation.id,
        intentType: "degraded_mode_notice",
        action: "disclose_degraded_mode",
        uiBlocks: [{
          type: "text",
          tone: "warning",
          title: "Mode dégradé",
          text: degradedMessage
        }],
        linkedRunId: runId,
        degradedEventCount: degradedEvents.length,
        strategies
      },
      metadata: {
        generationMode: "post_run_degraded_notice",
        linkedRunId: runId
      }
    }));
    this.#patchRunMetadata(runId, (metadata) => ({
      ...metadata,
      degradedModeNoticePostedAt: nowIso()
    }));
    this.mobileEventBuffer?.pushRaw("jon.degraded_mode", {
      projectId: run.projectId,
      message: degradedMessage,
      runId
    });
    this.emitStateChanged("conversation.degraded_mode.posted", {
      projectId: run.projectId,
      conversationId: conversation.id,
      runId
    });
  }

  async #maybePostAuthPrompt(runId) {
    const run = this.runtimeHandle.database.getRun(runId);
    if (!run) return;
    if (run.status !== RUN_STATUS.COMPLETED) return;

    const computerActionType = run.metadata?.computerActionType ?? "";
    const isBrowserLaunchRun = ["launch_browser", "launch_browser_search"].includes(computerActionType);
    if (!isBrowserLaunchRun) return;

    const unsupportedRequests = run.metadata?.missionUnderstanding?.unsupportedRequests
      ?? run.metadata?.plan?.missionUnderstanding?.unsupportedRequests
      ?? [];
    const authBlockers = String(unsupportedRequests.join(" ") + " " + (run.summary ?? "")).toLowerCase();
    const needsAuth = /auth|connect|login|log.?in|credential|sign.?in|compte|identifi|session/.test(authBlockers);
    if (!needsAuth) return;

    const conversationId = run.metadata?.conversationId ?? run.metadata?.conversation?.id ?? null;
    const conversation = conversationId ? this.runtimeHandle.database.getConversation(conversationId) : null;
    if (!conversation) return;

    const browserLabel = run.metadata?.selectedBrowser?.label ?? "le navigateur";
    const mission = run.metadata?.missionSpec?.objective ?? run.mission ?? "";
    const authMessage = `${browserLabel} est ouvert. Pour continuer cette mission${mission ? ` ("${mission.slice(0, 80)}")` : ""}, tu dois te connecter manuellement dans le navigateur. Une fois connecté, réponds-moi "c'est fait" et je continuerai automatiquement.`;

    this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
      projectId: run.projectId,
      conversationId: conversation.id,
      role: "assistant",
      kind: "turn",
      content: authMessage,
      payload: {
        conversationId: conversation.id,
        intentType: "auth_prompt",
        action: "waiting_for_user_auth",
        uiBlocks: [{
          type: "text",
          tone: "info",
          title: "Connexion requise",
          text: authMessage
        }],
        linkedRunId: runId,
        awaitingAuthConfirmation: true
      },
      metadata: {
        generationMode: "post_run_auth_prompt",
        linkedRunId: runId
      }
    }));
    this.mobileEventBuffer?.pushRaw("jon.needs_user", {
      projectId: run.projectId,
      message: authMessage,
      runId
    });
    this.emitStateChanged("conversation.auth_prompt.posted", {
      projectId: run.projectId,
      conversationId: conversation.id,
      runId
    });
  }

  #patchRunMetadata(runId, updater) {
    const existingRun = this.runtimeHandle.database.getRun(runId);
    if (!existingRun) {
      return null;
    }
    const nextMetadata = updater(existingRun.metadata ?? {});
    this.runtimeHandle.database.updateRun(runId, {
      status: existingRun.status,
      lifecycleStage: existingRun.lifecycleStage,
      plan: existingRun.plan,
      summary: existingRun.summary,
      metadata: nextMetadata,
      updatedAt: nowIso()
    });
    return this.runtimeHandle.database.getRun(runId);
  }

  emitStateChanged(type, payload = {}) {
    this.emit("state.changed", {
      id: `state-${Date.now()}`,
      type,
      payload,
      createdAt: nowIso()
    });
    try {
      this.mobileEventBuffer?.pushRaw(type, payload);
    } catch {
      // never let mobile event emission crash the main event loop
    }
  }

  async #removeFileSet(paths) {
    for (const filePath of safeDeletionPaths(paths)) {
      await removePathIfExists(filePath, { recursive: false });
    }
  }

  #assertRunNotActive(runId) {
    if (this.activeRuns.has(runId)) {
      throw new Error("Cannot delete an active run.");
    }
  }
}
