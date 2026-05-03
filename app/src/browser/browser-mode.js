import { createId, nowIso } from "../utils/ids.js";

export const BROWSER_MODE = Object.freeze({
  WORKSPACE: "workspace_browser",
  SYSTEM: "system_browser",
  FIXTURE: "fixture_browser"
});

export const BROWSER_SESSION_STATUS = Object.freeze({
  INACTIVE: "inactive",
  OPENING: "opening",
  ACTIVE: "active",
  NAVIGATING: "navigating",
  CLOSED: "closed",
  ERROR: "error"
});

export function resolveBrowserMode(requested, { fixtureMode = false } = {}) {
  if (fixtureMode) return BROWSER_MODE.FIXTURE;
  if (requested === BROWSER_MODE.SYSTEM) return BROWSER_MODE.SYSTEM;
  return BROWSER_MODE.WORKSPACE;
}

export function describeBrowserMode(mode) {
  switch (mode) {
  case BROWSER_MODE.WORKSPACE:
    return "Navigateur workspace (JON) — isolé, traceable, allowlisté";
  case BROWSER_MODE.SYSTEM:
    return "Navigateur système (utilisateur) — cookies et extensions personnels";
  case BROWSER_MODE.FIXTURE:
    return "Navigateur contrôlé (fixture) — surface de test";
  default:
    return "Mode browser inconnu";
  }
}

export class BrowserSessionTracker {
  constructor() {
    this.sessions = new Map();
  }

  open({ projectId, runId = null, mode = BROWSER_MODE.WORKSPACE, sessionId = null }) {
    const id = sessionId ?? createId("bsess");
    const session = {
      id,
      projectId,
      runId,
      mode,
      status: BROWSER_SESSION_STATUS.OPENING,
      currentUrl: null,
      currentTitle: null,
      screenshotBase64: null,
      navigationHistory: [],
      openedAt: nowIso(),
      lastActivityAt: nowIso(),
      errorMessage: null
    };
    this.sessions.set(id, session);
    return session;
  }

  activate(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = BROWSER_SESSION_STATUS.ACTIVE;
    session.lastActivityAt = nowIso();
    return session;
  }

  recordNavigation(sessionId, { url, title, screenshotBase64 = null }) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = BROWSER_SESSION_STATUS.ACTIVE;
    session.currentUrl = url;
    session.currentTitle = title;
    if (screenshotBase64) session.screenshotBase64 = screenshotBase64;
    session.navigationHistory = [
      ...session.navigationHistory,
      { url, title, at: nowIso() }
    ].slice(-20);
    session.lastActivityAt = nowIso();
    return session;
  }

  updateScreenshot(sessionId, screenshotBase64) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.screenshotBase64 = screenshotBase64;
    session.lastActivityAt = nowIso();
    return session;
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = BROWSER_SESSION_STATUS.CLOSED;
    session.lastActivityAt = nowIso();
    return session;
  }

  error(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = BROWSER_SESSION_STATUS.ERROR;
    session.errorMessage = message;
    session.lastActivityAt = nowIso();
    return session;
  }

  get(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  getByProject(projectId) {
    return Array.from(this.sessions.values())
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  getActiveByProject(projectId) {
    return Array.from(this.sessions.values())
      .find((s) => s.projectId === projectId && s.status === BROWSER_SESSION_STATUS.ACTIVE)
      ?? null;
  }

  cleanup(projectId) {
    for (const [id, session] of this.sessions.entries()) {
      if (session.projectId === projectId && session.status === BROWSER_SESSION_STATUS.CLOSED) {
        this.sessions.delete(id);
      }
    }
  }

  toPublicState(session) {
    if (!session) return null;
    return {
      id: session.id,
      projectId: session.projectId,
      runId: session.runId,
      mode: session.mode,
      modeLabel: describeBrowserMode(session.mode),
      status: session.status,
      currentUrl: session.currentUrl,
      currentTitle: session.currentTitle,
      hasScreenshot: Boolean(session.screenshotBase64),
      screenshotBase64: session.screenshotBase64,
      navigationHistory: session.navigationHistory.slice(-5),
      openedAt: session.openedAt,
      lastActivityAt: session.lastActivityAt,
      errorMessage: session.errorMessage
    };
  }
}
