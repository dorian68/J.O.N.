import fs from "node:fs/promises";
import path from "node:path";
import { BrowserOperator } from "../browser/browser-operator.js";
import { BrowserController } from "../browser/browser-controller.js";
import {
  auditMissionPlan,
  auditMissionExecution,
  auditBrowserMission,
  auditRunStatusChange,
  auditStepFailure
} from "../observability/audit-logger.js";
import { MissionProgressTracker } from "./mission-progress-tracker.js";
import { SemanticOutcomeVerifier } from "./semantic-outcome-verifier.js";
import {
  APPROVAL_CATEGORY,
  APPROVAL_DECISION,
  EVIDENCE_TYPE,
  EVENT_ACTOR,
  LLM_CALL_TYPE,
  LLM_MODEL_ALIAS,
  REASONING_STAGE,
  RUN_STATUS
} from "../config.js";
import { buildCollectionTable, buildDecisionNote } from "../artifacts/builders.js";
import {
  buildDeterministicDecisionDraftOutput,
  buildDeterministicMissionUnderstandingOutput,
  buildDeterministicPlanOutput,
  buildDeterministicFallbackOutput,
  buildDeterministicWindowDescriptionOutput
} from "../llm/deterministic-fallbacks.js";
import { validateMissionUnderstandingOutput } from "../mission/mission-understanding.js";
import { buildDeterministicDesktopPlan, validateDesktopPlanOutput } from "../mission/desktop-plan.js";
import { reconcileRunHandoffDecision, validateRunHandoffDecisionOutput } from "../mission/run-handoff-decision.js";
import { prepareRuntimeReasoningPayload, selectPreferredModelAlias } from "../llm/token-governance.js";
import { normalizePlanOutput } from "../llm/structured-output-normalizers.js";
import { createEvent } from "./events.js";
import { createId, nowIso } from "../utils/ids.js";
import { sanitizeFilename, writeText } from "../utils/files.js";
import { buildDeterministicAmbiguityOutput, buildDeterministicEvaluationOutput } from "../reasoning/evaluator.js";
import { createDefaultContextualReasoningEngine } from "../reasoning/contextual-reasoning-engine.js";
import { buildRunReviewModel } from "../service/run-review-model.js";
import { compactAccessibilityForPrompt } from "../computer/desktop-perception.js";
import { buildRecoveryAttempt, checkpointRecord } from "../computer/desktop-recovery.js";
import { buildDesktopRecoveryPlan } from "../computer/desktop-recovery-planner.js";
import {
  appendDesktopObservation,
  createDesktopObservationTimeline,
  summarizeDesktopObservationTimeline
} from "../computer/desktop-observation-timeline.js";
import {
  DESKTOP_AUTONOMY_MEMORY_SETTING_KEY,
  defaultDesktopAutonomyMemory,
  normalizeDesktopAutonomyMemory,
  summarizeDesktopAutonomyMemory,
  updateDesktopAutonomyMemory
} from "../computer/desktop-memory.js";
import {
  defaultProjectMemory,
  harvestProjectRunMemoryRecords,
  normalizeProjectMemory,
  projectMemorySettingKey,
  summarizeProjectMemory,
  updateProjectMemoryFromRun
} from "../memory/project-memory.js";
import {
  USER_MEMORY_SETTING_KEY,
  defaultUserMemory,
  extractUserMemoryRecordsFromRun,
  normalizeUserMemory,
  summarizeUserMemory,
  updateUserMemoryFromRun
} from "../memory/user-memory.js";
import {
  buildDesktopReplanContext,
  selectDesktopReplanContinuation
} from "../computer/desktop-replanner.js";
import { DesktopRunWatcher } from "../computer/desktop-run-watcher.js";
import { buildDesktopUserFacingError } from "../computer/desktop-user-facing.js";
import { assessDesktopStep, desktopSandboxSummary } from "../computer/desktop-safety.js";
import { buildDesktopSkillCatalog, graphSkillIdForDesktopSkill, skillForStep } from "../computer/desktop-skills.js";
import {
  AGENT_CONFIG_SETTING_KEY,
  defaultAgentConfiguration,
  normalizeAgentConfiguration
} from "../conversation/agent-config.js";
import {
  applyCapabilityOverrides,
  buildCapabilityGraph,
  capabilityNodeId,
  compactCapabilityGraphForPrompt
} from "../capabilities/capability-graph.js";
import {
  recordCapabilityRunOutcome,
  selectEnabledCapabilityForMission
} from "../capabilities/capability-candidate-workspace.js";

const PRIMARY_REASONING_PROMPT = Object.freeze({
  promptId: "system.primary_reasoning",
  version: "1.0.0"
});
const RUN_HANDOFF_DECISION_TIMEOUT_MS = 4_000;
const MAX_DYNAMIC_DESKTOP_REPLANS = 2;

function semanticSelectorForDesktopStep(step = {}) {
  const query = String(step.target?.semanticTarget ?? step.input?.semanticTarget ?? "").trim();
  if (!query) {
    return null;
  }
  return {
    query,
    role: String(step.target?.role ?? step.input?.role ?? "").trim() || null,
    automationId: String(step.target?.automationId ?? step.input?.automationId ?? "").trim() || null
  };
}

function assertStructuredStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an array.`), {
      category: "malformed_output"
    });
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function validatePlanOutput(output) {
  return normalizePlanOutput(output);
}

function validateDecisionDraft(output) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Decision note draft output must be an object."), {
      category: "malformed_output"
    });
  }
  const recommendation = String(output.recommendation ?? "").trim();
  if (!recommendation) {
    throw Object.assign(new Error("Decision note draft must contain a recommendation."), {
      category: "malformed_output"
    });
  }
  const overallConfidence = String(output.overallConfidence ?? "").trim().toLowerCase();
  if (!["low", "medium", "high"].includes(overallConfidence)) {
    throw Object.assign(new Error("Decision note draft must contain a valid overall confidence."), {
      category: "malformed_output"
    });
  }
  const validationState = String(output.validationState ?? "").trim();
  if (!validationState) {
    throw Object.assign(new Error("Decision note draft must contain a validation state."), {
      category: "malformed_output"
    });
  }
  return {
    recommendation,
    keyFindings: assertStructuredStringArray(output.keyFindings ?? [], "keyFindings"),
    uncertainties: assertStructuredStringArray(output.uncertainties ?? [], "uncertainties"),
    overallConfidence,
    validationState
  };
}

function validateEvaluationSupport(output) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Evaluation support output must be an object."), {
      category: "malformed_output"
    });
  }
  const qualityVerdict = String(output.qualityVerdict ?? "").trim();
  const recommendedValidationState = String(output.recommendedValidationState ?? "").trim();
  const ambiguitySummary = String(output.ambiguitySummary ?? "").trim();
  if (!qualityVerdict || !recommendedValidationState || !ambiguitySummary) {
    throw Object.assign(new Error("Evaluation support output is missing required fields."), {
      category: "malformed_output"
    });
  }
  return {
    qualityVerdict,
    riskFlags: assertStructuredStringArray(output.riskFlags ?? [], "riskFlags"),
    missingProof: assertStructuredStringArray(output.missingProof ?? [], "missingProof"),
    recommendedValidationState,
    ambiguityDetected: Boolean(output.ambiguityDetected),
    ambiguitySummary
  };
}

function validateAmbiguityNote(output) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Ambiguity note output must be an object."), {
      category: "malformed_output"
    });
  }
  const ambiguityNote = String(output.ambiguityNote ?? "").trim();
  if (!ambiguityNote) {
    throw Object.assign(new Error("Ambiguity note output must contain ambiguityNote."), {
      category: "malformed_output"
    });
  }
  return {
    ambiguityNote,
    uncertaintyPoints: assertStructuredStringArray(output.uncertaintyPoints ?? [], "uncertaintyPoints")
  };
}

function validateWindowDescriptionOutput(output) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Window description output must be an object."), {
      category: "malformed_output"
    });
  }
  const description = String(output.description ?? "").trim();
  if (!description) {
    throw Object.assign(new Error("Window description output must contain description."), {
      category: "malformed_output"
    });
  }
  const pageType = String(output.pageType ?? "unknown").trim() || "unknown";
  const allowedPageTypes = new Set(["browser_page", "desktop_app", "dialog", "terminal", "file_manager", "unknown"]);
  return {
    description,
    keyElements: assertStructuredStringArray(output.keyElements ?? [], "keyElements").slice(0, 12),
    pageType: allowedPageTypes.has(pageType) ? pageType : "unknown"
  };
}

function shouldUseDeterministicFallback(error) {
  return [
    "auth_error",
    "budget_exhausted",
    "circuit_open",
    "malformed_output",
    "provider_unavailable",
    "rate_limit",
    "stage_suppressed",
    "timeout"
  ].includes(error?.category);
}

function createStageTimeoutError(stage, timeoutMs) {
  return Object.assign(new Error(`Timed out while waiting for ${stage} after ${timeoutMs}ms.`), {
    category: "timeout"
  });
}

function mergeResearchTargetValues({ extractedValues = {}, staticValues = {}, fallbackTitle = "" }) {
  return {
    companyName: String(extractedValues.companyName ?? staticValues.companyName ?? fallbackTitle).trim() || fallbackTitle,
    tagline: String(extractedValues.tagline ?? staticValues.tagline ?? "").trim(),
    priceLevel: String(extractedValues.priceLevel ?? staticValues.priceLevel ?? "not_applicable").trim(),
    deliverySpeed: String(extractedValues.deliverySpeed ?? staticValues.deliverySpeed ?? "not_applicable").trim(),
    riskNote: String(extractedValues.riskNote ?? staticValues.riskNote ?? "").trim()
  };
}

function describeResearchSource(trustClassification) {
  return trustClassification === "allowlisted_real_web" ? "allowlisted real-web" : "controlled";
}

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractRequestedBrowserResultCount(run, desktopAction = {}) {
  const direct = parsePositiveInteger(run.metadata?.missionSpec?.parameters?.browserLaunch?.resultCount);
  if (direct) {
    return direct;
  }
  const text = [
    run.metadata?.missionSpec?.objective,
    run.metadata?.missionSpec?.deliverable,
    run.mission,
    desktopAction.searchQuery
  ].map((entry) => String(entry ?? "")).join(" ");
  const resultNouns = "(postes?|jobs?|offres?|missions?|results?|r[eé]sultats?|items?|[eé]l[eé]ments?|articles?|posts?|publications?|products?|produits?|profiles?|profils?|documents?|fichiers?|tickets?|issues?|messages?)";
  const countBeforeTarget = text.match(new RegExp(`\\b(\\d{1,2})\\b[\\s\\S]{0,80}\\b${resultNouns}\\b`, "i"));
  if (countBeforeTarget?.[1]) {
    return parsePositiveInteger(countBeforeTarget[1]);
  }
  const actionBeforeCount = text.match(/\b(list(?:er)?|liste|lister|show|find|trouve|chercher|cherche)\b[\s\S]{0,80}\b(\d{1,2})\b/i);
  if (actionBeforeCount?.[2]) {
    return parsePositiveInteger(actionBeforeCount[2]);
  }
  return null;
}

function countExtractedBrowserResults(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    for (const key of ["results", "items", "extractedResults", "listings", "jobs"]) {
      if (Array.isArray(source[key])) {
        return source[key].length;
      }
    }
  }
  return 0;
}

function verificationCheck(label, passed, details = {}) {
  return {
    label,
    status: passed ? "pass" : "fail",
    details
  };
}

export class PrototypeAgent {
  constructor({
    database,
    browserController,
    computerControlService,
    policyEngine,
    llmGateway,
    reasoningEngine = createDefaultContextualReasoningEngine(),
    workspaceLauncher = null,
    browserLauncher = null
  }) {
    this.database = database;
    this.browser = browserController;
    this.computer = computerControlService;
    this.policy = policyEngine;
    this.llmGateway = llmGateway;
    this.reasoning = reasoningEngine;
    this.workspaceLauncher = workspaceLauncher;
    this.browserLauncher = browserLauncher;
    this.surfaceLocks = new Map();
  }

  #surfaceLockLabel(lockName) {
    if (lockName === "browser") {
      return "browser surface";
    }
    if (lockName === "desktop") {
      return "desktop surface";
    }
    return `${lockName} surface`;
  }

  async #withSurfaceLock(lockName, run, operation) {
    if (!lockName) {
      return operation();
    }

    const previous = this.surfaceLocks.get(lockName) ?? Promise.resolve();
    const queued = this.surfaceLocks.has(lockName);
    let release = () => {};
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const queueTail = previous.catch(() => {}).then(() => current);
    this.surfaceLocks.set(lockName, queueTail);

    try {
      if (queued) {
        const label = this.#surfaceLockLabel(lockName);
        await this.#updateRun(run.id, {
          status: RUN_STATUS.PAUSED,
          lifecycleStage: "queued_surface_lock",
          summary: `Queued waiting for ${label}.`
        });
        this.#recordEvent(run.id, createEvent("run.queued", EVENT_ACTOR.SYSTEM, `Run queued waiting for ${label}.`, {
          lockName
        }));
      }

      await previous.catch(() => {});

      if (queued) {
        const label = this.#surfaceLockLabel(lockName);
        this.#recordEvent(run.id, createEvent("run.dequeued", EVENT_ACTOR.SYSTEM, `Run acquired ${label}.`, {
          lockName
        }));
      }

      return await operation();
    } finally {
      release();
      if (this.surfaceLocks.get(lockName) === queueTail) {
        this.surfaceLocks.delete(lockName);
      }
    }
  }

  #surfaceLockForComputerAction(desktopAction = null) {
    return desktopAction?.type === "browser_autonomy" ? "browser" : "desktop";
  }

  #getAgentConfiguration() {
    const setting = this.database.getAppSetting?.(
      AGENT_CONFIG_SETTING_KEY,
      defaultAgentConfiguration()
    );
    return normalizeAgentConfiguration({
      ...(setting?.value ?? defaultAgentConfiguration()),
      updatedAt: setting?.updatedAt ?? setting?.value?.updatedAt ?? null
    });
  }

  #desktopSandboxSummary() {
    return desktopSandboxSummary(this.#getAgentConfiguration());
  }

  #getDesktopAutonomyMemory() {
    const setting = this.database.getAppSetting?.(
      DESKTOP_AUTONOMY_MEMORY_SETTING_KEY,
      defaultDesktopAutonomyMemory()
    );
    return normalizeDesktopAutonomyMemory(setting?.value ?? defaultDesktopAutonomyMemory());
  }

  #saveDesktopAutonomyMemory(memory) {
    this.database.upsertAppSetting?.(
      DESKTOP_AUTONOMY_MEMORY_SETTING_KEY,
      normalizeDesktopAutonomyMemory(memory)
    );
  }

  #getProjectMemory(projectId) {
    if (!projectId) {
      return defaultProjectMemory(null);
    }
    const fallback = defaultProjectMemory(projectId);
    const setting = this.database.getAppSetting?.(
      projectMemorySettingKey(projectId),
      fallback
    );
    return normalizeProjectMemory(setting?.value ?? fallback, projectId);
  }

  #getProjectMemorySummary(projectId) {
    if (!projectId) {
      return summarizeProjectMemory(defaultProjectMemory(null));
    }
    return summarizeProjectMemory(this.#getProjectMemory(projectId));
  }

  #saveProjectMemory(projectId, memory) {
    if (!projectId) {
      return;
    }
    this.database.upsertAppSetting?.(
      projectMemorySettingKey(projectId),
      normalizeProjectMemory(memory, projectId)
    );
  }

  #recordProjectMemoryFromRun(run) {
    if (!run?.projectId) {
      return null;
    }
    const current = this.#getProjectMemory(run.projectId);
    const updated = updateProjectMemoryFromRun(current, run);
    if (updated !== current) {
      this.#saveProjectMemory(run.projectId, updated);
    }
    for (const record of harvestProjectRunMemoryRecords(run)) {
      try {
        this.database.insertMemoryRecord?.(record);
      } catch {
        // skip duplicate records silently
      }
    }
    const selectedCapabilityId = run.metadata?.selectedCapabilityId ?? null;
    if (selectedCapabilityId) {
      try {
        recordCapabilityRunOutcome(this.database, selectedCapabilityId, {
          runId: run.id,
          projectId: run.projectId ?? null,
          mission: run.mission ?? null,
          outcomeStatus: run.status === "completed" ? "completed" : "failed",
          approvalCount: 0,
          evidenceCount: 0
        });
      } catch {
        // non-blocking
      }
    }
    return updated;
  }

  #getUserMemory() {
    const setting = this.database.getAppSetting?.(
      USER_MEMORY_SETTING_KEY,
      defaultUserMemory()
    );
    return normalizeUserMemory(setting?.value ?? defaultUserMemory());
  }

  #getUserMemorySummary() {
    return summarizeUserMemory(this.#getUserMemory());
  }

  #saveUserMemory(memory) {
    this.database.upsertAppSetting?.(
      USER_MEMORY_SETTING_KEY,
      normalizeUserMemory(memory)
    );
  }

  #recordUserMemoryFromRun(run) {
    const current = this.#getUserMemory();
    const updated = updateUserMemoryFromRun(current, run);
    if (updated !== current) {
      this.#saveUserMemory(updated);
    }
    for (const record of extractUserMemoryRecordsFromRun(run)) {
      const createdAt = nowIso();
      this.database.insertMemoryRecord?.({
        id: createId("mem"),
        ...record,
        createdAt,
        updatedAt: createdAt
      });
    }
    return updated;
  }

  createProject({ name, description = "", allowlistedDomains }) {
    const project = {
      id: createId("prj"),
      name,
      description,
      allowlistedDomains,
      createdAt: nowIso()
    };
    this.database.insertProject(project);
    return project;
  }

  async getRunBundle(runId) {
    const run = this.database.getRun(runId);
    if (!run) {
      return null;
    }
    return {
      run,
      events: this.database.listEvents(runId),
      approvals: this.database.listApprovals(runId),
      sources: this.database.listSources(runId),
      evidence: this.database.listEvidence(runId),
      artifacts: this.database.listArtifacts(runId),
      llmCalls: this.database.listLlmCalls(runId),
      reasoningSnapshots: this.database.listReasoningContextSnapshots(runId)
    };
  }

  async decideRunHandoff({ runId, chainContext = {} }) {
    const bundle = await this.getRunBundle(runId);
    if (!bundle) {
      throw new Error(`Run not found: ${runId}`);
    }
    const runReview = buildRunReviewModel(bundle, []);
    const run = runReview.run;
    const project = this.#requireProject(run.projectId);
    const availableBrowsers = await this.#listAvailableBrowsers();
    const input = {
      originalMission: run.metadata?.orchestration?.rootMission ?? run.mission,
      currentRunMission: run.mission,
      outcomeSummary: runReview.review?.outcomeSummary ?? null,
      chainContext: {
        chainId: chainContext.chainId ?? run.metadata?.orchestration?.chainId ?? null,
        runIndex: chainContext.runIndex ?? run.metadata?.orchestration?.runIndex ?? 1,
        maxAutoRuns: chainContext.maxAutoRuns ?? run.metadata?.orchestration?.maxAutoRuns ?? 1,
        priorRuns: chainContext.priorRuns ?? []
      },
      availableBrowsers
    };
    const metadata = {
      chainId: input.chainContext.chainId,
      runIndex: input.chainContext.runIndex,
      maxAutoRuns: input.chainContext.maxAutoRuns
    };

    let llmResult;
    try {
      llmResult = await Promise.race([
        this.#invokeReasonedLlm({
          run,
          project,
          reasoningStage: REASONING_STAGE.RUN_HANDOFF_DECISION,
          callType: LLM_CALL_TYPE.RUN_HANDOFF_DECISION,
          taskPromptId: "task.run_handoff_decision",
          bindings: {
            originalMission: input.originalMission,
            currentRunMission: input.currentRunMission,
            outcomeSummary: JSON.stringify(input.outcomeSummary ?? null),
            chainContext: JSON.stringify(input.chainContext ?? {}),
            availableBrowsers: JSON.stringify(availableBrowsers ?? [])
          },
          input,
          metadata,
          validateOutput: validateRunHandoffDecisionOutput
        }),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(createStageTimeoutError(REASONING_STAGE.RUN_HANDOFF_DECISION, RUN_HANDOFF_DECISION_TIMEOUT_MS));
          }, RUN_HANDOFF_DECISION_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const degradedSnapshot = error.reasoningSnapshot ?? await this.#createReasoningSnapshot({
        run,
        project,
        stage: REASONING_STAGE.RUN_HANDOFF_DECISION,
        inputs: input
      });
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "Run handoff decision degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.RUN_HANDOFF_DECISION,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_run_handoff_fallback",
        contextSnapshotId: degradedSnapshot.id
      }));
      llmResult = {
        output: buildDeterministicFallbackOutput(LLM_CALL_TYPE.RUN_HANDOFF_DECISION, input),
        callRecord: null,
        reasoningSnapshot: degradedSnapshot
      };
    }

    llmResult.output = reconcileRunHandoffDecision(llmResult.output, input);

    this.#recordEvent(run.id, createEvent("run.handoff_decided", EVENT_ACTOR.AGENT, "Run handoff decision completed.", {
      llmCallId: llmResult.callRecord?.id ?? null,
      decision: llmResult.output.decision,
      selectedRecommendationSlot: llmResult.output.selectedRecommendationSlot,
      contextSnapshotId: llmResult.reasoningSnapshot?.id ?? null
    }));

    return {
      ...llmResult,
      generationMode: llmResult.callRecord ? "llm" : "deterministic_fallback"
    };
  }

  getLlmGatewayStatus() {
    return this.llmGateway?.getStatus() ?? {
      providerMode: "disabled",
      providerOrder: [],
      availableProviders: [],
      promptEnvironment: null
    };
  }

  #getBrowserVisionPolicy() {
    const configured = this.getLlmGatewayStatus().vision ?? {};
    return {
      enabled: configured.enabled !== false,
      maxFramesPerRun: Number.isFinite(Number(configured.maxFramesPerRun))
        ? Number(configured.maxFramesPerRun)
        : 4,
      screenshotWidth: Number.isFinite(Number(configured.screenshotWidth))
        ? Number(configured.screenshotWidth)
        : 480,
      defaultDetail: ["auto", "low", "high"].includes(configured.defaultDetail)
        ? configured.defaultDetail
        : "low",
      interactionDetail: ["auto", "low", "high"].includes(configured.interactionDetail)
        ? configured.interactionDetail
        : "high",
      blockerDetail: ["auto", "low", "high"].includes(configured.blockerDetail)
        ? configured.blockerDetail
        : "high"
    };
  }

  async #listAvailableBrowsers() {
    try {
      const browsers = await this.computer.listInstalledBrowsers();
      return Array.isArray(browsers) ? browsers : [];
    } catch {
      return [];
    }
  }

  async #listInstalledApplications() {
    try {
      const applications = await this.computer.listInstalledApplications();
      return Array.isArray(applications) ? applications : [];
    } catch {
      return [];
    }
  }

  async previewMissionPreflight({
    projectId,
    missionDraft,
    preferredScenarioType = null
  }) {
    const project = this.#requireProject(projectId);
    const availableBrowsers = await this.#listAvailableBrowsers();
    const previewRun = this.#buildMissionPreviewRun(project, missionDraft, preferredScenarioType);
    const understanding = await this.#previewMissionUnderstanding({
      run: previewRun,
      project,
      scenarioType: preferredScenarioType,
      missionDraft,
      availableBrowsers
    });

    return {
      preflightId: createId("preflight"),
      understanding: understanding.output,
      generationMode: understanding.generationMode,
      reasoningStage: REASONING_STAGE.MISSION_UNDERSTANDING,
      reasoningPreview: understanding.reasoningSnapshot?.preview ?? null,
      promptRefs: understanding.callRecord?.promptRefs ?? [
        PRIMARY_REASONING_PROMPT,
        {
          promptId: "task.mission_understanding",
          version: "1.0.0"
        }
      ],
      llm: understanding.callRecord ? {
        providerAlias: understanding.callRecord.providerAlias,
        modelAlias: understanding.callRecord.modelAlias,
        providerModel: understanding.callRecord.providerModel
      } : {
        providerAlias: "deterministic_fallback",
        modelAlias: null,
        providerModel: null
      },
      generatedAt: nowIso()
    };
  }

  #buildMissionPreviewRun(project, missionDraft, preferredScenarioType) {
    return {
      id: createId("pf"),
      projectId: project.id,
      mission: this.#composeMissionPreviewText(missionDraft),
      status: RUN_STATUS.CREATED,
      lifecycleStage: "preflight",
      summary: "Mission preflight prepared.",
      metadata: {
        type: preferredScenarioType ?? null,
        missionDraft
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  async startResearchMission(input) {
    const project = this.#requireProject(input.projectId);
    const run = await this.#createRun(project, input.mission, {
      type: "research",
      allowlistedDomains: project.allowlistedDomains,
      sourceTrustClassification: input.sourceTrustClassification ?? (Array.isArray(input.sourceTargets) && input.sourceTargets.length > 0
        ? "allowlisted_real_web"
        : "controlled_fixture"),
      evidenceSensitivity: input.evidenceSensitivity ?? "controlled_fixture",
      entryPoint: input.entryPoint ?? "scenario_catalog",
      requestedScenarioId: input.requestedScenarioId ?? "research",
      missionSpec: input.missionSpec ?? null,
      preflight: input.preflight ?? null,
      orchestration: input.orchestration ?? null
    });
    const runDir = await this.database.ensureRunDir(run.id);
    const completion = this.#withSurfaceLock("browser", run, () => this.#executeResearchMission({
      run,
      runDir,
      project,
      hubUrl: input.hubUrl,
      linkSpecs: input.linkSpecs,
      fieldMap: input.fieldMap,
      sourceTargets: input.sourceTargets,
      sourceTrustClassification: input.sourceTrustClassification,
      evidenceSensitivity: input.evidenceSensitivity
    }));
    return { runId: run.id, completion };
  }

  async runResearchMission(input) {
    const launched = await this.startResearchMission(input);
    return launched.completion;
  }

  async startFormPreparationMission(input) {
    const project = this.#requireProject(input.projectId);
    const run = await this.#createRun(project, input.mission, {
      type: "form_preparation",
      allowlistedDomains: project.allowlistedDomains,
      entryPoint: input.entryPoint ?? "scenario_catalog",
      requestedScenarioId: input.requestedScenarioId ?? "form",
      missionSpec: input.missionSpec ?? null,
      preflight: input.preflight ?? null,
      orchestration: input.orchestration ?? null
    });
    const runDir = await this.database.ensureRunDir(run.id);
    const completion = this.#withSurfaceLock("browser", run, () => this.#executeFormPreparationMission({
      run,
      runDir,
      project,
      formUrl: input.formUrl,
      values: input.values
    }));
    return { runId: run.id, completion };
  }

  async runFormPreparationMission(input) {
    const launched = await this.startFormPreparationMission(input);
    return launched.completion;
  }

  async startComputerObservationScenario(input) {
    const project = this.#requireProject(input.projectId);
    const desktopAction = input.desktopAction ?? null;
    const run = await this.#createRun(project, input.mission, {
      type: "computer_observation",
      computerActionType: desktopAction?.type ?? "observe_window",
      selectedBrowser: desktopAction?.browser ?? null,
      browserLaunchUrl: desktopAction?.url ?? null,
      browserSearchQuery: desktopAction?.searchQuery ?? null,
      surfaceClassification: input.surfaceClassification ?? "controlled_fixture_window",
      evidenceSensitivity: input.evidenceSensitivity ?? "controlled_fixture",
      targetWindowLabel: input.targetWindowLabel ?? input.allowlistedWindowId,
      targetWindowRule: input.targetWindowRule ?? null,
      entryPoint: input.entryPoint ?? "scenario_catalog",
      requestedScenarioId: input.requestedScenarioId ?? "computer",
      missionSpec: input.missionSpec ?? null,
      preflight: input.preflight ?? null,
      orchestration: input.orchestration ?? null
    });
    const runDir = await this.database.ensureRunDir(run.id);
    const launchExecution = () => desktopAction?.type === "desktop_autonomy"
      ? this.#executeDesktopAutonomyScenario({
        run,
        runDir,
        project,
        desktopAction,
        surfaceClassification: input.surfaceClassification ?? "real_local_desktop",
        evidenceSensitivity: input.evidenceSensitivity ?? "real_local_desktop"
      })
      : desktopAction?.type === "browser_autonomy"
      ? this.#executeBrowserAutonomyScenario({
        run,
        runDir,
        project,
        desktopAction,
        surfaceClassification: input.surfaceClassification ?? "real_local_browser",
        evidenceSensitivity: input.evidenceSensitivity ?? "real_local_browser"
      })
      : ["launch_browser", "launch_browser_search"].includes(desktopAction?.type)
      ? this.#executeComputerBrowserLaunchScenario({
        run,
        runDir,
        project,
        desktopAction,
        surfaceClassification: input.surfaceClassification ?? "real_local_browser",
        evidenceSensitivity: input.evidenceSensitivity ?? "real_local_browser"
      })
      : ["capture_browser_window", "capture_active_window"].includes(desktopAction?.type)
        ? this.#executeComputerWindowCaptureScenario({
          run,
          runDir,
          desktopAction,
          surfaceClassification: input.surfaceClassification ?? "real_local_browser",
          evidenceSensitivity: input.evidenceSensitivity ?? "real_local_browser",
          targetWindowLabel: input.targetWindowLabel ?? desktopAction?.browser?.label ?? "active window",
          targetWindowRule: input.targetWindowRule ?? null
        })
      : this.#executeComputerObservationScenario({
        run,
        runDir,
        allowlistedWindowId: input.allowlistedWindowId,
        expectedMatcher: input.expectedMatcher,
        surfaceClassification: input.surfaceClassification,
        evidenceSensitivity: input.evidenceSensitivity,
        targetWindowLabel: input.targetWindowLabel,
        targetWindowRule: input.targetWindowRule
      });
    const completion = this.#withSurfaceLock(
      this.#surfaceLockForComputerAction(desktopAction),
      run,
      launchExecution
    );
    return { runId: run.id, completion };
  }

  async runComputerObservationScenario(input) {
    const launched = await this.startComputerObservationScenario(input);
    return launched.completion;
  }

  async #executeResearchMission({
    run,
    runDir,
    project,
    hubUrl,
    linkSpecs,
    fieldMap,
    sourceTargets = [],
    sourceTrustClassification = "controlled_fixture",
    evidenceSensitivity = "controlled_fixture"
  }) {
    try {
      const planDraft = await this.#generatePlan({
        run,
        project,
        scenarioType: "research"
      });

      await this.#stageRun(run.id, {
        status: RUN_STATUS.PLANNED,
        lifecycleStage: "plan_generated",
        summary: "Plan generated.",
        plan: planDraft.plan
      }, "plan.generated", "Prototype plan generated.");

      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: "Research mission running."
      }, "run.started", "Research mission started.");

      await this.browser.openBrowserSession({
        allowlistedHosts: project.allowlistedDomains
      });
      this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.BROWSER, "Bounded browser session opened.", {
        tool: "open_browser_session",
        sourceTrustClassification,
        allowlistedDomains: project.allowlistedDomains
      }));

      const useRealWebTargets = Array.isArray(sourceTargets) && sourceTargets.length > 0;
      const pageTargets = [];

      if (useRealWebTargets) {
        const initialTargetId = this.browser.focusTab(this.browser.activeTargetId ?? this.browser.listTargets()[0].id);
        for (const [index, target] of sourceTargets.entries()) {
          const targetId = index === 0
            ? initialTargetId
            : await this.browser.openTab();
          this.browser.focusTab(targetId);
          await this.browser.navigate(targetId, target.url);
          await this.browser.waitForPageState(targetId, {
            state: "domcontentloaded",
            selector: target.waitFor ?? Object.values(target.fieldMap ?? {})[0] ?? null
          });
          pageTargets.push({
            targetId,
            title: target.title,
            fieldMap: target.fieldMap ?? {},
            staticValues: target.staticValues ?? {},
            trustClassification: target.trustClassification ?? sourceTrustClassification,
            evidenceSensitivity: target.evidenceSensitivity ?? evidenceSensitivity
          });
        }
      } else {
        const hubTargetId = this.browser.focusTab(this.browser.activeTargetId ?? this.browser.listTargets()[0].id);
        await this.browser.navigate(hubTargetId, hubUrl);
        await this.browser.waitForPageState(hubTargetId, {
          state: "domcontentloaded",
          selector: { testId: "page-title" }
        });

        for (const linkSpec of linkSpecs) {
          const opened = await this.browser.openLinkInNewTab(hubTargetId, { testId: linkSpec.testId });
          pageTargets.push({
            targetId: opened.targetId,
            title: linkSpec.title,
            fieldMap,
            staticValues: {},
            trustClassification: sourceTrustClassification,
            evidenceSensitivity
          });
        }
      }

      this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.BROWSER, "Comparison targets opened.", {
        tool: "open_tab",
        targetCount: pageTargets.length,
        sourceTrustClassification,
        mode: useRealWebTargets ? "allowlisted_real_web" : "controlled_fixture"
      }));

      const records = [];
      const sourceReferences = [];
      const sourceIds = [];
      const evidenceIds = [];

      for (const target of pageTargets) {
        this.browser.focusTab(target.targetId);
        await this.browser.waitForPageState(target.targetId, {
          state: "domcontentloaded",
          selector: Object.values(target.fieldMap ?? {})[0] ?? null
        });

        const meta = await this.browser.getTargetMeta(target.targetId);
        const extractedValues = Object.keys(target.fieldMap ?? {}).length > 0
          ? await this.browser.extractTextMap(target.targetId, target.fieldMap)
          : {};
        const values = mergeResearchTargetValues({
          extractedValues,
          staticValues: target.staticValues ?? {},
          fallbackTitle: target.title
        });
        const evidence = await this.browser.exportPageEvidence(
          target.targetId,
          path.join(runDir, "evidence"),
          sanitizeFilename(target.title),
          {
            logicalTitle: target.title,
            trustClassification: target.trustClassification,
            evidenceSensitivity: target.evidenceSensitivity
          }
        );

        const source = {
          id: createId("src"),
          title: values.companyName,
          canonicalRef: meta.url,
          trustClassification: target.trustClassification,
          metadata: {
            title: meta.title,
            sourceSurfaceType: target.trustClassification
          },
          createdAt: nowIso()
        };
        this.database.insertSource(run.id, source);
        sourceReferences.push(source);
        sourceIds.push(source.id);

        const evidenceRecord = {
          id: evidence.evidenceId,
          evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
          label: `${values.companyName} evidence`,
          storagePath: evidence.summaryPath,
          linkedSurface: meta.url,
          linkedEventId: null,
          linkedSourceId: source.id,
          sensitivity: target.evidenceSensitivity,
          metadata: {
            screenshotPath: evidence.screenshotPath,
            snapshotTitle: evidence.snapshot.title,
            sourceSurfaceType: target.trustClassification,
            browserState: evidence.browserState
          },
          createdAt: nowIso()
        };
        this.database.insertEvidence(run.id, evidenceRecord);
        evidenceIds.push(evidenceRecord.id);

        records.push({
          sourceId: source.id,
          sourceTitle: values.companyName,
          sourceReference: source.canonicalRef,
          fact: values.tagline,
          confidence: "medium",
          note: values.riskNote,
          evidenceId: evidence.evidenceId,
          evidenceLabel: `${values.companyName} evidence`,
          evidenceReference: `${values.companyName} evidence (${evidence.evidenceId}) :: ${evidence.summaryPath}`,
          priceLevel: values.priceLevel,
          deliverySpeed: values.deliverySpeed,
          riskNote: values.riskNote,
          tagline: values.tagline
        });

        this.#recordEvent(run.id, createEvent("source.recorded", EVENT_ACTOR.BROWSER, `Collected ${describeResearchSource(target.trustClassification)} source ${values.companyName}.`, {
          sourceId: source.id,
          evidenceId: evidence.evidenceId,
          trustClassification: target.trustClassification
        }));
        const evidenceEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.BROWSER, `Stored page evidence for ${values.companyName}.`, {
          sourceId: source.id,
          evidenceId: evidence.evidenceId,
          linkedSurface: meta.url,
          trustClassification: target.trustClassification,
          sensitivity: target.evidenceSensitivity
        }));
        this.database.updateEvidence(evidenceRecord.id, {
          linkedEventId: evidenceEvent.id
        });
      }

      const collectionArtifact = await this.#persistArtifact(run.id, runDir, buildCollectionTable({
        mission: run.mission,
        runId: run.id,
        validationState: "draft",
        records
      }), {
        artifactRole: "collection_table",
        validationState: "draft",
        recordCount: records.length,
        sourceIds,
        evidenceIds
      });
      const decisionDraft = await this.#draftDecisionNote({
        run,
        records,
        sourceReferences
      });
      const evaluationSupport = await this.#evaluateDecisionDraft({
        run,
        records,
        sourceReferences,
        draft: decisionDraft.output,
        collectionArtifact
      });
      const ambiguityNote = evaluationSupport.output.ambiguityDetected
        ? await this.#generateAmbiguityNote({
          run,
          records,
          sourceReferences,
          draft: decisionDraft.output,
          evaluationSupport: evaluationSupport.output
        })
        : null;
      const decisionArtifact = await this.#persistArtifact(run.id, runDir, buildDecisionNote({
        mission: run.mission,
        runId: run.id,
        records,
        sourceReferences,
        collectionArtifactId: collectionArtifact.id,
        validationState: evaluationSupport.output.recommendedValidationState,
        overallConfidence: decisionDraft.overallConfidence,
        draft: decisionDraft.output,
        evaluationSupport: evaluationSupport.output,
        ambiguityNote: ambiguityNote?.output ?? null
      }), {
        artifactRole: "decision_note",
        validationState: evaluationSupport.output.recommendedValidationState,
        overallConfidence: decisionDraft.overallConfidence,
        collectionArtifactId: collectionArtifact.id,
        sourceCount: sourceReferences.length,
        sourceIds,
        evidenceIds,
        llmCallId: decisionDraft.callRecord?.id ?? null,
        llmProviderAlias: decisionDraft.callRecord?.providerAlias ?? null,
        llmModelAlias: decisionDraft.callRecord?.modelAlias ?? null,
        llmPromptRefs: decisionDraft.callRecord?.promptRefs ?? [],
        generationMode: decisionDraft.callRecord ? "llm" : "deterministic_fallback",
        evaluationLlmCallId: evaluationSupport.callRecord?.id ?? null,
        ambiguityLlmCallId: ambiguityNote?.callRecord?.id ?? null,
        reasoningContextSnapshotIds: [
          decisionDraft.reasoningSnapshot?.id ?? null,
          evaluationSupport.reasoningSnapshot?.id ?? null,
          ambiguityNote?.reasoningSnapshot?.id ?? null
        ].filter(Boolean)
      });

      const researchVerification = {
        scenarioType: "research",
        verificationGoals: planDraft.plan.missionUnderstanding?.verificationGoals ?? [],
        requestedOutcomes: planDraft.plan.missionUnderstanding?.requestedOutcomes ?? [],
        boundaryNotices: planDraft.plan.missionUnderstanding?.unsupportedRequests ?? [],
        overallStatus: "pass",
        checks: [
          verificationCheck("Collected pages remained inside the allowlist.", sourceReferences.every((source) => {
            const hostname = extractHostname(source.canonicalRef);
            return hostname ? project.allowlistedDomains.includes(hostname) : false;
          }), {
            sourceCount: sourceReferences.length,
            allowlistedDomains: project.allowlistedDomains
          }),
          verificationCheck("Each collected source has persisted proof.", evidenceIds.length === sourceReferences.length, {
            evidenceCount: evidenceIds.length,
            sourceCount: sourceReferences.length
          }),
          verificationCheck("Expected result artifacts were persisted.", Boolean(collectionArtifact?.id) && Boolean(decisionArtifact?.id), {
            artifactIds: [collectionArtifact?.id ?? null, decisionArtifact?.id ?? null].filter(Boolean)
          })
        ]
      };
      if (researchVerification.checks.some((check) => check.status !== "pass")) {
        researchVerification.overallStatus = "fail";
      }
      await this.#recordVerificationSummary(run.id, researchVerification);
      if (researchVerification.overallStatus !== "pass") {
        throw new Error("Research verification failed after execution.");
      }

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Research mission completed with artifacts."
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, "Research mission completed.", {
        artifactIds: [collectionArtifact.id, decisionArtifact.id]
      }));

      await this.browser.close();
      return this.getRunBundle(run.id);
    } catch (error) {
      await this.#failRun(run.id, error);
      await this.browser.close().catch(() => {});
      throw error;
    }
  }

  async #executeFormPreparationMission({ run, runDir, project, formUrl, values }) {
    try {
      const planDraft = await this.#generatePlan({
        run,
        project,
        scenarioType: "form_preparation"
      });

      await this.#stageRun(run.id, {
        status: RUN_STATUS.PLANNED,
        lifecycleStage: "plan_generated",
        summary: "Plan generated.",
        plan: planDraft.plan
      }, "plan.generated", "Form preparation plan generated.");

      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: "Form preparation running."
      }, "run.started", "Form preparation mission started.");

      await this.browser.openBrowserSession({
        allowlistedHosts: project.allowlistedDomains
      });
      const targetId = this.browser.focusTab(this.browser.activeTargetId ?? this.browser.listTargets()[0].id);
      await this.browser.navigate(targetId, formUrl);
      await this.browser.waitForPageState(targetId, {
        selector: { testId: "form-main" }
      });

      const preApprovalEvidence = await this.browser.exportPageEvidence(targetId, path.join(runDir, "evidence"), "form-pre-approval", {
        stage: "before_edit"
      });
      this.database.insertEvidence(run.id, {
        id: preApprovalEvidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
        label: "Form approval context evidence",
        storagePath: preApprovalEvidence.summaryPath,
        linkedSurface: formUrl,
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: "controlled_fixture",
        metadata: {
          screenshotPath: preApprovalEvidence.screenshotPath,
          stage: "before_edit",
          browserState: preApprovalEvidence.browserState
        },
        createdAt: nowIso()
      });
      const preApprovalEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.BROWSER, "Stored form approval context evidence.", {
        evidenceId: preApprovalEvidence.evidenceId,
        linkedSurface: formUrl
      }));
      this.database.updateEvidence(preApprovalEvidence.evidenceId, {
        linkedEventId: preApprovalEvent.id
      });

      const approvalRequests = [
        {
          runId: run.id,
          category: APPROVAL_CATEGORY.EDIT,
          riskLevel: "medium",
          actionLabel: "Fill candidate name",
          targetLabel: "Candidate name field",
          reason: "The form requires a candidate name to progress to review-ready state.",
          expectedEffect: `The name field will contain "${values.name}".`,
          consequenceOfRefusal: "The form will remain incomplete.",
          evidenceId: preApprovalEvidence.evidenceId,
          metadata: {
            selector: { testId: "input-name" },
            targetPage: formUrl,
            reversibility: "reversible_within_fixture",
            fieldLabel: "Candidate name",
            proposedValueSummary: values.name
          }
        },
        {
          runId: run.id,
          category: APPROVAL_CATEGORY.EDIT,
          riskLevel: "medium",
          actionLabel: "Select role",
          targetLabel: "Role select field",
          reason: "The form requires a role to progress to review-ready state.",
          expectedEffect: `The role field will be set to "${values.role}".`,
          consequenceOfRefusal: "The form will remain incomplete.",
          evidenceId: preApprovalEvidence.evidenceId,
          metadata: {
            selector: { testId: "select-role" },
            targetPage: formUrl,
            reversibility: "reversible_within_fixture",
            fieldLabel: "Role",
            proposedValueSummary: values.role
          }
        }
      ];

      for (const request of approvalRequests) {
        const authorization = await this.policy.authorize(request);
        if (!authorization.allowed) {
          const stoppedBundle = await this.#stopRunFromApproval(run.id, authorization.approvalRecord, request.actionLabel);
          await this.browser.close();
          return stoppedBundle;
        }
      }

      const nameResult = await this.browser.clearAndType(targetId, { testId: "input-name" }, values.name);
      const roleResult = await this.browser.selectOption(targetId, { testId: "select-role" }, values.role);

      let checkboxResult = null;
      if (values.subscribe != null) {
        const checkboxApproval = await this.policy.authorize({
          runId: run.id,
          category: APPROVAL_CATEGORY.EDIT,
          riskLevel: "medium",
          actionLabel: "Toggle newsletter checkbox",
          targetLabel: "Newsletter checkbox",
          reason: "The operator requested a visible checkbox change in the controlled form.",
          expectedEffect: `The checkbox will become ${values.subscribe ? "checked" : "unchecked"}.`,
          consequenceOfRefusal: "The checkbox will retain its previous state.",
          evidenceId: preApprovalEvidence.evidenceId,
          metadata: {
            targetPage: formUrl,
            reversibility: "reversible_within_fixture",
            fieldLabel: "Newsletter checkbox",
            proposedValueSummary: values.subscribe ? "checked" : "unchecked"
          }
        });
        if (!checkboxApproval.allowed) {
          const stoppedBundle = await this.#stopRunFromApproval(run.id, checkboxApproval.approvalRecord, "Toggle newsletter checkbox");
          await this.browser.close();
          return stoppedBundle;
        }
        checkboxResult = await this.browser.toggleCheckbox(targetId, { testId: "checkbox-newsletter" }, values.subscribe);
      }

      const statusOutcome = await this.browser.verifyOutcome(targetId, {
        type: "text_visible",
        selector: { testId: "status" },
        expectedText: "ready-for-review"
      });

      const evidence = await this.browser.exportPageEvidence(targetId, path.join(runDir, "evidence"), "form-ready", {
        statusOutcome,
        nameResult,
        roleResult
      });

      this.database.insertEvidence(run.id, {
        id: evidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
        label: "Form preparation evidence",
        storagePath: evidence.summaryPath,
        linkedSurface: formUrl,
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: "controlled_fixture",
        metadata: {
          screenshotPath: evidence.screenshotPath,
          browserState: evidence.browserState
        },
        createdAt: nowIso()
      });
      const evidenceEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.BROWSER, "Stored form preparation evidence.", {
        evidenceId: evidence.evidenceId,
        linkedSurface: formUrl
      }));
      this.database.updateEvidence(evidence.evidenceId, {
        linkedEventId: evidenceEvent.id
      });

      const formVerification = {
        scenarioType: "form_preparation",
        verificationGoals: planDraft.plan.missionUnderstanding?.verificationGoals ?? [],
        requestedOutcomes: planDraft.plan.missionUnderstanding?.requestedOutcomes ?? [],
        boundaryNotices: planDraft.plan.missionUnderstanding?.unsupportedRequests ?? [],
        overallStatus: "pass",
        checks: [
          verificationCheck("Approved form field edits were applied.", nameResult.validated && roleResult.validated && (checkboxResult ? checkboxResult.validated : true), {
            nameValidated: nameResult.validated,
            roleValidated: roleResult.validated,
            checkboxValidated: checkboxResult?.validated ?? null
          }),
          verificationCheck("The form reached a review-ready visible state.", statusOutcome.validated, {
            observed: statusOutcome.observed ?? null
          }),
          verificationCheck("Preparation proof was persisted.", Boolean(evidence.evidenceId), {
            evidenceId: evidence.evidenceId
          })
        ]
      };
      if (formVerification.checks.some((check) => check.status !== "pass")) {
        formVerification.overallStatus = "fail";
      }
      await this.#recordVerificationSummary(run.id, formVerification);
      if (formVerification.overallStatus !== "pass") {
        throw new Error("Form-preparation verification failed after execution.");
      }

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Form was prepared and stopped before submission."
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, "Form preparation mission completed."));

      await this.browser.close();
      return this.getRunBundle(run.id);
    } catch (error) {
      await this.#failRun(run.id, error);
      await this.browser.close().catch(() => {});
      throw error;
    }
  }

  async #generateDesktopPlan({
    run,
    project,
    desktopAction,
    visibleWindows,
    activeWindow,
    installedApplications,
    activeAccessibilityBefore = null,
    desktopSnapshot = null,
    skillCatalog = [],
    desktopMemory = null,
    projectMemory = null,
    userMemory = null,
    replanContext = null
  }) {
    const missionUnderstanding = run.plan?.missionUnderstanding ?? run.metadata?.preflight?.understanding ?? null;
    const sandbox = this.#desktopSandboxSummary();
    const persistedCapabilityNodes = this.database.listCapabilityGraphNodes?.() ?? [];
    const capabilityNodes = persistedCapabilityNodes.length > 0
      ? persistedCapabilityNodes
      : buildCapabilityGraph({
        applications: installedApplications,
        browsers: [],
        agentConfiguration: this.#getAgentConfiguration()
      }).nodes;
    const capabilityOverrides = this.database.listCapabilityGraphOverrides?.() ?? [];
    const capabilityFeedback = this.database.listCapabilityFeedback?.({ limit: 500 }) ?? [];
    const governedCapabilityNodes = applyCapabilityOverrides(capabilityNodes, capabilityOverrides);
    const capabilityGraph = compactCapabilityGraphForPrompt(governedCapabilityNodes, {
      mission: run.mission,
      limit: 20,
      feedbackRecords: capabilityFeedback
    });
    const selectedCapability = selectEnabledCapabilityForMission(
      this.database,
      run.mission,
      run.metadata?.missionSpec?.deliverable ?? ""
    );
    const input = {
      mission: run.mission,
      missionSpec: run.metadata?.missionSpec ?? null,
      missionUnderstanding,
      desktopAction,
      installedApplications,
      visibleWindows,
      activeWindow,
      activeAccessibilityBefore: activeAccessibilityBefore ? compactAccessibilityForPrompt(activeAccessibilityBefore) : null,
      desktopSnapshot,
      skillCatalog,
      capabilityGraph,
      selectedCapability: selectedCapability ? {
        id: selectedCapability.id,
        title: selectedCapability.title,
        capabilityKind: selectedCapability.capabilityKind,
        artifactKind: selectedCapability.artifactKind,
        mission: selectedCapability.mission,
        status: selectedCapability.status
      } : null,
      desktopMemory: desktopMemory ? summarizeDesktopAutonomyMemory(desktopMemory) : null,
      projectMemory,
      userMemory,
      replanContext,
      sandbox
    };
    try {
      return await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.DESKTOP_PLAN,
        callType: LLM_CALL_TYPE.DESKTOP_PLAN,
        taskPromptId: "task.desktop_plan",
        bindings: {
          mission: run.mission,
          missionSpec: JSON.stringify(input.missionSpec ?? null),
          missionUnderstanding: JSON.stringify(missionUnderstanding ?? null),
          installedApplications: JSON.stringify(installedApplications ?? []),
          visibleWindows: JSON.stringify(visibleWindows ?? []),
          activeWindow: JSON.stringify(activeWindow ?? null),
          activeAccessibilityBefore: JSON.stringify(input.activeAccessibilityBefore ?? null),
          desktopSnapshot: JSON.stringify(desktopSnapshot ?? null),
          skillCatalog: JSON.stringify(skillCatalog),
          capabilityGraph: JSON.stringify(capabilityGraph),
          selectedCapability: JSON.stringify(input.selectedCapability ?? null),
          desktopMemory: JSON.stringify(input.desktopMemory),
          projectMemory: JSON.stringify(projectMemory ?? null),
          userMemory: JSON.stringify(userMemory ?? null),
          replanContext: JSON.stringify(replanContext ?? null),
          sandbox: JSON.stringify(input.sandbox)
        },
        input,
        metadata: {
          computerActionType: desktopAction?.type ?? null
        },
        validateOutput: (output) => validateDesktopPlanOutput(output, {
          maxSteps: sandbox.maxPlanSteps ?? 14
        })
      });
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const degradedSnapshot = error.reasoningSnapshot ?? await this.#createReasoningSnapshot({
        run,
        project,
        stage: REASONING_STAGE.DESKTOP_PLAN,
        inputs: input
      });
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "Desktop planning degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.DESKTOP_PLAN,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_desktop_plan_fallback",
        contextSnapshotId: degradedSnapshot.id
      }));
      return {
        output: buildDeterministicDesktopPlan(input),
        callRecord: null,
        reasoningSnapshot: degradedSnapshot
      };
    }
  }

  async #describeBrowserVisualFrame({
    run,
    project,
    frame = {},
    screenshotBase64 = null,
    change = null,
    phase = null,
    step = null,
    visionDetail = "low"
  }) {
    const structuredSummary = {
      url: frame?.url ?? null,
      title: frame?.title ?? null,
      loadingState: frame?.loadingState ?? null,
      blocker: frame?.blocker ?? null,
      bodyTextLength: frame?.bodyTextLength ?? 0,
      bodyPreview: frame?.bodyPreview ?? "",
      interactiveElementCount: frame?.interactiveElementCount ?? 0,
      changeReasons: change?.reasons ?? [],
      phase,
      step: step ? {
        id: step.id ?? null,
        action: step.action ?? null,
        label: step.label ?? null
      } : null
    };
    const descriptionInput = {
      windowTitle: frame?.title ?? "browser",
      pageUrl: frame?.url ?? null,
      ocrText: frame?.bodyPreview || "(no visible DOM text captured)",
      accessibilitySummary: JSON.stringify(structuredSummary),
      hasScreenshot: Boolean(screenshotBase64)
    };
    const extraMessages = screenshotBase64
      ? [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Browser screenshot frame. Use the image as the primary source. Structured fallback: ${JSON.stringify(structuredSummary)}`
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${screenshotBase64}`,
              detail: ["auto", "low", "high"].includes(visionDetail) ? visionDetail : "low"
            }
          }
        ]
      }]
      : [];

    let visionResult;
    try {
      visionResult = await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.WINDOW_DESCRIPTION,
        callType: LLM_CALL_TYPE.WINDOW_DESCRIPTION,
        taskPromptId: "task.window_description",
        bindings: {
          windowTitle: String(descriptionInput.windowTitle ?? "(unknown)"),
          ocrText: descriptionInput.ocrText,
          accessibilitySummary: descriptionInput.accessibilitySummary,
          hasScreenshot: String(descriptionInput.hasScreenshot)
        },
        input: descriptionInput,
        extraMessages,
        metadata: {
          browserMultimodalFrame: true,
          phase,
          stepId: step?.id ?? null,
          changeReasons: change?.reasons ?? [],
          visionDetail
        },
        validateOutput: validateWindowDescriptionOutput
      });
    } catch (error) {
      const fallbackOutput = validateWindowDescriptionOutput(
        buildDeterministicWindowDescriptionOutput(descriptionInput)
      );
      this.#recordEvent(run.id, createEvent("run.browser_vision_fallback_used", EVENT_ACTOR.SYSTEM, "Browser visual frame description used deterministic fallback.", {
        errorCategory: error.category ?? "provider_unavailable",
        message: error.message,
        phase,
        stepId: step?.id ?? null
      }));
      visionResult = {
        output: fallbackOutput,
        callRecord: error.callRecord ?? null,
        reasoningSnapshot: error.reasoningSnapshot ?? null,
        generationMode: "deterministic_fallback"
      };
    }

    const description = {
      id: createId("browser_vision"),
      status: "described",
      createdAt: nowIso(),
      phase,
      stepId: step?.id ?? null,
      stepAction: step?.action ?? null,
      url: frame?.url ?? null,
      title: frame?.title ?? null,
      visualHash: frame?.visual?.screenshotHash ?? null,
      hasScreenshot: Boolean(screenshotBase64),
      visionDetail,
      description: visionResult.output.description,
      keyElements: visionResult.output.keyElements,
      pageType: visionResult.output.pageType,
      llmCallId: visionResult.callRecord?.id ?? null,
      generationMode: visionResult.generationMode ?? (visionResult.callRecord ? "llm" : "deterministic_fallback")
    };
    this.#recordEvent(run.id, createEvent("run.browser_vision_described", EVENT_ACTOR.BROWSER, "Browser visual frame described from screenshot and structured state.", {
      frameId: description.id,
      phase,
      stepId: description.stepId,
      pageType: description.pageType,
      keyElements: description.keyElements,
      visualHash: description.visualHash,
      visionDetail: description.visionDetail,
      llmCallId: description.llmCallId,
      generationMode: description.generationMode
    }));
    return description;
  }

  async #describeDesktopVisualFrame({
    run,
    project,
    snapshot = null,
    change = null,
    phase = null,
    step = null,
    visionDetail = "low"
  }) {
    const screenshotPath = snapshot?.activeVisual?.outputPath ?? null;
    const screenshotBase64 = screenshotPath
      ? await fs.readFile(screenshotPath).then((buffer) => buffer.toString("base64")).catch(() => null)
      : null;
    if (!screenshotBase64 && !snapshot?.activeContentSignature) {
      return null;
    }
    const structuredSummary = {
      activeWindow: snapshot?.activeWindow ?? null,
      visibleWindowCount: snapshot?.visibleWindows?.length ?? 0,
      semanticTargets: snapshot?.activeSemanticTargets ?? [],
      activeContentSignature: snapshot?.activeContentSignature ?? null,
      visualHash: snapshot?.activeVisual?.screenshotHash ?? null,
      changeReasons: change?.reasons ?? [],
      phase,
      step: step ? {
        id: step.id ?? null,
        primitive: step.primitive ?? null,
        label: step.label ?? null
      } : null
    };
    const descriptionInput = {
      windowTitle: snapshot?.activeWindow?.title ?? "desktop",
      pageUrl: null,
      ocrText: snapshot?.activeContentSignature || "(no visible desktop text captured)",
      accessibilitySummary: JSON.stringify(structuredSummary),
      hasScreenshot: Boolean(screenshotBase64)
    };
    const extraMessages = screenshotBase64
      ? [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Desktop screenshot frame. Use the image as the primary source. Structured fallback: ${JSON.stringify(structuredSummary)}`
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${screenshotBase64}`,
              detail: ["auto", "low", "high"].includes(visionDetail) ? visionDetail : "low"
            }
          }
        ]
      }]
      : [];

    let visionResult;
    try {
      visionResult = await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.WINDOW_DESCRIPTION,
        callType: LLM_CALL_TYPE.WINDOW_DESCRIPTION,
        taskPromptId: "task.window_description",
        bindings: {
          windowTitle: String(descriptionInput.windowTitle ?? "(unknown)"),
          ocrText: descriptionInput.ocrText,
          accessibilitySummary: descriptionInput.accessibilitySummary,
          hasScreenshot: String(descriptionInput.hasScreenshot)
        },
        input: descriptionInput,
        extraMessages,
        metadata: {
          desktopMultimodalFrame: true,
          phase,
          stepId: step?.id ?? null,
          primitive: step?.primitive ?? null,
          changeReasons: change?.reasons ?? [],
          visionDetail
        },
        validateOutput: validateWindowDescriptionOutput
      });
    } catch (error) {
      const fallbackOutput = validateWindowDescriptionOutput(
        buildDeterministicWindowDescriptionOutput(descriptionInput)
      );
      this.#recordEvent(run.id, createEvent("run.desktop_vision_fallback_used", EVENT_ACTOR.SYSTEM, "Desktop visual frame description used deterministic fallback.", {
        errorCategory: error.category ?? "provider_unavailable",
        message: error.message,
        phase,
        stepId: step?.id ?? null
      }));
      visionResult = {
        output: fallbackOutput,
        callRecord: error.callRecord ?? null,
        generationMode: "deterministic_fallback"
      };
    }

    const description = {
      id: createId("desktop_vision"),
      status: "described",
      createdAt: nowIso(),
      phase,
      stepId: step?.id ?? null,
      primitive: step?.primitive ?? null,
      activeWindowId: snapshot?.activeWindow?.id ?? null,
      activeWindowTitle: snapshot?.activeWindow?.title ?? null,
      visualHash: snapshot?.activeVisual?.screenshotHash ?? null,
      hasScreenshot: Boolean(screenshotBase64),
      visionDetail,
      description: visionResult.output.description,
      keyElements: visionResult.output.keyElements,
      pageType: visionResult.output.pageType,
      llmCallId: visionResult.callRecord?.id ?? null,
      generationMode: visionResult.generationMode ?? (visionResult.callRecord ? "llm" : "deterministic_fallback")
    };
    this.#recordEvent(run.id, createEvent("run.desktop_vision_described", EVENT_ACTOR.COMPUTER, "Desktop visual frame described from screenshot and structured state.", {
      frameId: description.id,
      phase,
      stepId: description.stepId,
      primitive: description.primitive,
      pageType: description.pageType,
      keyElements: description.keyElements,
      visualHash: description.visualHash,
      visionDetail: description.visionDetail,
      llmCallId: description.llmCallId,
      generationMode: description.generationMode
    }));
    return description;
  }

  async #executeBrowserAutonomyScenario({
    run,
    runDir,
    project,
    desktopAction,
    surfaceClassification = "real_local_browser",
    evidenceSensitivity = "real_local_browser"
  }) {
    try {
      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: "Browser autonomy mission running."
      }, "run.started", "Browser autonomy scenario started.");

      const evidenceDir = path.join(runDir, "evidence");
      const allowlistedHosts = Array.isArray(desktopAction?.allowlistedHosts)
        ? desktopAction.allowlistedHosts
        : (project?.allowlistedDomains ?? []);
      const startUrl = desktopAction?.startUrl ?? null;
      const projectMemory = this.#getProjectMemorySummary(project?.id);
      const userMemory = this.#getUserMemorySummary();
      const browserVisionPolicy = this.#getBrowserVisionPolicy();

      const browserController = new BrowserController({ headless: false });
      const browserOperator = new BrowserOperator({
        browserController,
        llmGateway: this.llmGateway,
        projectId: project.id,
        runId: run.id,
        evidenceRoot: evidenceDir,
        describeVisualFrame: browserVisionPolicy.enabled
          ? async ({ frame, screenshotBase64, change, phase, step, visionDetail }) => this.#describeBrowserVisualFrame({
            run,
            project,
            frame,
            screenshotBase64,
            change,
            phase,
            step,
            visionDetail
          })
          : null,
        onEvent: async (event) => {
          if (event.type === "browser.watch_changed") {
            this.#recordEvent(run.id, createEvent("run.browser_watch_changed", EVENT_ACTOR.BROWSER, "Browser watcher detected a page state change.", {
              phase: event.payload?.phase ?? null,
              stepId: event.payload?.stepId ?? null,
              stepAction: event.payload?.stepAction ?? null,
              reasons: event.payload?.reasons ?? [],
              after: event.payload?.after ?? null,
              visualDescription: event.payload?.visualDescription ?? null
            }));
          } else if (event.type === "browser.watch_started") {
            this.#recordEvent(run.id, createEvent("run.browser_watch_started", EVENT_ACTOR.BROWSER, "Browser watcher started continuous page observation.", {
              targetId: event.payload?.targetId ?? null,
              baseline: event.payload?.baseline ?? null
            }));
          } else if (event.type === "browser.replan_triggered") {
            this.#recordEvent(run.id, createEvent("run.browser_replan_triggered", EVENT_ACTOR.BROWSER, "Browser mid-run replan generated from current page state.", {
              replanId: event.payload?.replanId ?? null,
              replanCount: event.payload?.replanCount ?? 1,
              triggerReason: event.payload?.triggerReason ?? null,
              triggerReasons: event.payload?.triggerReasons ?? [],
              generationMode: event.payload?.generationMode ?? null,
              newStepCount: event.payload?.newStepCount ?? 0
            }));
          }
        }
      });

      this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.BROWSER, "Browser autonomy operator launched.", {
        tool: "browser_autonomy",
        startUrl,
        allowlistedHosts
      }));

      const result = await browserOperator.runMission({
        mission: run.mission,
        startUrl,
        allowlistedHosts,
        projectMemory: {
          project: projectMemory,
          user: userMemory
        },
        browserWatchIncludeScreenshot: browserVisionPolicy.enabled,
        browserWatchScreenshotWidth: browserVisionPolicy.screenshotWidth,
        maxMultimodalVisionFrames: desktopAction?.maxMultimodalVisionFrames ?? browserVisionPolicy.maxFramesPerRun,
        browserVisionPolicy,
        closeBrowser: true
      });

      for (const evidenceRecord of result.evidence ?? []) {
        if (evidenceRecord?.id) {
          this.database.insertEvidence(run.id, {
            id: evidenceRecord.id,
            evidenceType: evidenceRecord.type ?? EVIDENCE_TYPE.PAGE_SCREENSHOT,
            label: evidenceRecord.label ?? "Browser autonomy evidence",
            storagePath: evidenceRecord.screenshotPath ?? evidenceRecord.summaryPath ?? null,
            linkedSurface: evidenceRecord.url ?? startUrl ?? "browser",
            linkedEventId: null,
            linkedSourceId: null,
            sensitivity: evidenceSensitivity,
            metadata: { surfaceClassification, url: evidenceRecord.url ?? null },
            createdAt: nowIso()
          });
        }
      }

      const stepCount = result.stepResults?.length ?? 0;
      const errorCount = result.errors?.length ?? 0;
      const watchChangeCount = result.browserWatchChanges?.length ?? 0;
      const multimodalFrameCount = result.multimodalFrames?.length ?? 0;
      const replanAdaptations = (result.adaptations ?? []).filter((a) => a.type === "browser_replan");
      const replanCount = replanAdaptations.length;
      const replanSuffix = replanCount > 0 ? ` (${replanCount} replan${replanCount > 1 ? "s" : ""})` : "";

      // Semantic outcome verification — partial is NOT auto-completed
      const browserSemanticVerification = new SemanticOutcomeVerifier().verify({
        mission: run.mission,
        planOutcomes: [],
        actionLog: [],
        evidence: result.evidence ?? [],
        artifacts: [],
        browserResult: result
      });

      const finalStatus = browserSemanticVerification.verifiedByOutcomes
        ? RUN_STATUS.COMPLETED
        : RUN_STATUS.FAILED;

      const summary = result.status === "completed" && browserSemanticVerification.verifiedByOutcomes
        ? `Browser mission completed — ${stepCount} steps executed${replanSuffix}.`
        : result.status === "partial" || !browserSemanticVerification.verifiedByOutcomes
        ? `Browser mission partially completed — ${stepCount} steps, ${errorCount} errors${replanSuffix}. Verification: ${browserSemanticVerification.verificationVerdict}.`
        : `Browser mission failed — ${errorCount} errors${replanSuffix}.`;

      await this.#stageRun(run.id, {
        status: finalStatus,
        lifecycleStage: browserSemanticVerification.verifiedByOutcomes ? "completed" : "failed",
        summary,
        output: {
          browserStatus: result.status,
          stepCount,
          errorCount,
          blockerCount: result.blockers?.length ?? 0,
          browserWatchChangeCount: watchChangeCount,
          multimodalFrameCount,
          replanCount,
          extracted: result.extracted ?? {},
          finalUrl: result.browserState?.url ?? null
        },
        metadata: {
          ...(this.database.getRun(run.id)?.metadata ?? {}),
          finalUrl: result.browserState?.url ?? null,
          semanticVerification: {
            verifiedByOutcomes: browserSemanticVerification.verifiedByOutcomes,
            verificationVerdict: browserSemanticVerification.verificationVerdict,
            objectiveSatisfied: browserSemanticVerification.objectiveSatisfied,
            confidence: browserSemanticVerification.confidence,
            failureReason: browserSemanticVerification.failureReason,
            nextBestAction: browserSemanticVerification.nextBestAction,
            unsatisfiedOutcomes: browserSemanticVerification.unsatisfiedOutcomes,
            satisfiedOutcomes: browserSemanticVerification.satisfiedOutcomes
          },
          browserObservationSummary: {
            watchChangeCount,
            multimodalFrameCount,
            visionPolicy: {
              modelAlias: "vision_fallback",
              maxFramesPerRun: browserVisionPolicy.maxFramesPerRun,
              screenshotWidth: browserVisionPolicy.screenshotWidth,
              defaultDetail: browserVisionPolicy.defaultDetail,
              interactionDetail: browserVisionPolicy.interactionDetail,
              blockerDetail: browserVisionPolicy.blockerDetail
            },
            lastChangeReasons: result.browserWatchChanges?.at(-1)?.reasons ?? [],
            lastVisualDescription: result.multimodalFrames?.at(-1)?.description ?? null,
            blockerCount: result.blockers?.length ?? 0,
            replanCount,
            replanAdaptations: replanAdaptations.map((a) => ({
              replanId: a.id,
              triggerReasons: a.triggerReasons ?? [],
              generationMode: a.generationMode ?? null,
              newStepCount: a.newStepCount ?? 0,
              currentUrl: a.currentUrl ?? null,
              detectedAt: a.detectedAt ?? null
            }))
          }
        }
      }, browserSemanticVerification.verifiedByOutcomes ? "run.completed" : "run.failed", summary);

      auditBrowserMission({
        projectId: project.id,
        runId: run.id,
        mission: run.mission,
        finalStatus,
        browserResult: result
      });
      return { runStatus: finalStatus, result };
    } catch (error) {
      auditBrowserMission({
        projectId: project.id,
        runId: run.id,
        mission: run.mission,
        finalStatus: "failed",
        browserResult: null
      });
      const failSummary = `Browser autonomy failed: ${error.message}`;
      await this.#stageRun(run.id, {
        status: RUN_STATUS.FAILED,
        lifecycleStage: "failed",
        summary: failSummary
      }, "run.failed", failSummary).catch(() => {});
      throw error;
    }
  }

  async #executeDesktopAutonomyScenario({
    run,
    runDir,
    project,
    desktopAction,
    surfaceClassification = "real_local_desktop",
    evidenceSensitivity = "real_local_desktop"
  }) {
    let desktopPlanForFeedback = null;
    let actionLogForFeedback = [];
    let observationTimeline = null;
    let latestDesktopEvidencePath = null;
    let desktopMemoryForRun = null;
    let desktopWatcher = null;
    try {
      const planDraft = await this.#generatePlan({
        run,
        project,
        scenarioType: "computer_observation"
      });

      await this.#stageRun(run.id, {
        status: RUN_STATUS.PLANNED,
        lifecycleStage: "plan_generated",
        summary: "Plan generated.",
        plan: planDraft.plan
      }, "plan.generated", "General desktop autonomy plan generated.");

      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: "Governed desktop autonomy running."
      }, "run.started", "Governed desktop autonomy scenario started.");

      const visibleWindowsBefore = await this.computer.listVisibleWindows();
      const activeWindowBefore = await this.computer.detectActiveWindow();
      const activeAccessibilityBefore = activeWindowBefore
        ? await this.computer.inspectAccessibilityTree(activeWindowBefore.id).catch((error) => ({
          available: false,
          reason: error.message,
          tree: null
        }))
        : null;
      const installedApplications = await this.#listInstalledApplications();
      const desktopSnapshot = await this.computer.inspectDesktop({
        maxWindows: 6,
        maxDepth: 2,
        maxNodes: 60
      }).catch((error) => ({
        capturedAt: nowIso(),
        unavailable: true,
        reason: error.message,
        activeWindow: activeWindowBefore,
        visibleWindowCount: visibleWindowsBefore.length,
        windows: []
      }));
      const skillCatalog = buildDesktopSkillCatalog(installedApplications);
      const desktopMemory = this.#getDesktopAutonomyMemory();
      const projectMemory = this.#getProjectMemorySummary(project?.id);
      const userMemory = this.#getUserMemorySummary();
      const desktopVisionPolicy = this.#getBrowserVisionPolicy();
      desktopMemoryForRun = desktopMemory;
      observationTimeline = createDesktopObservationTimeline({
        runId: run.id,
        mission: run.mission
      });
      appendDesktopObservation(observationTimeline, {
        phase: "initial_desktop",
        status: "observed",
        window: activeWindowBefore,
        perception: activeAccessibilityBefore ? { accessibility: activeAccessibilityBefore } : null
      });
      desktopWatcher = new DesktopRunWatcher({
        computer: this.computer,
        intervalMs: 500,
        maxChanges: 24,
        includeScreenshot: desktopVisionPolicy.enabled,
        retainScreenshotPath: desktopVisionPolicy.enabled
      });
      await desktopWatcher.start();
      const desktopPlan = await this.#generateDesktopPlan({
        run,
        project,
        desktopAction,
        visibleWindows: visibleWindowsBefore,
        activeWindow: activeWindowBefore,
        installedApplications,
        activeAccessibilityBefore,
        desktopSnapshot,
        skillCatalog,
        desktopMemory,
        projectMemory,
        userMemory
      });
      desktopPlan.output = validateDesktopPlanOutput(desktopPlan.output, {
        maxSteps: this.#desktopSandboxSummary().maxPlanSteps ?? 14
      });
      desktopPlanForFeedback = desktopPlan.output;

      auditMissionPlan({
        projectId: project.id,
        runId: run.id,
        mission: run.mission,
        plan: desktopPlan.output
      });

      if (desktopPlan.output.requiresClarification) {
        throw new Error(`Desktop plan needs clarification before acting: ${desktopPlan.output.clarificationQuestion}`);
      }

      const approvalContextEvidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "desktop-autonomy-approval-context", {
        mission: run.mission,
        installedApplications,
        visibleWindowsBefore,
        activeWindowBefore,
        activeAccessibilityBefore,
        desktopSnapshot,
        skillCatalog,
        desktopMemory: summarizeDesktopAutonomyMemory(desktopMemory),
        projectMemory,
        sandbox: this.#desktopSandboxSummary(),
        desktopPlan: desktopPlan.output,
        surfaceClassification
      });
      this.database.insertEvidence(run.id, {
        id: approvalContextEvidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
        label: "Desktop autonomy approval context",
        storagePath: approvalContextEvidence.outputPath,
        linkedSurface: activeWindowBefore?.title ?? "desktop",
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: evidenceSensitivity,
        metadata: {
          surfaceClassification,
          selectedApplicationId: desktopPlan.output.selectedApplication?.id ?? null
        },
        createdAt: nowIso()
      });

      const actionLog = [];
      actionLogForFeedback = actionLog;
      const checkpoints = [];
      const agentConfiguration = this.#getAgentConfiguration();
      let currentWindow = activeWindowBefore ?? null;
      let consecutiveFailures = 0;
      let dynamicReplanCount = 0;
      const executableSteps = [...desktopPlan.output.steps];
      const missionTracker = new MissionProgressTracker({
        runId: run.id,
        projectId: project.id,
        mission: run.mission,
        plan: desktopPlan.output
      });
      missionTracker.setActiveSurface("desktop", { app: desktopPlan.output.selectedApplication?.id ?? null });
      for (let stepIndex = 0; stepIndex < executableSteps.length; stepIndex++) {
        const step = executableSteps[stepIndex];
        const watchedChanges = await this.#consumeDesktopWatcherChanges({
          run,
          desktopWatcher,
          observationTimeline,
          step
        });
        if (watchedChanges.length > 0 && actionLog.length > 0 && dynamicReplanCount < MAX_DYNAMIC_DESKTOP_REPLANS && step.primitive !== "observe_windows") {
          currentWindow = watchedChanges.at(-1)?.after?.activeWindow ?? currentWindow;
          const watcherReplan = await this.#attemptDesktopDynamicReplan({
            run,
            project,
            desktopAction,
            installedApplications,
            skillCatalog,
            desktopMemory,
            projectMemory,
            userMemory,
            desktopPlan: desktopPlan.output,
            actionLog,
            observationTimeline,
            currentWindow,
            failedStep: step,
            error: new Error(`Desktop state changed while JON was monitoring: ${watchedChanges.at(-1)?.reasons?.join(", ") ?? "unknown change"}.`),
            currentStepIndex: Math.max(0, stepIndex - 1),
            remainingSteps: executableSteps.slice(stepIndex)
          });
          if (watcherReplan.accepted) {
            dynamicReplanCount++;
            missionTracker.recordDynamicReplan();
            executableSteps.splice(
              stepIndex,
              executableSteps.length - stepIndex,
              ...watcherReplan.steps
            );
            stepIndex--;
            await this.#markDesktopWatcherBaseline(desktopWatcher);
            continue;
          }
        }
        if (step.primitive === "stop") {
          actionLog.push({ step, status: "stopped", result: null });
          break;
        }
        if (step.primitive === "await_manual_action") {
          const actionDescription = step.input?.description ?? step.label ?? "Manual action required";
          const authorization = await this.policy.authorize({
            runId: run.id,
            category: APPROVAL_CATEGORY.MANUAL_USER_ACTION,
            riskLevel: "low",
            actionLabel: actionDescription,
            targetLabel: "user",
            reason: step.input?.reason ?? "JON cannot perform this action autonomously and requires you to act.",
            expectedEffect: step.input?.expectedEffect ?? "User completes the required action so JON can continue.",
            consequenceOfRefusal: "The mission will stop.",
            evidenceId: approvalContextEvidence.evidenceId,
            metadata: { primitive: "await_manual_action", stepId: step.id }
          });
          if (!authorization.allowed) {
            return this.#stopRunFromApproval(run.id, authorization.approvalRecord, actionDescription);
          }
          currentWindow = await this.computer.detectActiveWindow().catch(() => currentWindow);
          actionLog.push({ step, status: "completed", result: { manualActionConfirmed: true } });
          appendDesktopObservation(observationTimeline, {
            phase: "manual_action_confirmed",
            status: "completed",
            step,
            window: currentWindow,
            result: { manualActionConfirmed: true }
          });
          consecutiveFailures = 0;
          continue;
        }
        if (step.primitive === "observe_windows") {
          const observed = await this.computer.listVisibleWindows();
          const observeCheckpoint = checkpointRecord({
            step,
            before: currentWindow,
            after: currentWindow,
            safety: { allowed: true, blocked: false, reason: "Observation is read-only." },
            verification: { validated: true, reason: "Visible windows were listed." }
          });
          checkpoints.push(observeCheckpoint);
          actionLog.push({ step, status: "completed", result: { visibleWindows: observed }, checkpoint: observeCheckpoint });
          appendDesktopObservation(observationTimeline, {
            phase: "observe_windows",
            status: "completed",
            step,
            window: currentWindow,
            result: { visibleWindowCount: observed.length }
          });
          await this.#markDesktopWatcherBaseline(desktopWatcher);
          consecutiveFailures = 0;
          continue;
        }
        if (step.primitive === "launch_workspace_cli") {
          let cliResult = null;
          let cliStatus = "completed";
          if (typeof this.workspaceLauncher === "function") {
            try {
              const launchPromise = Promise.resolve(this.workspaceLauncher(run.projectId, {
                command: String(step.input?.command ?? "").trim(),
                args: Array.isArray(step.input?.args) ? step.input.args : [],
                label: String(step.input?.label ?? step.label ?? "").trim(),
                cwd: step.input?.cwd ?? undefined,
                autonomyMode: "assisted",
                conversationId: run.conversationId ?? null,
                authorized: true
              }));
              const launchTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(Object.assign(new Error("Workspace launcher timed out after 10s."), { code: "LAUNCHER_TIMEOUT" })), 10_000)
              );
              const launchResult = await Promise.race([launchPromise, launchTimeout]);
              const terminalId = launchResult?.terminal?.id ?? null;
              cliResult = {
                launched: true,
                terminalId,
                command: step.input?.command,
                label: launchResult?.terminal?.label ?? step.input?.label
              };

              // waitForCompletion: block until the terminal exits or times out
              if (step.input?.waitForCompletion && terminalId) {
                const waitMaxMs = Math.min(Number(step.input.waitTimeoutMs ?? 300_000), 600_000);
                const pollIntervalMs = 2_000;
                const waitStart = Date.now();
                while (Date.now() - waitStart < waitMaxMs) {
                  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                  const session = this.database.getWorkspaceTerminalSession(terminalId);
                  if (!session || session.status === "completed" || session.status === "error" || session.status === "detached") {
                    cliResult.exitStatus = session?.status ?? "unknown";
                    cliResult.exitCode = session?.metadata?.exitCode ?? null;
                    break;
                  }
                }
              }
            } catch (launchError) {
              cliResult = { launched: false, error: launchError.message };
              cliStatus = "failed";
            }
          } else {
            cliResult = { launched: false, error: "workspaceLauncher not configured" };
            cliStatus = "failed";
          }
          this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.COMPUTER, `Workspace CLI launched: ${step.input?.command ?? "unknown"}.`, {
            primitive: step.primitive,
            stepId: step.id,
            launched: cliResult?.launched ?? false,
            terminalId: cliResult?.terminalId ?? null
          }));
          actionLog.push({ step, status: cliStatus, result: cliResult });
          if (cliStatus === "completed") consecutiveFailures = 0;
          continue;
        }
        if (step.primitive === "open_workspace_browser") {
          let browserResult = null;
          let browserStatus = "completed";
          if (typeof this.browserLauncher === "function") {
            try {
              const session = await this.browserLauncher(run.projectId, {
                runId: run.id,
                url: step.input?.url ?? null,
                allowlistedHosts: Array.isArray(step.input?.allowlistedHosts) ? step.input.allowlistedHosts : [],
                headless: step.input?.headless ?? true
              });
              browserResult = { opened: true, sessionId: session?.id ?? null, url: step.input?.url ?? null };
            } catch (browserError) {
              browserResult = { opened: false, error: browserError.message };
              browserStatus = "failed";
            }
          } else {
            browserResult = { opened: false, error: "browserLauncher not configured" };
            browserStatus = "failed";
          }
          this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.COMPUTER, `Workspace browser opened: ${step.input?.url ?? "blank"}.`, {
            primitive: step.primitive,
            stepId: step.id,
            opened: browserResult?.opened ?? false,
            sessionId: browserResult?.sessionId ?? null
          }));
          actionLog.push({ step, status: browserStatus, result: browserResult });
          if (browserStatus === "completed") consecutiveFailures = 0;
          continue;
        }
        const isFilePrimitive = [
          "list_directory",
          "read_text_file",
          "create_text_file",
          "write_text_file",
          "copy_path",
          "rename_path",
          "move_path",
          "delete_path"
        ].includes(step.primitive);
        const selectedSkill = skillForStep(step, desktopPlan.output.selectedApplication ?? null);
        const safety = assessDesktopStep(step, {
          mission: run.mission,
          currentWindow,
          selectedApplication: desktopPlan.output.selectedApplication ?? null,
          skill: selectedSkill,
          agentConfiguration
        });
        if (safety.blocked) {
          const recovery = buildRecoveryAttempt({
            step,
            error: new Error(safety.reason),
            currentWindow,
            beforeWindow: activeWindowBefore
          });
          const blockedCheckpoint = checkpointRecord({
            step,
            before: currentWindow,
            after: currentWindow,
            safety,
            recovery,
            verification: { validated: false, reason: safety.reason }
          });
          checkpoints.push(blockedCheckpoint);
          actionLog.push({ step, status: "blocked", result: null, safety, recovery, checkpoint: blockedCheckpoint });
          auditStepFailure({
            runId: run.id,
            projectId: project.id,
            stepId: step.id,
            stepIndex,
            totalSteps: executableSteps.length,
            primitive: step.primitive,
            label: step.label,
            status: "blocked",
            safetyReason: safety.reason,
            riskLevel: safety.riskLevel ?? null,
            recoveryAttempted: Boolean(recovery),
            consecutiveFailures: consecutiveFailures + 1
          });
          missionTracker.recordStepResult({ stepId: step.id, primitive: step.primitive, label: step.label, status: "blocked" });
          this.#recordEvent(run.id, createEvent("tool.blocked", EVENT_ACTOR.POLICY, `Desktop primitive blocked: ${step.primitive}.`, {
            primitive: step.primitive,
            stepId: step.id,
            reason: safety.reason
          }));
          consecutiveFailures++;
          appendDesktopObservation(observationTimeline, {
            phase: "blocked_by_policy",
            status: "failed",
            step,
            window: currentWindow,
            recovery,
            error: new Error(safety.reason)
          });
          continue;
        }
        const stepAwareness = await this.#observeDesktopStepContext({
          run,
          step,
          currentWindow,
          observationTimeline
        });
        currentWindow = stepAwareness.currentWindow ?? currentWindow;
        let beforePerception = stepAwareness.beforePerception ?? (currentWindow?.id
          ? await this.computer.inspectVisibleUi(currentWindow.id).catch((error) => ({
            available: false,
            reason: error.message
          }))
          : null);
        appendDesktopObservation(observationTimeline, {
          phase: "before_step",
          status: "observed",
          step,
          window: currentWindow,
          perception: beforePerception
        });
        if (safety.requiresApproval) {
          const isTrustedApp = step.primitive === "launch_application" && (() => {
            const appId = step.target?.appId ?? desktopPlan.output.selectedApplication?.id ?? "";
            const execPath = (step.target?.executablePath ?? "").toLowerCase();
            const trusted = agentConfiguration.guardrails?.trustedApplications ?? [];
            return trusted.some((entry) => {
              const e = String(entry).toLowerCase();
              return e && (e === String(appId).toLowerCase() || (execPath && execPath.includes(e)));
            });
          })();
          if (!isTrustedApp) {
            const category = step.primitive === "launch_application"
              ? APPROVAL_CATEGORY.LOCAL_APP_LAUNCH
              : APPROVAL_CATEGORY.LOCAL_DESKTOP_ACTUATION;
            const authorization = await this.policy.authorize({
              runId: run.id,
              category,
              riskLevel: safety.riskLevel,
              actionLabel: step.label,
              targetLabel: step.target?.label ?? step.target?.appId ?? currentWindow?.title ?? "desktop",
              reason: `${safety.reason} Explicit approval is required before executing this local primitive.`,
              expectedEffect: step.expectedOutcome,
              consequenceOfRefusal: "The desktop autonomy run will stop before performing this primitive.",
              evidenceId: approvalContextEvidence.evidenceId,
              metadata: {
                primitive: step.primitive,
                stepId: step.id,
                sandbox: this.#desktopSandboxSummary(),
                selectedSkillId: selectedSkill.id,
                surfaceClassification
              }
            });
            if (!authorization.allowed) {
              if (authorization.approvalRecord?.decision === APPROVAL_DECISION.STOP_RUN) {
                return this.#stopRunFromApproval(run.id, authorization.approvalRecord, step.label);
              }
              this.#recordEvent(run.id, createEvent("tool.blocked", EVENT_ACTOR.POLICY, `Step skipped after approval denial: ${step.label}.`, {
                primitive: step.primitive,
                stepId: step.id,
                reason: authorization.approvalRecord?.rationale ?? "Approval denied"
              }));
              actionLog.push({ step, status: "skipped", result: null, safety, reason: "approval_denied" });
              auditStepFailure({
                runId: run.id,
                projectId: project.id,
                stepId: step.id,
                stepIndex,
                totalSteps: executableSteps.length,
                primitive: step.primitive,
                label: step.label,
                status: "skipped",
                reason: "approval_denied",
                safetyReason: safety?.reason ?? null,
                riskLevel: safety?.riskLevel ?? null,
                approvalRationale: authorization.approvalRecord?.rationale ?? authorization.approvalRecord?.metadata?.rationale ?? null,
                consecutiveFailures: consecutiveFailures + 1
              });
              missionTracker.recordStepResult({ stepId: step.id, primitive: step.primitive, label: step.label, status: "skipped" });
              consecutiveFailures++;
              continue;
            }
            const approvalChanges = await this.#consumeDesktopWatcherChanges({
              run,
              desktopWatcher,
              observationTimeline,
              step
            });
            if (approvalChanges.length > 0) {
              const approvalAwareness = await this.#observeDesktopStepContext({
                run,
                step,
                currentWindow: approvalChanges.at(-1)?.after?.activeWindow ?? currentWindow,
                observationTimeline
              });
              currentWindow = approvalAwareness.currentWindow ?? currentWindow;
              beforePerception = approvalAwareness.beforePerception ?? beforePerception;
            }
          }
        }

        let result = null;
        try {
          switch (step.primitive) {
          case "launch_application": {
            const appId = step.target?.appId ?? desktopPlan.output.selectedApplication?.id;
            result = await this.computer.launchApplication(appId);
            const appProcessName = String(result?.application?.processName ?? "").toLowerCase();
            const appExePath = String(result?.application?.executablePath ?? "").toLowerCase();
            const appLabel = String(result?.application?.label ?? appId ?? "").toLowerCase();
            const appLabelSlug = appLabel.replace(/[._\-\s]/g, "");

            // Strategy 1 — exact match: processName / executablePath / label (12s)
            const exactMatcher = (w) =>
              (appProcessName && String(w.processName ?? "").toLowerCase() === appProcessName)
              || (appExePath && String(w.executablePath ?? "").toLowerCase() === appExePath)
              || (appLabel && String(w.title ?? "").toLowerCase().includes(appLabel));

            let waitResult = await this.computer.waitForVisibleWindowMatch(exactMatcher, { timeoutMs: 12000, intervalMs: 300 });

            // Strategy 2 — fuzzy match on label slug (5s extra)
            if (!waitResult.validated && appLabelSlug.length >= 3) {
              const fuzzyMatcher = (w) => {
                const pn = String(w.processName ?? "").toLowerCase().replace(/[._\-\s]/g, "");
                const ti = String(w.title ?? "").toLowerCase().replace(/[._\-\s]/g, "");
                return pn.includes(appLabelSlug) || ti.includes(appLabelSlug) || appLabelSlug.includes(pn.slice(0, Math.min(pn.length, 5)));
              };
              waitResult = await this.computer.waitForVisibleWindowMatch(fuzzyMatcher, { timeoutMs: 5000, intervalMs: 400 });
            }

            // Strategy 3 — new window appeared since mission start
            if (!waitResult.validated) {
              const windowsNow = await this.computer.listVisibleWindows();
              const knownIds = new Set((visibleWindowsBefore ?? []).map((w) => w.id));
              const newWindows = windowsNow.filter((w) => !knownIds.has(w.id));
              if (newWindows.length > 0) {
                waitResult = { validated: true, ambiguous: false, matchedWindow: newWindows[0], visibleWindows: windowsNow, recoveryStrategy: "new_window_since_launch" };
              }
            }

            currentWindow = waitResult.matchedWindow ?? await this.computer.detectActiveWindow().catch(() => null);

            if (!currentWindow) {
              const visibleNow = await this.computer.listVisibleWindows().catch(() => []);
              throw new Error(
                `Application launch did not produce a visible window. appId=${appId}. ` +
                `Visible windows: [${visibleNow.map((w) => `"${w.title}"`).join(", ") || "none"}]`
              );
            }

            result = {
              launch: result,
              waitResult,
              currentWindow,
              recoveryStrategy: waitResult.recoveryStrategy ?? (waitResult.validated ? "exact_match" : "active_window_fallback")
            };
            break;
          }
          case "focus_window": {
            const targetWindowId = step.target?.windowId ?? currentWindow?.id;
            result = await this.computer.focusWindow(targetWindowId);
            currentWindow = result;
            break;
          }
          case "type_text": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            result = await this.computer.typeText(targetWindow?.id ?? null, step.input?.text ?? "");
            currentWindow = await this.computer.detectActiveWindow();
            break;
          }
          case "send_hotkey": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            result = await this.computer.sendHotkey(targetWindow?.id ?? null, step.input?.keys ?? "");
            currentWindow = await this.computer.detectActiveWindow();
            break;
          }
          case "click_point": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            const bounds = targetWindow?.bounds ?? { x: 0, y: 0, width: 800, height: 600 };
            const explicitPoint = step.input?.point && typeof step.input.point === "object" ? step.input.point : null;
            const semanticSelector = step.target?.semanticTarget || step.input?.semanticTarget
              ? {
                query: step.target?.semanticTarget ?? step.input?.semanticTarget,
                role: step.target?.role ?? step.input?.role ?? null,
                automationId: step.target?.automationId ?? step.input?.automationId ?? null
              }
              : null;
            let semanticResolution = semanticSelector && targetWindow?.id
              ? await this.computer.resolveSemanticTarget(targetWindow.id, semanticSelector).catch((error) => ({
                found: false,
                reason: error.message,
                target: null
              }))
              : null;
            if (semanticSelector && !semanticResolution?.found && targetWindow?.id) {
              for (let _semPoll = 0; _semPoll < 3 && !semanticResolution?.found; _semPoll++) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                semanticResolution = await this.computer.resolveSemanticTarget(targetWindow.id, semanticSelector).catch((error) => ({
                  found: false,
                  reason: error.message,
                  target: null
                }));
              }
            }
            if (semanticSelector && !semanticResolution?.found) {
              throw new Error(`Semantic desktop target was not found: ${semanticResolution?.reason ?? semanticSelector.query}`);
            }
            const point = semanticResolution?.target?.center ?? explicitPoint ?? (step.target?.point === "window_center"
              ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
              : { x: Number(step.input?.x ?? bounds.x + 20), y: Number(step.input?.y ?? bounds.y + 20) });
            result = await this.computer.clickPoint(targetWindow?.id ?? null, point);
            result = {
              ...result,
              semanticResolution
            };
            currentWindow = await this.computer.detectActiveWindow();
            break;
          }
          case "scroll_window": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            result = await this.computer.scrollWindow(targetWindow?.id ?? null, Number(step.input?.delta ?? -360));
            currentWindow = await this.computer.detectActiveWindow();
            break;
          }
          case "capture_window": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            result = await this.computer.captureWindow(targetWindow?.id);
            break;
          }
          case "read_visible_text": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            const captureResult = await this.computer.captureWindow(targetWindow?.id).catch(() => null);
            const ocrResult = captureResult?.outputPath
              ? await this.computer.extractTextFromImage(captureResult.outputPath).catch(() => ({ available: false, engine: null, text: "", lines: [], words: [] }))
              : { available: false, engine: null, text: "", lines: [], words: [] };
            const uiInspection = targetWindow?.id
              ? await this.computer.inspectVisibleUi(targetWindow.id).catch(() => null)
              : null;
            result = {
              windowTitle: targetWindow?.title ?? null,
              text: ocrResult.text ?? "",
              lines: ocrResult.lines ?? [],
              words: ocrResult.words ?? [],
              ocrAvailable: ocrResult.available ?? false,
              ocrEngine: ocrResult.engine ?? null,
              accessibilitySummary: uiInspection?.accessibilitySummary ?? null,
              semanticTargets: uiInspection?.semanticTargets ?? []
            };
            break;
          }
          case "describe_window": {
            const targetWindow = currentWindow ?? await this.computer.detectActiveWindow();
            const visionSnapshot = await this.computer.buildWindowVisionSnapshot(targetWindow?.id, {
              capture: true,
              maxDepth: 4,
              maxNodes: 80
            });
            const screenshotPath = visionSnapshot?.screenshot?.outputPath ?? null;
            const imageBase64 = screenshotPath
              ? await fs.readFile(screenshotPath).then((buf) => buf.toString("base64")).catch(() => null)
              : null;
            const ocrText = visionSnapshot?.ocr?.text ?? "";
            const accessibilitySummary = visionSnapshot?.accessibility?.summary ?? null;
            const extraMessages = imageBase64
              ? [{
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Window screenshot (base64 PNG) — use this image as the primary source for your description. OCR fallback: ${ocrText || "(none)"}. Accessibility summary: ${JSON.stringify(accessibilitySummary ?? null)}`
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${imageBase64}`,
                      detail: "high"
                    }
                  }
                ]
              }]
              : [];
            const descriptionInput = {
              windowTitle: targetWindow?.title ?? null,
              ocrText: ocrText || "(no OCR text available)",
              accessibilitySummary: JSON.stringify(accessibilitySummary ?? null),
              hasScreenshot: Boolean(imageBase64)
            };
            const descriptionLlmResult = await this.#invokeReasonedLlm({
              run,
              project,
              reasoningStage: REASONING_STAGE.WINDOW_DESCRIPTION,
              callType: LLM_CALL_TYPE.WINDOW_DESCRIPTION,
              taskPromptId: "task.window_description",
              bindings: {
                windowTitle: String(descriptionInput.windowTitle ?? "(unknown)"),
                ocrText: descriptionInput.ocrText,
                accessibilitySummary: descriptionInput.accessibilitySummary,
                hasScreenshot: String(descriptionInput.hasScreenshot)
              },
              input: descriptionInput,
              extraMessages,
              validateOutput: validateWindowDescriptionOutput
            });
            result = {
              windowTitle: targetWindow?.title ?? null,
              description: descriptionLlmResult.output?.description ?? "",
              keyElements: descriptionLlmResult.output?.keyElements ?? [],
              pageType: descriptionLlmResult.output?.pageType ?? null,
              ocrText,
              hasScreenshot: Boolean(imageBase64)
            };
            break;
          }
          case "list_directory":
          case "read_text_file":
          case "create_text_file":
          case "write_text_file":
          case "copy_path":
          case "rename_path":
          case "move_path":
          case "delete_path": {
            result = await this.computer.executeFilePrimitive(step, {
              runDir,
              agentConfiguration
            });
            break;
          }
          default:
            throw new Error(`Unsupported desktop primitive at execution time: ${step.primitive}`);
          }
        } catch (error) {
          const recovery = buildRecoveryAttempt({
            step,
            error,
            currentWindow,
            beforeWindow: activeWindowBefore
          });
          const visibleWindowsForRecovery = await Promise.resolve(this.computer.listVisibleWindows()).catch(() => []);
          const recoveryPlan = buildDesktopRecoveryPlan({
            step,
            error,
            currentWindow,
            beforeWindow: activeWindowBefore,
            visibleWindows: visibleWindowsForRecovery,
            desktopMemory
          });
          appendDesktopObservation(observationTimeline, {
            phase: "recovery_planned",
            status: "observed",
            step,
            window: currentWindow,
            recovery: {
              ...recovery,
              selectedStrategy: recoveryPlan.strategies[0]?.id ?? recovery.selectedStrategy
            },
            error
          });
          const recoveredStep = await this.#attemptDesktopStepRecovery({
            step,
            error,
            currentWindow,
            beforeWindow: activeWindowBefore,
            beforePerception,
            safety,
            recovery,
            recoveryPlan,
            visibleWindows: visibleWindowsForRecovery
          });
          if (recoveredStep.completed) {
            checkpoints.push(recoveredStep.checkpoint);
            actionLog.push({
              step,
              status: "completed",
              result: recoveredStep.result,
              perceptionAfter: recoveredStep.perceptionAfter,
              perceptionDelta: recoveredStep.perceptionDelta,
              recovery: recoveredStep.recovery,
              safety,
              checkpoint: recoveredStep.checkpoint
            });
            this.#recordEvent(run.id, createEvent("tool.recovery_succeeded", EVENT_ACTOR.COMPUTER, `Desktop recovery succeeded after ${step.primitive} failed.`, {
              primitive: step.primitive,
              stepId: step.id,
              selectedStrategy: recoveredStep.recovery?.selectedStrategy ?? "semantic_target_retry",
              reason: error.message,
              targetWindowId: recoveredStep.currentWindow?.id ?? null
            }));
            appendDesktopObservation(observationTimeline, {
              phase: "recovery_succeeded",
              status: "completed",
              step,
              window: recoveredStep.currentWindow,
              perception: recoveredStep.perceptionAfter,
              result: recoveredStep.result,
              recovery: recoveredStep.recovery
            });
            currentWindow = recoveredStep.currentWindow ?? currentWindow;
            await this.#markDesktopWatcherBaseline(desktopWatcher);
            consecutiveFailures = 0;
            continue;
          }
          const recoveredWindow = await this.computer.detectActiveWindow().catch(() => null);
          const failurePerception = recoveredWindow?.id
            ? await this.computer.inspectVisibleUi(recoveredWindow.id).catch((inspectError) => ({
              available: false,
              reason: inspectError.message
            }))
            : null;
          const failureCapture = recoveredWindow?.id
            ? await this.computer.captureWindow(recoveredWindow.id).catch(() => null)
            : null;
          latestDesktopEvidencePath = failureCapture?.outputPath ?? latestDesktopEvidencePath;
          const failedCheckpoint = checkpointRecord({
            step,
            before: beforePerception,
            after: failurePerception,
            safety,
            recovery,
            verification: {
              validated: false,
              reason: error.message,
              failureCapturePath: failureCapture?.outputPath ?? null
            }
          });
          checkpoints.push(failedCheckpoint);
          actionLog.push({
            step,
            status: "failed",
            result: null,
            error: error.message,
            perceptionAfter: failurePerception,
            recovery,
            failureCapture,
            safety,
            checkpoint: failedCheckpoint
          });
          auditStepFailure({
            runId: run.id,
            projectId: project.id,
            stepId: step.id,
            stepIndex,
            totalSteps: executableSteps.length,
            primitive: step.primitive,
            label: step.label,
            status: "failed",
            errorMessage: error.message,
            safetyReason: safety?.reason ?? null,
            riskLevel: safety?.riskLevel ?? null,
            recoveryAttempted: Boolean(recovery),
            screenshotPath: failureCapture?.outputPath ?? null,
            consecutiveFailures: consecutiveFailures + 1
          });
          missionTracker.recordStepResult({
            stepId: step.id, primitive: step.primitive, label: step.label,
            status: "failed", errorMessage: error.message,
            screenshotPath: failureCapture?.outputPath ?? null,
            recoveryAttempted: Boolean(recovery)
          });
          appendDesktopObservation(observationTimeline, {
            phase: "step_failed",
            status: "failed",
            step,
            window: recoveredWindow ?? currentWindow,
            perception: failurePerception,
            recovery: {
              ...recovery,
              recoveryPlan
            },
            error,
            capturePath: failureCapture?.outputPath ?? null
          });
          this.#recordEvent(run.id, createEvent("tool.recovery_attempted", EVENT_ACTOR.COMPUTER, `Desktop recovery attempted after ${step.primitive} failed.`, {
            primitive: step.primitive,
            stepId: step.id,
            selectedStrategy: recoveryPlan.strategies[0]?.id ?? recovery.selectedStrategy,
            reason: error.message
          }));
          currentWindow = recoveredWindow ?? currentWindow;
          if (dynamicReplanCount < MAX_DYNAMIC_DESKTOP_REPLANS) {
            const dynamicReplan = await this.#attemptDesktopDynamicReplan({
              run,
              project,
              desktopAction,
              installedApplications,
              skillCatalog,
              desktopMemory,
              projectMemory,
              userMemory,
              desktopPlan: desktopPlan.output,
              actionLog,
              observationTimeline,
              currentWindow,
              failedStep: step,
              error,
              currentStepIndex: stepIndex,
              remainingSteps: executableSteps.slice(stepIndex + 1)
            });
            if (dynamicReplan.accepted) {
              dynamicReplanCount++;
              executableSteps.splice(
                stepIndex + 1,
                executableSteps.length - stepIndex - 1,
                ...dynamicReplan.steps
              );
              consecutiveFailures = 0;
              continue;
            }
          }
          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            const resyncWindow = await this.computer.detectActiveWindow().catch(() => null);
            if (resyncWindow?.id) {
              currentWindow = resyncWindow;
              await this.computer.captureWindow(resyncWindow.id).catch(() => null);
            }
            this.#recordEvent(run.id, createEvent("run.paused", EVENT_ACTOR.SYSTEM, `Mission paused after ${consecutiveFailures} consecutive failures — waiting for user intervention.`, {
              consecutiveFailures,
              currentWindowTitle: currentWindow?.title ?? null
            }));
            await this.#updateRun(run.id, {
              status: RUN_STATUS.PAUSED,
              lifecycleStage: "paused_consecutive_failures",
              summary: `Mission paused after ${consecutiveFailures} consecutive failures. Please check the desktop state and resume.`
            });
            const resumeAuthorization = await this.policy.authorize({
              runId: run.id,
              category: APPROVAL_CATEGORY.MANUAL_USER_ACTION,
              riskLevel: "low",
              actionLabel: "Résoudre le blocage et reprendre la mission",
              targetLabel: currentWindow?.title ?? "desktop",
              reason: `JON a échoué ${consecutiveFailures} étapes consécutives. Vérifiez l'état de l'écran et confirmez pour que JON puisse continuer.`,
              expectedEffect: "La mission reprend depuis l'état actuel de l'écran.",
              consequenceOfRefusal: "La mission s'arrête.",
              evidenceId: approvalContextEvidence.evidenceId,
              metadata: { consecutiveFailures, lastFailedPrimitive: step.primitive, stepId: step.id }
            });
            if (!resumeAuthorization.allowed) {
              return this.#stopRunFromApproval(run.id, resumeAuthorization.approvalRecord, "Resume after consecutive failures");
            }
            consecutiveFailures = 0;
            currentWindow = await this.computer.detectActiveWindow().catch(() => currentWindow);
          }
          continue;
        }
        let recovery = null;
        if (!currentWindow) {
          const activeCandidate = await this.computer.detectActiveWindow().catch(() => null);
          if (activeCandidate) {
            currentWindow = activeCandidate;
            recovery = {
              strategy: "active_window_fallback",
              reason: "Recovered to the active window because no explicit current window was available after the primitive."
            };
          }
        }
        const perceptionAfter = currentWindow?.id
          ? await this.computer.inspectVisibleUi(currentWindow.id).catch((error) => ({
            available: false,
            reason: error.message
          }))
          : null;
        this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.COMPUTER, `Desktop primitive executed: ${step.primitive}.`, {
          primitive: step.primitive,
          stepId: step.id,
          targetWindowId: currentWindow?.id ?? null,
          recovered: Boolean(recovery),
          perceptionAvailable: Boolean(perceptionAfter?.accessibility?.available ?? perceptionAfter?.available)
        }));
        const perceptionDelta = this.computer.comparePerception(beforePerception, perceptionAfter);
        const stepVerification = {
          validated: step.primitive === "capture_window"
            ? Boolean(result?.outputPath)
            : Boolean(perceptionAfter || result),
          reason: step.primitive === "capture_window"
            ? "Capture primitive produced a proof path."
            : isFilePrimitive
              ? "File primitive returned a result and rollback metadata when mutation was performed."
            : "Primitive returned and post-action perception was captured when a window was available.",
          perceptionDelta
        };
        const checkpoint = checkpointRecord({
          step,
          before: beforePerception,
          after: perceptionAfter,
          safety,
          recovery,
          verification: stepVerification
        });
        checkpoints.push(checkpoint);
        actionLog.push({
          step,
          status: "completed",
          result,
          perceptionAfter,
          perceptionDelta,
          recovery,
          safety,
          checkpoint
        });
        missionTracker.recordStepResult({
          stepId: step.id,
          primitive: step.primitive,
          label: step.label,
          status: "completed",
          recoveryAttempted: Boolean(recovery)
        });
        if (step.primitive === "launch_application" && result?.currentWindow?.title) {
          missionTracker.setActiveSurface("desktop", { app: result.currentWindow.title });
        }
        appendDesktopObservation(observationTimeline, {
          phase: "after_step",
          status: "completed",
          step,
          window: currentWindow,
          perception: perceptionAfter,
          result,
          recovery
        });
        await this.#markDesktopWatcherBaseline(desktopWatcher);
        consecutiveFailures = 0;

        // Auth screen detection — pause naturally when a login screen appears after a step
        const _authTitle = (currentWindow?.title ?? "").toLowerCase();
        const _authText = JSON.stringify(perceptionAfter ?? "").toLowerCase();
        const _authByTitle = ["sign in", "log in", "login", "connexion", "authentification", "authenticate", "mot de passe"].some((kw) => _authTitle.includes(kw));
        const _authByForm = _authText.includes("password") && (_authText.includes("email") || _authText.includes("username") || _authText.includes("identifiant") || _authText.includes("utilisateur"));
        if (_authByTitle || _authByForm) {
          this.#recordEvent(run.id, createEvent("run.auth_screen_detected", EVENT_ACTOR.SYSTEM, `Authentication screen detected after ${step.primitive}.`, {
            windowTitle: currentWindow?.title ?? null,
            stepId: step.id,
            triggerType: _authByTitle ? "window_title" : "accessibility_form"
          }));
          const authAuthorization = await this.policy.authorize({
            runId: run.id,
            category: APPROVAL_CATEGORY.MANUAL_USER_ACTION,
            riskLevel: "low",
            actionLabel: "Authentification requise",
            targetLabel: currentWindow?.title ?? "fenêtre active",
            reason: `JON a détecté un écran d'authentification sur "${currentWindow?.title ?? "fenêtre inconnue"}". Veuillez vous connecter pour permettre à JON de continuer la mission.`,
            expectedEffect: "Vous complétez l'authentification, puis JON reprend la mission automatiquement.",
            consequenceOfRefusal: "La mission s'arrêtera.",
            evidenceId: approvalContextEvidence.evidenceId,
            metadata: { authDetectedAt: step.id, windowTitle: currentWindow?.title ?? null }
          });
          if (!authAuthorization.allowed) {
            return this.#stopRunFromApproval(run.id, authAuthorization.approvalRecord, "Auth blocker — mission stopped by user.");
          }
          currentWindow = await this.computer.detectActiveWindow().catch(() => currentWindow);
        }
      }

      const activeWindowAfter = await this.computer.detectActiveWindow();
      const visibleWindowsAfter = await this.computer.listVisibleWindows();
      const activeAccessibilityAfter = activeWindowAfter
        ? await this.computer.inspectAccessibilityTree(activeWindowAfter.id).catch((error) => ({
          available: false,
          reason: error.message,
          tree: null
        }))
        : null;
      const finalCapture = activeWindowAfter ? await this.computer.captureWindow(activeWindowAfter.id) : null;
      const finalVisionSnapshot = activeWindowAfter
        ? await this.computer.buildWindowVisionSnapshot(activeWindowAfter.id, {
          capture: true,
          maxDepth: 3,
          maxNodes: 100
        }).catch((error) => ({
          available: false,
          reason: error.message
        }))
        : null;
      latestDesktopEvidencePath = finalVisionSnapshot?.screenshot?.outputPath ?? finalCapture?.outputPath ?? latestDesktopEvidencePath;
      appendDesktopObservation(observationTimeline, {
        phase: "final_desktop",
        status: "observed",
        window: activeWindowAfter,
        perception: finalVisionSnapshot,
        capturePath: latestDesktopEvidencePath
      });
      const observationSummary = summarizeDesktopObservationTimeline(observationTimeline);
      const evidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "desktop-autonomy", {
        mission: run.mission,
        desktopPlan: desktopPlan.output,
        actionLog,
        checkpoints,
        observationTimeline,
        observationSummary,
        visibleWindowsBefore,
        activeWindowBefore,
        activeAccessibilityBefore,
        visibleWindowsAfter,
        activeWindowAfter,
        activeAccessibilityAfter,
        finalVisionSnapshot,
        finalCapture,
        surfaceClassification
      });
      this.database.insertEvidence(run.id, {
        id: evidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
        label: "Desktop autonomy evidence",
        storagePath: evidence.outputPath,
        linkedSurface: activeWindowAfter?.title ?? currentWindow?.title ?? "desktop",
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: evidenceSensitivity,
        metadata: {
          screenshotPath: finalCapture?.outputPath ?? null,
          surfaceClassification,
          selectedApplicationId: desktopPlan.output.selectedApplication?.id ?? null,
          actionCount: actionLog.length,
          checkpointCount: checkpoints.length,
          observationSummary
        },
        createdAt: nowIso()
      });
      const evidenceEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored desktop autonomy evidence.", {
        evidenceId: evidence.evidenceId,
        surfaceClassification
      }));
      this.database.updateEvidence(evidence.evidenceId, {
        linkedEventId: evidenceEvent.id
      });

      const desktopVerification = {
        scenarioType: "computer_observation",
        verificationGoals: desktopPlan.output.verificationGoals,
        requestedOutcomes: planDraft.plan.missionUnderstanding?.requestedOutcomes ?? [],
        boundaryNotices: [
          ...(planDraft.plan.missionUnderstanding?.unsupportedRequests ?? []),
          ...desktopPlan.output.unsupportedRequests
        ],
        overallStatus: "pass",
        checks: [
          verificationCheck("A desktop plan was produced by the agent.", desktopPlan.output.steps.length > 0, {
            stepCount: desktopPlan.output.steps.length,
            selectedApplicationId: desktopPlan.output.selectedApplication?.id ?? null
          }),
          verificationCheck("Every planned primitive completed or stopped intentionally.", actionLog.every((entry) => ["completed", "stopped"].includes(entry.status)), {
            actionCount: actionLog.length
          }),
          verificationCheck("Every non-read desktop primitive produced a checkpoint.", checkpoints.length >= actionLog.length, {
            checkpointCount: checkpoints.length,
            actionCount: actionLog.length
          }),
          verificationCheck("Desktop autonomy proof was persisted.", Boolean(evidence.evidenceId), {
            evidenceId: evidence.evidenceId,
            screenshotCaptured: Boolean(finalCapture?.outputPath)
          }),
          verificationCheck("Desktop perception was captured after execution.", Boolean(activeAccessibilityAfter || actionLog.some((entry) => entry.perceptionAfter)), {
            activeAccessibilityAvailable: Boolean(activeAccessibilityAfter?.available),
            perceivedStepCount: actionLog.filter((entry) => entry.perceptionAfter).length
          }),
          verificationCheck("Vision snapshot was captured for final desktop state.", Boolean(finalVisionSnapshot?.screenshot?.outputPath || finalCapture?.outputPath), {
            screenshotPath: finalVisionSnapshot?.screenshot?.outputPath ?? finalCapture?.outputPath ?? null,
            ocrAvailable: Boolean(finalVisionSnapshot?.ocr?.available),
            ocrEngine: finalVisionSnapshot?.ocr?.engine ?? null
          })
        ]
      };
      if (desktopVerification.checks.some((check) => check.status !== "pass")) {
        desktopVerification.overallStatus = "fail";
      }
      const updatedDesktopMemory = updateDesktopAutonomyMemory(desktopMemory, {
        run,
        desktopPlan: desktopPlan.output,
        actionLog,
        observationSummary,
        outcomeStatus: desktopVerification.overallStatus === "pass" ? "completed" : "failed"
      });
      this.#saveDesktopAutonomyMemory(updatedDesktopMemory);
      // Semantic outcome verification — validates user objective, not just procedural steps
      const desktopSemanticVerification = new SemanticOutcomeVerifier().verify({
        mission: run.mission,
        planOutcomes: desktopPlan.output.verificationGoals ?? [],
        actionLog,
        evidence: evidence.evidenceId ? [{ id: evidence.evidenceId }] : [],
        artifacts: [],
        browserResult: null,
        desktopState: { activeWindow: activeAccessibilityAfter ?? null },
        trackerSnapshot: missionTracker.toSnapshot()
      });
      missionTracker.setFinalVerification(desktopSemanticVerification);
      missionTracker.complete({ verifiedByOutcomes: desktopSemanticVerification.verifiedByOutcomes });
      await this.#mergeRunMetadata(run.id, {
        desktopObservationSummary: observationSummary,
        desktopMemorySummary: summarizeDesktopAutonomyMemory(updatedDesktopMemory),
        selectedApplication: desktopPlan.output.selectedApplication ?? null,
        selectedApplicationId: desktopPlan.output.selectedApplication?.id ?? null,
        missionProgress: missionTracker.toSnapshot(),
        semanticVerification: {
          verifiedByOutcomes: desktopSemanticVerification.verifiedByOutcomes,
          verificationVerdict: desktopSemanticVerification.verificationVerdict,
          objectiveSatisfied: desktopSemanticVerification.objectiveSatisfied,
          confidence: desktopSemanticVerification.confidence,
          failureReason: desktopSemanticVerification.failureReason,
          nextBestAction: desktopSemanticVerification.nextBestAction,
          unsatisfiedOutcomes: desktopSemanticVerification.unsatisfiedOutcomes,
          satisfiedOutcomes: desktopSemanticVerification.satisfiedOutcomes
        }
      });
      await this.#recordVerificationSummary(run.id, desktopVerification);
      this.#recordCapabilityFeedbackForDesktopPlan({
        run,
        desktopPlan: desktopPlan.output,
        actionLog,
        outcomeStatus: desktopVerification.overallStatus === "pass" ? "success" : "failed"
      });
      if (desktopVerification.overallStatus !== "pass") {
        throw new Error("Desktop autonomy verification failed after execution.");
      }
      if (!desktopSemanticVerification.verifiedByOutcomes) {
        throw new Error(`Desktop autonomy semantic verification failed: ${desktopSemanticVerification.failureReason ?? desktopSemanticVerification.verificationVerdict}`);
      }

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Governed desktop autonomy run completed."
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, "Governed desktop autonomy scenario completed.", {
        actionCount: actionLog.length,
        selectedApplicationId: desktopPlan.output.selectedApplication?.id ?? null
      }));
      auditMissionExecution({
        projectId: project.id,
        runId: run.id,
        mission: run.mission,
        finalStatus: "completed",
        actionLog,
        consecutiveFailures
      });
      return {
        ...(await this.getRunBundle(run.id)),
        desktopPlan: desktopPlan.output
      };
    } catch (error) {
      const observationSummary = observationTimeline
        ? summarizeDesktopObservationTimeline(observationTimeline)
        : null;
      const userFacingError = buildDesktopUserFacingError({
        error,
        actionLog: actionLogForFeedback,
        observationSummary,
        latestEvidencePath: latestDesktopEvidencePath
      });
      const failedDesktopMemory = updateDesktopAutonomyMemory(desktopMemoryForRun, {
        run,
        desktopPlan: desktopPlanForFeedback,
        actionLog: actionLogForFeedback,
        observationSummary,
        outcomeStatus: "failed"
      });
      this.#saveDesktopAutonomyMemory(failedDesktopMemory);
      await this.#mergeRunMetadata(run.id, {
        desktopObservationSummary: observationSummary,
        desktopMemorySummary: summarizeDesktopAutonomyMemory(failedDesktopMemory),
        userFacingError
      }).catch(() => {});
      auditMissionExecution({
        projectId: project.id,
        runId: run.id,
        mission: run.mission,
        finalStatus: "failed",
        actionLog: actionLogForFeedback,
        consecutiveFailures: 0,
        stoppedReason: error.message
      });
      this.#recordCapabilityFeedbackForDesktopPlan({
        run,
        desktopPlan: desktopPlanForFeedback,
        actionLog: actionLogForFeedback,
        outcomeStatus: "failed",
        notes: error.message
      });
      await this.#failRun(run.id, error);
      throw error;
    } finally {
      await desktopWatcher?.stop?.();
    }
  }

  async #executeComputerBrowserLaunchScenario({
    run,
    runDir,
    project,
    desktopAction,
    surfaceClassification,
    evidenceSensitivity
  }) {
    try {
      const planDraft = await this.#generatePlan({
        run,
        project,
        scenarioType: "computer_observation"
      });

      await this.#stageRun(run.id, {
        status: RUN_STATUS.PLANNED,
        lifecycleStage: "plan_generated",
        summary: "Plan generated.",
        plan: planDraft.plan
      }, "plan.generated", "Computer desktop action plan generated.");

      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: desktopAction.type === "launch_browser_search"
          ? "Desktop browser search running."
          : "Desktop browser launch running."
      }, "run.started", desktopAction.type === "launch_browser_search"
        ? "Desktop browser search scenario started."
        : "Desktop browser launch scenario started.");

      const availableBrowsers = await this.computer.listInstalledBrowsers();
      const beforeWindow = await this.computer.detectActiveWindow();
      const visibleWindowsBefore = await this.computer.listVisibleWindows();
      const approvalContextEvidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "browser-launch-approval-context", {
        availableBrowsers,
        selectedBrowser: desktopAction.browser,
        activeWindow: beforeWindow,
        visibleWindowsBefore,
        surfaceClassification
      });
      this.database.insertEvidence(run.id, {
        id: approvalContextEvidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
        label: "Desktop browser launch approval context",
        storagePath: approvalContextEvidence.outputPath,
        linkedSurface: beforeWindow?.title ?? desktopAction.browser?.label ?? "desktop",
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: evidenceSensitivity,
        metadata: {
          browserId: desktopAction.browser?.id ?? null,
          browserLabel: desktopAction.browser?.label ?? null,
          surfaceClassification
        },
        createdAt: nowIso()
      });
      const approvalContextEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored desktop browser launch approval context.", {
        evidenceId: approvalContextEvidence.evidenceId,
        browserId: desktopAction.browser?.id ?? null,
        surfaceClassification
      }));
      this.database.updateEvidence(approvalContextEvidence.evidenceId, {
        linkedEventId: approvalContextEvent.id
      });

      const agentConfigForBrowser = this.#getAgentConfiguration();
      const trustedBrowserIds = agentConfigForBrowser.guardrails?.trustedBrowserIds ?? [];
      const browserId = desktopAction.browser?.id ?? "";
      const isTrustedBrowser = trustedBrowserIds.some((entry) =>
        String(entry).toLowerCase() === String(browserId).toLowerCase()
      );
      if (!isTrustedBrowser) {
        const authorization = await this.policy.authorize({
          runId: run.id,
          category: APPROVAL_CATEGORY.LOCAL_APP_LAUNCH,
          riskLevel: "medium",
          actionLabel: `Open ${desktopAction.browser?.label ?? "browser"}`,
          targetLabel: desktopAction.browser?.label ?? desktopAction.browser?.id ?? "browser",
          reason: "The run needs to open one bounded local browser application before any further desktop-visible step can happen.",
          expectedEffect: `${desktopAction.browser?.label ?? "The selected browser"} will open on this machine.`,
          consequenceOfRefusal: "The run cannot continue with the requested desktop-visible browser step.",
          evidenceId: approvalContextEvidence.evidenceId,
          metadata: {
            browserId: desktopAction.browser?.id ?? null,
            browserLabel: desktopAction.browser?.label ?? null,
            browserExecutablePath: desktopAction.browser?.executablePath ?? null,
            reversibility: "reversible_local_launch",
            surfaceClassification
          }
        });
        if (!authorization.allowed) {
          return this.#stopRunFromApproval(run.id, authorization.approvalRecord, `Open ${desktopAction.browser?.label ?? "browser"}`);
        }
      }

      const launchResult = await this.computer.launchBrowser(desktopAction.browser.id, {
        url: desktopAction.url ?? null
      });
      this.#recordEvent(run.id, createEvent("tool.executed", EVENT_ACTOR.COMPUTER, desktopAction.type === "launch_browser_search"
        ? `Desktop browser search requested for ${desktopAction.browser.label}.`
        : `Desktop browser launch requested for ${desktopAction.browser.label}.`, {
        tool: desktopAction.type,
        browserId: desktopAction.browser.id,
        browserLabel: desktopAction.browser.label,
        launchUrl: desktopAction.url ?? null,
        searchQuery: desktopAction.searchQuery ?? null
      }));

      const visibleWindowIdsBefore = new Set(visibleWindowsBefore.map((windowState) => windowState.id));
      const launchWait = await this.computer.waitForVisibleWindowMatch((windowState) => {
        return String(windowState.processName ?? "").toLowerCase() === String(desktopAction.browser.processName ?? "").toLowerCase()
          || String(windowState.executablePath ?? "").toLowerCase() === String(desktopAction.browser.executablePath ?? "").toLowerCase();
      }, {
        timeoutMs: 5000,
        intervalMs: 150
      });
      const launchedWindow = launchWait.visibleWindows?.find((windowState) => {
        const matchesBrowser = String(windowState.processName ?? "").toLowerCase() === String(desktopAction.browser.processName ?? "").toLowerCase()
          || String(windowState.executablePath ?? "").toLowerCase() === String(desktopAction.browser.executablePath ?? "").toLowerCase();
        return matchesBrowser && !visibleWindowIdsBefore.has(windowState.id);
      }) ?? launchWait.matchedWindow ?? null;
      const afterWindow = await this.computer.detectActiveWindow();
      const windowCapture = launchedWindow
        ? await this.computer.captureWindow(launchedWindow.id)
        : null;
      const browserBecameVisible = Boolean(launchWait.validated && launchedWindow);
      const browserIsForeground = Boolean(afterWindow && (
        String(afterWindow.processName ?? "").toLowerCase() === String(desktopAction.browser.processName ?? "").toLowerCase()
        || String(afterWindow.executablePath ?? "").toLowerCase() === String(desktopAction.browser.executablePath ?? "").toLowerCase()
      ));
      const verification = {
        validated: Boolean(browserBecameVisible && (!visibleWindowIdsBefore.has(launchedWindow?.id ?? "") || browserIsForeground)),
        ambiguous: !launchWait.validated,
        observed: {
          launchResult,
          launchedWindow,
          activeWindowAfterLaunch: afterWindow,
          browserIsForeground
        }
      };

      const evidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "browser-launch", {
        availableBrowsers,
        selectedBrowser: desktopAction.browser,
        beforeWindow,
        visibleWindowsBefore,
        launchResult,
        launchWait,
        launchedWindow,
        activeWindowAfterLaunch: afterWindow,
        windowCapture,
        verification,
        surfaceClassification
      });

      this.database.insertEvidence(run.id, {
        id: evidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
        label: "Desktop browser launch evidence",
        storagePath: evidence.outputPath,
        linkedSurface: desktopAction.browser?.label ?? "browser",
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: evidenceSensitivity,
        metadata: {
          screenshotPath: windowCapture?.outputPath ?? null,
          browserId: desktopAction.browser?.id ?? null,
          browserLabel: desktopAction.browser?.label ?? null,
          surfaceClassification
        },
        createdAt: nowIso()
      });
      const evidenceEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored desktop browser launch evidence.", {
        evidenceId: evidence.evidenceId,
        browserId: desktopAction.browser?.id ?? null,
        surfaceClassification
      }));
      this.database.updateEvidence(evidence.evidenceId, {
        linkedEventId: evidenceEvent.id
      });

      const expectedLaunchUrl = String(desktopAction.url ?? "").trim();
      const requestedResultCount = extractRequestedBrowserResultCount(run, desktopAction);
      const extractedResultCount = countExtractedBrowserResults(desktopAction, launchResult, windowCapture);
      const launchUrlWasUsed = !expectedLaunchUrl
        || String(launchResult?.url ?? "") === expectedLaunchUrl
        || String(launchedWindow?.title ?? "").includes(expectedLaunchUrl)
        || String(windowCapture?.content ?? "").includes(expectedLaunchUrl);
      const browserLaunchVerification = {
        scenarioType: "computer_observation",
        verificationGoals: planDraft.plan.missionUnderstanding?.verificationGoals ?? [],
        requestedOutcomes: planDraft.plan.missionUnderstanding?.requestedOutcomes ?? [],
        boundaryNotices: planDraft.plan.missionUnderstanding?.unsupportedRequests ?? [],
        overallStatus: "pass",
        checks: [
          verificationCheck("The selected browser was available on this machine.", availableBrowsers.some((browser) => browser.id === desktopAction.browser.id), {
            browserId: desktopAction.browser.id,
            browserCount: availableBrowsers.length
          }),
          verificationCheck("A visible browser window appeared after launch.", Boolean(launchWait.validated && launchedWindow), {
            matchedWindowId: launchedWindow?.id ?? null,
            matchedProcessName: launchedWindow?.processName ?? null
          }),
          verificationCheck("The launched browser became the active context or opened a new visible window.", verification.validated, {
            activeWindowProcessName: afterWindow?.processName ?? null,
            matchedWindowId: launchedWindow?.id ?? null,
            wasNewWindow: launchedWindow ? !visibleWindowIdsBefore.has(launchedWindow.id) : false
          }),
          verificationCheck("Desktop launch proof was persisted.", Boolean(evidence.evidenceId), {
            evidenceId: evidence.evidenceId,
            screenshotCaptured: Boolean(windowCapture?.outputPath)
          }),
          ...(expectedLaunchUrl
            ? [verificationCheck("The requested browser launch URL was used.", launchUrlWasUsed, {
              requestedUrl: expectedLaunchUrl,
              launchedUrl: launchResult?.url ?? null,
              launchedWindowTitle: launchedWindow?.title ?? null
            })]
            : []),
          ...(requestedResultCount
            ? [verificationCheck("The requested browser result list was extracted.", extractedResultCount >= requestedResultCount, {
              requestedResultCount,
              extractedResultCount
            })]
            : [])
        ]
      };
      if (browserLaunchVerification.checks.some((check) => check.status !== "pass")) {
        browserLaunchVerification.overallStatus = "fail";
      }
      await this.#recordVerificationSummary(run.id, browserLaunchVerification);
      if (browserLaunchVerification.overallStatus !== "pass") {
        const incompleteDeliverable = Boolean(requestedResultCount && extractedResultCount < requestedResultCount);
        const browserLaunchPrimitivePassed = browserLaunchVerification.checks
          .filter((check) => check.label !== "The requested browser result list was extracted.")
          .every((check) => check.status === "pass");
        if (incompleteDeliverable && browserLaunchPrimitivePassed) {
          const summary = `Browser was opened, but the requested ${requestedResultCount} results were not extracted.`;
          await this.#updateRun(run.id, {
            status: RUN_STATUS.FAILED,
            lifecycleStage: "failed_incomplete_deliverable",
            summary
          });
          this.#recordEvent(run.id, createEvent("run.failed", EVENT_ACTOR.AGENT, "Browser launch completed but the requested result list was not delivered.", {
            browserId: desktopAction.browser.id,
            browserLabel: desktopAction.browser.label,
            requestedResultCount,
            extractedResultCount,
            reason: "incomplete_deliverable"
          }));
          return {
            ...(await this.getRunBundle(run.id)),
            verification
          };
        }
        throw new Error("Desktop browser launch verification failed after execution.");
      }

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: desktopAction.type === "launch_browser_search"
          ? `${desktopAction.browser.label} search step was executed and verified.`
          : `${desktopAction.browser.label} was opened and verified.`
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, desktopAction.type === "launch_browser_search"
        ? "Desktop browser search scenario completed."
        : "Desktop browser launch scenario completed.", {
        browserId: desktopAction.browser.id,
        browserLabel: desktopAction.browser.label,
        searchQuery: desktopAction.searchQuery ?? null
      }));
      return {
        ...(await this.getRunBundle(run.id)),
        verification
      };
    } catch (error) {
      await this.#failRun(run.id, error);
      throw error;
    }
  }

  async #executeComputerObservationScenario({
    run,
    runDir,
    allowlistedWindowId,
    expectedMatcher,
    surfaceClassification = "controlled_fixture_window",
    evidenceSensitivity = "controlled_fixture",
    targetWindowLabel = null,
    targetWindowRule = null
  }) {
    try {
      const planDraft = await this.#generatePlan({
        run,
        project: null,
        scenarioType: "computer_observation"
      });

      await this.#stageRun(run.id, {
        status: RUN_STATUS.PLANNED,
        lifecycleStage: "plan_generated",
        summary: "Plan generated.",
        plan: planDraft.plan
      }, "plan.generated", "Computer observation plan generated.");

      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: "Computer observation running."
      }, "run.started", "Computer observation scenario started.");

      const beforeWindow = await this.computer.detectActiveWindow();
      if (!beforeWindow || beforeWindow.id !== allowlistedWindowId) {
        const visibleWindows = await this.computer.listVisibleWindows();
        const focusContextEvidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "focus-approval-context", {
          activeWindow: beforeWindow,
          visibleWindows,
          surfaceClassification,
          targetWindowLabel,
          targetWindowRule
        });
        this.database.insertEvidence(run.id, {
          id: focusContextEvidence.evidenceId,
          evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
          label: "Computer focus approval context",
          storagePath: focusContextEvidence.outputPath,
          linkedSurface: beforeWindow?.title ?? "unknown_window",
          linkedEventId: null,
          linkedSourceId: null,
          sensitivity: evidenceSensitivity,
          metadata: {
            targetWindowId: allowlistedWindowId,
            activeWindowId: beforeWindow?.id ?? null,
            surfaceClassification,
            targetWindowLabel,
            targetWindowRule
          },
          createdAt: nowIso()
        });
        const focusContextEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored local focus approval context.", {
          evidenceId: focusContextEvidence.evidenceId,
          targetWindowId: allowlistedWindowId,
          surfaceClassification
        }));
        this.database.updateEvidence(focusContextEvidence.evidenceId, {
          linkedEventId: focusContextEvent.id
        });
        const authorization = await this.policy.authorize({
          runId: run.id,
          category: APPROVAL_CATEGORY.LOCAL_FOCUS,
          riskLevel: "medium",
          actionLabel: "Focus local allowlisted window",
          targetLabel: allowlistedWindowId,
          reason: "The run needs the correct allowlisted local surface in focus to capture evidence.",
          expectedEffect: "The controlled local window will become active.",
          consequenceOfRefusal: "The local context remains ambiguous and the run should stop.",
          evidenceId: focusContextEvidence.evidenceId,
          metadata: {
            targetWindowId: allowlistedWindowId,
            targetWindowTitle: visibleWindows.find((candidate) => candidate.id === allowlistedWindowId)?.title ?? targetWindowLabel ?? allowlistedWindowId,
            targetWindowAllowlisted: true,
            reversibility: "reversible_context_switch",
            surfaceClassification,
            targetWindowRule
          }
        });
        if (!authorization.allowed) {
          return this.#stopRunFromApproval(run.id, authorization.approvalRecord, "Focus local allowlisted window");
        }
        await this.computer.focusWindow(allowlistedWindowId);
      }

      const focusedWindow = await this.computer.detectActiveWindow();
      if (!focusedWindow || focusedWindow.id !== allowlistedWindowId) {
        throw new Error(`Focused window did not match expected allowlisted window: ${allowlistedWindowId}`);
      }
      const beforeCapture = await this.computer.captureWindow(focusedWindow.id);
      const waitResult = await this.computer.waitForUiState(focusedWindow.id, expectedMatcher);
      const afterCapture = await this.computer.captureWindow(focusedWindow.id);
      const verification = await this.computer.verifyVisibleOutcome(beforeCapture, afterCapture, (before, after) => expectedMatcher({
        ...after,
        windowId: after.window?.id ?? after.windowId ?? focusedWindow.id,
        title: after.window?.title ?? after.title ?? focusedWindow.title ?? null,
        content: after.content ?? after.observation?.content ?? after.observation?.title ?? after.window?.title ?? null,
        previousContent: before.content ?? before.observation?.content ?? before.observation?.title ?? before.window?.title ?? null
      }));

      const evidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "computer-observation", {
        focusedWindow,
        beforeCapture,
        afterCapture,
        waitResult,
        verification,
        surfaceClassification,
        targetWindowLabel: targetWindowLabel ?? focusedWindow.title,
        targetWindowRule
      });

      this.database.insertEvidence(run.id, {
        id: evidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
        label: "Computer control observation evidence",
        storagePath: evidence.outputPath,
        linkedSurface: focusedWindow.title,
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: evidenceSensitivity,
        metadata: {
          beforeCapturePath: beforeCapture.outputPath ?? null,
          afterCapturePath: afterCapture.outputPath ?? null,
          surfaceClassification,
          targetWindowLabel: targetWindowLabel ?? focusedWindow.title,
          targetWindowRule
        },
        createdAt: nowIso()
      });
      const evidenceEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored computer observation evidence.", {
        evidenceId: evidence.evidenceId,
        targetWindowId: focusedWindow.id,
        surfaceClassification
      }));
      this.database.updateEvidence(evidence.evidenceId, {
        linkedEventId: evidenceEvent.id
      });

      const computerVerification = {
        scenarioType: "computer_observation",
        verificationGoals: planDraft.plan.missionUnderstanding?.verificationGoals ?? [],
        requestedOutcomes: planDraft.plan.missionUnderstanding?.requestedOutcomes ?? [],
        boundaryNotices: planDraft.plan.missionUnderstanding?.unsupportedRequests ?? [],
        overallStatus: "pass",
        checks: [
          verificationCheck("The focused window matched the allowlisted target.", focusedWindow.id === allowlistedWindowId, {
            focusedWindowId: focusedWindow.id,
            allowlistedWindowId
          }),
          verificationCheck("The expected visible state was observed.", waitResult.validated && verification.validated, {
            waitValidated: waitResult.validated,
            verificationValidated: verification.validated
          }),
          verificationCheck("Observation proof was persisted.", Boolean(evidence.evidenceId), {
            evidenceId: evidence.evidenceId
          })
        ]
      };
      if (computerVerification.checks.some((check) => check.status !== "pass")) {
        computerVerification.overallStatus = "fail";
      }
      await this.#recordVerificationSummary(run.id, computerVerification);
      if (computerVerification.overallStatus !== "pass") {
        throw new Error("Computer-observation verification failed after execution.");
      }

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Computer observation scenario completed."
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, "Computer observation scenario completed."));
      return {
        ...(await this.getRunBundle(run.id)),
        verification
      };
    } catch (error) {
      await this.#failRun(run.id, error);
      throw error;
    }
  }

  async #executeComputerWindowCaptureScenario({
    run,
    runDir,
    desktopAction,
    surfaceClassification = "real_local_browser",
    evidenceSensitivity = "real_local_browser",
    targetWindowLabel = null,
    targetWindowRule = null
  }) {
    try {
      const planDraft = await this.#generatePlan({
        run,
        project: null,
        scenarioType: "computer_observation"
      });

      await this.#stageRun(run.id, {
        status: RUN_STATUS.PLANNED,
        lifecycleStage: "plan_generated",
        summary: "Plan generated.",
        plan: planDraft.plan
      }, "plan.generated", "Computer capture plan generated.");

      await this.#stageRun(run.id, {
        status: RUN_STATUS.RUNNING,
        lifecycleStage: "executing",
        summary: "Desktop capture running."
      }, "run.started", "Desktop capture scenario started.");

      const visibleWindows = await this.computer.listVisibleWindows();
      const activeWindow = await this.computer.detectActiveWindow();
      const wantsBrowserCapture = desktopAction?.type === "capture_browser_window";
      const matchedBrowserWindow = wantsBrowserCapture
        ? visibleWindows.find((windowState) => {
          return String(windowState.processName ?? "").toLowerCase() === String(desktopAction.browser?.processName ?? "").toLowerCase()
            || String(windowState.executablePath ?? "").toLowerCase() === String(desktopAction.browser?.executablePath ?? "").toLowerCase();
        }) ?? null
        : null;

      const targetWindow = wantsBrowserCapture
        ? matchedBrowserWindow
        : activeWindow;

      if (!targetWindow) {
        throw new Error(wantsBrowserCapture
          ? `No visible ${desktopAction.browser?.label ?? "browser"} window was found for capture.`
          : "No active window was available for capture.");
      }

      if (wantsBrowserCapture && activeWindow?.id !== targetWindow.id) {
        const approvalContextEvidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "capture-focus-approval-context", {
          activeWindow,
          visibleWindows,
          targetWindow,
          surfaceClassification,
          targetWindowLabel,
          targetWindowRule
        });
        this.database.insertEvidence(run.id, {
          id: approvalContextEvidence.evidenceId,
          evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
          label: "Desktop capture focus approval context",
          storagePath: approvalContextEvidence.outputPath,
          linkedSurface: activeWindow?.title ?? targetWindow.title,
          linkedEventId: null,
          linkedSourceId: null,
          sensitivity: evidenceSensitivity,
          metadata: {
            targetWindowId: targetWindow.id,
            targetWindowLabel: targetWindow.title,
            surfaceClassification,
            targetWindowRule
          },
          createdAt: nowIso()
        });
        const focusContextEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored desktop capture focus approval context.", {
          evidenceId: approvalContextEvidence.evidenceId,
          targetWindowId: targetWindow.id,
          surfaceClassification
        }));
        this.database.updateEvidence(approvalContextEvidence.evidenceId, {
          linkedEventId: focusContextEvent.id
        });
        const authorization = await this.policy.authorize({
          runId: run.id,
          category: APPROVAL_CATEGORY.LOCAL_FOCUS,
          riskLevel: "medium",
          actionLabel: "Focus target window for capture",
          targetLabel: targetWindow.title,
          reason: "The run needs the correct visible window in focus before capturing proof.",
          expectedEffect: "The targeted local window will become active for the screenshot step.",
          consequenceOfRefusal: "The run cannot safely capture the intended visible window.",
          evidenceId: approvalContextEvidence.evidenceId,
          metadata: {
            targetWindowId: targetWindow.id,
            targetWindowTitle: targetWindow.title,
            targetWindowRule,
            surfaceClassification,
            reversibility: "reversible_context_switch"
          }
        });
        if (!authorization.allowed) {
          return this.#stopRunFromApproval(run.id, authorization.approvalRecord, "Focus target window for capture");
        }
        await this.computer.focusWindow(targetWindow.id);
      }

      const focusedWindow = wantsBrowserCapture
        ? await this.computer.detectActiveWindow()
        : targetWindow;
      const captureTarget = wantsBrowserCapture ? focusedWindow : targetWindow;
      if (!captureTarget) {
        throw new Error("The run could not confirm a target window for the capture step.");
      }

      const capture = await this.computer.captureWindow(captureTarget.id);
      const evidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), wantsBrowserCapture ? "browser-window-capture" : "active-window-capture", {
        activeWindow,
        targetWindow,
        capture,
        desktopAction,
        surfaceClassification
      });

      this.database.insertEvidence(run.id, {
        id: evidence.evidenceId,
        evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
        label: wantsBrowserCapture ? "Desktop browser capture evidence" : "Desktop active-window capture evidence",
        storagePath: evidence.outputPath,
        linkedSurface: captureTarget.title,
        linkedEventId: null,
        linkedSourceId: null,
        sensitivity: evidenceSensitivity,
        metadata: {
          screenshotPath: capture.outputPath ?? null,
          targetWindowId: captureTarget.id,
          targetWindowTitle: captureTarget.title,
          browserId: desktopAction?.browser?.id ?? null,
          browserLabel: desktopAction?.browser?.label ?? null,
          surfaceClassification,
          targetWindowRule
        },
        createdAt: nowIso()
      });
      const evidenceEvent = this.#recordEvent(run.id, createEvent("evidence.recorded", EVENT_ACTOR.COMPUTER, "Stored desktop capture evidence.", {
        evidenceId: evidence.evidenceId,
        targetWindowId: captureTarget.id,
        surfaceClassification
      }));
      this.database.updateEvidence(evidence.evidenceId, {
        linkedEventId: evidenceEvent.id
      });

      const captureVerification = {
        scenarioType: "computer_observation",
        verificationGoals: planDraft.plan.missionUnderstanding?.verificationGoals ?? [],
        requestedOutcomes: planDraft.plan.missionUnderstanding?.requestedOutcomes ?? [],
        boundaryNotices: planDraft.plan.missionUnderstanding?.unsupportedRequests ?? [],
        overallStatus: "pass",
        checks: [
          verificationCheck("The intended window was available for capture.", Boolean(targetWindow), {
            targetWindowId: targetWindow?.id ?? null,
            targetWindowTitle: targetWindow?.title ?? null
          }),
          verificationCheck("A screenshot capture was written for this run.", Boolean(capture?.outputPath), {
            screenshotPath: capture?.outputPath ?? null
          }),
          verificationCheck("Capture proof was persisted.", Boolean(evidence.evidenceId), {
            evidenceId: evidence.evidenceId
          })
        ]
      };
      if (captureVerification.checks.some((check) => check.status !== "pass")) {
        captureVerification.overallStatus = "fail";
      }
      await this.#recordVerificationSummary(run.id, captureVerification);
      if (captureVerification.overallStatus !== "pass") {
        throw new Error("Desktop window capture verification failed after execution.");
      }

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: wantsBrowserCapture
          ? `${desktopAction.browser?.label ?? "Browser"} screenshot captured and verified.`
          : "Active-window screenshot captured and verified."
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, wantsBrowserCapture
        ? "Desktop browser capture scenario completed."
        : "Desktop active-window capture scenario completed.", {
        browserId: desktopAction?.browser?.id ?? null,
        targetWindowId: captureTarget.id
      }));
      return {
        ...(await this.getRunBundle(run.id)),
        verification: {
          validated: true,
          ambiguous: false,
          observed: {
            targetWindow,
            capture
          }
        }
      };
    } catch (error) {
      await this.#failRun(run.id, error);
      throw error;
    }
  }

  async #createRun(project, mission, metadata) {
    const llmStatus = this.getLlmGatewayStatus();
    const run = {
      id: createId("run"),
      projectId: project.id,
      mission,
      status: RUN_STATUS.CREATED,
      lifecycleStage: "created",
      plan: null,
      summary: "Run created.",
      metadata: {
        ...metadata,
        llm: {
          providerMode: llmStatus.providerMode,
          effectiveMode: llmStatus.effectiveMode,
          availableProviders: llmStatus.availableProviders,
          promptEnvironment: llmStatus.promptEnvironment,
          budgets: llmStatus.budgets,
          configIssues: llmStatus.configIssues,
          deterministicFallback: llmStatus.deterministicFallback
        }
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.database.insertRun(run);
    this.#recordEvent(run.id, createEvent("run.created", EVENT_ACTOR.SYSTEM, "Run created.", {
      projectId: project.id,
      mission
    }));
    return run;
  }

  #buildReasoningBindings(bindings, reasoningSnapshot) {
    return {
      ...bindings,
      reasoningContextJson: JSON.stringify(reasoningSnapshot.llmContext)
    };
  }

  #buildReasoningMetadata(reasoningStage, reasoningSnapshot, metadata = {}) {
    return {
      ...metadata,
      reasoningStage,
      contextSnapshotId: reasoningSnapshot.id,
      matchedObservationIds: reasoningSnapshot.observations.map((observation) => observation.id),
      matchedGuidelineIds: reasoningSnapshot.guidelines.map((guideline) => guideline.id),
      resolvedVariableIds: reasoningSnapshot.variables.map((variable) => variable.id),
      sourceIdsUsed: reasoningSnapshot.sources.map((source) => source.id),
      artifactIdsUsed: reasoningSnapshot.artifacts.map((artifact) => artifact.id),
      evidenceIdsUsed: reasoningSnapshot.evidence.map((entry) => entry.id),
      policyConstraintIds: reasoningSnapshot.policyConstraints.map((constraint) => constraint.id),
      injectionReasonsSummary: reasoningSnapshot.preview?.injectionReasonSummary ?? null
    };
  }

  #composeMissionPreviewText(missionDraft = {}) {
    const lines = [`Objective: ${String(missionDraft.objective ?? "").trim() || "Unknown mission"}`];
    if (missionDraft.deliverable) {
      lines.push(`Expected deliverable: ${String(missionDraft.deliverable).trim()}`);
    }
    const constraints = Array.isArray(missionDraft.constraints) ? missionDraft.constraints : [];
    if (constraints.length > 0) {
      lines.push("Constraints:");
      for (const constraint of constraints) {
        lines.push(`- ${constraint}`);
      }
    }
    const forbiddenActions = Array.isArray(missionDraft.forbiddenActions) ? missionDraft.forbiddenActions : [];
    if (forbiddenActions.length > 0) {
      lines.push("Actions to avoid:");
      for (const action of forbiddenActions) {
        lines.push(`- ${action}`);
      }
    }
    if (missionDraft.mode) {
      lines.push(`Preferred execution hint: ${missionDraft.mode}.`);
    }
    return lines.join("\n");
  }

  #createPreviewReasoningSnapshot({ run, project, scenarioType, missionDraft, availableBrowsers }) {
    const projectMemory = this.#getProjectMemorySummary(project?.id);
    const userMemory = this.#getUserMemorySummary();
    return this.reasoning.createSnapshot({
      stage: REASONING_STAGE.MISSION_UNDERSTANDING,
      run,
      project,
      bundle: {
        run,
        events: [],
        approvals: [],
        sources: [],
        evidence: [],
        artifacts: [],
        llmCalls: [],
        reasoningSnapshots: []
      },
      llmStatus: this.getLlmGatewayStatus(),
      pendingApprovals: [],
      inputs: {
        mission: run.mission,
        scenarioType,
        missionSpec: missionDraft,
        allowlistedDomains: project?.allowlistedDomains ?? [],
        availableBrowsers,
        projectMemory,
        userMemory
      },
      priorSnapshots: []
    });
  }

  async #previewMissionUnderstanding({ run, project, scenarioType, missionDraft, availableBrowsers }) {
    const projectMemory = this.#getProjectMemorySummary(project?.id);
    const userMemory = this.#getUserMemorySummary();
    const reasoningSnapshot = this.#createPreviewReasoningSnapshot({
      run,
      project,
      scenarioType,
      missionDraft,
      availableBrowsers
    });
    const input = {
      mission: run.mission,
      scenarioType,
      missionSpec: missionDraft,
      allowlistedDomains: project?.allowlistedDomains ?? [],
      availableBrowsers,
      projectMemory,
      userMemory
    };
    const bindings = {
      mission: run.mission,
      scenarioType,
      missionSpec: JSON.stringify(missionDraft ?? null),
      allowlistedDomains: JSON.stringify(project?.allowlistedDomains ?? []),
      availableBrowsers: JSON.stringify(availableBrowsers ?? []),
      projectMemory: JSON.stringify(projectMemory ?? null),
      userMemory: JSON.stringify(userMemory ?? null)
    };
    const preparedPayload = prepareRuntimeReasoningPayload({
      reasoningStage: REASONING_STAGE.MISSION_UNDERSTANDING,
      reasoningSnapshot,
      bindings,
      input
    });
    const modelAlias = selectPreferredModelAlias(REASONING_STAGE.MISSION_UNDERSTANDING);
    const promptRefs = [
      PRIMARY_REASONING_PROMPT,
      {
        promptId: "task.mission_understanding",
        version: "1.0.0",
        bindings: preparedPayload.bindings
      }
    ];
    try {
      const result = await this.llmGateway.generateStructured({
        runId: run.id,
        projectId: run.projectId,
        callType: LLM_CALL_TYPE.MISSION_UNDERSTANDING,
        modelAlias,
        promptRefs,
        input: preparedPayload.input,
        metadata: this.#buildReasoningMetadata(REASONING_STAGE.MISSION_UNDERSTANDING, reasoningSnapshot, {
          missionPreflight: true,
          inputCompaction: preparedPayload.compaction,
          tokenGovernancePolicyId: preparedPayload.policy.id,
          requestedModelAlias: modelAlias
        }),
        validateOutput: (output) => validateMissionUnderstandingOutput(output, {
          availableBrowsers
        })
      });
      return {
        output: result.output,
        callRecord: result.callRecord,
        reasoningSnapshot,
        generationMode: "llm"
      };
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      return {
        output: buildDeterministicMissionUnderstandingOutput(input),
        callRecord: error.callRecord ?? null,
        reasoningSnapshot: error.reasoningSnapshot ?? reasoningSnapshot,
        generationMode: "deterministic_fallback"
      };
    }
  }

  async #createReasoningSnapshot({ run, project, stage, inputs, priorSnapshots = [] }) {
    const bundle = await this.getRunBundle(run.id);
    const snapshot = this.reasoning.createSnapshot({
      stage,
      run,
      project,
      bundle,
      llmStatus: this.getLlmGatewayStatus(),
      pendingApprovals: [],
      inputs,
      priorSnapshots
    });
    this.database.insertReasoningContextSnapshot(snapshot);
    this.#recordEvent(run.id, createEvent("reasoning.context_snapshot.created", EVENT_ACTOR.AGENT, `Reasoning context snapshot created: ${stage}.`, {
      reasoningStage: stage,
      contextSnapshotId: snapshot.id,
      matchedObservationIds: snapshot.observations.map((observation) => observation.id),
      matchedGuidelineIds: snapshot.guidelines.map((guideline) => guideline.id)
    }));
    return snapshot;
  }

  async #invokeReasonedLlm({
    run,
    project,
    reasoningStage,
    callType,
    taskPromptId,
    bindings,
    input,
    metadata = {},
    validateOutput,
    priorSnapshots = [],
    extraMessages = []
  }) {
    const reasoningSnapshot = await this.#createReasoningSnapshot({
      run,
      project,
      stage: reasoningStage,
      inputs: input,
      priorSnapshots
    });
    const preparedPayload = prepareRuntimeReasoningPayload({
      reasoningStage,
      reasoningSnapshot,
      bindings,
      input
    });
    const modelAlias = selectPreferredModelAlias(reasoningStage);

    const promptRefs = [
      PRIMARY_REASONING_PROMPT,
      {
        promptId: taskPromptId,
        version: "1.0.0",
        bindings: preparedPayload.bindings
      }
    ];

    const llmResult = await this.#invokeLlm({
      run,
      callType,
      modelAlias,
      promptRefs,
      input: preparedPayload.input,
      metadata: this.#buildReasoningMetadata(reasoningStage, reasoningSnapshot, {
        ...metadata,
        inputCompaction: preparedPayload.compaction,
        tokenGovernancePolicyId: preparedPayload.policy.id,
        requestedModelAlias: modelAlias
      }),
      validateOutput,
      extraMessages
    }).catch((error) => {
      error.reasoningSnapshot = reasoningSnapshot;
      throw error;
    });

    return {
      ...llmResult,
      reasoningSnapshot
    };
  }

  async #generatePlan({ run, project, scenarioType }) {
    const availableBrowsers = await this.#listAvailableBrowsers();
    const projectMemory = this.#getProjectMemorySummary(project?.id);
    const userMemory = this.#getUserMemorySummary();
    const selectedCapabilityForPlan = selectEnabledCapabilityForMission(
      this.database,
      run.mission,
      run.metadata?.missionSpec?.deliverable ?? ""
    );
    const input = {
      mission: run.mission,
      scenarioType,
      missionSpec: run.metadata?.missionSpec ?? null,
      allowlistedDomains: project?.allowlistedDomains ?? [],
      availableBrowsers,
      projectMemory,
      userMemory,
      selectedCapability: selectedCapabilityForPlan ? {
        id: selectedCapabilityForPlan.id,
        title: selectedCapabilityForPlan.title,
        capabilityKind: selectedCapabilityForPlan.capabilityKind,
        artifactKind: selectedCapabilityForPlan.artifactKind,
        mission: selectedCapabilityForPlan.mission,
        status: selectedCapabilityForPlan.status
      } : null
    };
    const metadata = {
      scenarioType,
      missionType: run.metadata?.type ?? null
    };
    const missionUnderstanding = await this.#understandMission({
      run,
      project,
      scenarioType,
      input,
      metadata
    });
    let llmResult;
    try {
      llmResult = await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.PLAN_GENERATION,
        callType: LLM_CALL_TYPE.PLAN_GENERATION,
        taskPromptId: "task.plan_generation",
        bindings: {
          mission: run.mission,
          scenarioType,
          missionUnderstanding: JSON.stringify(missionUnderstanding.output),
          allowlistedDomains: JSON.stringify(project?.allowlistedDomains ?? []),
          availableBrowsers: JSON.stringify(availableBrowsers ?? []),
          projectMemory: JSON.stringify(projectMemory ?? null),
          userMemory: JSON.stringify(userMemory ?? null),
          selectedCapability: JSON.stringify(input.selectedCapability ?? null)
        },
        input: {
          ...input,
          missionUnderstanding: missionUnderstanding.output
        },
        metadata,
        validateOutput: validatePlanOutput,
        priorSnapshots: [missionUnderstanding.reasoningSnapshot]
      });
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const degradedOutput = buildDeterministicPlanOutput(input);
      const degradedSnapshot = error.reasoningSnapshot ?? missionUnderstanding.reasoningSnapshot;
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "LLM plan generation degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.PLAN_GENERATION,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_plan_fallback",
        contextSnapshotId: degradedSnapshot.id
      }));
      llmResult = {
        output: degradedOutput,
        callRecord: null,
        reasoningSnapshot: degradedSnapshot
      };
    }

    const frameAligned = missionUnderstanding.output.chosenExecutionFrame === scenarioType;
    if (!frameAligned) {
      this.#recordEvent(run.id, createEvent("run.mission_route_mismatch", EVENT_ACTOR.SYSTEM, "Mission-understanding selected a different bounded frame than the active runtime path.", {
        scenarioType,
        chosenExecutionFrame: missionUnderstanding.output.chosenExecutionFrame,
        llmCallId: missionUnderstanding.callRecord?.id ?? null
      }));
    }
    if (missionUnderstanding.output.unsupportedRequests.length > 0) {
      this.#recordEvent(run.id, createEvent("run.boundary.notice", EVENT_ACTOR.SYSTEM, "The mission includes requests that remain outside the bounded prototype.", {
        unsupportedRequests: missionUnderstanding.output.unsupportedRequests,
        llmCallId: missionUnderstanding.callRecord?.id ?? null
      }));
    }

    return {
      ...llmResult,
      plan: {
        steps: llmResult.output.steps,
        assumptions: llmResult.output.assumptions,
        missionUnderstanding: {
          summary: missionUnderstanding.output.missionSummary,
          clarifiedObjective: missionUnderstanding.output.clarifiedObjective,
          chosenExecutionFrame: missionUnderstanding.output.chosenExecutionFrame,
          routingConfidence: missionUnderstanding.output.routingConfidence,
          coverageStatus: missionUnderstanding.output.coverageStatus,
          whyThisFrame: missionUnderstanding.output.whyThisFrame,
          coveredNow: missionUnderstanding.output.coveredNow,
          notCoveredNow: missionUnderstanding.output.notCoveredNow,
          requestedOutcomes: missionUnderstanding.output.requestedOutcomes,
          verificationGoals: missionUnderstanding.output.verificationGoals,
          runNowPlan: missionUnderstanding.output.runNowPlan,
          nextRunSuggestion: missionUnderstanding.output.nextRunSuggestion,
          nextRunRecommendation: missionUnderstanding.output.nextRunRecommendation ?? null,
          maybeLaterSuggestion: missionUnderstanding.output.maybeLaterSuggestion,
          maybeLaterRecommendation: missionUnderstanding.output.maybeLaterRecommendation ?? null,
          unsupportedRequests: missionUnderstanding.output.unsupportedRequests,
        ambiguityNote: missionUnderstanding.output.ambiguityNote,
        computerActionType: missionUnderstanding.output.computerActionType ?? null,
        selectedBrowser: missionUnderstanding.output.selectedBrowser ?? null,
        browserSearchQuery: missionUnderstanding.output.browserSearchQuery ?? "",
        browserLaunchUrl: missionUnderstanding.output.browserLaunchUrl ?? null,
        clarificationOptions: missionUnderstanding.output.clarificationOptions ?? [],
        requiresClarification: missionUnderstanding.output.requiresClarification,
          clarificationQuestion: missionUnderstanding.output.clarificationQuestion,
          llmCallId: missionUnderstanding.callRecord?.id ?? null,
          generationMode: missionUnderstanding.generationMode,
          contextSnapshotId: missionUnderstanding.reasoningSnapshot?.id ?? null,
          frameAligned
        },
        llmCallId: llmResult.callRecord?.id ?? null,
        generationMode: llmResult.callRecord ? "llm" : "deterministic_fallback",
        contextSnapshotId: llmResult.reasoningSnapshot?.id ?? null,
        missionUnderstandingSnapshotId: missionUnderstanding.reasoningSnapshot.id
      }
    };
  }

  async #understandMission({ run, project, scenarioType, input, metadata }) {
    const confirmedPreflight = run.metadata?.preflight?.understanding ?? null;
    if (confirmedPreflight) {
      const output = validateMissionUnderstandingOutput(confirmedPreflight, {
        availableBrowsers: input.availableBrowsers ?? []
      });
      const reasoningSnapshot = await this.#createReasoningSnapshot({
        run,
        project,
        stage: REASONING_STAGE.MISSION_UNDERSTANDING,
        inputs: {
          ...input,
          missionUnderstanding: output
        }
      });
      this.#recordEvent(run.id, createEvent("run.mission_understanding.reused", EVENT_ACTOR.AGENT, "Mission understanding reused from the confirmed preflight.", {
        chosenExecutionFrame: output.chosenExecutionFrame,
        routingConfidence: output.routingConfidence,
        contextSnapshotId: reasoningSnapshot.id
      }));
      return {
        output,
        callRecord: null,
        reasoningSnapshot,
        generationMode: "confirmed_preflight"
      };
    }

    let llmResult;
    try {
      llmResult = await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.MISSION_UNDERSTANDING,
        callType: LLM_CALL_TYPE.MISSION_UNDERSTANDING,
        taskPromptId: "task.mission_understanding",
        bindings: {
          mission: run.mission,
          scenarioType,
          missionSpec: JSON.stringify(run.metadata?.missionSpec ?? null),
          allowlistedDomains: JSON.stringify(project?.allowlistedDomains ?? []),
          availableBrowsers: JSON.stringify(input.availableBrowsers ?? []),
          projectMemory: JSON.stringify(input.projectMemory ?? null),
          userMemory: JSON.stringify(input.userMemory ?? null)
        },
        input,
        metadata,
        validateOutput: (output) => validateMissionUnderstandingOutput(output, {
          availableBrowsers: input.availableBrowsers ?? []
        })
      });
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const degradedOutput = buildDeterministicMissionUnderstandingOutput(input);
      const degradedSnapshot = error.reasoningSnapshot ?? await this.#createReasoningSnapshot({
        run,
        project,
        stage: REASONING_STAGE.MISSION_UNDERSTANDING,
        inputs: input
      });
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "Mission understanding degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.MISSION_UNDERSTANDING,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_mission_understanding_fallback",
        contextSnapshotId: degradedSnapshot.id
      }));
      llmResult = {
        output: degradedOutput,
        callRecord: null,
        reasoningSnapshot: degradedSnapshot
      };
    }

    this.#recordEvent(run.id, createEvent("run.mission_understood", EVENT_ACTOR.AGENT, "Mission understanding completed.", {
      llmCallId: llmResult.callRecord?.id ?? null,
      chosenExecutionFrame: llmResult.output.chosenExecutionFrame,
      routingConfidence: llmResult.output.routingConfidence,
      coverageStatus: llmResult.output.coverageStatus,
      requiresClarification: llmResult.output.requiresClarification,
      unsupportedRequestCount: llmResult.output.unsupportedRequests.length,
      contextSnapshotId: llmResult.reasoningSnapshot?.id ?? null
    }));
    return {
      ...llmResult,
      generationMode: llmResult.callRecord ? "llm" : "deterministic_fallback"
    };
  }

  async #draftDecisionNote({ run, records, sourceReferences }) {
    const input = {
      mission: run.mission,
      records,
      sourceReferences: sourceReferences.map((source) => ({
        id: source.id,
        title: source.title,
        canonicalRef: source.canonicalRef
      }))
    };
    const metadata = {
      recordCount: records.length,
      sourceCount: sourceReferences.length,
      artifactType: "note_de_decision"
    };
    let llmResult;
    try {
      llmResult = await this.#invokeReasonedLlm({
        run,
        project: this.#requireProject(run.projectId),
        reasoningStage: REASONING_STAGE.DECISION_NOTE_DRAFT,
        callType: LLM_CALL_TYPE.DECISION_NOTE_DRAFT,
        taskPromptId: "task.decision_note_draft",
        bindings: {
          mission: run.mission,
          records: JSON.stringify(records),
          sourceReferences: JSON.stringify(sourceReferences.map((source) => ({
            id: source.id,
            title: source.title,
            canonicalRef: source.canonicalRef
          })))
        },
        input,
        metadata,
        validateOutput: validateDecisionDraft
      });
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const degradedOutput = buildDeterministicDecisionDraftOutput(input);
      const degradedSnapshot = error.reasoningSnapshot ?? await this.#createReasoningSnapshot({
        run,
        project: this.#requireProject(run.projectId),
        stage: REASONING_STAGE.DECISION_NOTE_DRAFT,
        inputs: input
      });
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "Decision note drafting degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.DECISION_NOTE_DRAFT,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_decision_note_fallback",
        contextSnapshotId: degradedSnapshot.id
      }));
      llmResult = {
        output: degradedOutput,
        callRecord: null,
        reasoningSnapshot: degradedSnapshot
      };
    }

    return {
      ...llmResult,
      validationState: llmResult.output.validationState,
      overallConfidence: llmResult.output.overallConfidence
    };
  }

  async #evaluateDecisionDraft({ run, records, sourceReferences, draft, collectionArtifact }) {
    const project = this.#requireProject(run.projectId);
    const input = {
      mission: run.mission,
      draft,
      records,
      sourceReferences: sourceReferences.map((source) => ({
        id: source.id,
        title: source.title,
        canonicalRef: source.canonicalRef
      })),
      relatedArtifactIds: [collectionArtifact.id]
    };
    const metadata = {
      recordCount: records.length,
      sourceCount: sourceReferences.length,
      collectionArtifactId: collectionArtifact.id
    };
    let llmResult;
    try {
      llmResult = await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.EVALUATION_SUPPORT,
        callType: LLM_CALL_TYPE.EVALUATION_SUPPORT,
        taskPromptId: "task.evaluation_support",
        bindings: {
          mission: run.mission,
          draft: JSON.stringify(draft),
          records: JSON.stringify(records),
          sourceReferences: JSON.stringify(input.sourceReferences)
        },
        input,
        metadata,
        validateOutput: validateEvaluationSupport
      });
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const fallbackSnapshot = error.reasoningSnapshot ?? await this.#createReasoningSnapshot({
        run,
        project,
        stage: REASONING_STAGE.EVALUATION_SUPPORT,
        inputs: input
      });
      const degradedOutput = buildDeterministicEvaluationOutput({
        draft,
        records,
        snapshot: fallbackSnapshot
      });
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "Evaluation support degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.EVALUATION_SUPPORT,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_evaluation_fallback",
        contextSnapshotId: fallbackSnapshot.id
      }));
      llmResult = {
        output: degradedOutput,
        callRecord: null,
        reasoningSnapshot: fallbackSnapshot
      };
    }
    return llmResult;
  }

  async #generateAmbiguityNote({ run, records, sourceReferences, draft, evaluationSupport }) {
    const project = this.#requireProject(run.projectId);
    const input = {
      mission: run.mission,
      records,
      sourceReferences: sourceReferences.map((source) => ({
        id: source.id,
        title: source.title,
        canonicalRef: source.canonicalRef
      })),
      draft,
      evaluationSupport
    };
    let llmResult;
    try {
      llmResult = await this.#invokeReasonedLlm({
        run,
        project,
        reasoningStage: REASONING_STAGE.AMBIGUITY_NOTE,
        callType: LLM_CALL_TYPE.AMBIGUITY_NOTE,
        taskPromptId: "task.ambiguity_note",
        bindings: {
          mission: run.mission,
          records: JSON.stringify(records)
        },
        input,
        metadata: {
          recordCount: records.length
        },
        validateOutput: validateAmbiguityNote
      });
    } catch (error) {
      if (!shouldUseDeterministicFallback(error) || !this.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      const fallbackSnapshot = error.reasoningSnapshot ?? await this.#createReasoningSnapshot({
        run,
        project,
        stage: REASONING_STAGE.AMBIGUITY_NOTE,
        inputs: input
      });
      const degradedOutput = buildDeterministicAmbiguityOutput({
        snapshot: fallbackSnapshot,
        records
      });
      this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, "Ambiguity note generation degraded to deterministic fallback.", {
        callType: LLM_CALL_TYPE.AMBIGUITY_NOTE,
        failedLlmCallId: error.callRecord?.id ?? null,
        errorCategory: error.category ?? "provider_unavailable",
        strategy: "deterministic_ambiguity_fallback",
        contextSnapshotId: fallbackSnapshot.id
      }));
      llmResult = {
        output: degradedOutput,
        callRecord: null,
        reasoningSnapshot: fallbackSnapshot
      };
    }
    return llmResult;
  }

  async #invokeLlm({ run, callType, modelAlias, promptRefs, input, metadata = {}, validateOutput, extraMessages = [] }) {
    if (!this.llmGateway) {
      throw new Error("LLM gateway is not configured.");
    }

    const requestedEvent = this.#recordEvent(run.id, createEvent("llm.call.requested", EVENT_ACTOR.AGENT, `LLM call requested: ${callType}.`, {
      callType,
      modelAlias,
      reasoningStage: metadata.reasoningStage ?? null,
      contextSnapshotId: metadata.contextSnapshotId ?? null,
      tokenGovernancePolicyId: metadata.tokenGovernancePolicyId ?? null,
      inputCompactionApplied: Boolean(metadata.inputCompaction?.applied)
    }));

    try {
      const result = await this.llmGateway.generateStructured({
        runId: run.id,
        projectId: run.projectId,
        callType,
        modelAlias,
        promptRefs,
        input,
        metadata,
        validateOutput,
        extraMessages
      });
      this.database.insertLlmCall(result.callRecord);
      this.#recordEvent(run.id, createEvent("llm.call.completed", EVENT_ACTOR.AGENT, `LLM call completed: ${callType}.`, {
        llmCallId: result.callRecord.id,
        callType,
        providerAlias: result.callRecord.providerAlias,
        modelAlias: result.callRecord.modelAlias,
        requestId: result.callRecord.metadata?.requestId ?? null,
        latencyMs: result.callRecord.latencyMs,
        estimatedCost: result.callRecord.estimatedCost,
        fallbackUsed: result.callRecord.metadata?.fallbackUsed ?? false,
        degradedModeUsed: result.callRecord.metadata?.degradedModeUsed ?? false,
        requestedEventId: requestedEvent.id,
        reasoningStage: result.callRecord.metadata?.reasoningStage ?? null,
        contextSnapshotId: result.callRecord.metadata?.contextSnapshotId ?? null,
        tokenGovernance: result.callRecord.metadata?.tokenGovernance ?? null
      }));
      if (result.callRecord.metadata?.tokenGovernance?.executionMode === "reused") {
        this.#recordEvent(run.id, createEvent("llm.call.reused", EVENT_ACTOR.SYSTEM, `LLM result reused for ${callType}.`, {
          llmCallId: result.callRecord.id,
          reusedFromCallId: result.callRecord.metadata?.tokenGovernance?.reusedFromCallId ?? null,
          reasoningStage: result.callRecord.metadata?.reasoningStage ?? null,
          contextSnapshotId: result.callRecord.metadata?.contextSnapshotId ?? null
        }));
      }
      if (result.callRecord.metadata?.tokenGovernance?.liveProviderBlocked) {
        this.#recordEvent(run.id, createEvent("llm.call.live_provider_blocked", EVENT_ACTOR.SYSTEM, `Live provider blocked for ${callType}.`, {
          llmCallId: result.callRecord.id,
          reasoningStage: result.callRecord.metadata?.reasoningStage ?? null,
          requestedModelAlias: result.callRecord.metadata?.tokenGovernance?.requestedModelAlias ?? null,
          effectiveModelAlias: result.callRecord.metadata?.tokenGovernance?.effectiveModelAlias ?? null,
          reason: result.callRecord.metadata?.tokenGovernance?.liveProviderBlockReason ?? null
        }));
      }
      if (result.callRecord.metadata?.tokenGovernance?.downgraded) {
        this.#recordEvent(run.id, createEvent("llm.call.downgraded", EVENT_ACTOR.SYSTEM, `LLM model downgraded for ${callType}.`, {
          llmCallId: result.callRecord.id,
          reasoningStage: result.callRecord.metadata?.reasoningStage ?? null,
          requestedModelAlias: result.callRecord.metadata?.tokenGovernance?.requestedModelAlias ?? null,
          effectiveModelAlias: result.callRecord.metadata?.tokenGovernance?.effectiveModelAlias ?? null,
          reason: result.callRecord.metadata?.tokenGovernance?.downgradeReason ?? null
        }));
      }
      if (result.callRecord.metadata?.fallbackUsed) {
        this.#recordEvent(run.id, createEvent("llm.call.fallback_used", EVENT_ACTOR.SYSTEM, `LLM fallback used for ${callType}.`, {
          llmCallId: result.callRecord.id,
          callType,
          providerAlias: result.callRecord.providerAlias,
          fallbackChain: result.callRecord.fallbackChain,
          contextSnapshotId: result.callRecord.metadata?.contextSnapshotId ?? null
        }));
      }
      if (result.callRecord.metadata?.degradedModeUsed) {
        this.#recordEvent(run.id, createEvent("llm.degraded_mode.activated", EVENT_ACTOR.SYSTEM, `LLM degraded mode active for ${callType}.`, {
          llmCallId: result.callRecord.id,
          callType,
          providerAlias: result.callRecord.providerAlias,
          fallbackChain: result.callRecord.fallbackChain,
          contextSnapshotId: result.callRecord.metadata?.contextSnapshotId ?? null
        }));
      }
      return result;
    } catch (error) {
      if (error.callRecord) {
        this.database.insertLlmCall(error.callRecord);
      }
      if (error.callRecord?.metadata?.tokenGovernance?.liveProviderBlocked) {
        this.#recordEvent(run.id, createEvent("llm.call.live_provider_blocked", EVENT_ACTOR.SYSTEM, `Live provider blocked for ${callType}.`, {
          llmCallId: error.callRecord.id,
          reasoningStage: error.callRecord.metadata?.reasoningStage ?? null,
          requestedModelAlias: error.callRecord.metadata?.tokenGovernance?.requestedModelAlias ?? null,
          effectiveModelAlias: error.callRecord.metadata?.tokenGovernance?.effectiveModelAlias ?? null,
          reason: error.callRecord.metadata?.tokenGovernance?.liveProviderBlockReason ?? null
        }));
      }
      if (error.callRecord?.metadata?.tokenGovernance?.executionMode === "suppressed") {
        this.#recordEvent(run.id, createEvent("llm.call.suppressed", EVENT_ACTOR.SYSTEM, `LLM stage suppressed for ${callType}.`, {
          llmCallId: error.callRecord.id,
          callType,
          reasoningStage: error.callRecord.metadata?.reasoningStage ?? null,
          reason: error.callRecord.metadata?.tokenGovernance?.reason ?? null,
          contextSnapshotId: error.callRecord.metadata?.contextSnapshotId ?? null
        }));
      }
      this.#recordEvent(run.id, createEvent("llm.call.failed", EVENT_ACTOR.SYSTEM, `LLM call failed: ${callType}.`, {
        llmCallId: error.callRecord?.id ?? null,
        callType,
        errorCategory: error.category ?? "provider_unavailable",
        requestId: error.callRecord?.metadata?.requestId ?? null,
        message: error.message,
        requestedEventId: requestedEvent.id,
        reasoningStage: error.callRecord?.metadata?.reasoningStage ?? null,
        contextSnapshotId: error.callRecord?.metadata?.contextSnapshotId ?? null
      }));
      throw error;
    }
  }

  async #persistArtifact(runId, runDir, artifactDefinition, metadata) {
    const artifactId = createId("art");
    const fileName = `${sanitizeFilename(artifactDefinition.title)}-${artifactId}.md`;
    const storagePath = path.join(runDir, "artifacts", fileName);
    await writeText(storagePath, artifactDefinition.content);
    const artifact = {
      id: artifactId,
      artifactType: artifactDefinition.artifactType,
      status: "draft",
      title: artifactDefinition.title,
      storagePath,
      metadata,
      createdAt: nowIso()
    };
    this.database.insertArtifact(runId, artifact);
    this.#recordEvent(runId, createEvent("artifact.created", EVENT_ACTOR.ARTIFACT, `${artifact.title} created.`, {
      artifactId,
      artifactType: artifact.artifactType,
      sourceIds: artifact.metadata?.sourceIds ?? [],
      evidenceIds: artifact.metadata?.evidenceIds ?? []
    }));
    return artifact;
  }

  async #stageRun(runId, patch, eventType, summary) {
    await this.#updateRun(runId, patch);
    this.#recordEvent(runId, createEvent(eventType, EVENT_ACTOR.AGENT, summary));
  }

  async #mergeRunMetadata(runId, metadataPatch) {
    const run = this.database.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    await this.#updateRun(runId, {
      metadata: {
        ...(run.metadata ?? {}),
        ...metadataPatch
      }
    });
  }

  async #recordVerificationSummary(runId, verificationSummary) {
    await this.#mergeRunMetadata(runId, {
      verificationSummary
    });
    this.#recordEvent(runId, createEvent("run.verification_completed", EVENT_ACTOR.AGENT, "Run verification summary recorded.", {
      scenarioType: verificationSummary.scenarioType,
      overallStatus: verificationSummary.overallStatus,
      failedCheckCount: verificationSummary.checks.filter((check) => check.status !== "pass").length
    }));
  }

  async #updateRun(runId, patch) {
    this.database.updateRun(runId, {
      ...patch,
      updatedAt: nowIso()
    });
    if (["completed", "failed", "stopped"].includes(String(patch.status ?? "").toLowerCase())) {
      const run = this.database.getRun(runId);
      this.#recordProjectMemoryFromRun(run);
      this.#recordUserMemoryFromRun(run);
      auditRunStatusChange({
        runId,
        projectId: run?.projectId ?? null,
        mission: run?.mission ?? null,
        toStatus: patch.status,
        lifecycleStage: patch.lifecycleStage ?? null,
        reason: patch.summary ?? null
      });
    }
  }

  async #failRun(runId, error) {
    await this.#updateRun(runId, {
      status: RUN_STATUS.FAILED,
      lifecycleStage: "failed",
      summary: error.message
    });
    this.#recordEvent(runId, createEvent("run.failed", EVENT_ACTOR.SYSTEM, error.message, {
      name: error.name,
      stack: error.stack
    }));
  }

  async #stopRunFromApproval(runId, approvalRecord, actionLabel) {
    const stoppedByOperator = approvalRecord?.decision === APPROVAL_DECISION.STOP_RUN;
    const summary = stoppedByOperator
      ? `Run stopped by operator during approval: ${actionLabel}`
      : `Run stopped after approval denial: ${actionLabel}`;

    await this.#updateRun(runId, {
      status: RUN_STATUS.STOPPED,
      lifecycleStage: "stopped",
      summary
    });
    this.#recordEvent(runId, createEvent("run.stopped", EVENT_ACTOR.OPERATOR, summary, {
      approvalId: approvalRecord?.id ?? null,
      decision: approvalRecord?.decision ?? APPROVAL_DECISION.DENIED,
      actionLabel
    }));
    return this.getRunBundle(runId);
  }

  async #markDesktopWatcherBaseline(desktopWatcher = null) {
    if (!desktopWatcher) {
      return null;
    }
    return desktopWatcher.markBaseline().catch(() => null);
  }

  async #consumeDesktopWatcherChanges({
    run,
    project = null,
    desktopWatcher = null,
    observationTimeline = null,
    step = null,
    visionPolicy = null
  } = {}) {
    if (!desktopWatcher) {
      return [];
    }
    await desktopWatcher.observeNow().catch(() => null);
    const changes = desktopWatcher.consumeChanges();
    if (changes.length === 0) {
      return [];
    }
    const latest = changes.at(-1);
    const policy = visionPolicy ?? this.#getBrowserVisionPolicy();
    const shouldDescribe = policy.enabled !== false
      && latest?.after?.activeVisual?.outputPath
      && (latest.reasons ?? []).some((reason) => [
        "visual_changed",
        "active_window_changed",
        "active_content_changed",
        "active_window_title_changed"
      ].includes(reason));
    const visualDescription = shouldDescribe
      ? await this.#describeDesktopVisualFrame({
        run,
        project,
        snapshot: latest.after,
        change: latest,
        phase: "background_watch_change",
        step,
        visionDetail: (latest.reasons ?? []).includes("active_window_changed")
          || ["click_point", "type_text", "send_hotkey"].includes(step?.primitive)
          ? policy.interactionDetail
          : policy.defaultDetail
      }).catch(() => null)
      : null;
    if (observationTimeline) {
      appendDesktopObservation(observationTimeline, {
        phase: "background_watch_change",
        status: "changed",
        step,
        window: latest?.after?.activeWindow ?? null,
        visualDescription,
        visualHash: latest?.after?.activeVisual?.screenshotHash ?? null,
        capturePath: latest?.after?.activeVisual?.outputPath ?? null,
        result: {
          changeCount: changes.length,
          reasons: latest?.reasons ?? [],
          activeWindowTitle: latest?.after?.activeWindow?.title ?? null,
          visibleWindowCount: latest?.after?.visibleWindows?.length ?? 0,
          visualHash: latest?.after?.activeVisual?.screenshotHash ?? null,
          visualDescriptionId: visualDescription?.id ?? null
        }
      });
    }
    this.#recordEvent(run.id, createEvent("run.desktop_watch_changed", EVENT_ACTOR.COMPUTER, "Desktop watcher detected a background state change.", {
      stepId: step?.id ?? null,
      primitive: step?.primitive ?? null,
      changeCount: changes.length,
      reasons: latest?.reasons ?? [],
      activeWindowId: latest?.after?.activeWindow?.id ?? null,
      activeWindowTitle: latest?.after?.activeWindow?.title ?? null,
      visualHash: latest?.after?.activeVisual?.screenshotHash ?? null,
      visualDescription: visualDescription ? {
        id: visualDescription.id,
        description: visualDescription.description,
        keyElements: visualDescription.keyElements,
        pageType: visualDescription.pageType,
        generationMode: visualDescription.generationMode,
        visionDetail: visualDescription.visionDetail
      } : null
    }));
    return changes;
  }

  async #observeDesktopStepContext({
    run,
    step,
    currentWindow = null,
    observationTimeline = null
  }) {
    const [activeWindow, visibleWindows] = await Promise.all([
      Promise.resolve(this.computer.detectActiveWindow()).catch(() => null),
      Promise.resolve(this.computer.listVisibleWindows()).catch(() => [])
    ]);
    const visibleWindowIds = new Set(visibleWindows.map((windowState) => windowState.id).filter(Boolean));
    let selectedWindow = currentWindow ?? activeWindow ?? null;
    let adaptation = null;

    if (selectedWindow?.id && !visibleWindowIds.has(selectedWindow.id)) {
      selectedWindow = activeWindow ?? visibleWindows[0] ?? null;
      adaptation = {
        selectedStrategy: "active_window_fallback",
        reason: "The previous target window is no longer visible, so JON refreshed to the active visible window.",
        recoveredWindowId: selectedWindow?.id ?? null
      };
    } else if (!selectedWindow && activeWindow) {
      selectedWindow = activeWindow;
      adaptation = {
        selectedStrategy: "active_window_fallback",
        reason: "No current window was available, so JON refreshed to the active window.",
        recoveredWindowId: activeWindow.id
      };
    }

    const selector = semanticSelectorForDesktopStep(step);
    let semanticResolution = null;
    if (selector) {
      const candidateWindows = [];
      const seen = new Set();
      for (const candidate of [selectedWindow, activeWindow, ...visibleWindows]) {
        if (!candidate?.id || seen.has(candidate.id)) {
          continue;
        }
        seen.add(candidate.id);
        candidateWindows.push(candidate);
      }
      for (const candidate of candidateWindows) {
        const resolution = await this.computer.resolveSemanticTarget(candidate.id, selector, {
          maxDepth: 5,
          maxNodes: 240,
          minScore: 0.28
        }).catch((error) => ({
          found: false,
          reason: error.message,
          target: null
        }));
        if (!resolution?.found || !resolution.target?.center) {
          continue;
        }
        semanticResolution = resolution;
        if (selectedWindow?.id !== candidate.id) {
          selectedWindow = await Promise.resolve(this.computer.focusWindow(candidate.id)).catch(() => candidate);
          adaptation = {
            selectedStrategy: "pre_step_semantic_refocus",
            reason: `The semantic target "${selector.query}" was visible in another window, so JON focused that window before acting.`,
            recoveredWindowId: selectedWindow?.id ?? candidate.id
          };
        }
        break;
      }
    }

    const beforePerception = selectedWindow?.id
      ? await this.computer.inspectVisibleUi(selectedWindow.id).catch((error) => ({
        available: false,
        reason: error.message
      }))
      : null;

    const awareness = {
      activeWindowId: activeWindow?.id ?? null,
      visibleWindowCount: visibleWindows.length,
      adapted: Boolean(adaptation),
      semanticTargetFound: selector ? Boolean(semanticResolution?.found) : null,
      semanticTargetLabel: semanticResolution?.target?.label ?? null
    };

    if (observationTimeline) {
      appendDesktopObservation(observationTimeline, {
        phase: "continuous_observation",
        status: adaptation ? "adapted" : "observed",
        step,
        window: selectedWindow,
        perception: beforePerception,
        result: awareness,
        recovery: adaptation
      });
    }

    if (adaptation) {
      this.#recordEvent(run.id, createEvent("tool.pre_step_adapted", EVENT_ACTOR.COMPUTER, `Desktop context adapted before ${step.primitive}.`, {
        primitive: step.primitive,
        stepId: step.id,
        selectedStrategy: adaptation.selectedStrategy,
        recoveredWindowId: adaptation.recoveredWindowId,
        semanticTargetFound: awareness.semanticTargetFound
      }));
    }

    return {
      currentWindow: selectedWindow,
      beforePerception,
      awareness,
      adaptation,
      semanticResolution
    };
  }

  async #attemptDesktopDynamicReplan({
    run,
    project,
    desktopAction,
    installedApplications,
    skillCatalog,
    desktopMemory,
    projectMemory = null,
    userMemory = null,
    desktopPlan,
    actionLog,
    observationTimeline,
    currentWindow,
    failedStep,
    error,
    currentStepIndex,
    remainingSteps
  }) {
    const visibleWindows = await Promise.resolve(this.computer.listVisibleWindows()).catch(() => []);
    const activeWindow = await Promise.resolve(this.computer.detectActiveWindow()).catch(() => currentWindow);
    const activeAccessibilityBefore = activeWindow?.id
      ? await this.computer.inspectAccessibilityTree(activeWindow.id).catch((inspectError) => ({
        available: false,
        reason: inspectError.message,
        tree: null
      }))
      : null;
    const desktopSnapshot = await this.computer.inspectDesktop({
      maxWindows: 6,
      maxDepth: 2,
      maxNodes: 80
    }).catch((snapshotError) => ({
      capturedAt: nowIso(),
      unavailable: true,
      reason: snapshotError.message,
      activeWindow,
      visibleWindowCount: visibleWindows.length,
      windows: []
    }));
    const observationSummary = observationTimeline
      ? summarizeDesktopObservationTimeline(observationTimeline)
      : null;
    const replanContext = buildDesktopReplanContext({
      run,
      failedStep,
      error,
      currentStepIndex,
      remainingSteps,
      actionLog,
      observationSummary,
      currentWindow: activeWindow ?? currentWindow
    });

    let replanResult = null;
    try {
      replanResult = await this.#generateDesktopPlan({
        run,
        project,
        desktopAction,
        visibleWindows,
        activeWindow,
        installedApplications,
        activeAccessibilityBefore,
        desktopSnapshot,
        skillCatalog,
        desktopMemory,
        projectMemory,
        userMemory,
        replanContext
      });
      replanResult.output = validateDesktopPlanOutput(replanResult.output, {
        maxSteps: this.#desktopSandboxSummary().maxPlanSteps ?? 14
      });
    } catch (replanError) {
      this.#recordEvent(run.id, createEvent("run.dynamic_replan_failed", EVENT_ACTOR.SYSTEM, "Dynamic desktop replan failed.", {
        failedStepId: failedStep?.id ?? null,
        failedPrimitive: failedStep?.primitive ?? null,
        originalError: error?.message ?? null,
        replanError: replanError.message
      }));
      return { accepted: false, error: replanError };
    }

    const steps = selectDesktopReplanContinuation(replanResult.output, {
      maxSteps: this.#desktopSandboxSummary().maxPlanSteps ?? 14
    });
    if (steps.length === 0) {
      return { accepted: false, replanResult };
    }

    if (observationTimeline) {
      appendDesktopObservation(observationTimeline, {
        phase: "dynamic_replan",
        status: "completed",
        step: failedStep,
        window: activeWindow ?? currentWindow,
        result: {
          replacementStepCount: steps.length,
          planSummary: replanResult.output.planSummary
        },
        recovery: {
          selectedStrategy: "dynamic_replan",
          reason: error?.message ?? "Prior step failed after recovery."
        }
      });
    }
    this.#recordEvent(run.id, createEvent("run.dynamic_replanned", EVENT_ACTOR.AGENT, "Desktop plan dynamically replanned from current screen state.", {
      failedStepId: failedStep?.id ?? null,
      failedPrimitive: failedStep?.primitive ?? null,
      replacementStepCount: steps.length,
      planSummary: replanResult.output.planSummary
    }));

    return {
      accepted: true,
      steps,
      replanResult,
      replanContext
    };
  }

  async #attemptDesktopStepRecovery({
    step,
    error,
    currentWindow = null,
    beforeWindow = null,
    beforePerception = null,
    safety = null,
    recovery = null,
    recoveryPlan = null,
    visibleWindows = []
  }) {
    if (step?.primitive !== "click_point") {
      return { completed: false };
    }
    const semanticQuery = step.target?.semanticTarget ?? step.input?.semanticTarget ?? null;
    if (!semanticQuery) {
      return { completed: false };
    }

    const selector = {
      query: semanticQuery,
      role: step.target?.role ?? step.input?.role ?? null,
      automationId: step.target?.automationId ?? step.input?.automationId ?? null
    };
    const activeWindow = await Promise.resolve(this.computer.detectActiveWindow()).catch(() => null);
    const observedWindows = visibleWindows.length > 0
      ? visibleWindows
      : await Promise.resolve(this.computer.listVisibleWindows()).catch(() => []);
    const candidateWindowIds = recoveryPlan?.strategies
      ?.find((strategy) => strategy.id === "semantic_target_retry")
      ?.candidateWindowIds ?? [];
    const candidateWindows = [];
    const seenWindowIds = new Set();
    for (const windowState of [currentWindow, activeWindow, beforeWindow, ...observedWindows]) {
      if (!windowState?.id || seenWindowIds.has(windowState.id)) {
        continue;
      }
      seenWindowIds.add(windowState.id);
      candidateWindows.push(windowState);
    }
    const orderedCandidateWindows = [
      ...candidateWindowIds.map((windowId) => candidateWindows.find((windowState) => windowState.id === windowId)).filter(Boolean),
      ...candidateWindows.filter((windowState) => !candidateWindowIds.includes(windowState.id))
    ];

    for (const windowState of orderedCandidateWindows) {
      const semanticResolution = await this.computer.resolveSemanticTarget(windowState.id, selector, {
        maxDepth: 5,
        maxNodes: 240,
        minScore: 0.28
      }).catch((resolveError) => ({
        found: false,
        reason: resolveError.message,
        target: null
      }));
      if (!semanticResolution?.found || !semanticResolution.target?.center) {
        continue;
      }
      if (activeWindow?.id !== windowState.id) {
        await Promise.resolve(this.computer.focusWindow(windowState.id)).catch(() => null);
      }
      const clickResult = await this.computer.clickPoint(windowState.id, semanticResolution.target.center);
      const recoveredWindow = await Promise.resolve(this.computer.detectActiveWindow()).catch(() => windowState);
      const perceptionAfter = recoveredWindow?.id
        ? await this.computer.inspectVisibleUi(recoveredWindow.id).catch((inspectError) => ({
          available: false,
          reason: inspectError.message
        }))
        : null;
      const perceptionDelta = this.computer.comparePerception(beforePerception, perceptionAfter);
      const recoveredAttempt = {
        ...(recovery ?? {}),
        selectedStrategy: "semantic_target_retry",
        retryReason: error?.message ?? null,
        retriedAt: nowIso(),
        recoveredWindowId: recoveredWindow?.id ?? windowState.id,
        recoveryPlan,
        semanticResolution
      };
      const checkpoint = checkpointRecord({
        step,
        before: beforePerception,
        after: perceptionAfter,
        safety,
        recovery: recoveredAttempt,
        verification: {
          validated: true,
          reason: `Retried click on semantic target "${semanticQuery}" after re-observing desktop windows.`,
          perceptionDelta
        }
      });

      return {
        completed: true,
        currentWindow: recoveredWindow ?? windowState,
        result: {
          ...clickResult,
          semanticResolution,
          recovered: true
        },
        recovery: recoveredAttempt,
        perceptionAfter,
        perceptionDelta,
        checkpoint
      };
    }

    return { completed: false };
  }

  #recordCapabilityFeedbackForDesktopPlan({
    run,
    desktopPlan = null,
    actionLog = [],
    outcomeStatus = "candidate",
    notes = null
  }) {
    if (!this.database.insertCapabilityFeedback || !desktopPlan) {
      return;
    }
    const selectedNodeIds = new Map();
    if (desktopPlan.selectedApplication?.id) {
      selectedNodeIds.set(capabilityNodeId("surface", desktopPlan.selectedApplication.id), desktopPlan.selectedApplication.skillId ?? null);
    }
    for (const step of desktopPlan.steps ?? []) {
      if (step.primitive && step.primitive !== "stop") {
        selectedNodeIds.set(capabilityNodeId("tool", step.primitive), null);
      }
      const skill = skillForStep(step, desktopPlan.selectedApplication ?? null);
      if (skill?.id) {
        const graphSkillId = graphSkillIdForDesktopSkill(skill.id);
        if (graphSkillId) {
          selectedNodeIds.set(capabilityNodeId("skill", graphSkillId), graphSkillId);
        }
      }
    }
    const approvals = this.database.listApprovals?.(run.id) ?? [];
    const evidence = this.database.listEvidence?.(run.id) ?? [];
    const rollbackCount = actionLog.filter((entry) => Boolean(entry?.result?.rollbackManifestPath || entry?.result?.backupPath)).length;
    for (const [nodeId, skillId] of selectedNodeIds) {
      this.database.insertCapabilityFeedback({
        id: createId("capfb"),
        nodeId,
        skillId,
        mission: run.mission,
        projectId: run.projectId,
        runId: run.id,
        conversationTurnId: null,
        selectedScore: null,
        outcomeStatus,
        approvalCount: approvals.length,
        evidenceCount: evidence.length,
        rollbackCount,
        notes,
        metadata: {
          source: "desktop_plan_execution",
          selectedApplicationId: desktopPlan.selectedApplication?.id ?? null,
          primitiveCount: (desktopPlan.steps ?? []).length,
          completedActionCount: actionLog.filter((entry) => entry.status === "completed").length
        },
        createdAt: nowIso()
      });
    }
  }

  #recordEvent(runId, event) {
    this.database.insertEvent(runId, event);
    return event;
  }

  #requireProject(projectId) {
    const project = this.database.getProject(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return project;
  }
}
