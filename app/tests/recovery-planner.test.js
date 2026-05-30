import assert from "node:assert/strict";
import { RecoveryPlanner } from "../src/runtime/recovery-planner.js";

export async function run() {
  const planner = new RecoveryPlanner();

  {
    const plan = planner.plan({
      verification: { failureReason: "Requested screenshot proof is missing." },
      attemptCount: 0
    });
    assert.equal(plan.failureType, "missing_evidence");
    assert.equal(plan.strategy, "capture_missing_proof");
    assert.equal(plan.autoExecutable, true);
  }

  {
    const plan = planner.plan({
      verification: { failureReason: "Evidence does not align with target app." },
      attemptCount: 0
    });
    assert.equal(plan.failureType, "evidence_misaligned");
    assert.equal(plan.strategy, "reobserve_target_surface");
  }

  {
    const plan = planner.plan({
      failure: { category: "malformed_output", message: "coveredNow must be an array" },
      attemptCount: 1,
      maxRetries: 2
    });
    assert.equal(plan.strategy, "repair_llm_output");
    assert.equal(plan.autoExecutable, true);
  }

  {
    const plan = planner.plan({
      workspaceSnapshot: { approvals: { pendingCount: 1 } }
    });
    assert.equal(plan.failureType, "approval_required");
    assert.equal(plan.autoExecutable, false);
  }
}
