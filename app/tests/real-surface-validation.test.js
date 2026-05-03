import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRealSurfaceTraceabilityFromRunBundle,
  buildRealSurfaceValidationPack,
  evaluateRealSurfaceTraceability,
  recordRealSurfaceValidationFromRunBundle,
  recordRealSurfaceValidationResult
} from "../src/validation/real-surface-harness.js";
import { getRealSurfaceScenarioCatalog } from "../src/validation/real-surface-catalog.js";

export async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-real-surface-validation-"));
  const catalog = getRealSurfaceScenarioCatalog();
  assert.ok(catalog.length >= 4);
  assert.ok(catalog.some((scenario) => scenario.id === "live_llm_provider_smoke"));
  assert.ok(catalog.some((scenario) => scenario.id === "bounded_real_web_research"));
  assert.ok(catalog.some((scenario) => scenario.id === "real_web_canvas_interaction"));
  assert.ok(catalog.some((scenario) => scenario.id === "real_web_pdf_extraction"));
  assert.ok(catalog.some((scenario) => scenario.id === "desktop_app_variety_matrix"));

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
    assert.equal(stored.traceabilityReview.passed, false);

    const completeCanvasReview = evaluateRealSurfaceTraceability({
      scenarioId: "real_web_canvas_interaction",
      traceability: {
        runId: "run_canvas",
        evidenceIds: ["ev_before", "ev_after"],
        llmCallIds: ["llm_visual"],
        reasoningSnapshotIds: ["ctx_canvas"],
        logPaths: ["app/.runtime-data/logs/llm-runtime.jsonl"]
      }
    });
    assert.equal(completeCanvasReview.passed, true);

    const bundleTraceability = buildRealSurfaceTraceabilityFromRunBundle({
      run: {
        id: "run_bundle_research",
        summary: "Collected and cited two public sources."
      },
      evidence: [
        { id: "evidence_source_1" },
        { id: "evidence_source_2" }
      ],
      artifacts: [
        { id: "artifact_collection" },
        { id: "artifact_decision" }
      ],
      llmCalls: [
        { id: "llm_understanding" },
        { id: "llm_decision" }
      ],
      reasoningSnapshots: [
        { id: "ctx_understanding" },
        { id: "ctx_decision" }
      ]
    }, {
      scenarioId: "bounded_real_web_research"
    });
    assert.equal(bundleTraceability.runId, "run_bundle_research");
    assert.deepEqual(bundleTraceability.artifactIds, ["artifact_collection", "artifact_decision"]);
    assert.equal(bundleTraceability.logPaths.length, 1);

    const recordedFromBundle = await recordRealSurfaceValidationFromRunBundle({
      scenarioId: "bounded_real_web_research",
      reviewer: "qa-operator",
      bundle: {
        run: {
          id: "run_bundle_research",
          summary: "Collected and cited two public sources."
        },
        evidence: [
          { id: "evidence_source_1" },
          { id: "evidence_source_2" }
        ],
        artifacts: [
          { id: "artifact_collection" },
          { id: "artifact_decision" }
        ],
        llmCalls: [
          { id: "llm_understanding" },
          { id: "llm_decision" }
        ],
        reasoningSnapshots: [
          { id: "ctx_understanding" },
          { id: "ctx_decision" }
        ]
      },
      rootPath: tempRoot
    });
    assert.equal(recordedFromBundle.payload.result, "pass");
    assert.equal(recordedFromBundle.payload.traceabilityReview.passed, true);

    await assert.rejects(
      recordRealSurfaceValidationResult({
        scenarioId: "real_web_canvas_interaction",
        reviewer: "qa-operator",
        result: "pass",
        notes: "Missing evidence should block pass.",
        traceability: {
          runId: "run_canvas"
        },
        rootPath: tempRoot
      }),
      /traceability gates are incomplete/
    );
  } finally {
    await fs.rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
}
