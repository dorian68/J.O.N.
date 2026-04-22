import fs from "node:fs/promises";
import path from "node:path";
import { REAL_SURFACE_VALIDATION_ROOT } from "../config.js";
import { getRealSurfaceScenarioCatalog, REAL_SURFACE_RESULT } from "./real-surface-catalog.js";
import { ensureDir, writeJson } from "../utils/files.js";

function compareRecordedAt(left, right) {
  return new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function listResultFiles(rootPath) {
  let entries = [];
  try {
    entries = await fs.readdir(rootPath, {
      withFileTypes: true
    });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("validation-pack"))
    .map((entry) => path.join(rootPath, entry.name));
}

function summarizeScenarioResults(scenario, records) {
  const ordered = [...records].sort(compareRecordedAt);
  const latest = ordered[0] ?? null;
  const status = latest?.result ?? "missing";
  return {
    scenarioId: scenario.id,
    label: scenario.label,
    status,
    latestRecordPath: latest?.recordPath ?? null,
    latestRecordedAt: latest?.recordedAt ?? null,
    latestNotes: latest?.notes ?? "",
    historyCount: ordered.length,
    passCriteria: scenario.passCriteria
  };
}

export async function buildRealSurfaceValidationSummary({
  rootPath = REAL_SURFACE_VALIDATION_ROOT
} = {}) {
  const scenarios = getRealSurfaceScenarioCatalog();
  const files = await listResultFiles(rootPath);
  const records = [];

  for (const filePath of files) {
    const payload = await readJsonIfExists(filePath);
    if (payload?.scenarioId) {
      records.push({
        ...payload,
        recordPath: filePath
      });
    }
  }

  const scenarioSummaries = scenarios.map((scenario) => summarizeScenarioResults(
    scenario,
    records.filter((record) => record.scenarioId === scenario.id)
  ));

  const counts = {
    pass: scenarioSummaries.filter((entry) => entry.status === REAL_SURFACE_RESULT.PASS).length,
    partial: scenarioSummaries.filter((entry) => entry.status === REAL_SURFACE_RESULT.PARTIAL).length,
    fail: scenarioSummaries.filter((entry) => entry.status === REAL_SURFACE_RESULT.FAIL).length,
    blocked: scenarioSummaries.filter((entry) => entry.status === REAL_SURFACE_RESULT.BLOCKED).length,
    missing: scenarioSummaries.filter((entry) => entry.status === "missing").length
  };

  const overallStatus = counts.fail > 0
    ? "contains_failures"
    : counts.missing > 0 || counts.blocked > 0
      ? "incomplete"
      : counts.partial > 0
        ? "partial"
        : "all_passed";

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    counts,
    scenarios: scenarioSummaries
  };
}

export async function persistRealSurfaceValidationSummary(summary, {
  rootPath = REAL_SURFACE_VALIDATION_ROOT
} = {}) {
  await ensureDir(rootPath);
  const stamped = summary.generatedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(rootPath, `validation-summary-${stamped}.json`);
  const latestPath = path.join(rootPath, "validation-summary-latest.json");
  await writeJson(outputPath, summary);
  await writeJson(latestPath, summary);
  return {
    outputPath,
    latestPath
  };
}

