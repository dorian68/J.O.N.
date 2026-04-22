import assert from "node:assert/strict";
import { APPROVAL_DECISION } from "../src/config.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { OperatorService } from "../src/service/operator-service.js";

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
    assert.equal(detail.evidence.some((entry) => entry.label === "Desktop autonomy evidence"), true);
    assert.equal(detail.llmCalls.some((call) => call.callType === "desktop_plan"), true);
  } finally {
    await service.close();
  }
}
