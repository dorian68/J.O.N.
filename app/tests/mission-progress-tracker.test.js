import assert from "node:assert/strict";
import { MissionProgressTracker } from "../src/runtime/mission-progress-tracker.js";

function makeTracker(opts = {}) {
  return new MissionProgressTracker({
    runId: "run-test-001",
    projectId: "proj-001",
    mission: "Test mission",
    plan: opts.plan ?? null
  });
}

export async function run() {

  // ── Step tracking ──────────────────────────────────────────────────────────

  {
    const t = makeTracker();
    const snap = t.toSnapshot();
    assert.equal(snap.steps.completed, 0, "initial completedSteps");
    assert.equal(snap.steps.failed, 0, "initial failedSteps");
    assert.equal(snap.steps.consecutiveFailures, 0, "initial consecutiveFailures");
  }

  {
    const t = makeTracker();
    t.recordStepResult({ stepId: "s1", primitive: "launch_application", status: "completed" });
    assert.equal(t.completedSteps, 1);
    assert.equal(t.consecutiveFailures, 0, "success resets consecutiveFailures");
  }

  {
    const t = makeTracker();
    t.recordStepResult({ stepId: "s1", primitive: "click_point", status: "failed", errorMessage: "Not found" });
    assert.equal(t.failedSteps, 1);
    assert.equal(t.consecutiveFailures, 1);
  }

  {
    const t = makeTracker();
    t.recordStepResult({ stepId: "s1", primitive: "launch_application", status: "failed", recoveryAttempted: true });
    assert.equal(t.recoveredSteps, 1, "recovery tracked");
  }

  {
    const t = makeTracker();
    t.recordStepResult({ stepId: "s1", primitive: "click_point", status: "failed" });
    t.recordStepResult({ stepId: "s2", primitive: "click_point", status: "failed" });
    t.recordStepResult({ stepId: "s3", primitive: "launch_application", status: "completed" });
    assert.equal(t.consecutiveFailures, 0, "success should reset consecutive counter");
    assert.equal(t.failedSteps, 2);
  }

  {
    const t = makeTracker();
    t.recordStepResult({ stepId: "s1", primitive: "capture_window", status: "completed", screenshotPath: "/tmp/shot.png" });
    assert.deepEqual(t.screenshotPaths, ["/tmp/shot.png"]);
  }

  {
    const t = makeTracker();
    t.recordDynamicReplan();
    t.recordDynamicReplan();
    assert.equal(t.dynamicReplanCount, 2);
  }

  // ── Surface tracking ───────────────────────────────────────────────────────

  {
    const t = makeTracker();
    t.setActiveSurface("desktop", { app: "Notepad" });
    assert.equal(t.activeSurface, "desktop");
    assert.equal(t.activeApp, "Notepad");
  }

  {
    const t = makeTracker();
    t.setActiveSurface("browser", { url: "https://google.com" });
    assert.equal(t.activeBrowserUrl, "https://google.com");
  }

  // ── Outcome tracking ───────────────────────────────────────────────────────

  {
    const t = makeTracker({ plan: { steps: [], verificationGoals: ["search done", "screenshot taken"] } });
    t.markOutcomeCompleted("search done");
    assert(t.completedOutcomes.includes("search done"));
    assert(!t.pendingOutcomes.includes("search done"));
  }

  {
    const t = makeTracker({ plan: { steps: [], verificationGoals: ["open app"] } });
    t.markOutcomeBlocked("open app", "App not installed");
    assert.equal(t.blockedOutcomes.length, 1);
    assert.equal(t.blockedOutcomes[0].reason, "App not installed");
  }

  // ── Semantic verification ──────────────────────────────────────────────────

  {
    const t = makeTracker();
    const verification = {
      verifiedByOutcomes: true,
      objectiveSatisfied: true,
      verificationVerdict: "pass",
      confidence: "high",
      satisfiedOutcomes: ["work done", "evidence collected"],
      unsatisfiedOutcomes: [],
      failureReason: null,
      nextBestAction: null,
      evidenceUsed: ["ev-001"],
      requiresUserInput: false,
      userQuestion: null
    };
    t.setFinalVerification(verification);
    assert.equal(t.verifiedByOutcomes, true);
    assert.equal(t.userObjectiveSatisfied, true);
    assert.equal(t.verificationVerdict, "pass");
    assert.deepEqual(t.verifiedOutcomes, ["work done", "evidence collected"]);
  }

  {
    const t = makeTracker();
    t.setFinalVerification({
      verifiedByOutcomes: false,
      objectiveSatisfied: false,
      verificationVerdict: "fail",
      confidence: "high",
      satisfiedOutcomes: [],
      unsatisfiedOutcomes: ["no evidence"],
      failureReason: "no evidence collected",
      nextBestAction: "add screenshot step",
      evidenceUsed: [],
      requiresUserInput: false,
      userQuestion: null
    });
    assert.equal(t.verifiedByOutcomes, false);
    assert.equal(t.userObjectiveSatisfied, false);
    assert.equal(t.verificationVerdict, "fail");
  }

  {
    const t = makeTracker();
    t.setFinalVerification({
      verifiedByOutcomes: true, objectiveSatisfied: true, verificationVerdict: "pass",
      confidence: "high", satisfiedOutcomes: ["steps done"], unsatisfiedOutcomes: [],
      failureReason: null, nextBestAction: null
    });
    const info = t.whatIsVerified();
    assert(info, "whatIsVerified should return non-null");
    assert.equal(info.verdict, "pass");
    assert.equal(info.objectiveSatisfied, true);
  }

  {
    const t = makeTracker();
    t.recordEvidence("ev-001");
    t.recordStepResult({ stepId: "s1", primitive: "capture_window", status: "completed", screenshotPath: "/tmp/shot.png" });
    const info = t.whatEvidenceExists();
    assert.deepEqual(info.evidenceIds, ["ev-001"]);
    assert.deepEqual(info.screenshotPaths, ["/tmp/shot.png"]);
  }

  {
    const t = makeTracker();
    t.setFinalVerification({
      verifiedByOutcomes: true, objectiveSatisfied: true, verificationVerdict: "pass",
      confidence: "high", satisfiedOutcomes: [], unsatisfiedOutcomes: [],
      failureReason: null, nextBestAction: null, requiresUserInput: false
    });
    t.complete({ verifiedByOutcomes: true });
    assert.equal(t.whatDoesJonNeedFromUser(), null, "nothing needed when verified");
  }

  {
    const t = makeTracker();
    t.setFinalVerification({
      verifiedByOutcomes: false, objectiveSatisfied: false, verificationVerdict: "partial",
      confidence: "medium", satisfiedOutcomes: [], unsatisfiedOutcomes: ["screenshot missing"],
      failureReason: "screenshot missing", nextBestAction: null, requiresUserInput: false
    });
    const msg = t.whatDoesJonNeedFromUser();
    assert(typeof msg === "string" && msg.includes("partial"), "partial verdict should tell user to review");
  }

  // ── Final status ───────────────────────────────────────────────────────────

  {
    const t = makeTracker();
    t.complete({ verifiedByOutcomes: true });
    assert.equal(t.finalStatus, "completed");
    assert.equal(t.verifiedByOutcomes, true);
  }

  {
    const t = makeTracker();
    t.fail("Too many consecutive failures");
    assert.equal(t.finalStatus, "failed");
    assert.equal(t.stoppedReason, "Too many consecutive failures");
  }

  {
    const t = makeTracker();
    t.setFinalVerification({
      verifiedByOutcomes: true, objectiveSatisfied: true, verificationVerdict: "pass",
      confidence: "high", satisfiedOutcomes: ["done"], unsatisfiedOutcomes: [],
      failureReason: null, nextBestAction: null, requiresUserInput: false, userQuestion: null
    });
    const snap = t.toSnapshot();
    assert(snap.semanticVerification, "toSnapshot should include semanticVerification");
    assert.equal(snap.semanticVerification.verdict, "pass");
    assert.equal(snap.semanticVerification.objectiveSatisfied, true);
    assert.deepEqual(snap.semanticVerification.verifiedOutcomes, ["done"]);
  }

  {
    const t = makeTracker({ plan: { steps: [1, 2, 3], verificationGoals: [] } });
    t.recordStepResult({ stepId: "s1", primitive: "launch_application", status: "completed" });
    t.recordStepResult({ stepId: "s2", primitive: "type_text", status: "completed" });
    const info = t.whereAreWe();
    assert.equal(info.runId, "run-test-001");
    assert(info.progress.includes("2/3"), `progress should show 2/3, got: ${info.progress}`);
  }

  {
    const t = makeTracker();
    t.recordStepResult({ stepId: "s1", primitive: "click_point", status: "failed" });
    t.recordStepResult({ stepId: "s2", primitive: "click_point", status: "failed" });
    t.recordStepResult({ stepId: "s3", primitive: "click_point", status: "failed" });
    const blocking = t.whatIsBlocking();
    assert(typeof blocking === "string" && blocking.includes("3"), `should report 3 consecutive failures, got: ${blocking}`);
  }

  // ── whatIsVerified returns null before verification is set ─────────────────
  {
    const t = makeTracker();
    assert.equal(t.whatIsVerified(), null, "no verification set yet should return null");
  }
}
