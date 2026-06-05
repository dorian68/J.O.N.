import assert from "node:assert/strict";
import { OperatorService } from "../src/service/operator-service.js";

// Verifies cross-surface chain-resume after a manual browser handoff:
//  1. A composed mission whose web phase PAUSES (login/CAPTCHA wall) must report
//     an explicit `awaiting_handoff` state — NOT a bare ok:false that reads as a
//     failure — and must NOT run the downstream desktop phase yet.
//  2. The chain continuation is persisted onto the paused run.
//  3. Once the human clears the blocker (the resumed web run completes),
//     continueComposedAfterResume runs the remaining desktop phase, carrying the
//     freshly gathered data forward, and the whole chain reports ok:true.
export async function run() {
  const events = [];
  const runs = new Map();
  const startedRequests = [];

  const stub = {
    activeRuns: new Map(),
    emitStateChanged: (type, payload) => events.push({ type, payload }),
    runtimeHandle: {
      database: {
        getRun: (runId) => runs.get(runId) ?? null,
        getConversation: () => null,
        updateRun: (runId, patch) => {
          const existing = runs.get(runId) ?? { id: runId };
          runs.set(runId, {
            ...existing,
            ...patch,
            metadata: patch.metadata ?? existing.metadata
          });
        }
      }
    },
    async startMission(projectId, request) {
      startedRequests.push(request);
      const runId = `run_${startedRequests.length}`;
      // The browser phase pauses for a manual handoff the first time it runs.
      const isBrowserPhase = request.missionSpec?.parameters?.computerAction?.type === "browser_autonomy";
      runs.set(runId, { id: runId, projectId, status: isBrowserPhase ? "paused" : "completed" });
      this.activeRuns.set(runId, Promise.resolve());
      return { runId };
    },
    async extractRunDeliverableText(runId) {
      // Only the RESUMED web run actually gathered the data.
      return runId === "resumed_web" ? "SEANCE 18:00 Dune; SEANCE 21:00 Oppenheimer" : "";
    },
    runComposedMission: OperatorService.prototype.runComposedMission,
    runComposedFrom: OperatorService.prototype.runComposedFrom,
    continueComposedAfterResume: OperatorService.prototype.continueComposedAfterResume
  };

  // ── 1) Web phase pauses → awaiting_handoff, desktop phase deferred ──────────
  const result = await stub.runComposedMission("prj", {
    objective: "ouvre moi le site cinestar et ecris moi sur un notepad toutes les seances de film pour demain"
  });

  assert.equal(result.composed, true);
  assert.equal(result.status, "awaiting_handoff", "paused web phase must report awaiting_handoff, not failure");
  assert.equal(result.awaitingHandoff, true);
  assert.equal(result.ok, false);
  assert.ok(result.pausedRunId, "exposes the paused run id");
  assert.equal(startedRequests.length, 1, "desktop phase must NOT run while the web phase is blocked");
  assert.ok(events.some((e) => e.type === "mission.composed.awaiting_handoff"), "emits awaiting_handoff event");
  assert.ok(!events.some((e) => e.type === "mission.composed.completed"), "chain is not marked completed while blocked");

  // The continuation was persisted onto the paused run for later resume.
  const pausedRun = runs.get(result.pausedRunId);
  const continuation = pausedRun.metadata?.composedContinuation;
  assert.ok(continuation, "continuation persisted on the paused run");
  assert.equal(continuation.nextPhaseIndex, 1, "resume should continue from the desktop phase");
  assert.equal(continuation.pausedPhaseProducesData, true, "web phase is the data producer");
  assert.equal(continuation.plan.phases.length, 2);

  // ── 2) Human cleared the blocker → resumed web run completed ────────────────
  runs.set("resumed_web", { id: "resumed_web", projectId: "prj", status: "completed" });
  stub.activeRuns.set("resumed_web", Promise.resolve());
  const continued = await stub.continueComposedAfterResume("resumed_web", continuation);

  assert.equal(continued.composed, true);
  assert.equal(continued.ok, true, "chain completes after the handoff is resolved");
  assert.equal(continued.status, "completed");
  assert.equal(continued.phases.length, 2, "both phases recorded");
  assert.equal(continued.phases[0].status, "completed", "the previously-paused phase is marked completed");

  // The desktop phase finally ran, carrying the data gathered AFTER the handoff.
  const desktopReq = startedRequests.at(-1);
  assert.equal(desktopReq.missionSpec.parameters.computerAction.type, "desktop_autonomy");
  const inline = desktopReq.missionSpec.parameters.inlineGeneratedContent ?? [];
  assert.equal(inline.length, 1, "desktop phase carries the gathered data inline");
  assert.match(inline[0].content, /Dune/);
  assert.match(inline[0].content, /Oppenheimer/);
  assert.ok(
    events.some((e) => e.type === "mission.composed.completed" && e.payload.ok === true),
    "emits a completed event with ok:true after resume"
  );

  // ── 3) If the resumed phase pauses AGAIN, we keep waiting (no false finish) ──
  events.length = 0;
  runs.set("blocked_again", { id: "blocked_again", projectId: "prj", status: "paused" });
  const stillBlocked = await stub.continueComposedAfterResume("blocked_again", continuation);
  assert.equal(stillBlocked.status, "awaiting_handoff", "a re-blocked phase keeps waiting");
  const reblocked = runs.get("blocked_again");
  assert.ok(reblocked.metadata?.composedContinuation, "continuation re-persisted onto the re-blocked run");
}
