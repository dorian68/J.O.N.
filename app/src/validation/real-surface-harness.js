import path from "node:path";
import { REAL_SURFACE_VALIDATION_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { getRealSurfaceScenario, getRealSurfaceScenarioCatalog, REAL_SURFACE_RESULT } from "./real-surface-catalog.js";

const VALID_RESULT_CODES = new Set(Object.values(REAL_SURFACE_RESULT));

function nowIso() {
  return new Date().toISOString();
}

function safeStamp(value) {
  return value.replace(/[:.]/g, "-");
}

function buildTraceabilityTemplate(scenario) {
  return {
    scenarioId: scenario.id,
    runId: null,
    benchmarkCreatedAt: null,
    artifactIds: [],
    evidenceIds: [],
    llmCallIds: [],
    reasoningSnapshotIds: [],
    logPaths: [],
    notes: []
  };
}

export function buildRealSurfaceValidationPack({ scenarioId = "all", reviewer = "operator" } = {}) {
  const catalog = scenarioId === "all"
    ? getRealSurfaceScenarioCatalog()
    : [getRealSurfaceScenario(scenarioId)].filter(Boolean);

  if (catalog.length === 0) {
    throw new Error(`Unknown real-surface validation scenario: ${scenarioId}`);
  }

  return {
    generatedAt: nowIso(),
    reviewer,
    scenarios: catalog.map((scenario) => ({
      ...scenario,
      traceabilityTemplate: buildTraceabilityTemplate(scenario),
      reviewPrompt: `Review ${scenario.id} against its explicit pass criteria only.`
    }))
  };
}

export async function persistRealSurfaceValidationPack(pack) {
  await ensureDir(REAL_SURFACE_VALIDATION_ROOT);
  const stamped = safeStamp(pack.generatedAt);
  const outputPath = path.join(REAL_SURFACE_VALIDATION_ROOT, `validation-pack-${stamped}.json`);
  const latestPath = path.join(REAL_SURFACE_VALIDATION_ROOT, "validation-pack-latest.json");
  await writeJson(outputPath, pack);
  await writeJson(latestPath, pack);
  return {
    outputPath,
    latestPath
  };
}

export async function recordRealSurfaceValidationResult({
  scenarioId,
  reviewer = "operator",
  result,
  notes = "",
  traceability = {},
  rootPath = REAL_SURFACE_VALIDATION_ROOT
} = {}) {
  const scenario = getRealSurfaceScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown real-surface validation scenario: ${scenarioId}`);
  }
  if (!VALID_RESULT_CODES.has(result)) {
    throw new Error(`Unsupported real-surface validation result: ${result}`);
  }

  const payload = {
    recordedAt: nowIso(),
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    reviewer,
    result,
    notes,
    traceability: {
      ...buildTraceabilityTemplate(scenario),
      ...traceability,
      scenarioId: scenario.id
    }
  };

  await ensureDir(rootPath);
  const stamped = safeStamp(payload.recordedAt);
  const outputPath = path.join(rootPath, `${scenario.id}-${result}-${stamped}.json`);
  await writeJson(outputPath, payload);
  return {
    outputPath,
    payload
  };
}
