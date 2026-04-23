import assert from "node:assert/strict";
import {
  buildDeterministicMissionUnderstanding,
  detectUnsupportedMissionRequests,
  inferMissionMode,
  missionModeToScenarioType,
  scenarioTypeToMissionMode,
  validateMissionUnderstandingOutput
} from "../src/mission/mission-understanding.js";

export async function run() {
  const researchInference = inferMissionMode({
    objective: "Open the browser, compare the allowlisted pages, and prepare a short note."
  });
  assert.equal(researchInference.mode, "research");

  const formInference = inferMissionMode({
    objective: "Prepare the form fields for review and stop before submission.",
    parameters: {
      formValues: {
        name: "Jordan Labry"
      }
    }
  });
  assert.equal(formInference.mode, "form");

  const computerInference = inferMissionMode({
    objective: "Bring the local window to the front, observe the screen, and capture proof."
  });
  assert.equal(computerInference.mode, "computer");

  const unsupported = detectUnsupportedMissionRequests({
    objective: "Log in, upload a file, then submit the form."
  });
  assert.equal(unsupported.length >= 2, true);

  const understanding = buildDeterministicMissionUnderstanding({
    mission: "Bring the local window to the front and capture proof.",
    scenarioType: "computer_observation"
  });
  assert.equal(understanding.chosenExecutionFrame, "computer_observation");
  assert.equal(Array.isArray(understanding.verificationGoals), true);
  assert.equal(understanding.verificationGoals.length > 0, true);
  assert.equal(Array.isArray(understanding.runNowPlan), true);
  assert.equal(understanding.runNowPlan.length > 0, true);
  assert.equal(typeof understanding.nextRunSuggestion, "string");
  assert.equal(typeof understanding.maybeLaterSuggestion, "string");
  assert.equal(understanding.nextRunRecommendation, null);
  assert.equal(understanding.requiresClarification, false);

  const hybridUnderstanding = buildDeterministicMissionUnderstanding({
    mission: "Open the browser, compare the allowlisted pages, then capture a screenshot of the visible result.",
    availableBrowsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" }
    ]
  });
  assert.equal(["partial", "clarification_needed"].includes(hybridUnderstanding.coverageStatus), true);
  assert.equal(hybridUnderstanding.nextRunSuggestion.length > 0, true);
  assert.equal(hybridUnderstanding.requiresClarification, false);
  assert.equal(hybridUnderstanding.nextRunRecommendation?.preferredMode, "computer");
  assert.equal(hybridUnderstanding.nextRunRecommendation?.parameters?.computerAction?.type, "capture_browser_window");
  assert.equal(hybridUnderstanding.clarificationQuestion.length === 0, true);

  const browserClarification = buildDeterministicMissionUnderstanding({
    mission: "Open my browser on this machine.",
    availableBrowsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" },
      { id: "chrome", label: "Google Chrome", processName: "chrome" }
    ]
  });
  assert.equal(browserClarification.chosenExecutionFrame, "computer_observation");
  assert.equal(browserClarification.computerActionType, "launch_browser");
  assert.equal(browserClarification.requiresClarification, true);
  assert.equal(browserClarification.clarificationOptions.length, 2);
  assert.equal(browserClarification.choiceRequest.kind, "browser");
  assert.equal(browserClarification.choiceRequest.options.length, 2);
  assert.equal(browserClarification.choiceRequest.resolutionTarget.parameterPath, "parameters.browserLaunch.browserId");
  assert.equal(browserClarification.selectedBrowser, null);

  const browserSelected = buildDeterministicMissionUnderstanding({
    mission: "Open Chrome on this machine.",
    availableBrowsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" },
      { id: "chrome", label: "Google Chrome", processName: "chrome" }
    ]
  });
  assert.equal(browserSelected.chosenExecutionFrame, "computer_observation");
  assert.equal(browserSelected.computerActionType, "launch_browser");
  assert.equal(browserSelected.requiresClarification, false);
  assert.equal(browserSelected.selectedBrowser?.id, "chrome");
  assert.equal(browserSelected.runNowPlan.some((step) => step.includes("Google Chrome")), true);

  const browserSearch = buildDeterministicMissionUnderstanding({
    mission: "Open Edge, search for release readiness, then capture a screenshot of the visible result.",
    availableBrowsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" }
    ]
  });
  assert.equal(browserSearch.chosenExecutionFrame, "computer_observation");
  assert.equal(browserSearch.computerActionType, "launch_browser_search");
  assert.equal(browserSearch.requiresClarification, false);
  assert.equal(browserSearch.browserSearchQuery.length > 0, true);
  assert.equal(browserSearch.browserLaunchUrl.startsWith("https://"), true);
  assert.equal(browserSearch.nextRunRecommendation?.preferredMode, "computer");
  assert.equal(browserSearch.nextRunRecommendation?.parameters?.computerAction?.type, "capture_browser_window");
  assert.equal(browserSearch.nextRunRecommendation?.parameters?.browserLaunch?.browserId, "edge");

  const browserCaptureFollowUp = buildDeterministicMissionUnderstanding({
    mission: "Capture a visible screenshot from Microsoft Edge after the browser step completes.",
    parameters: {
      browserLaunch: {
        browserId: "edge"
      },
      computerAction: {
        type: "capture_browser_window"
      }
    },
    availableBrowsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" },
      { id: "chrome", label: "Google Chrome", processName: "chrome" }
    ]
  });
  assert.equal(browserCaptureFollowUp.chosenExecutionFrame, "computer_observation");
  assert.equal(browserCaptureFollowUp.computerActionType, "capture_browser_window");
  assert.equal(browserCaptureFollowUp.requiresClarification, false);
  assert.equal(browserCaptureFollowUp.selectedBrowser?.id, "edge");

  const stringListOutput = {
    ...buildDeterministicMissionUnderstanding({
      mission: "Open the browser and search release readiness.",
      availableBrowsers: [
        { id: "edge", label: "Microsoft Edge", processName: "msedge" }
      ]
    }),
    coveredNow: "Open Microsoft Edge\nSearch release readiness",
    requestedOutcomes: "Open Microsoft Edge; Search release readiness",
    runNowPlan: "Open Microsoft Edge\nSearch release readiness",
    verificationGoals: "Verify the browser opened\nPersist visible proof"
  };
  const normalizedStringLists = validateMissionUnderstandingOutput(stringListOutput, {
    availableBrowsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" }
    ]
  });
  assert.equal(Array.isArray(normalizedStringLists.coveredNow), true);
  assert.equal(normalizedStringLists.coveredNow.length, 2);
  assert.equal(normalizedStringLists.runNowPlan.length, 2);

  const vagueUnderstanding = buildDeterministicMissionUnderstanding({
    mission: "Handle this for me."
  });
  assert.equal(vagueUnderstanding.requiresClarification, true);
  assert.equal(vagueUnderstanding.clarificationQuestion.length > 0, true);
  assert.equal(vagueUnderstanding.nextRunRecommendation, null);

  assert.equal(missionModeToScenarioType("form"), "form_preparation");
  assert.equal(scenarioTypeToMissionMode("research"), "research");
}
