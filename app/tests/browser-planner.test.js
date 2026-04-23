import assert from "node:assert/strict";
import {
  BROWSER_PLAN_SCHEMA_VERSION,
  buildDeterministicBrowserPlan,
  validateBrowserPlanOutput
} from "../src/browser/browser-planner.js";

export async function run() {
  const plan = buildDeterministicBrowserPlan({
    mission: "Open the controlled page, inspect it, click the ready button and capture proof.",
    startUrl: "http://127.0.0.1:41731/outcome-status.html",
    allowlistedHosts: ["127.0.0.1"],
    stepHints: [
      {
        id: "click_ready",
        action: "click",
        selector: { testId: "button-promote-status" },
        requiresApproval: false
      },
      {
        id: "verify_ready",
        action: "verify_outcome",
        expectation: {
          type: "text_visible",
          selector: { testId: "status-value" },
          expectedText: "ready"
        }
      }
    ]
  });

  assert.equal(plan.schemaVersion, BROWSER_PLAN_SCHEMA_VERSION);
  assert.equal(plan.allowlistedHosts.includes("127.0.0.1"), true);
  assert.deepEqual(
    ["open_session", "navigate", "wait_state", "read_state", "read_dom", "detect_blockers"].every((action) => plan.steps.some((step) => step.action === action)),
    true
  );
  assert.equal(plan.steps.some((step) => step.action === "click" && step.selector.testId === "button-promote-status"), true);
  assert.equal(plan.steps.some((step) => step.action === "verify_outcome" && step.expectation.type === "text_visible"), true);

  assert.throws(
    () => validateBrowserPlanOutput({
      missionSummary: "Unsafe external URL",
      startUrl: "https://example.com/",
      allowlistedHosts: ["127.0.0.1"],
      steps: [
        { id: "open", action: "open_session" },
        { id: "go", action: "navigate", target: { url: "https://example.com/" } }
      ]
    }, { allowlistedHosts: ["127.0.0.1"] }),
    /not allowlisted/
  );

  assert.throws(
    () => validateBrowserPlanOutput({
      missionSummary: "Bad action",
      startUrl: "http://127.0.0.1:41731/index.html",
      allowlistedHosts: ["127.0.0.1"],
      steps: [
        { id: "open", action: "open_session" },
        { id: "bad", action: "stealth_bypass", target: {} }
      ]
    }, { allowlistedHosts: ["127.0.0.1"] }),
    /Unsupported browser plan action/
  );

  assert.throws(
    () => validateBrowserPlanOutput({
      missionSummary: "Credential action",
      startUrl: "http://127.0.0.1:41731/index.html",
      allowlistedHosts: ["127.0.0.1"],
      steps: [
        { id: "open", action: "open_session" },
        {
          id: "type_password",
          action: "type",
          selector: { css: "input[type=password]" },
          value: "password"
        }
      ]
    }, { allowlistedHosts: ["127.0.0.1"] }),
    /stealth/
  );
}
