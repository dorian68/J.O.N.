import path from "node:path";
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
  buildDeterministicFallbackOutput
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

const PRIMARY_REASONING_PROMPT = Object.freeze({
  promptId: "system.primary_reasoning",
  version: "1.0.0"
});
const RUN_HANDOFF_DECISION_TIMEOUT_MS = 4_000;

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
    reasoningEngine = createDefaultContextualReasoningEngine()
  }) {
    this.database = database;
    this.browser = browserController;
    this.computer = computerControlService;
    this.policy = policyEngine;
    this.llmGateway = llmGateway;
    this.reasoning = reasoningEngine;
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
    const completion = this.#executeResearchMission({
      run,
      runDir,
      project,
      hubUrl: input.hubUrl,
      linkSpecs: input.linkSpecs,
      fieldMap: input.fieldMap,
      sourceTargets: input.sourceTargets,
      sourceTrustClassification: input.sourceTrustClassification,
      evidenceSensitivity: input.evidenceSensitivity
    });
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
    const completion = this.#executeFormPreparationMission({
      run,
      runDir,
      project,
      formUrl: input.formUrl,
      values: input.values
    });
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
    const completion = desktopAction?.type === "desktop_autonomy"
      ? this.#executeDesktopAutonomyScenario({
        run,
        runDir,
        project,
        desktopAction,
        surfaceClassification: input.surfaceClassification ?? "real_local_desktop",
        evidenceSensitivity: input.evidenceSensitivity ?? "real_local_desktop"
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
    skillCatalog = []
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
      const desktopPlan = await this.#generateDesktopPlan({
        run,
        project,
        desktopAction,
        visibleWindows: visibleWindowsBefore,
        activeWindow: activeWindowBefore,
        installedApplications,
        activeAccessibilityBefore,
        desktopSnapshot,
        skillCatalog
      });
      desktopPlan.output = validateDesktopPlanOutput(desktopPlan.output, {
        maxSteps: this.#desktopSandboxSummary().maxPlanSteps ?? 14
      });
      desktopPlanForFeedback = desktopPlan.output;

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
      for (const step of desktopPlan.output.steps) {
        if (step.primitive === "stop") {
          actionLog.push({ step, status: "stopped", result: null });
          break;
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
          this.#recordEvent(run.id, createEvent("tool.blocked", EVENT_ACTOR.POLICY, `Desktop primitive blocked: ${step.primitive}.`, {
            primitive: step.primitive,
            stepId: step.id,
            reason: safety.reason
          }));
          break;
        }
        const beforePerception = currentWindow?.id
          ? await this.computer.inspectVisibleUi(currentWindow.id).catch((error) => ({
            available: false,
            reason: error.message
          }))
          : null;
        if (safety.requiresApproval) {
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
            return this.#stopRunFromApproval(run.id, authorization.approvalRecord, step.label);
          }
        }

        let result = null;
        try {
          switch (step.primitive) {
          case "launch_application": {
            const appId = step.target?.appId ?? desktopPlan.output.selectedApplication?.id;
            result = await this.computer.launchApplication(appId);
            const waitResult = await this.computer.waitForVisibleWindowMatch((windowState) => {
              return String(windowState.processName ?? "").toLowerCase() === String(result?.application?.processName ?? "").toLowerCase()
                || String(windowState.executablePath ?? "").toLowerCase() === String(result?.application?.executablePath ?? "").toLowerCase()
                || String(windowState.title ?? "").toLowerCase().includes(String(result?.application?.label ?? "").toLowerCase());
            }, { timeoutMs: 5000, intervalMs: 150 });
            currentWindow = waitResult.matchedWindow ?? await this.computer.detectActiveWindow();
            result = { launch: result, waitResult, currentWindow };
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
            const semanticResolution = semanticSelector && targetWindow?.id
              ? await this.computer.resolveSemanticTarget(targetWindow.id, semanticSelector).catch((error) => ({
                found: false,
                reason: error.message,
                target: null
              }))
              : null;
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
          this.#recordEvent(run.id, createEvent("tool.recovery_attempted", EVENT_ACTOR.COMPUTER, `Desktop recovery attempted after ${step.primitive} failed.`, {
            primitive: step.primitive,
            stepId: step.id,
            selectedStrategy: recovery.selectedStrategy,
            reason: error.message
          }));
          currentWindow = recoveredWindow ?? currentWindow;
          break;
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
      const evidence = await this.computer.exportActionEvidence(path.join(runDir, "evidence"), "desktop-autonomy", {
        mission: run.mission,
        desktopPlan: desktopPlan.output,
        actionLog,
        checkpoints,
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
          checkpointCount: checkpoints.length
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

      await this.#updateRun(run.id, {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Governed desktop autonomy run completed."
      });
      this.#recordEvent(run.id, createEvent("run.completed", EVENT_ACTOR.AGENT, "Governed desktop autonomy scenario completed.", {
        actionCount: actionLog.length,
        selectedApplicationId: desktopPlan.output.selectedApplication?.id ?? null
      }));
      return {
        ...(await this.getRunBundle(run.id)),
        desktopPlan: desktopPlan.output
      };
    } catch (error) {
      this.#recordCapabilityFeedbackForDesktopPlan({
        run,
        desktopPlan: desktopPlanForFeedback,
        actionLog: actionLogForFeedback,
        outcomeStatus: "failed",
        notes: error.message
      });
      await this.#failRun(run.id, error);
      throw error;
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
          })
        ]
      };
      if (browserLaunchVerification.checks.some((check) => check.status !== "pass")) {
        browserLaunchVerification.overallStatus = "fail";
      }
      await this.#recordVerificationSummary(run.id, browserLaunchVerification);
      if (browserLaunchVerification.overallStatus !== "pass") {
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
      const verification = this.computer.verifyVisibleOutcome(beforeCapture, afterCapture, (before, after) => expectedMatcher({
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
        availableBrowsers
      },
      priorSnapshots: []
    });
  }

  async #previewMissionUnderstanding({ run, project, scenarioType, missionDraft, availableBrowsers }) {
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
      availableBrowsers
    };
    const bindings = {
      mission: run.mission,
      scenarioType,
      missionSpec: JSON.stringify(missionDraft ?? null),
      allowlistedDomains: JSON.stringify(project?.allowlistedDomains ?? []),
      availableBrowsers: JSON.stringify(availableBrowsers ?? [])
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
    priorSnapshots = []
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
      validateOutput
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
    const input = {
      mission: run.mission,
      scenarioType,
      missionSpec: run.metadata?.missionSpec ?? null,
      allowlistedDomains: project?.allowlistedDomains ?? [],
      availableBrowsers
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
          availableBrowsers: JSON.stringify(availableBrowsers ?? [])
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
          availableBrowsers: JSON.stringify(input.availableBrowsers ?? [])
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

  async #invokeLlm({ run, callType, modelAlias, promptRefs, input, metadata = {}, validateOutput }) {
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
        validateOutput
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
