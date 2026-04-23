import assert from "node:assert/strict";
import { APPROVAL_DECISION } from "../src/config.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { OperatorService } from "../src/service/operator-service.js";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture research test mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture computer observation test mission."
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPendingApproval(service, { timeoutMs = 4000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pending = service.listPendingApprovals();
    if (pending.length > 0) {
      return pending[0];
    }
    await sleep(100);
  }
  throw new Error("Timed out while waiting for a pending approval.");
}

async function waitForMissionChainWithApprovals(service, rootRunId, { timeoutMs = 15000 } = {}) {
  const startedAt = Date.now();
  const resolvedApprovalIds = new Set();
  while (Date.now() - startedAt < timeoutMs) {
    const rootRun = service.runtimeHandle.database.getRun(rootRunId);
    if (!rootRun) {
      return null;
    }
    const chainRuns = service.runtimeHandle.database
      .listRuns(rootRun.projectId)
      .filter((candidate) => (candidate.metadata?.orchestration?.rootRunId ?? candidate.id) === rootRunId)
      .sort((left, right) => Number(left.metadata?.orchestration?.runIndex ?? 0) - Number(right.metadata?.orchestration?.runIndex ?? 0));

    const pendingChainApprovals = service
      .listPendingApprovals()
      .filter((approval) => chainRuns.some((run) => run.id === approval.runId));
    for (const approval of pendingChainApprovals) {
      if (resolvedApprovalIds.has(approval.id)) {
        continue;
      }
      resolvedApprovalIds.add(approval.id);
      await service.resolveApproval(approval.id, APPROVAL_DECISION.APPROVED_ONCE, approval.category === "local_focus"
        ? "Allow chained focus shift for browser capture."
        : "Allow chained bounded continuation.");
    }

    const activeChainRun = chainRuns.find((candidate) => service.listActiveRunIds().includes(candidate.id));
    if (!activeChainRun && chainRuns.length >= 2) {
      return {
        rootRunId,
        runs: await Promise.all(chainRuns.map((candidate) => service.getRunDetail(candidate.id)))
      };
    }
    await sleep(100);
  }
  throw new Error("Timed out while waiting for the chained mission to settle.");
}

export async function run() {
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
    computerProvider: new FakeWindowProvider([
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
    ], {
      applications: [
        {
          id: "notepad",
          label: "Notepad",
          kind: "text_editor",
          processName: "notepad",
          executablePath: "C:\\Windows\\System32\\notepad.exe"
        },
        {
          id: "obsidian",
          label: "Obsidian",
          kind: "notes",
          processName: "Obsidian",
          executablePath: "C:\\Users\\Labry\\AppData\\Local\\Obsidian\\Obsidian.exe"
        },
        {
          id: "calculator",
          label: "Calculator",
          kind: "utility",
          processName: "CalculatorApp",
          executablePath: "C:\\Windows\\System32\\calc.exe"
        }
      ],
      browsers: [
        {
          id: "edge",
          label: "Microsoft Edge",
          processName: "msedge",
          executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
        },
        {
          id: "chrome",
          label: "Google Chrome",
          processName: "chrome",
          executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        }
      ]
    })
  });

  try {
    await service.clearTemporaryRuntimeState();
    for (const project of service.listProjects()) {
      await service.deleteProject(project.id);
    }
    const project = await service.ensureDemoProject();
    const dashboard = await service.getDashboard(project.id);
    assert.equal(Array.isArray(dashboard.missionEntry?.modes), true);
    assert.equal(dashboard.missionEntry.modes.some((mode) => mode.id === "research"), true);
    assert.equal(typeof dashboard.llmDashboard?.estimatedCost, "number");
    assert.equal(Array.isArray(dashboard.llmDashboard?.stageBreakdown), true);

    const launch = await service.startScenario(project.id, "computer");

    const pendingApproval = await waitForPendingApproval(service);
    assert.equal(pendingApproval.category, "local_focus");

    const pausedDetail = await service.getRunDetail(launch.runId);
    assert.equal(pausedDetail.run.status, "paused");
    assert.equal(pausedDetail.pendingApprovals.length, 1);
    assert.equal(pausedDetail.review.operatorState.code, "blocked_approval");
    assert.equal(pausedDetail.pendingApprovals[0].evidenceId != null, true);
    await assert.rejects(
      () => service.waitForRun(launch.runId, { timeoutMs: 30 }),
      (error) => error.code === "RUN_WAIT_TIMEOUT" && error.runId === launch.runId
    );

    await service.resolveApproval(pendingApproval.id, APPROVAL_DECISION.APPROVED_ONCE, "Controlled approval for service test.");
    const completedDetail = await service.waitForRun(launch.runId);

    assert.equal(completedDetail.run.status, "completed");
    assert.equal(completedDetail.approvals.length >= 1, true);
    assert.equal(completedDetail.evidence.length >= 1, true);
    assert.equal(completedDetail.review.operatorState.code, "finished");
    assert.equal(completedDetail.approvals[0].decisionAt != null, true);
    assert.equal(completedDetail.approvals[0].operatorRationale, "Controlled approval for service test.");

    const observationEvidence = completedDetail.evidence.find((entry) => entry.label === "Computer control observation evidence");
    assert.equal(Boolean(observationEvidence), true);
    const manifest = await service.readEvidenceManifest(launch.runId, observationEvidence.id);
    assert.equal(manifest.evidence.label, "Computer control observation evidence");
    assert.equal(manifest.content.payload.verification.validated, true);

    const preview = await service.previewMission(project.id, {
      objective: "Compare the controlled candidate pages and prepare a decision note for the operator.",
      deliverable: "Decision note with traceable findings",
      constraints: [
        "Use only controlled pages",
        "Keep uncertainty visible"
      ],
      forbiddenActions: [
        "Do not submit anything"
      ]
    });

    assert.equal(preview.preflight.understanding.chosenExecutionFrame, "research");
    assert.equal(preview.preflight.understanding.coveredNow.length >= 1, true);
    assert.equal(preview.preflight.understanding.verificationGoals.length >= 1, true);
    assert.equal(preview.preflight.understanding.runNowPlan.length >= 1, true);
    assert.equal(preview.preflight.understanding.nextRunSuggestion.length > 0, true);
    assert.equal(
      preview.preflight.understanding.nextRunRecommendation == null
        || typeof preview.preflight.understanding.nextRunRecommendation.objective === "string",
      true
    );
    assert.equal(preview.preflight.understanding.requiresClarification, false);

    const hybridPreview = await service.previewMission(project.id, {
      objective: "Compare the controlled pages, then capture a screenshot of the visible result."
    });
    assert.equal(hybridPreview.preflight.understanding.coverageStatus !== "full", true);
    assert.equal(hybridPreview.preflight.understanding.requiresClarification, true);
    assert.equal(hybridPreview.preflight.understanding.clarificationQuestion.length > 0, true);

    const browserPreview = await service.previewMission(project.id, {
      objective: "Open my browser on this machine."
    });
    assert.equal(browserPreview.preflight.understanding.chosenExecutionFrame, "computer_observation");
    assert.equal(browserPreview.preflight.understanding.computerActionType, "launch_browser");
    assert.equal(browserPreview.preflight.understanding.requiresClarification, true);
    assert.equal(browserPreview.preflight.understanding.clarificationOptions.length, 2);

    const browserSelectedPreview = await service.previewMission(project.id, {
      objective: "Open my browser on this machine.",
      parameters: {
        browserLaunch: {
          browserId: "edge"
        }
      }
    });
    assert.equal(browserSelectedPreview.preflight.understanding.requiresClarification, false);
    assert.equal(browserSelectedPreview.preflight.understanding.selectedBrowser?.id, "edge");

    const browserConversation = await service.handleConversationTurn(project.id, {
      message: "Open my browser on this machine."
    });
    assert.equal(browserConversation.preflight.understanding.requiresClarification, true);
    assert.equal(browserConversation.preflight.understanding.clarificationOptions.length, 2);
    const pendingConversation = service.runtimeHandle.database.getConversation(browserConversation.conversation.id);
    assert.equal(pendingConversation.metadata?.pendingClarification?.status, "awaiting_user");
    assert.equal(pendingConversation.metadata?.pendingClarification?.options.length, 2);

    const clarifiedConversation = await service.handleConversationTurn(project.id, {
      conversationId: browserConversation.conversation.id,
      message: "Microsoft Edge"
    });
    assert.equal(clarifiedConversation.turn.generationMode, "clarification_resolution");
    assert.equal(clarifiedConversation.turn.action, "prepare_mission_preflight");
    assert.equal(clarifiedConversation.preflight.understanding.requiresClarification, false);
    assert.equal(clarifiedConversation.preflight.understanding.selectedBrowser?.id, "edge");
    assert.equal(clarifiedConversation.missionDraft.parameters.browserLaunch.browserId, "edge");
    const resolvedConversation = service.runtimeHandle.database.getConversation(browserConversation.conversation.id);
    assert.equal(resolvedConversation.metadata?.pendingClarification, null);

    const appChoiceConversation = await service.handleConversationTurn(project.id, {
      message: "Ouvre mon éditeur de notes."
    });
    assert.equal(appChoiceConversation.preflight.understanding.requiresClarification, true);
    assert.equal(appChoiceConversation.preflight.understanding.choiceRequest.kind, "application");
    assert.equal(appChoiceConversation.preflight.understanding.choiceRequest.options.some((option) => option.id === "notepad"), true);
    assert.equal(appChoiceConversation.preflight.understanding.choiceRequest.options.some((option) => option.id === "obsidian"), true);
    const pendingAppChoice = service.runtimeHandle.database.getConversation(appChoiceConversation.conversation.id);
    assert.equal(pendingAppChoice.metadata?.pendingClarification?.choiceRequest?.kind, "application");

    const clarifiedAppChoice = await service.handleConversationTurn(project.id, {
      conversationId: appChoiceConversation.conversation.id,
      message: "Obsidian"
    });
    assert.equal(clarifiedAppChoice.turn.generationMode, "clarification_resolution");
    assert.equal(clarifiedAppChoice.preflight.understanding.requiresClarification, false);
    assert.equal(clarifiedAppChoice.missionDraft.parameters.applicationLaunch.applicationId, "obsidian");
    assert.equal(clarifiedAppChoice.missionDraft.parameters.applicationLaunch.applicationLabel, "Obsidian");
    const resolvedAppChoice = service.runtimeHandle.database.getConversation(appChoiceConversation.conversation.id);
    assert.equal(resolvedAppChoice.metadata?.pendingClarification, null);

    const browserMissionLaunch = await service.startMission(project.id, {
      missionSpec: {
        objective: "Open my browser on this machine.",
        parameters: {
          browserLaunch: {
            browserId: "edge"
          }
        }
      },
      preflight: browserSelectedPreview.preflight
    });
    const browserApproval = await waitForPendingApproval(service);
    assert.equal(browserApproval.category, "local_app_launch");
    await service.resolveApproval(browserApproval.id, APPROVAL_DECISION.APPROVED_ONCE, "Allow local browser launch for bounded test.");
    const browserMissionDetail = await service.waitForRun(browserMissionLaunch.runId);
    assert.equal(browserMissionDetail.run.status, "completed");
    assert.equal(browserMissionDetail.run.metadata?.computerActionType, "launch_browser");
    assert.equal(browserMissionDetail.run.metadata?.missionSpec?.parameters?.browserLaunch?.browserId, "edge");
    assert.equal(browserMissionDetail.run.plan?.missionUnderstanding?.selectedBrowser?.id, "edge");
    assert.equal(browserMissionDetail.review.outcomeSummary.selectedBrowser?.id, "edge");
    assert.equal(browserMissionDetail.review.outcomeSummary.didNow.some((item) => item.toLowerCase().includes("edge")), true);
    const browserEvidence = browserMissionDetail.evidence.find((entry) => entry.label === "Desktop browser launch evidence");
    assert.equal(Boolean(browserEvidence), true);
    const browserManifest = await service.readEvidenceManifest(browserMissionLaunch.runId, browserEvidence.id);
    assert.equal(browserManifest.content.payload.verification.validated, true);
    assert.equal(browserMissionDetail.run.metadata?.verificationSummary?.overallStatus, "pass");

    const browserSearchPreview = await service.previewMission(project.id, {
      objective: "Open Edge, search for release readiness, then capture a screenshot of the visible result.",
      parameters: {
        browserLaunch: {
          browserId: "edge"
        }
      }
    });
    assert.equal(browserSearchPreview.preflight.understanding.chosenExecutionFrame, "computer_observation");
    assert.equal(browserSearchPreview.preflight.understanding.computerActionType, "launch_browser_search");
    assert.equal(browserSearchPreview.preflight.understanding.browserSearchQuery.length > 0, true);
    assert.equal(browserSearchPreview.preflight.understanding.browserLaunchUrl.startsWith("https://"), true);
    assert.equal(browserSearchPreview.preflight.understanding.nextRunRecommendation?.preferredMode, "computer");
    assert.equal(browserSearchPreview.preflight.understanding.nextRunRecommendation?.parameters?.computerAction?.type, "capture_browser_window");
    assert.equal(browserSearchPreview.preflight.understanding.requiresClarification, false);

    const browserSearchMissionLaunch = await service.startMission(project.id, {
      missionSpec: {
        objective: "Open Edge, search for release readiness, then capture a screenshot of the visible result.",
        parameters: {
          browserLaunch: {
            browserId: "edge"
          }
        }
      },
      preflight: browserSearchPreview.preflight,
      orchestration: {
        autoContinue: true,
        maxAutoRuns: 2
      }
    });
    const browserSearchApproval = await waitForPendingApproval(service);
    assert.equal(browserSearchApproval.category, "local_app_launch");
    await service.resolveApproval(browserSearchApproval.id, APPROVAL_DECISION.APPROVED_ONCE, "Allow auto-chained browser search launch.");
    const missionChain = await waitForMissionChainWithApprovals(service, browserSearchMissionLaunch.runId);
    assert.equal(missionChain.runs.length >= 2, true);
    const sortedChainRuns = missionChain.runs.sort((left, right) => {
      const leftIndex = Number(left.run.metadata?.orchestration?.runIndex ?? 0);
      const rightIndex = Number(right.run.metadata?.orchestration?.runIndex ?? 0);
      return leftIndex - rightIndex;
    });
    const rootChainRun = sortedChainRuns[0];
    const secondChainRun = sortedChainRuns[1];
    assert.equal(rootChainRun.run.metadata?.computerActionType, "launch_browser_search");
    assert.equal(rootChainRun.run.metadata?.orchestration?.continuedToRunId, secondChainRun.run.id);
    assert.equal(rootChainRun.review.outcomeSummary.handoffDecision?.decision, "continue_now");
    assert.equal(secondChainRun.run.metadata?.computerActionType, "capture_browser_window");
    assert.equal(secondChainRun.run.metadata?.entryPoint, "auto_chain");
    assert.equal(secondChainRun.run.status, "completed");
    const captureEvidence = secondChainRun.evidence.find((entry) => entry.label === "Desktop browser capture evidence");
    assert.equal(Boolean(captureEvidence), true);
    const captureManifest = await service.readEvidenceManifest(secondChainRun.run.id, captureEvidence.id);
    assert.equal(captureManifest.content.payload.capture.window.title.includes("Microsoft Edge"), true);
    assert.equal(secondChainRun.run.metadata?.verificationSummary?.overallStatus, "pass");

    const missionLaunch = await service.startMission(project.id, {
      missionSpec: {
        objective: "Compare the controlled candidate pages and prepare a decision note for the operator.",
        deliverable: "Decision note with traceable findings",
        constraints: [
          "Use only controlled pages",
          "Keep uncertainty visible"
        ],
        forbiddenActions: [
          "Do not submit anything"
        ]
      },
      preflight: preview.preflight
    });
    const missionDetail = await service.waitForRun(missionLaunch.runId);

    assert.equal(missionDetail.run.status, "completed");
    assert.equal(missionDetail.run.metadata?.entryPoint, "mission_entry_gui");
    assert.equal(missionDetail.run.metadata?.missionSpec?.routing?.modeSource, "agent_preflight_confirmed");
    assert.equal(missionDetail.run.metadata?.missionSpec?.objective, "Compare the controlled candidate pages and prepare a decision note for the operator.");
    assert.equal(missionDetail.run.plan?.missionUnderstanding?.chosenExecutionFrame, "research");
    assert.equal(missionDetail.run.plan?.missionUnderstanding?.generationMode, "confirmed_preflight");
    assert.equal(missionDetail.run.plan?.missionUnderstanding?.runNowPlan.length >= 1, true);
    assert.equal(typeof missionDetail.run.plan?.missionUnderstanding?.nextRunSuggestion, "string");
    assert.equal(missionDetail.review.outcomeSummary.didNow.length >= 1, true);
    assert.equal(missionDetail.review.outcomeSummary.verifiedNow.length >= 1, true);
    assert.equal(missionDetail.review.outcomeSummary.recommendedNextStep.summary.length > 0, true);
    assert.equal(typeof missionDetail.review.llmUsage.totalTokens, "number");
    assert.equal(missionDetail.run.metadata?.verificationSummary?.overallStatus, "pass");
    assert.equal(missionDetail.artifacts.length >= 2, true);

    const refreshedDashboard = await service.getDashboard(project.id);
    assert.equal(refreshedDashboard.llmDashboard.callCount >= 1, true);
    assert.equal(refreshedDashboard.llmDashboard.recentRuns.some((entry) => entry.runId === missionLaunch.runId), true);
  } finally {
    await service.close();
  }
}
