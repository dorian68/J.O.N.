import assert from "node:assert/strict";
import { guardCompletedRunPatch } from "../src/runtime/prototype-agent.js";
import { RUN_STATUS } from "../src/config.js";

export async function run() {
  {
    const guarded = guardCompletedRunPatch({
      currentRun: { metadata: {} },
      patch: {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Mission completed."
      },
      now: () => "2026-01-01T00:00:00.000Z"
    });
    assert.equal(guarded.status, RUN_STATUS.FAILED);
    assert.equal(guarded.lifecycleStage, "failed_false_completion_guard");
    assert.equal(guarded.metadata.falseCompletionGuard.requestedStatus, RUN_STATUS.COMPLETED);
  }

  {
    const allowed = guardCompletedRunPatch({
      currentRun: {
        metadata: {
          semanticVerification: {
            verifiedByOutcomes: true,
            objectiveSatisfied: true
          }
        }
      },
      patch: {
        status: RUN_STATUS.COMPLETED,
        lifecycleStage: "completed",
        summary: "Mission completed."
      }
    });
    assert.equal(allowed.status, RUN_STATUS.COMPLETED);
    assert.equal(allowed.lifecycleStage, "completed");
  }

  {
    const allowedFromPatch = guardCompletedRunPatch({
      currentRun: { metadata: {} },
      patch: {
        status: RUN_STATUS.COMPLETED,
        metadata: {
          semanticVerification: {
            verifiedByOutcomes: true
          }
        }
      }
    });
    assert.equal(allowedFromPatch.status, RUN_STATUS.COMPLETED);
  }
}
