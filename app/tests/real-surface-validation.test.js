import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRealSurfaceValidationPack,
  recordRealSurfaceValidationResult
} from "../src/validation/real-surface-harness.js";
import { getRealSurfaceScenarioCatalog } from "../src/validation/real-surface-catalog.js";

export async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-real-surface-validation-"));
  const catalog = getRealSurfaceScenarioCatalog();
  assert.ok(catalog.length >= 4);
  assert.ok(catalog.some((scenario) => scenario.id === "live_llm_provider_smoke"));
  assert.ok(catalog.some((scenario) => scenario.id === "bounded_real_web_research"));

  const pack = buildRealSurfaceValidationPack({
    scenarioId: "bounded_real_web_research",
    reviewer: "qa-operator"
  });
  assert.equal(pack.scenarios.length, 1);
  assert.equal(pack.scenarios[0].id, "bounded_real_web_research");
  assert.ok(pack.scenarios[0].traceabilityTemplate);
  assert.ok(pack.scenarios[0].passCriteria.length >= 3);

  try {
    const recorded = await recordRealSurfaceValidationResult({
      scenarioId: "bounded_real_web_research",
      reviewer: "qa-operator",
      result: "partial",
      notes: "Manual validation pending one more source.",
      traceability: {
        runId: "run_manual_validation",
        artifactIds: ["artifact_decision"],
        evidenceIds: ["evidence_page"],
        llmCallIds: ["llm_reasoning"],
        reasoningSnapshotIds: ["ctx_reasoning"],
        logPaths: ["app/.runtime-data/logs/llm-runtime.jsonl"]
      },
      rootPath: tempRoot
    });

    const stored = JSON.parse(await fs.readFile(recorded.outputPath, "utf8"));
    assert.equal(stored.result, "partial");
    assert.equal(stored.traceability.runId, "run_manual_validation");
    assert.deepEqual(stored.traceability.artifactIds, ["artifact_decision"]);
    assert.deepEqual(stored.traceability.reasoningSnapshotIds, ["ctx_reasoning"]);
  } finally {
    await fs.rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
}
