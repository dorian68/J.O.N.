import assert from "node:assert/strict";
import { buildDesktopRecoveryPlan } from "../src/computer/desktop-recovery-planner.js";
import {
  appendDesktopObservation,
  createDesktopObservationTimeline,
  summarizeDesktopObservationTimeline
} from "../src/computer/desktop-observation-timeline.js";
import {
  defaultDesktopAutonomyMemory,
  normalizeDesktopAutonomyMemory,
  summarizeDesktopAutonomyMemory,
  updateDesktopAutonomyMemory
} from "../src/computer/desktop-memory.js";
import {
  buildDesktopReplanContext,
  selectDesktopReplanContinuation
} from "../src/computer/desktop-replanner.js";
import { buildDesktopUserFacingError } from "../src/computer/desktop-user-facing.js";

export async function run() {
  const step = {
    id: "click_search",
    primitive: "click_point",
    label: "Click Search",
    target: { semanticTarget: "Search", role: "button" }
  };
  const memory = updateDesktopAutonomyMemory(defaultDesktopAutonomyMemory(), {
    run: { id: "run_previous", mission: "Click Search" },
    desktopPlan: { selectedApplication: { id: "browser_edge", label: "Edge" } },
    actionLog: [
      {
        step,
        status: "completed",
        recovery: { selectedStrategy: "semantic_target_retry" },
        result: { semanticResolution: { target: { label: "Search", role: "button" } } }
      }
    ],
    outcomeStatus: "completed"
  });
  const normalized = normalizeDesktopAutonomyMemory(memory);
  assert.equal(normalized.recoveryStrategies.semantic_target_retry.successes, 1);
  assert.equal(normalized.semanticTargets.search.successes, 1);

  const plan = buildDesktopRecoveryPlan({
    step,
    error: new Error("No visible semantic target matched Search."),
    currentWindow: { id: "win_a", title: "Notes" },
    beforeWindow: { id: "win_b", title: "Browser" },
    visibleWindows: [{ id: "win_b", title: "Browser" }],
    desktopMemory: normalized
  });
  assert.equal(plan.strategies[0].id, "semantic_target_retry");
  assert.equal(plan.canAutoRecover, true);
  assert.equal(plan.userFacingSummary.nextAction, "Retry semantic target");

  const timeline = createDesktopObservationTimeline({ runId: "run_test", mission: "Click Search" });
  appendDesktopObservation(timeline, {
    phase: "before_step",
    status: "observed",
    step,
    window: { id: "win_a", title: "Notes" }
  });
  appendDesktopObservation(timeline, {
    phase: "recovery_succeeded",
    status: "completed",
    step,
    window: { id: "win_b", title: "Browser" },
    recovery: { selectedStrategy: "semantic_target_retry" }
  });
  const summary = summarizeDesktopObservationTimeline(timeline);
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.recoveryCount, 1);
  assert.equal(summary.lastWindowTitle, "Browser");

  const userFacingError = buildDesktopUserFacingError({
    error: new Error("The target is hidden."),
    actionLog: [{ step, status: "failed", error: "The target is hidden." }],
    observationSummary: summary,
    latestEvidencePath: "capture.json"
  });
  assert.equal(userFacingError.lastStepId, "click_search");
  assert.equal(userFacingError.evidencePath, "capture.json");

  const memorySummary = summarizeDesktopAutonomyMemory(normalized);
  assert.equal(memorySummary.recoveryStrategies[0].id, "semantic_target_retry");

  const replanContext = buildDesktopReplanContext({
    run: { id: "run_current", mission: "Click Search and read results" },
    failedStep: step,
    error: new Error("Search disappeared after navigation."),
    currentStepIndex: 2,
    remainingSteps: [{ id: "read_results", primitive: "read_visible_text", label: "Read results" }],
    actionLog: [{ step, status: "failed", error: "Search disappeared after navigation." }],
    observationSummary: summary,
    currentWindow: { id: "win_b", title: "Browser" }
  });
  assert.equal(replanContext.schemaVersion, "desktop_replan_context_v1");
  assert.equal(replanContext.trigger.failedStep.id, "click_search");
  assert.equal(replanContext.remainingSteps.length, 1);

  const continuation = selectDesktopReplanContinuation({
    requiresClarification: false,
    steps: [
      { id: "observe_again", primitive: "read_visible_text" },
      { id: "stop", primitive: "stop" }
    ]
  });
  assert.equal(continuation.length, 1);
  assert.equal(continuation[0].id, "observe_again");
}
