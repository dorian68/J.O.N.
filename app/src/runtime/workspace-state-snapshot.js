/**
 * WorkspaceStateSnapshot — real-time aggregated view of JON's environment.
 *
 * Collects: visible windows, active app, browser sessions, terminal sessions,
 * pending approvals, current run, mission progress, recent evidence, blockers,
 * token/cost status.
 *
 * Used by: SemanticOutcomeVerifier, MissionProgressTracker, RecoveryPlanner,
 * audit extraction, run progress API.
 */

import { nowIso } from "../utils/ids.js";

export class WorkspaceStateSnapshot {

  /**
   * Build a snapshot from available runtime handles.
   * All parameters are optional — missing sources produce null/[] fields.
   *
   * @param {object} opts
   * @param {object|null} opts.computer            — ComputerControlService
   * @param {object|null} opts.database            — PrototypeDatabase
   * @param {object|null} opts.missionTracker      — MissionProgressTracker
   * @param {object|null} opts.operatorService     — OperatorService (for approvals)
   * @param {string|null} opts.runId
   * @param {string|null} opts.projectId
   * @param {object|null} opts.browserState        — last known browserOperator state
   * @param {object[]|null} opts.terminalSessions  — active terminal session objects
   * @param {object|null} opts.tokenBudget         — { used, limit, remaining }
   */
  static async build({
    computer = null,
    database = null,
    missionTracker = null,
    operatorService = null,
    runId = null,
    projectId = null,
    browserState = null,
    terminalSessions = null,
    tokenBudget = null
  } = {}) {
    const capturedAt = nowIso();

    // ── Desktop state ────────────────────────────────────────────────────────
    let visibleWindows = [];
    let activeWindow = null;
    let desktopError = null;

    if (computer) {
      try {
        visibleWindows = await computer.listVisibleWindows().catch(() => []);
        activeWindow = await computer.detectActiveWindow().catch(() => null);
      } catch (err) {
        desktopError = err.message;
      }
    }

    // ── Browser state ────────────────────────────────────────────────────────
    const browserSessions = browserState
      ? [{
        url: browserState.url ?? null,
        title: browserState.title ?? null,
        status: browserState.status ?? "unknown",
        stepCount: browserState.stepCount ?? null,
        lastCapturedAt: capturedAt
      }]
      : [];

    // ── Terminal state ───────────────────────────────────────────────────────
    const terminalSessionList = (terminalSessions ?? []).map((t) => ({
      id: t.id ?? null,
      cwd: t.cwd ?? null,
      status: t.status ?? "unknown",
      lastOutput: t.lastOutput?.slice(-200) ?? null
    }));

    // ── Pending approvals ────────────────────────────────────────────────────
    const pendingApprovals = operatorService
      ? (operatorService.listPendingApprovals?.() ?? []).filter((a) => !runId || a.runId === runId)
      : [];

    // ── Current run ──────────────────────────────────────────────────────────
    let currentRun = null;
    let recentEvidence = [];
    let blockers = [];

    if (database && runId) {
      try {
        const run = database.getRun(runId);
        if (run) {
          currentRun = {
            id: run.id,
            mission: run.mission,
            status: run.status,
            lifecycleStage: run.lifecycleStage,
            summary: run.summary,
            createdAt: run.createdAt
          };
        }
        recentEvidence = (database.listEvidence?.(runId) ?? [])
          .slice(-5)
          .map((e) => ({
            id: e.id,
            type: e.evidenceType,
            label: e.label,
            path: e.storagePath,
            surface: e.linkedSurface
          }));
      } catch {
        // database may not support these methods in all contexts
      }
    }

    // ── Mission progress ─────────────────────────────────────────────────────
    const missionProgress = missionTracker ? missionTracker.whereAreWe() : null;
    const verificationState = missionTracker ? missionTracker.whatIsVerified() : null;
    const evidenceState = missionTracker ? missionTracker.whatEvidenceExists() : null;
    const userNeed = missionTracker ? missionTracker.whatDoesJonNeedFromUser() : null;

    // Collect blockers from tracker
    if (missionTracker) {
      const blocking = missionTracker.whatIsBlocking();
      if (blocking) blockers.push({ source: "missionTracker", reason: blocking });
    }
    if (pendingApprovals.length > 0) {
      blockers.push({ source: "approvals", reason: `${pendingApprovals.length} pending approval(s)` });
    }

    return {
      capturedAt,
      runId,
      projectId,

      desktop: {
        visibleWindowCount: visibleWindows.length,
        visibleWindows: visibleWindows.slice(0, 10).map((w) => ({
          id: w.id,
          title: w.title,
          active: w.active ?? false,
          allowlisted: w.allowlisted ?? false
        })),
        activeWindow: activeWindow
          ? { id: activeWindow.id, title: activeWindow.title }
          : null,
        error: desktopError
      },

      browser: {
        sessionCount: browserSessions.length,
        sessions: browserSessions
      },

      terminal: {
        sessionCount: terminalSessionList.length,
        sessions: terminalSessionList
      },

      approvals: {
        pendingCount: pendingApprovals.length,
        pending: pendingApprovals.map((a) => ({
          id: a.id,
          category: a.category,
          actionLabel: a.actionLabel,
          riskLevel: a.riskLevel
        }))
      },

      run: currentRun,

      mission: {
        progress: missionProgress,
        verification: verificationState,
        evidence: evidenceState,
        userNeed,
        blockers
      },

      recentEvidence,

      tokenBudget: tokenBudget ?? null,

      // Convenience flags for SemanticOutcomeVerifier and RecoveryPlanner
      flags: {
        hasActiveDesktopWindow: Boolean(activeWindow),
        hasActiveBrowser: browserSessions.length > 0,
        hasActiveTerminals: terminalSessionList.length > 0,
        hasPendingApprovals: pendingApprovals.length > 0,
        isBlocked: blockers.length > 0,
        objectiveSatisfied: missionTracker?.userObjectiveSatisfied ?? null,
        verificationVerdict: missionTracker?.verificationVerdict ?? null
      }
    };
  }

  /**
   * Lightweight synchronous snapshot — no async computer calls.
   * Use when you need a snapshot but can't await.
   */
  static fromTracker({ missionTracker, runId = null, projectId = null, browserState = null, terminalSessions = null } = {}) {
    return {
      capturedAt: nowIso(),
      runId,
      projectId,
      desktop: { visibleWindowCount: 0, visibleWindows: [], activeWindow: null, error: "sync-only" },
      browser: {
        sessionCount: browserState ? 1 : 0,
        sessions: browserState ? [{ url: browserState.url, status: browserState.status }] : []
      },
      terminal: { sessionCount: (terminalSessions ?? []).length, sessions: [] },
      approvals: { pendingCount: 0, pending: [] },
      run: null,
      mission: {
        progress: missionTracker?.whereAreWe() ?? null,
        verification: missionTracker?.whatIsVerified() ?? null,
        evidence: missionTracker?.whatEvidenceExists() ?? null,
        userNeed: missionTracker?.whatDoesJonNeedFromUser() ?? null,
        blockers: []
      },
      recentEvidence: [],
      tokenBudget: null,
      flags: {
        hasActiveDesktopWindow: false,
        hasActiveBrowser: Boolean(browserState),
        hasActiveTerminals: (terminalSessions ?? []).length > 0,
        hasPendingApprovals: false,
        isBlocked: false,
        objectiveSatisfied: missionTracker?.userObjectiveSatisfied ?? null,
        verificationVerdict: missionTracker?.verificationVerdict ?? null
      }
    };
  }
}
