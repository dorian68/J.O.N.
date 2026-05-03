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

  const preferredApplicationPlan = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open my note editor.",
    missionSpec: {
      parameters: {
        applicationLaunch: {
          applicationId: "obsidian"
        }
      }
    },
    installedApplications: [
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
      }
    ]
  }));
  assert.equal(preferredApplicationPlan.selectedApplication.id, "obsidian");

  const upworkPlan = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Ouvrir Upwork et lister 5 postes autour de Excel.",
    missionSpec: {
      parameters: {
        browserLaunch: {
          browserId: "chrome",
          targetSite: "Upwork",
          searchQuery: "Excel",
          searchUrl: "https://www.google.com/search?q=Upwork%20Excel%20jobs",
          resultType: "jobs",
          resultCount: 5
        },
        computerAction: {
          type: "launch_browser_search"
        }
      }
    },
    installedApplications: [
      {
        id: "shortcut_excel",
        label: "Microsoft Excel",
        kind: "spreadsheet",
        processName: "EXCEL",
        executablePath: "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE"
      },
      {
        id: "browser_chrome",
        label: "Google Chrome",
        kind: "browser",
        processName: "chrome",
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
    ]
  }));
  assert.equal(upworkPlan.selectedApplication.id, "browser_chrome");
  assert.equal(upworkPlan.steps.some((step) => step.primitive === "launch_application" && step.target.appId === "shortcut_excel"), false);
  assert.equal(upworkPlan.steps.some((step) => step.primitive === "type_text" && step.input.text.includes("google.com/search")), true);
  assert.equal(upworkPlan.steps.some((step) => step.primitive === "type_text" && step.input.text.includes("Upwork")), true);
  assert.equal(upworkPlan.steps.some((step) => step.primitive === "capture_window"), true);

  const linkedInPlan = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open LinkedIn and list 3 data analyst jobs.",
    missionSpec: {
      parameters: {
        browserLaunch: {
          browserId: "chrome",
          url: "https://linkedin.com",
          searchQuery: "data analyst",
          resultType: "jobs",
          resultCount: 3
        },
        computerAction: {
          type: "launch_browser_search"
        }
      }
    },
    installedApplications: [
      {
        id: "shortcut_excel",
        label: "Microsoft Excel",
        kind: "spreadsheet",
        processName: "EXCEL",
        executablePath: "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE"
      },
      {
        id: "browser_chrome",
        label: "Google Chrome",
        kind: "browser",
        processName: "chrome",
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
    ]
  }));
  assert.equal(linkedInPlan.selectedApplication.id, "browser_chrome");
  assert.equal(linkedInPlan.steps.some((step) => step.primitive === "type_text" && step.input.text.includes("site%3Alinkedin.com")), true);

  const localExcelPlan = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open Excel on this machine.",
    installedApplications: [
      {
        id: "shortcut_excel",
        label: "Microsoft Excel",
        kind: "spreadsheet",
        processName: "EXCEL",
        executablePath: "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE"
      },
      {
        id: "browser_chrome",
        label: "Google Chrome",
        kind: "browser",
        processName: "chrome",
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
    ]
  }));
  assert.equal(localExcelPlan.selectedApplication.id, "shortcut_excel");

  const clarification = validateDesktopPlanOutput(buildDeterministicDesktopPlan({
    mission: "Open the app and type hello.",
    installedApplications: []
  }));
  assert.equal(clarification.requiresClarification, true);
  assert.equal(clarification.clarificationQuestion.length > 0, true);
}
