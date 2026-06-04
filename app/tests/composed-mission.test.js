import assert from "node:assert/strict";
import { OperatorService } from "../src/service/operator-service.js";

// Verifies the cross-surface orchestration logic (ordering + data hand-off +
// return shape) without spinning a real browser/desktop, by invoking
// runComposedMission against a lightweight stub.
export async function run() {
  const startedRequests = [];
  const events = [];

  const stub = {
    activeRuns: new Map(),
    emitStateChanged: (type, payload) => events.push({ type, payload }),
    runtimeHandle: {
      database: {
        getRun: (runId) => ({ id: runId, status: "completed" }),
        getConversation: () => null
      }
    },
    // Each phase "runs" instantly and is already settled.
    async startMission(projectId, request) {
      startedRequests.push(request);
      const runId = `run_${startedRequests.length}`;
      this.activeRuns.set(runId, Promise.resolve());
      return { runId };
    },
    // Phase 1 (browser) produces this gathered text.
    async extractRunDeliverableText(runId) {
      return runId === "run_1" ? "SEANCE 18:00 Dune; SEANCE 21:00 Oppenheimer" : "";
    },
    runComposedMission: OperatorService.prototype.runComposedMission
  };

  const result = await stub.runComposedMission("prj_test", {
    objective: "ouvre moi le site cinestar et ecris moi sur un notepad toutes les seances de film pour demain"
  });

  // Two phases ran, browser before desktop.
  assert.equal(startedRequests.length, 2, "two phases should run");

  // Objectives stay short (well under the 360-char mission cap).
  assert.ok(startedRequests[0].missionSpec.objective.length <= 360, "phase 1 objective within cap");
  assert.ok(startedRequests[1].missionSpec.objective.length <= 360, "phase 2 objective within cap");

  // The desktop phase received the gathered data via inline content (not the objective).
  const inline = startedRequests[1].missionSpec.parameters?.inlineGeneratedContent ?? [];
  assert.equal(inline.length, 1, "phase 2 carries inline data");
  assert.match(inline[0].content, /Dune/);
  assert.match(inline[0].content, /Oppenheimer/);

  // Composed result shape.
  assert.equal(result.composed, true);
  assert.equal(result.ok, true);
  assert.equal(result.phases.length, 2);
  assert.equal(result.phases[0].surface, "browser");
  assert.equal(result.phases[1].surface, "desktop");

  // Lifecycle events emitted.
  assert.ok(events.some((e) => e.type === "mission.composed.started"));
  assert.ok(events.some((e) => e.type === "mission.composed.completed"));

  // Non-multi-surface missions delegate straight to startMission (single phase).
  startedRequests.length = 0;
  const single = await stub.runComposedMission("prj_test", { objective: "ouvre notepad et écris bonjour" });
  assert.equal(startedRequests.length, 1, "single-surface mission runs once");
  assert.equal(single.composed, undefined);
}
