import assert from "node:assert/strict";
import {
  defaultProjectMemory,
  normalizeProjectMemory,
  projectMemorySettingKey,
  summarizeProjectMemory,
  updateProjectMemoryFromRun
} from "../src/memory/project-memory.js";

export async function run() {
  const projectId = "prj_memory";
  assert.equal(projectMemorySettingKey(projectId), "project.memory.v1:prj_memory");

  let memory = defaultProjectMemory(projectId);
  memory = updateProjectMemoryFromRun(memory, {
    id: "run_browser_1",
    projectId,
    mission: "Open Edge and search invoices",
    status: "completed",
    summary: "Browser search completed.",
    metadata: {
      finalUrl: "https://example.com/results",
      missionUnderstanding: {
        chosenExecutionFrame: "computer_observation",
        computerActionType: "launch_browser_search",
        selectedBrowser: { id: "edge", label: "Microsoft Edge" }
      },
      verificationSummary: { overallStatus: "pass" }
    }
  });
  memory = updateProjectMemoryFromRun(memory, {
    id: "run_browser_2",
    projectId,
    mission: "Open Edge and search reports",
    status: "completed",
    summary: "Browser search completed again.",
    metadata: {
      finalUrl: "https://example.com/reports",
      missionUnderstanding: {
        chosenExecutionFrame: "computer_observation",
        computerActionType: "launch_browser_search",
        selectedBrowser: { id: "edge", label: "Microsoft Edge" }
      },
      verificationSummary: { overallStatus: "pass" }
    }
  });
  memory = updateProjectMemoryFromRun(memory, {
    id: "run_desktop_fail",
    projectId,
    mission: "Use Paint",
    status: "failed",
    summary: "Paint failed.",
    metadata: {
      missionUnderstanding: {
        chosenExecutionFrame: "computer_observation",
        computerActionType: "desktop_autonomy"
      },
      selectedApplication: { id: "paint", label: "Paint" },
      verificationSummary: { overallStatus: "fail" }
    }
  });

  const normalized = normalizeProjectMemory(memory, projectId);
  assert.equal(normalized.browsers["browser:edge"].successes, 2);
  assert.equal(normalized.hosts["host:example.com"].successes, 2);
  assert.equal(normalized.desktopApplications["desktop_app:paint"].failures, 1);

  const summary = summarizeProjectMemory(normalized);
  assert.equal(summary.learnedPreferences.some((entry) => entry.kind === "browser" && entry.label === "Microsoft Edge"), true);
  assert.equal(summary.topHosts[0].label, "example.com");
  assert.equal(summary.failurePatterns.some((entry) => entry.key === "desktop_app:paint"), true);

  const deduped = updateProjectMemoryFromRun(normalized, {
    id: "run_browser_2",
    projectId,
    mission: "Open Edge and search reports",
    status: "completed",
    summary: "Browser search completed again.",
    metadata: {
      missionUnderstanding: {
        chosenExecutionFrame: "computer_observation",
        computerActionType: "launch_browser_search",
        selectedBrowser: { id: "edge", label: "Microsoft Edge" }
      }
    }
  });
  assert.equal(deduped.browsers["browser:edge"].successes, 2);
}
