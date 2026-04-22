import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createFixtureServer } from "../fixtures/fixture-server.js";
import { createPrototypeRuntime } from "../runtime/create-prototype-runtime.js";
import { ApprovalBroker } from "../runtime/approval-broker.js";
import { BenchmarkService } from "./benchmark-service.js";
import { summarizeLlmCalls } from "./llm-analytics.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";
import { createEvent } from "../runtime/events.js";
import {
  APPROVAL_DECISION,
  DATA_ROOT,
  EVENT_ACTOR,
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
  buildDeterministicConversationTurn,
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
  applyCapabilityOverrides,
  buildCapabilityFeedbackStats,
  compactCapabilityGraphForPrompt,
  explainCapabilityRankingForMission,
  refreshCapabilityGraph,
  scoreCapabilityNodesForMission,
  summarizeCapabilityGraph
} from "../capabilities/capability-graph.js";
import { buildDeterministicCapabilityDescriptionOutput } from "../llm/deterministic-fallbacks.js";
import {
  BUILTIN_SKILL_MANIFESTS,
  USER_SKILL_MANIFESTS_SETTING_KEY,
  normalizeUserDefinedSkillManifest,
  serializeSkillManifest,
  validateSkillManifest
} from "../capabilities/skill-manifest.js";
import { validateOperationalDeepSkills } from "../capabilities/skill-validation-harness.js";

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

function shouldUseConversationFallback(error) {
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

function compactConversationHistory(turns = []) {
  return turns.slice(-12).map((turn) => ({
    role: turn.role,
    kind: turn.kind,
    content: compactConversationMessage(turn.content).slice(0, 600),
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
    fixtureServer = null,
    realSurfaceRuntimeConfig = null,
    realSurfaceConfigPath = null,
    computerProvider = null
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
    let service = null;

    let runtimeHandle;
    runtimeHandle = await createPrototypeRuntime({
      approvalResolver: (request) => approvalBroker.requestApproval(request),
      computerProvider: resolvedComputerProvider,
      policyHooks: {
        onApprovalRequested: async (approvalRecord, action) => {
          runtimeHandle.database.insertApproval(action.runId, approvalRecord);
          runtimeHandle.database.updateRun(action.runId, {
            status: RUN_STATUS.PAUSED,
            lifecycleStage: "approval_pending",
            summary: `Awaiting approval: ${approvalRecord.actionLabel}`,
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
      realSurfaceRuntimeConfig: resolvedRuntimeConfig
    });
    await service.ensureDemoProject();
    return service;
  }

  constructor({
    fixtureServer,
    approvalBroker,
    runtimeHandle,
    computerProvider,
    benchmarkService,
    realSurfaceRuntimeConfig
  }) {
    super();
    this.fixtureServer = fixtureServer;
    this.approvalBroker = approvalBroker;
    this.runtimeHandle = runtimeHandle;
    this.computerProvider = computerProvider;
    this.benchmarkService = benchmarkService;
    this.realSurfaceRuntimeConfig = realSurfaceRuntimeConfig;
    this.activeRuns = new Map();
  }

  get fixtureManifest() {
    return this.fixtureServer.manifest;
  }

  async close() {
    await Promise.allSettled(this.activeRuns.values());
    await this.runtimeHandle.close();
    await this.fixtureServer.close();
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
    const graph = refreshCapabilityGraph(this.runtimeHandle.database, {
      applications: availableApplications,
      browsers: availableBrowsers,
      agentConfiguration: this.getAgentConfiguration()
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
      preview: "Oui. J’ai besoin de ton accord pour lancer l’application.",
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

  listActiveRunIds() {
    return Array.from(this.activeRuns.keys());
  }

  listPendingApprovals(runId = null) {
    const approvals = this.approvalBroker.listPending();
    if (!runId) {
      return approvals;
    }
    return approvals.filter((approval) => approval.runId === runId);
  }

  async getRunDetail(runId) {
    const bundle = await this.runtimeHandle.runtime.getRunBundle(runId);
    if (!bundle) {
      return null;
    }
    return buildRunReviewModel(bundle, this.listPendingApprovals(runId));
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
    const availableBrowsers = await this.listInstalledBrowsers();
    const availableApplications = await this.listInstalledApplications();
    const capabilityGraph = await this.getCapabilityGraph();
    const operationalDeep = await buildOperationalDeepReadinessReport();
    return {
      fixtureManifest: this.fixtureManifest,
      llmGatewayStatus: this.runtimeHandle.runtime.getLlmGatewayStatus(),
      llmDashboard: summarizeLlmCalls(projectLlmCalls, selectedProjectRuns),
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
        browserLaunchSupported: availableBrowsers.length > 0,
        generalDesktopControlSupported: availableApplications.length > 0
      },
      operationalDeep,
        capabilityGraph: {
          summary: capabilityGraph.summary,
          preview: compactCapabilityGraphForPrompt(capabilityGraph.nodes, {
            limit: 24,
            feedbackRecords: capabilityGraph.feedbackRecords
          }),
          nodes: capabilityGraph.nodes.slice(0, 80).map(compactCapabilityForDescription),
          feedback: capabilityGraph.feedback,
          skillRegistry: this.getSkillRegistry()
        },
      projects: projectsWithRuns,
      selectedProjectId,
      pendingApprovals: this.listPendingApprovals(),
      activeRunIds: this.listActiveRunIds(),
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
    if (this.activeRuns.size > 0) {
      throw new Error("A run is already active. Finish or fail the current run before launching a new one.");
    }

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
    if (this.activeRuns.size > 0) {
      throw new Error("A run is already active. Finish or fail the current run before launching a new one.");
    }

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
    this.runtimeHandle.database.insertConversationTurn(conversationTurnRecord({
      projectId,
      conversationId: conversation.id,
      role: "user",
      kind: "message",
      content: message,
      payload: {
        source: "user_home",
        conversationId: conversation.id
      }
    }));
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
      limit: 18,
      feedbackRecords: capabilityGraph.feedbackRecords
    });
    const input = {
      message,
      visibleAssistantSystemPrompt: agentConfig.conversationalSystemPrompt,
      guardrails: agentConfig.guardrails,
      capabilityGraph: relevantCapabilityGraph,
      conversationContext: {
        ...(turnRequest.context && typeof turnRequest.context === "object" ? turnRequest.context : {}),
        conversation: {
          id: conversation.id,
          title: conversation.title,
          summary: conversation.summary,
          status: conversation.status,
          updatedAt: conversation.updatedAt
        },
        persistedTurns: compactConversationHistory(persistedHistory)
      },
      safeCapabilities: safeCapabilitiesDescriptor(),
      availableBrowsers,
      availableApplications: availableApplications.slice(0, 40),
      activeRunState: buildActiveRunState(this.listActiveRunIds(), this.runtimeHandle.database)
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
          capabilityGraph: JSON.stringify(relevantCapabilityGraph),
          conversationContext: JSON.stringify(input.conversationContext ?? null),
          safeCapabilities: JSON.stringify(input.safeCapabilities),
          availableBrowsers: JSON.stringify(availableBrowsers),
          availableApplications: JSON.stringify(availableApplications.slice(0, 40)),
          activeRunState: JSON.stringify(input.activeRunState)
        }
      }
    ];

    let plannerResult;
    try {
      const result = await this.runtimeHandle.llmGateway.generateStructured({
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
          requestedModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING
        },
        validateOutput: (output) => validateConversationTurnOutput(output, { message })
      });
      plannerResult = {
        output: result.output,
        callRecord: result.callRecord,
        generationMode: "llm"
      };
    } catch (error) {
      if (!shouldUseConversationFallback(error) || !this.runtimeHandle.runtime.getLlmGatewayStatus().deterministicFallback) {
        throw error;
      }
      plannerResult = {
        output: validateConversationTurnOutput(buildDeterministicConversationTurn(input), { message }),
        callRecord: error.callRecord ?? null,
        generationMode: "deterministic_fallback",
        fallbackReason: error.category ?? "provider_unavailable"
      };
    }

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
        clarificationQuestion: turn.clarificationQuestion
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
      metadata: {
        ...(conversation.metadata ?? {}),
        lastIntentType: turn.intentType,
        lastAction: turn.action,
        lastGenerationMode: turn.generationMode
      },
      updatedAt: nowIso()
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

    return {
      conversation: this.runtimeHandle.database.getConversation(conversation.id),
      turn,
      preflight,
      missionDraft
    };
  }

  async readConversationArtifact(artifactId) {
    return readConversationArtifact(artifactId);
  }

  async waitForRun(runId) {
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) {
      await activeRun;
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
        await this.#maybeContinueMissionChain(runId).catch((error) => {
          this.runtimeHandle.database.insertEvent(runId, createEvent("run.chain.error", EVENT_ACTOR.SYSTEM, "Automatic mission chaining stopped after an orchestration error.", {
            error: error.message
          }));
          this.emitStateChanged("run.chain.error", {
            runId,
            error: error.message
          });
        });
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
