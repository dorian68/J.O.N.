import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRealSurfaceValidationSummary } from "../src/validation/real-surface-summary.js";

export async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-validation-summary-"));
  try {
    await fs.writeFile(path.join(tempRoot, "bounded_real_web_research-pass-1.json"), JSON.stringify({
      scenarioId: "bounded_real_web_research",
      recordedAt: "2026-04-16T10:00:00.000Z",
      result: "pass",
      notes: "ok"
    }), "utf8");
    await fs.writeFile(path.join(tempRoot, "live_llm_provider_smoke-blocked-1.json"), JSON.stringify({
      scenarioId: "live_llm_provider_smoke",
      recordedAt: "2026-04-16T11:00:00.000Z",
      result: "blocked",
      notes: "missing key"
    }), "utf8");

    const summary = await buildRealSurfaceValidationSummary({
      rootPath: tempRoot
    });
    assert.equal(summary.overallStatus, "incomplete");
    assert.equal(summary.counts.pass, 1);
    assert.equal(summary.counts.blocked, 1);
    assert.ok(summary.scenarios.some((entry) => entry.scenarioId === "bounded_real_web_research" && entry.status === "pass"));
  } finally {
    await fs.rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
}

