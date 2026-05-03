import { nowIso } from "../utils/ids.js";

export class MissionProgressTracker {
  constructor({ runId, projectId, mission, plan = null } = {}) {
    this.runId = runId;
    this.projectId = projectId;
    this.mission = mission;
    this.startedAt = nowIso();
    this.updatedAt = nowIso();

    // Plan
    this.plannedSteps = plan?.steps ?? [];
    this.totalSteps = this.plannedSteps.length;

    // Execution counters
    this.completedSteps = 0;
    this.failedSteps = 0;
    this.blockedSteps = 0;
    this.skippedSteps = 0;
    this.recoveredSteps = 0;
    this.consecutiveFailures = 0;
    this.dynamicReplanCount = 0;

    // Outcomes
    this.completedOutcomes = [];
    this.pendingOutcomes = plan?.verificationGoals?.slice() ?? [];
    this.blockedOutcomes = [];

    // Active surfaces
    this.activeSurface = null;   // "desktop" | "browser" | "terminal" | null
    this.activeApp = null;
    this.activeBrowserUrl = null;
    this.activeTerminalId = null;

    // Evidence & artifacts
    this.evidenceIds = [];
    this.artifactIds = [];
    this.screenshotPaths = [];

    // User interaction
    this.pendingApprovalId = null;
    this.userNeededReason = null;
    this.userNeededAt = null;

    // Final status
    this.finalStatus = null;       // "completed" | "failed" | "stopped" | "paused"
    this.stoppedReason = null;
    this.verifiedByOutcomes = false;

    // Semantic verification (set by SemanticOutcomeVerifier)
    this.finalVerification = null;       // full verifier output object
    this.userObjectiveSatisfied = false; // shorthand boolean
    this.verifiedOutcomes = [];          // list of verified outcome labels
    this.verificationVerdict = null;     // "pass" | "partial" | "fail" | "degraded"

    // Step log
    this.stepLog = [];
  }

  // ── Step tracking ────────────────────────────────────────────────────────────

  recordStepResult({ stepId, primitive, label, status, errorMessage, screenshotPath, recoveryAttempted }) {
    this.updatedAt = nowIso();
    this.stepLog.push({
      stepId, primitive, label, status,
      errorMessage: errorMessage ?? null,
      screenshotPath: screenshotPath ?? null,
      recoveryAttempted: recoveryAttempted ?? false,
      recordedAt: nowIso()
    });

    switch (status) {
      case "completed":
        this.completedSteps++;
        this.consecutiveFailures = 0;
        break;
      case "failed":
        this.failedSteps++;
        this.consecutiveFailures++;
        if (recoveryAttempted) this.recoveredSteps++;
        break;
      case "blocked":
        this.blockedSteps++;
        this.consecutiveFailures++;
        break;
      case "skipped":
        this.skippedSteps++;
        this.consecutiveFailures++;
        break;
    }

    if (screenshotPath) this.screenshotPaths.push(screenshotPath);
  }

  recordDynamicReplan() {
    this.dynamicReplanCount++;
    this.updatedAt = nowIso();
  }

  // ── Surface tracking ─────────────────────────────────────────────────────────

  setActiveSurface(surface, { app = null, url = null, terminalId = null } = {}) {
    this.activeSurface = surface;
    if (app !== null) this.activeApp = app;
    if (url !== null) this.activeBrowserUrl = url;
    if (terminalId !== null) this.activeTerminalId = terminalId;
    this.updatedAt = nowIso();
  }

  // ── Evidence / artifacts ─────────────────────────────────────────────────────

  recordEvidence(evidenceId) {
    this.evidenceIds.push(evidenceId);
    this.updatedAt = nowIso();
  }

  recordArtifact(artifactId) {
    this.artifactIds.push(artifactId);
    this.updatedAt = nowIso();
  }

  // ── Outcome tracking ─────────────────────────────────────────────────────────

  markOutcomeCompleted(outcome) {
    this.pendingOutcomes = this.pendingOutcomes.filter((o) => o !== outcome);
    this.completedOutcomes.push(outcome);
    this.updatedAt = nowIso();
  }

  markOutcomeBlocked(outcome, reason) {
    this.pendingOutcomes = this.pendingOutcomes.filter((o) => o !== outcome);
    this.blockedOutcomes.push({ outcome, reason });
    this.updatedAt = nowIso();
  }

  // ── User interaction ─────────────────────────────────────────────────────────

  setWaitingForUser(approvalId, reason) {
    this.pendingApprovalId = approvalId;
    this.userNeededReason = reason;
    this.userNeededAt = nowIso();
    this.updatedAt = nowIso();
  }

  clearWaitingForUser() {
    this.pendingApprovalId = null;
    this.userNeededReason = null;
    this.userNeededAt = null;
    this.updatedAt = nowIso();
  }

  // ── Final status ─────────────────────────────────────────────────────────────

  complete({ verifiedByOutcomes = false } = {}) {
    this.finalStatus = "completed";
    this.verifiedByOutcomes = verifiedByOutcomes;
    this.updatedAt = nowIso();
  }

  // ── Semantic verification ────────────────────────────────────────────────────

  setFinalVerification(verification) {
    this.finalVerification = verification ?? null;
    this.userObjectiveSatisfied = verification?.objectiveSatisfied ?? false;
    this.verifiedByOutcomes = verification?.verifiedByOutcomes ?? false;
    this.verifiedOutcomes = verification?.satisfiedOutcomes ?? [];
    this.verificationVerdict = verification?.verificationVerdict ?? null;
    this.updatedAt = nowIso();
  }

  whatIsVerified() {
    if (!this.finalVerification) return null;
    return {
      verdict: this.verificationVerdict,
      objectiveSatisfied: this.userObjectiveSatisfied,
      verifiedOutcomes: this.verifiedOutcomes,
      unsatisfiedOutcomes: this.finalVerification.unsatisfiedOutcomes ?? [],
      failureReason: this.finalVerification.failureReason ?? null,
      confidence: this.finalVerification.confidence ?? "unknown"
    };
  }

  whatEvidenceExists() {
    return {
      evidenceIds: this.evidenceIds,
      artifactIds: this.artifactIds,
      screenshotPaths: this.screenshotPaths,
      evidenceUsedInVerification: this.finalVerification?.evidenceUsed ?? []
    };
  }

  whatDoesJonNeedFromUser() {
    if (this.pendingApprovalId) return `Approval required: ${this.userNeededReason ?? "unknown"}`;
    if (this.finalVerification?.requiresUserInput) return this.finalVerification.userQuestion ?? "User input needed to verify objective.";
    if (this.verificationVerdict === "partial") return "Mission partially completed — user should review and confirm whether objective was met.";
    if (this.verificationVerdict === "fail") return `Mission failed verification: ${this.finalVerification?.failureReason ?? "unknown reason"}. Retry or reformulate.`;
    return null;
  }

  fail(reason) {
    this.finalStatus = "failed";
    this.stoppedReason = reason;
    this.updatedAt = nowIso();
  }

  stop(reason) {
    this.finalStatus = "stopped";
    this.stoppedReason = reason;
    this.updatedAt = nowIso();
  }

  pause(reason) {
    this.finalStatus = "paused";
    this.stoppedReason = reason;
    this.updatedAt = nowIso();
  }

  // ── Query interface ──────────────────────────────────────────────────────────

  whereAreWe() {
    const done = this.completedSteps;
    const total = this.totalSteps || (done + this.failedSteps + this.blockedSteps + this.skippedSteps);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      runId: this.runId,
      mission: this.mission,
      progress: `${done}/${total} steps (${pct}%)`,
      activeSurface: this.activeSurface,
      activeApp: this.activeApp,
      activeBrowserUrl: this.activeBrowserUrl,
      consecutiveFailures: this.consecutiveFailures,
      dynamicReplans: this.dynamicReplanCount,
      completedOutcomes: this.completedOutcomes,
      pendingOutcomes: this.pendingOutcomes,
      blockedOutcomes: this.blockedOutcomes,
      waitingForUser: Boolean(this.pendingApprovalId),
      userNeededReason: this.userNeededReason,
      finalStatus: this.finalStatus,
      evidenceCount: this.evidenceIds.length,
      artifactCount: this.artifactIds.length
    };
  }

  whatIsBlocking() {
    if (this.pendingApprovalId) return `Waiting for user approval: ${this.userNeededReason ?? "unknown reason"}`;
    if (this.consecutiveFailures >= 3) return `${this.consecutiveFailures} consecutive failures on ${this.activeSurface ?? "desktop"}`;
    if (this.blockedOutcomes.length > 0) return `Blocked outcomes: ${this.blockedOutcomes.map((b) => b.outcome).join(", ")}`;
    return null;
  }

  whatHaveYouDone() {
    const log = this.stepLog.filter((s) => s.status === "completed");
    return log.map((s) => `${s.primitive}: ${s.label ?? s.stepId}`);
  }

  whatIsNext() {
    const nextPending = this.pendingOutcomes[0] ?? null;
    if (nextPending) return `Next outcome to achieve: ${nextPending}`;
    return this.finalStatus ? `Mission ${this.finalStatus}` : "Executing next planned step";
  }

  toSnapshot() {
    return {
      runId: this.runId,
      projectId: this.projectId,
      mission: this.mission,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      steps: {
        total: this.totalSteps,
        completed: this.completedSteps,
        failed: this.failedSteps,
        blocked: this.blockedSteps,
        skipped: this.skippedSteps,
        recovered: this.recoveredSteps,
        consecutiveFailures: this.consecutiveFailures,
        dynamicReplans: this.dynamicReplanCount
      },
      outcomes: {
        completed: this.completedOutcomes,
        pending: this.pendingOutcomes,
        blocked: this.blockedOutcomes
      },
      surfaces: {
        active: this.activeSurface,
        app: this.activeApp,
        browserUrl: this.activeBrowserUrl,
        terminalId: this.activeTerminalId
      },
      proof: {
        evidenceIds: this.evidenceIds,
        artifactIds: this.artifactIds,
        screenshotPaths: this.screenshotPaths
      },
      userInteraction: {
        waitingForUser: Boolean(this.pendingApprovalId),
        approvalId: this.pendingApprovalId,
        reason: this.userNeededReason,
        requestedAt: this.userNeededAt
      },
      finalStatus: this.finalStatus,
      verifiedByOutcomes: this.verifiedByOutcomes,
      stoppedReason: this.stoppedReason,
      semanticVerification: {
        verdict: this.verificationVerdict,
        objectiveSatisfied: this.userObjectiveSatisfied,
        verifiedOutcomes: this.verifiedOutcomes,
        unsatisfiedOutcomes: this.finalVerification?.unsatisfiedOutcomes ?? [],
        failureReason: this.finalVerification?.failureReason ?? null,
        confidence: this.finalVerification?.confidence ?? null,
        nextBestAction: this.finalVerification?.nextBestAction ?? null,
        requiresUserInput: this.finalVerification?.requiresUserInput ?? false
      }
    };
  }
}
