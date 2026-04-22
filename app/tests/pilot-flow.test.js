import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runPilotSummary } from "../src/pilot/pilot-flow.js";

export async function run() {
  const { report, persisted } = await runPilotSummary();
  assert.ok(["all_passed", "partial", "incomplete", "contains_failures"].includes(report.overallStatus));
  assert.ok(report.readiness.currentLevel);
  await fs.access(persisted.latestPath);
  await fs.access(persisted.latestMarkdownPath);
  assert.equal(path.basename(persisted.latestPath), "pilot-summary-latest.json");
}
