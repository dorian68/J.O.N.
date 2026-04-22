import assert from "node:assert/strict";
import { runBrowserBenchmarks } from "../src/benchmarks/browser-benchmarks.js";

function isSpawnEperm(error) {
  return error?.message?.includes("spawn EPERM");
}

export async function run() {
  let result;
  try {
    result = await runBrowserBenchmarks();
  } catch (error) {
    if (isSpawnEperm(error)) {
      console.warn("browser-benchmarks test skipped: browser launch blocked (EPERM).");
      return;
    }
    throw error;
  }

  assert.equal(result.assertions.researchCompleted, true);
  assert.equal(result.assertions.researchArtifactCount, true);
  assert.equal(result.assertions.researchSourceCount, true);
  assert.equal(result.assertions.collectionArtifactTraceable, true);
  assert.equal(result.assertions.decisionArtifactQualified, true);
  assert.equal(result.assertions.formCompleted, true);
  assert.equal(result.assertions.formApprovalCount, true);
  assert.equal(result.assertions.formEvidenceCount, true);
  assert.equal(result.assertions.refusalRunStopped, true);
  assert.equal(result.assertions.refusalApprovalDenied, true);
  assert.equal(result.assertions.refusalNoImplicitWrite, true);
  assert.equal(result.assertions.refusalEventTracked, true);
  assert.equal(result.assertions.deepScrollResolved, true);
  assert.equal(result.assertions.ambiguousDomDetected, true);
  assert.equal(result.assertions.blockerDetected, true);
  assert.equal(result.assertions.blockerDismissed, true);
  assert.equal(result.assertions.outcomeVerified, true);
}
