import assert from "node:assert/strict";
import { runReasoningBenchmarks } from "../src/benchmarks/reasoning-benchmarks.js";

export async function run() {
  const report = await runReasoningBenchmarks();
  assert.ok(report.snapshotId);
  assert.ok(Object.values(report.assertions).every((value) => value === true), "Reasoning benchmarks should pass.");
  assert.equal(report.cases.length >= 1, true);
}
