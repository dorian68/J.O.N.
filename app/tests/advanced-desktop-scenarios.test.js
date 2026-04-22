import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { ADVANCED_DESKTOP_SCENARIOS, runAdvancedDesktopScenarioPack } from "../src/validation/advanced-desktop-scenarios.js";

export async function run() {
  assert.equal(ADVANCED_DESKTOP_SCENARIOS.length >= 5, true);
  assert.equal(ADVANCED_DESKTOP_SCENARIOS.length <= 10, true);
  assert.equal(ADVANCED_DESKTOP_SCENARIOS.some((scenario) => scenario.id === "semantic_button_targeting"), true);
  assert.equal(ADVANCED_DESKTOP_SCENARIOS.some((scenario) => scenario.id === "active_window_ocr_extract"), true);

  const { report, latestPath } = await runAdvancedDesktopScenarioPack({ realSafe: false });
  assert.equal(report.scenarios.length, ADVANCED_DESKTOP_SCENARIOS.length);
  assert.equal(report.executionMode, "fixture_capability_probe");
  assert.equal(report.proofs.screenCapturePath.length > 0, true);
  assert.equal(report.proofs.semanticTargetCount > 0, true);
  assert.equal(report.scenarios.some((scenario) => scenario.status === "ready"), true);
  await fs.access(latestPath);
}
