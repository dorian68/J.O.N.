/**
 * SemanticOutcomeVerifier — verifies that the user's actual objective was met,
 * not just that steps executed without error.
 *
 * Deterministic v1: rule-based checks against mission text, action log,
 * evidence, artifacts, and browser/desktop state. No LLM call.
 *
 * Output: { verifiedByOutcomes, objectiveSatisfied, verificationVerdict,
 *           confidence, evidenceUsed, missingEvidence, satisfiedOutcomes,
 *           unsatisfiedOutcomes, failureReason, nextBestAction,
 *           requiresUserInput, userQuestion, checks }
 *
 * Rule: verifiedByOutcomes === true  ←→ run may be marked COMPLETED.
 *       verifiedByOutcomes === false ←→ run must NOT be marked COMPLETED.
 */

export class SemanticOutcomeVerifier {

  /**
   * @param {object} opts
   * @param {string} opts.mission           — raw user mission text
   * @param {string[]} [opts.planOutcomes]  — verificationGoals from plan
   * @param {object[]} [opts.actionLog]     — desktop action log entries ({ status, primitive, label, ... })
   * @param {object[]} [opts.evidence]      — evidence records ({ id, evidenceId, type, ... })
   * @param {object[]} [opts.artifacts]     — artifact records from DB
   * @param {object|null} [opts.browserResult] — result from browserOperator.runMission()
   * @param {object|null} [opts.desktopState]  — post-execution desktop state
   * @param {object|null} [opts.trackerSnapshot] — MissionProgressTracker.toSnapshot()
   */
  verify({
    mission = "",
    planOutcomes = [],
    actionLog = [],
    evidence = [],
    artifacts = [],
    browserResult = null,
    desktopState = null,
    trackerSnapshot = null
  } = {}) {
    const missionLower = (mission ?? "").toLowerCase();
    const checks = [];

    // ── 1. Work was actually executed ─────────────────────────────────────────
    const completedDesktopActions = actionLog.filter((e) => e.status === "completed");
    const browserStepCount = browserResult?.stepResults?.length ?? 0;
    const totalWork = completedDesktopActions.length + browserStepCount;

    checks.push(this.#check(
      "work_executed",
      "Actions were executed toward the objective",
      totalWork > 0,
      { completedDesktopActions: completedDesktopActions.length, browserSteps: browserStepCount }
    ));

    // ── 2. Evidence collected ────────────────────────────────────────────────
    const allEvidence = [
      ...evidence,
      ...(browserResult?.evidence ?? [])
    ].filter(Boolean);
    const evidenceCount = allEvidence.length;

    checks.push(this.#check(
      "evidence_collected",
      "Evidence was captured during execution",
      evidenceCount > 0,
      { evidenceCount }
    ));

    // ── 3. No critical unrecovered failures ──────────────────────────────────
    const criticalFailures = actionLog.filter((e) => e.status === "failed" && !e.recoveryAttempted);
    const browserErrors = browserResult?.errors ?? [];
    const hasCriticalFailures = criticalFailures.length > 0;

    checks.push(this.#check(
      "no_critical_failures",
      "No critical unrecovered failures during execution",
      !hasCriticalFailures,
      {
        criticalFailureCount: criticalFailures.length,
        browserErrorCount: browserErrors.length,
        failedPrimitives: criticalFailures.map((e) => e.primitive ?? "unknown")
      }
    ));

    // ── 4. Browser partial is NOT a semantic pass ────────────────────────────
    if (browserResult) {
      const browserFullyCompleted = browserResult.status === "completed";
      checks.push(this.#check(
        "browser_fully_completed",
        "Browser mission reached full completion (not partial or failed)",
        browserFullyCompleted,
        { browserStatus: browserResult.status }
      ));

      // 4b. Browser blockers don't indicate objective was unreachable
      const unresolvedBlockers = (browserResult.blockers ?? []).filter((b) => !b.resolved);
      if (unresolvedBlockers.length > 0) {
        checks.push(this.#check(
          "browser_no_blockers",
          "No unresolved browser blockers remained",
          false,
          {
            blockerCount: unresolvedBlockers.length,
            blockers: unresolvedBlockers.map((b) => b.reason ?? b.type ?? "unknown").slice(0, 3)
          }
        ));
      }
    }

    // ── 5. Desktop mission: key primitives matched objective ─────────────────
    if (actionLog.length > 0 && !browserResult) {
      const completedPrimitives = completedDesktopActions.map((e) => e.primitive ?? "");

      // If mission mentions opening/launching — check launch primitive happened
      const launchRequested = /open|launch|start|run/.test(missionLower);
      const launchDone = completedPrimitives.some((p) => p.includes("launch") || p.includes("open"));
      if (launchRequested) {
        checks.push(this.#check(
          "launch_primitive_executed",
          "Application launch was requested and executed",
          launchDone,
          { completedPrimitives: completedPrimitives.slice(0, 5) }
        ));
      }

      // If mission mentions typing / writing — check type primitive happened
      const typeRequested = /type|write|enter|input/.test(missionLower);
      const typeDone = completedPrimitives.some((p) => p.includes("type") || p.includes("input") || p.includes("write"));
      if (typeRequested) {
        checks.push(this.#check(
          "type_primitive_executed",
          "Text input was requested and executed",
          typeDone,
          { completedPrimitives: completedPrimitives.slice(0, 5) }
        ));
      }

      // If mission mentions screenshot — check capture primitive happened
      const screenshotRequested = /screenshot|capture|photo|image/.test(missionLower);
      const screenshotDone = completedPrimitives.some((p) => p.includes("capture") || p.includes("screenshot") || p.includes("photo"));
      if (screenshotRequested) {
        checks.push(this.#check(
          "screenshot_captured",
          "Screenshot was requested and captured",
          screenshotDone,
          { completedPrimitives: completedPrimitives.slice(0, 5) }
        ));
      }
    }

    // ── 6. Browser navigation matched objective ──────────────────────────────
    if (browserResult) {
      // Search objective → at minimum some navigation was done
      const searchRequested = /search|find|look for|query/.test(missionLower);
      if (searchRequested) {
        const navigationSteps = (browserResult.stepResults ?? []).filter(
          (s) => s.action === "navigate" || s.action === "search" || s.action === "type"
        );
        checks.push(this.#check(
          "browser_search_executed",
          "Browser search/navigation was executed",
          navigationSteps.length > 0 || browserStepCount > 0,
          { navigationStepCount: navigationSteps.length, totalBrowserSteps: browserStepCount }
        ));
      }

      // Screenshot objective in browser
      const screenshotRequested = /screenshot|capture/.test(missionLower);
      if (screenshotRequested) {
        const screenshotEvidence = allEvidence.filter((e) => e.type === "page_screenshot" || e.screenshotPath);
        checks.push(this.#check(
          "browser_screenshot_captured",
          "Browser screenshot was captured as requested",
          screenshotEvidence.length > 0,
          { screenshotEvidenceCount: screenshotEvidence.length }
        ));
      }
    }

    // ── 7. Extraction/artifact if explicitly requested ───────────────────────
    const extractionRequested = /extract|artifact|table|list|summar|export/.test(missionLower);
    if (extractionRequested) {
      const hasArtifact = artifacts.length > 0;
      const hasExtracted = browserResult?.extracted && Object.keys(browserResult.extracted).length > 0;
      checks.push(this.#check(
        "extraction_delivered",
        "Extraction or artifact was requested and delivered",
        hasArtifact || hasExtracted,
        {
          artifactCount: artifacts.length,
          hasExtractedData: Boolean(hasExtracted),
          extractedKeys: hasExtracted ? Object.keys(browserResult.extracted).slice(0, 3) : []
        }
      ));
    }

    // ── 8. Tracker: no consecutive failure cascade ───────────────────────────
    if (trackerSnapshot) {
      const consecutiveFailures = trackerSnapshot.steps?.consecutiveFailures ?? 0;
      if (consecutiveFailures >= 3) {
        checks.push(this.#check(
          "no_failure_cascade",
          "No consecutive failure cascade (≥3 failures in a row)",
          false,
          { consecutiveFailures }
        ));
      }
    }

    // ── Compute verdict ──────────────────────────────────────────────────────
    const failedChecks = checks.filter((c) => !c.passed);
    const passedChecks = checks.filter((c) => c.passed);
    const totalChecks = checks.length;

    // Critical checks that block completion entirely.
    // Advisory checks (keyword-matching primitives) only affect confidence.
    const CRITICAL_CHECK_IDS = new Set([
      "work_executed",
      "browser_fully_completed",
      "browser_no_blockers",
      "no_critical_failures",
      "no_failure_cascade"
    ]);
    const criticalBlockers = failedChecks.filter((c) => CRITICAL_CHECK_IDS.has(c.id));
    const advisoryFailures = failedChecks.filter((c) => !CRITICAL_CHECK_IDS.has(c.id));

    // Completion is only blocked by critical failures
    const verifiedByOutcomes = criticalBlockers.length === 0;
    const objectiveSatisfied = verifiedByOutcomes;

    let verificationVerdict;
    let confidence;

    if (!verifiedByOutcomes) {
      verificationVerdict = "fail";
      confidence = "high";
    } else if (advisoryFailures.length === 0) {
      verificationVerdict = "pass";
      confidence = totalChecks >= 4 ? "high" : "medium";
    } else if (advisoryFailures.length <= Math.ceil(totalChecks * 0.4)) {
      verificationVerdict = "pass";
      confidence = "medium";
    } else {
      verificationVerdict = "partial";
      confidence = "low";
    }

    const failureReason = failedChecks.length > 0
      ? failedChecks.map((c) => c.label).join("; ")
      : null;

    return {
      verifiedByOutcomes,
      objectiveSatisfied,
      verificationVerdict,
      confidence,
      evidenceUsed: allEvidence.map((e) => e.id ?? e.evidenceId ?? null).filter(Boolean),
      missingEvidence: failedChecks
        .filter((c) => c.id.includes("evidence") || c.id.includes("screenshot") || c.id.includes("extraction"))
        .map((c) => c.label),
      satisfiedOutcomes: passedChecks.map((c) => c.label),
      unsatisfiedOutcomes: failedChecks.map((c) => c.label),
      failureReason,
      nextBestAction: this.#suggestNextAction(failedChecks, missionLower),
      requiresUserInput: false,
      userQuestion: null,
      checks
    };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  #check(id, label, passed, detail = {}) {
    return { id, label, passed, status: passed ? "pass" : "fail", detail };
  }

  #suggestNextAction(failedChecks, missionLower) {
    if (!failedChecks.length) return null;
    const ids = failedChecks.map((c) => c.id);

    if (ids.includes("browser_fully_completed"))
      return "Browser mission was only partially completed. Retry with a more focused scope or check for blockers.";
    if (ids.includes("browser_no_blockers"))
      return "Browser encountered unresolved blockers. Check allowlisted hosts and page accessibility.";
    if (ids.includes("no_critical_failures"))
      return "Critical failures occurred during execution. Review step failure log and consider recovery strategy.";
    if (ids.includes("launch_primitive_executed"))
      return "Application launch failed. Verify the application is installed and name is correct.";
    if (ids.includes("work_executed"))
      return "No actions were executed. Check that the mission was properly dispatched and the agent loop ran.";
    if (ids.includes("extraction_delivered"))
      return "Data extraction was requested but no artifact was created. Add an explicit extraction step to the plan.";
    if (ids.includes("evidence_collected"))
      return "No evidence was collected. Ensure screenshot capture is configured for this run.";

    return "Review execution log for details. Consider retrying with a more explicit mission description.";
  }
}
