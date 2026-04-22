import assert from "node:assert/strict";
import {
  OPERATIONAL_DEEP_FIELD_SCENARIOS,
  buildOperationalDeepReadinessReport
} from "../src/release/operational-deep-readiness.js";

export async function run() {
  const advancedDesktopReport = {
    executionMode: "real_safe_capability_probe",
    scenarios: [
      { id: "file_explorer_observe_readonly", status: "ready" },
      { id: "text_editor_draft_capture", status: "ready" },
      { id: "browser_search_capture_sequence", status: "ready" },
      { id: "calculator_result_capture", status: "ready" },
      { id: "active_window_ocr_extract", status: "ready" },
      { id: "semantic_button_targeting", status: "ready" },
      { id: "blocked_sensitive_action_recovery", status: "ready" }
    ]
  };
  const realSurfaceSummary = {
    overallStatus: "all_passed",
    scenarios: [
      { scenarioId: "bounded_local_window_observation", status: "pass" },
      { scenarioId: "bounded_real_web_research", status: "pass" }
    ]
  };
  const report = await buildOperationalDeepReadinessReport({
    advancedDesktopReport,
    realSurfaceSummary
  });
  assert.equal(report.classification.implementationStatus, "operational_deep_contract");
  assert.equal(report.classification.isJonOperationalDeepImplemented, true);
  assert.equal(report.skillValidation.status, "all_passed");
  assert.equal(report.fieldScenarios.length, OPERATIONAL_DEEP_FIELD_SCENARIOS.length);
  assert.equal(report.fieldScenarios.some((scenario) => scenario.skillId === "skill.browser" && scenario.status === "field_supported"), true);
  assert.equal(report.fieldScenarios.some((scenario) => scenario.skillId === "skill.terminal_guarded" && scenario.status === "partial"), true);
  assert.equal(report.classification.fieldProofStatus, "partial");

  const emptyEvidenceReport = await buildOperationalDeepReadinessReport({
    advancedDesktopReport: null,
    realSurfaceSummary: {
      overallStatus: "incomplete",
      scenarios: []
    }
  });
  assert.equal(emptyEvidenceReport.classification.implementationStatus, "operational_deep_contract");
  assert.equal(emptyEvidenceReport.classification.fieldProofStatus, "missing");
  assert.equal(emptyEvidenceReport.nextRequiredProof.length, OPERATIONAL_DEEP_FIELD_SCENARIOS.length);
}
