import assert from "node:assert/strict";
import { APPROVAL_DECISION } from "../src/config.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { OperatorService } from "../src/service/operator-service.js";
import { projectMemorySettingKey } from "../src/memory/project-memory.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function approveUntilComplete(service, runId, { timeoutMs = 12000 } = {}) {
  const startedAt = Date.now();
  const approved = new Set();
  while (Date.now() - startedAt < timeoutMs) {
    for (const approval of service.listPendingApprovals().filter((entry) => entry.runId === runId)) {
      if (approved.has(approval.id)) {
        continue;
      }
      approved.add(approval.id);
      await service.resolveApproval(approval.id, APPROVAL_DECISION.APPROVED_ONCE, "Approve governed desktop autonomy test primitive.");
    }
    const detail = await service.getRunDetail(runId);
    if (["completed", "failed", "stopped"].includes(detail.run.status)) {
      return detail;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for governed desktop autonomy run.");
}

async function runSemanticRecoveryScenario() {
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: {
      research: { mode: "controlled_fixture", mission: "Controlled fixture research test mission." },
      computer: { mode: "controlled_fixture_window", mission: "Controlled fixture computer observation test mission." }
    },
    computerProvider: new FakeWindowProvider([
      {
        id: "win_notes",
        title: "Scratch Pad",
        active: true,
        allowlisted: true,
        content: "notes"
      },
      {
        id: "win_search",
        title: "Search Panel",
        active: false,
        allowlisted: true,
        content: "ready",
        controls: [
          {
            id: "search_button",
            name: "Search",
            controlType: "ControlType.Button",
            bounds: { x: 400, y: 220, width: 120, height: 44 }
          }
        ]
      }
    ])
  });

  try {
    await service.clearTemporaryRuntimeState();
    for (const project of service.listProjects()) {
      await service.deleteProject(project.id);
    }
    const project = await service.ensureDemoProject();
    const preview = await service.previewMission(project.id, {
      objective: "On the desktop, click the Search button."
    });
    assert.equal(preview.preflight.understanding.computerActionType, "desktop_autonomy");

    const launch = await service.startMission(project.id, {
      missionSpec: {
        objective: "On the desktop, click the Search button."
      },
      preflight: preview.preflight
    });
    const detail = await approveUntilComplete(service, launch.runId);
    assert.equal(detail.run.status, "completed");
    assert.equal(detail.events.some((event) => event.type === "tool.pre_step_adapted"), true);
    assert.equal(detail.run.metadata?.desktopObservationSummary?.phases?.continuous_observation >= 1, true);
    assert.equal(detail.run.metadata?.desktopObservationSummary?.recoveryCount >= 0, true);
    assert.equal(detail.run.metadata?.verificationSummary?.overallStatus, "pass");
  } finally {
    await service.close();
  }
}

async function approveAfterDesktopDrift(service, provider, runId, { timeoutMs = 12000 } = {}) {
  const startedAt = Date.now();
  let driftInjected = false;
  while (Date.now() - startedAt < timeoutMs) {
    const pending = service.listPendingApprovals().find((entry) => entry.runId === runId);
    if (pending) {
      if (!driftInjected) {
        provider.focusWindow("win_browser");
        driftInjected = true;
        await sleep(650);
      }
      await service.resolveApproval(pending.id, APPROVAL_DECISION.APPROVED_ONCE, "Approve after simulated desktop drift.");
    }
    const detail = await service.getRunDetail(runId);
    if (["completed", "failed", "stopped"].includes(detail.run.status)) {
      return detail;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for desktop watcher drift scenario.");
}

async function runDesktopWatcherDriftScenario() {
  const provider = new FakeWindowProvider([
    {
      id: "win_notes",
      title: "Notes",
      active: true,
      allowlisted: true,
      content: "ready",
      controls: [
        {
          id: "continue_button",
          name: "Continue",
          controlType: "ControlType.Button",
          bounds: { x: 300, y: 200, width: 120, height: 44 }
        }
      ]
    },
    {
      id: "win_browser",
      title: "Browser",
      active: false,
      allowlisted: true,
      content: "external change"
    }
  ]);
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: {
      research: { mode: "controlled_fixture", mission: "Controlled fixture research test mission." },
      computer: { mode: "controlled_fixture_window", mission: "Controlled fixture computer observation test mission." }
    },
    computerProvider: provider
  });

  try {
    await service.clearTemporaryRuntimeState();
    for (const project of service.listProjects()) {
      await service.deleteProject(project.id);
    }
    const project = await service.ensureDemoProject();
    const preview = await service.previewMission(project.id, {
      objective: "On the desktop, click Continue button."
    });
    const launch = await service.startMission(project.id, {
      missionSpec: {
        objective: "On the desktop, click Continue button."
      },
      preflight: preview.preflight
    });
    const detail = await approveAfterDesktopDrift(service, provider, launch.runId);
    assert.equal(detail.run.status, "completed");
    assert.equal(detail.events.some((event) => event.type === "run.desktop_watch_changed"), true);
    assert.equal(detail.events.some((event) => event.type === "tool.pre_step_adapted"), true);
    assert.equal(detail.run.metadata?.desktopObservationSummary?.phases?.background_watch_change >= 1, true);
  } finally {
    await service.close();
  }
}

export async function run() {
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: {
      research: { mode: "controlled_fixture", mission: "Controlled fixture research test mission." },
      computer: { mode: "controlled_fixture_window", mission: "Controlled fixture computer observation test mission." }
    },
    computerProvider: new FakeWindowProvider([], {
      applications: [
        {
          id: "notepad",
          label: "Notepad",
          kind: "text_editor",
          processName: "notepad",
          executablePath: "C:\\Windows\\System32\\notepad.exe"
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
    const preview = await service.previewMission(project.id, {
      objective: "Open Notepad, write hello cowork, then take a screenshot."
    });
    assert.equal(preview.preflight.understanding.chosenExecutionFrame, "computer_observation");
    assert.equal(preview.preflight.understanding.computerActionType, "desktop_autonomy");

    const launch = await service.startMission(project.id, {
      missionSpec: {
        objective: "Open Notepad, write hello cowork, then take a screenshot."
      },
      preflight: preview.preflight
    });
    const detail = await approveUntilComplete(service, launch.runId);
    assert.equal(detail.run.status, "completed");
    assert.equal(detail.run.metadata?.computerActionType, "desktop_autonomy");
    assert.equal(detail.run.metadata?.verificationSummary?.overallStatus, "pass");
    assert.equal(detail.run.metadata?.desktopObservationSummary?.entryCount > 0, true);
    assert.equal(detail.run.metadata?.desktopMemorySummary?.recentRunCount > 0, true);
    const projectMemory = service.runtimeHandle.database.getAppSetting(projectMemorySettingKey(project.id), null).value;
    assert.equal(projectMemory?.recentRuns?.some((entry) => entry.runId === launch.runId), true);
    assert.equal(projectMemory?.desktopApplications?.["desktop_app:notepad"]?.successes >= 1, true);
    assert.equal(detail.evidence.some((entry) => entry.label === "Desktop autonomy evidence"), true);
    assert.equal(detail.llmCalls.some((call) => call.callType === "desktop_plan"), true);
  } finally {
    await service.close();
  }

  await runSemanticRecoveryScenario();
  await runDesktopWatcherDriftScenario();
}
