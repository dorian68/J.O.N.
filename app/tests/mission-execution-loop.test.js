import assert from "node:assert/strict";
import { MissionExecutionLoop, MISSION_LOOP_STATUS } from "../src/runtime/mission-execution-loop.js";

export async function run() {
  {
    let verifyCount = 0;
    const loop = new MissionExecutionLoop({
      observe: async () => ({ visible: true }),
      decide: async () => ({ action: { id: "a1", primitive: "observe" } }),
      act: async () => ({ status: "completed" }),
      verify: async () => {
        verifyCount += 1;
        return verifyCount >= 2
          ? { objectiveSatisfied: true, verifiedByOutcomes: true }
          : { objectiveSatisfied: false, blocked: true, failureReason: "Need one more observation." };
      },
      recover: async () => ({ strategy: "retry_after_observation", autoExecutable: true }),
      maxIterations: 3
    });
    const result = await loop.run({ mission: "observe until verified", runId: "run-loop" });
    assert.equal(result.status, MISSION_LOOP_STATUS.COMPLETED);
    assert.equal(result.objectiveSatisfied, true);
    assert(result.timeline.some((entry) => entry.phase === "recover"));
  }

  {
    const loop = new MissionExecutionLoop({
      observe: async () => ({ visible: true }),
      decide: async () => ({ action: { id: "a1", primitive: "capture" } }),
      act: async () => ({ status: "completed" }),
      verify: async () => ({ objectiveSatisfied: false, blocked: true, failureReason: "Missing screenshot." }),
      recover: async () => ({ strategy: "ask_user", autoExecutable: false, nextAction: "Ask user." }),
      maxIterations: 2
    });
    const result = await loop.run({ mission: "capture proof" });
    assert.equal(result.status, MISSION_LOOP_STATUS.BLOCKED);
    assert.equal(result.objectiveSatisfied, false);
    assert.equal(result.blockedReason, "Ask user.");
  }
}
