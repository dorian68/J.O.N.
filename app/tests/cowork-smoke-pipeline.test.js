import assert from "node:assert/strict";
import { runCoworkSmokePipeline } from "../src/smoke/cowork-smoke-pipeline.js";

export async function run() {
  const report = await runCoworkSmokePipeline({
    includeBrowser: false,
    persist: false,
    runner: "test"
  });

  assert.equal(report.mode, "controlled_no_browser");
  assert.equal(report.status, "degraded");
  assert.equal(report.summary.failed, 0);
  assert.equal(report.cases.some((entry) => entry.id === "budget_governance" && entry.status === "pass"), true);
  assert.equal(report.cases.some((entry) => entry.id === "conversation_memory" && entry.status === "pass"), true);
  assert.equal(report.cases.some((entry) => entry.id === "surface_concurrency" && entry.status === "pass"), true);
  assert.equal(report.cases.some((entry) => entry.id === "controlled_browser_research" && entry.status === "skipped"), true);
  assert.equal(Array.isArray(report.recommendations), true);
}
