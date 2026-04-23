import { APPROVAL_DECISION } from "../config.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { OperatorService } from "../service/operator-service.js";

const DEFAULT_TIMEOUT_MS = 45_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTurn(payload) {
  return {
    reply: payload.turn?.reply ?? "",
    intentType: payload.turn?.intentType ?? null,
    action: payload.turn?.action ?? null,
    generationMode: payload.turn?.generationMode ?? null,
    fallbackReason: payload.turn?.fallbackReason ?? null,
    requiresClarification: Boolean(payload.turn?.requiresClarification),
    choiceKind: payload.preflight?.understanding?.choiceRequest?.kind ?? payload.turn?.choiceRequest?.kind ?? null,
    choiceOptions: payload.preflight?.understanding?.choiceRequest?.options?.map((option) => option.label) ?? [],
    selectedBrowser: payload.preflight?.understanding?.selectedBrowser?.id ?? null,
    chosenExecutionFrame: payload.preflight?.understanding?.chosenExecutionFrame ?? null
  };
}

function assertCondition(condition, message, details = {}) {
  if (!condition) {
    throw Object.assign(new Error(message), {
      details
    });
  }
}

function createSmokeComputerProvider() {
  return new FakeWindowProvider([
    {
      id: "win_notes",
      title: "Operator Notes",
      active: true,
      allowlisted: true,
      content: "notes"
    }
  ], {
    applications: [
      {
        id: "notepad",
        label: "Bloc-notes",
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
  });
}

async function waitForRunDetail(service, runId, predicate, { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = 250 } = {}) {
  const startedAt = Date.now();
  let lastDetail = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastDetail = await service.getRunDetail(runId);
    if (lastDetail && predicate(lastDetail)) {
      return lastDetail;
    }
    await sleep(intervalMs);
  }
  throw Object.assign(new Error(`Timed out waiting for run ${runId} to reach the expected smoke state.`), {
    code: "SMOKE_RUN_STATE_TIMEOUT",
    runId,
    lastStatus: lastDetail?.run?.status ?? null,
    lastLifecycleStage: lastDetail?.run?.lifecycleStage ?? null,
    pendingApprovals: lastDetail?.pendingApprovals?.map((approval) => approval.actionLabel) ?? []
  });
}

async function main() {
  const requireLive = process.argv.includes("--require-live");
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: {
      research: {
        mode: "controlled_fixture",
        mission: "Controlled fixture research smoke."
      },
      computer: {
        mode: "controlled_fixture_window",
        mission: "Controlled fixture computer smoke."
      }
    },
    computerProvider: createSmokeComputerProvider()
  });

  const report = {
    status: "unknown",
    generatedAt: new Date().toISOString(),
    requireLive,
    checks: []
  };

  try {
    await service.clearTemporaryRuntimeState();
    for (const project of service.listProjects()) {
      await service.deleteProject(project.id);
    }
    const project = await service.ensureDemoProject();

    const greeting = await service.handleConversationTurn(project.id, {
      message: "hello ?"
    });
    const greetingSummary = summarizeTurn(greeting);
    assertCondition(Boolean(greetingSummary.reply), "Greeting did not produce a reply.", greetingSummary);
    if (requireLive) {
      assertCondition(greetingSummary.generationMode === "llm", "Greeting did not use the live LLM.", greetingSummary);
    }
    report.checks.push({
      id: "conversation_greeting",
      status: "pass",
      ...greetingSummary
    });

    const catalog = await service.handleConversationTurn(project.id, {
      message: "quels navigateurs et applications peux-tu utiliser sur cette machine ?"
    });
    const catalogSummary = summarizeTurn(catalog);
    assertCondition(
      /edge|chrome|bloc-notes|obsidian|navigateur|application/i.test(catalogSummary.reply)
        || (catalog.turn?.uiBlocks ?? []).length > 0,
      "Catalog question did not surface available tools/apps.",
      catalogSummary
    );
    report.checks.push({
      id: "safe_local_catalog_question",
      status: "pass",
      ...catalogSummary,
      uiBlockTypes: catalog.turn?.uiBlocks?.map((block) => block.type) ?? []
    });

    const ambiguousBrowser = await service.handleConversationTurn(project.id, {
      message: "ouvre mon navigateur web"
    });
    const ambiguousSummary = summarizeTurn(ambiguousBrowser);
    assertCondition(
      ambiguousSummary.choiceKind === "browser" && ambiguousSummary.choiceOptions.length >= 2,
      "Ambiguous browser launch did not produce a browser choice.",
      ambiguousSummary
    );
    report.checks.push({
      id: "ambiguous_browser_choice",
      status: "pass",
      ...ambiguousSummary
    });

    const launchTurn = await service.handleConversationTurn(project.id, {
      message: "ouvre Edge"
    });
    const launchSummary = summarizeTurn(launchTurn);
    assertCondition(
      launchTurn.preflight?.understanding?.selectedBrowser?.id === "edge",
      "Direct Edge launch did not select Edge in preflight.",
      launchSummary
    );

    const launch = await service.startMission(project.id, {
      missionSpec: launchTurn.missionDraft,
      preflight: launchTurn.preflight,
      conversationId: launchTurn.conversation?.id
    });

    const approvalDetail = await waitForRunDetail(
      service,
      launch.runId,
      (detail) => detail.pendingApprovals?.length > 0 || ["completed", "failed"].includes(detail.run?.status),
      { timeoutMs: DEFAULT_TIMEOUT_MS }
    );
    const pendingApproval = approvalDetail.pendingApprovals?.[0] ?? null;
    assertCondition(Boolean(pendingApproval), "Browser launch did not request approval before acting.", {
      runId: launch.runId,
      status: approvalDetail.run?.status,
      lifecycleStage: approvalDetail.run?.lifecycleStage
    });
    await service.resolveApproval(
      pendingApproval.id,
      APPROVAL_DECISION.APPROVED_ONCE,
      "Agentic desktop smoke approval."
    );
    const finalDetail = await service.waitForRun(launch.runId, {
      timeoutMs: DEFAULT_TIMEOUT_MS
    });
    assertCondition(finalDetail.run?.status === "completed", "Approved Edge launch run did not complete.", {
      runId: launch.runId,
      status: finalDetail.run?.status,
      lifecycleStage: finalDetail.run?.lifecycleStage
    });
    assertCondition((finalDetail.evidence ?? []).length > 0, "Approved Edge launch run did not produce evidence.", {
      runId: launch.runId
    });
    report.checks.push({
      id: "governed_browser_launch_execution",
      status: "pass",
      ...launchSummary,
      runId: launch.runId,
      runStatus: finalDetail.run.status,
      approvalLabel: pendingApproval.actionLabel,
      evidenceCount: finalDetail.evidence.length,
      artifactCount: finalDetail.artifacts?.length ?? 0,
      lastEvents: finalDetail.events?.slice(-6).map((event) => event.type) ?? []
    });

    report.status = "pass";
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "fail";
    report.error = {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      runId: error.runId ?? null,
      lastStatus: error.lastStatus ?? null,
      lastLifecycleStage: error.lastLifecycleStage ?? null,
      pendingApprovals: error.pendingApprovals ?? null
    };
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await service.close({ timeoutMs: 5_000 });
  }
}

await main();
