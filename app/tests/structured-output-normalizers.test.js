import assert from "node:assert/strict";
import { normalizePlanOutput } from "../src/llm/structured-output-normalizers.js";

export async function run() {
  const normalized = normalizePlanOutput({
    plan: [
      {
        step: "Open browser",
        description: "Start a controlled browser session.",
        assumptions: ["Browser is installed."]
      },
      {
        step: "Collect sources",
        description: "Gather bounded evidence."
      }
    ],
    assumptions: ["Operator approvals remain unchanged."]
  });

  assert.deepEqual(normalized.steps, [
    "Open browser: Start a controlled browser session.",
    "Collect sources: Gather bounded evidence."
  ]);
  assert.deepEqual(normalized.assumptions, [
    "Browser is installed.",
    "Operator approvals remain unchanged."
  ]);

  const runNowPlan = normalizePlanOutput({
    missionSummary: "Open browser safely.",
    runNowPlan: [
      "Confirm the browser choice.",
      "Launch the selected browser.",
      "Verify the window opened."
    ],
    assumptions: ["Approval is still required before launch."]
  });
  assert.deepEqual(runNowPlan.steps, [
    "Confirm the browser choice.",
    "Launch the selected browser.",
    "Verify the window opened."
  ]);
  assert.deepEqual(runNowPlan.assumptions, ["Approval is still required before launch."]);

  const actionPlan = normalizePlanOutput({
    actions: [
      { action: "Open Microsoft Edge", detail: "Use the governed app-launch capability." },
      { title: "Check result", description: "Confirm a visible browser window exists." }
    ]
  });
  assert.deepEqual(actionPlan.steps, [
    "Open Microsoft Edge: Use the governed app-launch capability.",
    "Check result: Confirm a visible browser window exists."
  ]);
}
