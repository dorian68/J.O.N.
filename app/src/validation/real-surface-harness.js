import path from "node:path";
import { REAL_SURFACE_VALIDATION_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { getRealSurfaceScenario, getRealSurfaceScenarioCatalog, REAL_SURFACE_RESULT } from "./real-surface-catalog.js";

const VALID_RESULT_CODES = new Set(Object.values(REAL_SURFACE_RESULT));
const DEFAULT_LLM_LOG_PATH = "app/.runtime-data/logs/llm-runtime.jsonl";

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

function idsFrom(entries = []) {
  return Array.isArray(entries) ? entries.map((entry) => entry?.id).filter(Boolean) : [];
}

function countField(traceability, field) {
  return Array.isArray(traceability?.[field]) ? traceability[field].filter(Boolean).length : 0;
}

export function evaluateRealSurfaceTraceability({
  scenarioId,
  traceability = {}
} = {}) {
  const scenario = getRealSurfaceScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown real-surface validation scenario: ${scenarioId}`);
  }
  const minimum = scenario.minimumTraceability ?? {};
  const checks = [
    {
      id: "run_id",
      required: Boolean(minimum.runId),
      actual: traceability.runId ? 1 : 0,
      expected: minimum.runId ? 1 : 0,
      passed: !minimum.runId || Boolean(traceability.runId)
    },
    ...["artifactIds", "evidenceIds", "llmCallIds", "reasoningSnapshotIds", "logPaths"].map((field) => {
      const expected = Number(minimum[field] ?? 0);
      const actual = countField(traceability, field);
      return {
        id: field,
        required: expected > 0,
        actual,
        expected,
        passed: actual >= expected
      };
    })
  ];
  return {
    scenarioId: scenario.id,
    passed: checks.every((check) => check.passed),
    checks,
    missing: checks
      .filter((check) => !check.passed)
      .map((check) => ({
        id: check.id,
        expected: check.expected,
        actual: check.actual
      }))
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
    },
    traceabilityReview: null
  };
  payload.traceabilityReview = evaluateRealSurfaceTraceability({
    scenarioId: scenario.id,
    traceability: payload.traceability
  });
  if (result === REAL_SURFACE_RESULT.PASS && !payload.traceabilityReview.passed) {
    throw new Error(`Cannot record pass for ${scenario.id}: traceability gates are incomplete.`);
  }

  await ensureDir(rootPath);
  const stamped = safeStamp(payload.recordedAt);
  const outputPath = path.join(rootPath, `${scenario.id}-${result}-${stamped}.json`);
  await writeJson(outputPath, payload);
  return {
    outputPath,
    payload
  };
}

export function buildRealSurfaceTraceabilityFromRunBundle(bundle = {}, {
  scenarioId = null,
  logPaths = null,
  notes = []
} = {}) {
  const llmCallIds = idsFrom(bundle.llmCalls);
  const inferredLogPaths = Array.isArray(logPaths)
    ? logPaths.filter(Boolean)
    : llmCallIds.length > 0 ? [DEFAULT_LLM_LOG_PATH] : [];
  const run = bundle.run ?? null;
  return {
    scenarioId: scenarioId ?? null,
    runId: run?.id ?? null,
    benchmarkCreatedAt: null,
    artifactIds: idsFrom(bundle.artifacts),
    evidenceIds: idsFrom(bundle.evidence),
    llmCallIds,
    reasoningSnapshotIds: idsFrom(bundle.reasoningSnapshots),
    logPaths: inferredLogPaths,
    notes: [
      run?.summary ? `Run summary: ${run.summary}` : null,
      ...notes
    ].filter(Boolean)
  };
}

export async function recordRealSurfaceValidationFromRunBundle({
  scenarioId,
  bundle,
  reviewer = "operator",
  result = null,
  notes = "",
  logPaths = null,
  rootPath = REAL_SURFACE_VALIDATION_ROOT
} = {}) {
  const traceability = buildRealSurfaceTraceabilityFromRunBundle(bundle, {
    scenarioId,
    logPaths,
    notes: notes ? [notes] : []
  });
  const review = evaluateRealSurfaceTraceability({ scenarioId, traceability });
  const inferredResult = result ?? (review.passed ? REAL_SURFACE_RESULT.PASS : REAL_SURFACE_RESULT.PARTIAL);
  return recordRealSurfaceValidationResult({
    scenarioId,
    reviewer,
    result: inferredResult,
    notes,
    traceability,
    rootPath
  });
}

export async function recordRealSurfaceValidationFromRun({
  scenarioId,
  runId,
  database,
  reviewer = "operator",
  result = null,
  notes = "",
  logPaths = null,
  rootPath = REAL_SURFACE_VALIDATION_ROOT
} = {}) {
  if (!database) {
    throw new Error("A database handle is required to build real-surface traceability from a run.");
  }
  const run = database.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  return recordRealSurfaceValidationFromRunBundle({
    scenarioId,
    bundle: {
      run,
      evidence: database.listEvidence(runId),
      artifacts: database.listArtifacts(runId),
      llmCalls: database.listLlmCalls(runId),
      reasoningSnapshots: database.listReasoningContextSnapshots(runId)
    },
    reviewer,
    result,
    notes,
    logPaths,
    rootPath
  });
}
