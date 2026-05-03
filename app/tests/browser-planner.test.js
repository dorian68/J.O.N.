import assert from "node:assert/strict";
import {
  BROWSER_PLAN_SCHEMA_VERSION,
  BROWSER_REPLAN_TRIGGERS,
  buildDeterministicBrowserPlan,
  buildDeterministicBrowserReplan,
  selectReplanTriggerChange,
  validateBrowserPlanOutput
} from "../src/browser/browser-planner.js";
import { rankCandidates } from "../src/browser/dom-strategy.js";

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

  // --- Replan: trigger selection ---
  assert.deepEqual(
    BROWSER_REPLAN_TRIGGERS.includes("url_changed") &&
    BROWSER_REPLAN_TRIGGERS.includes("blocker_changed") &&
    BROWSER_REPLAN_TRIGGERS.includes("active_target_changed"),
    true
  );

  // url_changed without a manual blocker should trigger a replan.
  const urlChangeTrigger = selectReplanTriggerChange([
    { id: "c1", reasons: ["url_changed", "dom_changed"], after: { activeTarget: { blocker: { blocked: false } } } }
  ]);
  assert.equal(urlChangeTrigger?.id, "c1", "url_changed should trigger replan");

  // dom_changed alone must NOT trigger a replan (too noisy, not structural).
  assert.equal(
    selectReplanTriggerChange([
      { id: "c2", reasons: ["dom_changed", "interactive_elements_changed"], after: { activeTarget: { blocker: null } } }
    ]),
    null,
    "dom_changed alone must not trigger replan"
  );

  // CAPTCHA blockers must not trigger a replan — they need manual handoff.
  assert.equal(
    selectReplanTriggerChange([
      { id: "c3", reasons: ["blocker_changed"], after: { activeTarget: { blocker: { blocked: true, reason: "solve captcha to continue" } } } }
    ]),
    null,
    "captcha blocker must not replan"
  );

  // Auth gate must not trigger replan.
  assert.equal(
    selectReplanTriggerChange([
      { id: "c4", reasons: ["url_changed"], after: { activeTarget: { blocker: { blocked: true, reason: "Please login to view this page" } } } }
    ]),
    null,
    "auth gate must not replan"
  );

  // Empty changes array returns null.
  assert.equal(selectReplanTriggerChange([]), null, "empty changes returns null");

  // --- Replan: deterministic fallback plan ---
  const replanFallback = buildDeterministicBrowserReplan({
    mission: "Find current order status",
    currentUrl: "https://shop.example.com/orders/123",
    allowlistedHosts: ["shop.example.com"]
  });
  // Replan fallback uses the correct schema.
  assert.equal(replanFallback.schemaVersion, BROWSER_PLAN_SCHEMA_VERSION);
  // Fallback is read-only: no interactive actions.
  assert.equal(
    replanFallback.steps.some((s) => ["click", "type", "select"].includes(s.action)),
    false,
    "replan fallback must not include interactive steps"
  );
  // Must end with evidence capture.
  const lastReplanStep = replanFallback.steps.at(-1);
  assert.equal(lastReplanStep?.action, "capture_evidence", "replan fallback must end with capture_evidence");
  // Fallback confidence must be low (signals LLM unavailability).
  assert.equal(replanFallback.confidence, "low", "replan fallback confidence must be low");
  // After filtering open_session (as BrowserOperator does during replan), steps are valid.
  const filteredReplanSteps = replanFallback.steps.filter((s) => s.action !== "open_session");
  assert.equal(filteredReplanSteps.some((s) => s.action === "capture_evidence"), true);
  assert.equal(filteredReplanSteps.length >= 4, true, "enough steps remain after open_session filter");

  const ranked = rankCandidates([
    {
      index: 0,
      tagName: "button",
      text: "Search",
      role: "button",
      visible: true,
      disabled: false,
      outsideViewport: false
    },
    {
      index: 1,
      tagName: "button",
      text: "Search settings",
      role: "button",
      visible: true,
      disabled: false,
      outsideViewport: false
    }
  ], {
    role: "button",
    name: "Search"
  });
  assert.equal(ranked.best.index, 0);
  assert.equal(ranked.ambiguous, false);
  assert.equal(ranked.best.reasons.includes("exact_name"), true);
}
