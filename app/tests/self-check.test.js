import assert from "node:assert/strict";
import { runSelfCheck } from "../src/release/self-check.js";

// A fixture provider without selfTest() should be treated as not-applicable (ok).
const fixtureRuntime = {
  computer: { provider: {} },
  getLlmGatewayStatus: () => ({ providers: ["mock_offline"], productionStrict: false })
};

// A provider whose selfTest reports failure should fail that check.
const brokenRuntime = {
  computer: { provider: { selfTest: async () => ({ ok: false, actuationMode: "single_shot", checks: {} }) } },
  getLlmGatewayStatus: () => ({ providers: ["mock_offline"], productionStrict: false })
};

export async function run() {
  const report = await runSelfCheck({ runtime: fixtureRuntime });
  assert.equal(typeof report.ok, "boolean");
  assert.ok(Array.isArray(report.checks));
  const ids = report.checks.map((c) => c.id).sort();
  assert.deepEqual(ids, ["deliverable_renderer", "desktop_provider", "llm_gateway"]);

  // Deliverable renderer must really work (libraries installed).
  const renderer = report.checks.find((c) => c.id === "deliverable_renderer");
  assert.equal(renderer.ok, true, "deliverable renderer should be operational");

  // Fixture provider (no selfTest) is reported ok / not-applicable.
  const desktop = report.checks.find((c) => c.id === "desktop_provider");
  assert.equal(desktop.ok, true);

  // Whole-system ok when renderer + gateway ok and provider is fixture.
  assert.equal(report.ok, true);

  // Broken provider flips the overall verdict and carries a remediation hint.
  const brokenReport = await runSelfCheck({ runtime: brokenRuntime });
  const brokenDesktop = brokenReport.checks.find((c) => c.id === "desktop_provider");
  assert.equal(brokenDesktop.ok, false);
  assert.ok(brokenDesktop.remediation, "failed check should suggest remediation");
  assert.equal(brokenReport.ok, false);
}
