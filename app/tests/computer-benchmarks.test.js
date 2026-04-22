import assert from "node:assert/strict";
import { runComputerBenchmarks } from "../src/benchmarks/computer-benchmarks.js";

export async function run() {
  const result = await runComputerBenchmarks();

  assert.equal(result.assertions.runCompleted, true);
  assert.equal(result.assertions.verificationValidated, true);
  assert.equal(result.assertions.approvalsPresent, true);
  assert.equal(result.assertions.evidencePresent, true);
}
