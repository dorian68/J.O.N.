import assert from "node:assert/strict";
import { buildDeterministicDesktopPlan, validateDesktopPlanOutput } from "../src/mission/desktop-plan.js";

export async function run() {
  const plan = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open Notepad, write hello cowork, then take a screenshot.",
    installedApplications: [
      {
        id: "notepad",
        label: "Notepad",
        kind: "text_editor",
        processName: "notepad",
        executablePath: "C:\\Windows\\System32\\notepad.exe"
      }
    ],
    visibleWindows: [],
    activeWindow: null
  }));

  assert.equal(plan.selectedApplication.id, "notepad");
  assert.equal(plan.requiresClarification, false);
  assert.equal(plan.steps.some((step) => step.primitive === "launch_application"), true);
  assert.equal(plan.steps.some((step) => step.primitive === "type_text"), true);
  assert.equal(plan.steps.some((step) => step.primitive === "capture_window"), true);

  const semanticClickPlan = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open Notepad, then click Search button.",
    installedApplications: [
      {
        id: "notepad",
        label: "Notepad",
        kind: "text_editor",
        processName: "notepad",
        executablePath: "C:\\Windows\\System32\\notepad.exe"
      }
    ]
  }));
  const clickStep = semanticClickPlan.steps.find((step) => step.primitive === "click_point");
  assert.equal(clickStep.target.semanticTarget, "Search");

  const clarification = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open the app and type hello.",
    installedApplications: []
  }));
  assert.equal(clarification.requiresClarification, true);
  assert.equal(clarification.clarificationQuestion.length > 0, true);
}
