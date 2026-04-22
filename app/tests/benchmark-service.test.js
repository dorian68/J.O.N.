import assert from "node:assert/strict";
import { BenchmarkService } from "../src/service/benchmark-service.js";

function isSpawnEperm(error) {
  return error?.message?.includes("spawn EPERM");
}

export async function run() {
  const service = new BenchmarkService();
  let report;
  try {
    report = await service.runFullBenchmarkSuite();
  } catch (error) {
    if (isSpawnEperm(error)) {
      console.warn("benchmark-service test skipped: browser launch blocked (EPERM).");
      return;
    }
    throw error;
  }
  const reviewed = await service.submitSuiteReview({
    createdAt: report.createdAt,
    suiteId: "browser",
    classification: "real_success",
    notes: "Controlled benchmark review from automated test.",
    reviewer: "test-suite"
  });

  const browserSuite = reviewed.review.suites.find((suite) => suite.id === "browser");
  assert.equal(Boolean(browserSuite), true);
  assert.equal(browserSuite.humanReviewStatus, "reviewed");
  assert.equal(browserSuite.humanReviewClassification, "real_success");
  assert.equal(browserSuite.humanReviewReviewer, "test-suite");

  const latest = await service.getLatestBenchmarkReport();
  const latestBrowserSuite = latest.review.suites.find((suite) => suite.id === "browser");
  assert.equal(latestBrowserSuite.humanReviewStatus, "reviewed");
  assert.equal(latestBrowserSuite.humanReviewClassification, "real_success");
}
