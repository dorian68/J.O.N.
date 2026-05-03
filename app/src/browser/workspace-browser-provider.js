import path from "node:path";
import os from "node:os";
import { BrowserController } from "./browser-controller.js";
import { BROWSER_MODE, BROWSER_SESSION_STATUS, BrowserSessionTracker } from "./browser-mode.js";
import { createId, nowIso } from "../utils/ids.js";

const JON_PROFILE_DIR = process.env.COWORK_JON_BROWSER_PROFILE_DIR
  ?? path.join(os.homedir(), ".cowork", "jon-browser-profile");

export class WorkspaceBrowserProvider {
  constructor({ onEvent = null, defaultHeadless = true } = {}) {
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.defaultHeadless = defaultHeadless;
    this.tracker = new BrowserSessionTracker();
    this.controllers = new Map();
    this.targetIndex = new Map();

    // Singleton JON persistent session — reused across all missions
    this.jonSessionId = null;
    this.jonController = null;
  }

  // Returns the active JON session if alive, null otherwise
  getJonSession() {
    if (!this.jonSessionId) return null;
    const session = this.tracker.get(this.jonSessionId);
    if (!session || session.status === BROWSER_SESSION_STATUS.CLOSED) {
      this.jonSessionId = null;
      this.jonController = null;
      return null;
    }
    if (!this.jonController?.isOpen()) {
      this.jonSessionId = null;
      this.jonController = null;
      return null;
    }
    return session;
  }

  // Creates (or reuses) the persistent JON browser session
  async getOrCreateJonSession({ projectId, allowlistedHosts = [] } = {}) {
    const existing = this.getJonSession();
    if (existing) {
      // Update allowlist on the controller
      if (allowlistedHosts.length > 0) {
        this.jonController.allowlistedHosts = allowlistedHosts;
      }
      return this.tracker.toPublicState(existing);
    }

    const controller = new BrowserController({
      headless: false,
      userDataDir: JON_PROFILE_DIR
    });
    const session = this.tracker.open({
      projectId,
      runId: null,
      mode: BROWSER_MODE.WORKSPACE,
      sessionId: null
    });
    this.jonController = controller;
    this.jonSessionId = session.id;
    this.controllers.set(session.id, controller);

    try {
      const result = await controller.openBrowserSession({ allowlistedHosts, headless: false });
      this.targetIndex.set(session.id, result.targetId);
      this.tracker.activate(session.id);
      this.#emit("workspace.browser.session.opened", {
        sessionId: session.id,
        projectId,
        runId: null,
        mode: BROWSER_MODE.WORKSPACE,
        headless: false,
        allowlistedHosts,
        persistent: true
      });
      return this.tracker.toPublicState(this.tracker.get(session.id));
    } catch (err) {
      this.tracker.error(session.id, err.message);
      this.controllers.delete(session.id);
      this.targetIndex.delete(session.id);
      this.jonSessionId = null;
      this.jonController = null;
      throw err;
    }
  }

  async createSession({ projectId, runId = null, mode = BROWSER_MODE.WORKSPACE, allowlistedHosts = [], headless = this.defaultHeadless, sessionId = null, persistent = false }) {
    // If persistent mode requested (or mode is WORKSPACE), reuse the JON session
    if (persistent || mode === BROWSER_MODE.WORKSPACE) {
      return this.getOrCreateJonSession({ projectId, allowlistedHosts });
    }

    const session = this.tracker.open({ projectId, runId, mode, sessionId });
    const controller = new BrowserController({ headless });
    this.controllers.set(session.id, controller);

    try {
      const result = await controller.openBrowserSession({ allowlistedHosts, headless });
      this.targetIndex.set(session.id, result.targetId);
      this.tracker.activate(session.id);
      this.#emit("workspace.browser.session.opened", {
        sessionId: session.id,
        projectId,
        runId,
        mode,
        headless,
        allowlistedHosts
      });
      return this.tracker.toPublicState(this.tracker.get(session.id));
    } catch (err) {
      this.tracker.error(session.id, err.message);
      this.controllers.delete(session.id);
      this.targetIndex.delete(session.id);
      throw err;
    }
  }

  async navigate(sessionId, url) {
    const { controller, targetId, session } = this.#resolve(sessionId);
    if (!session) throw new Error(`Unknown browser session: ${sessionId}`);

    try {
      const result = await controller.navigate(targetId, url);
      const title = await this.#getTitle(controller, targetId);
      let screenshotBase64 = null;
      try {
        screenshotBase64 = await controller.captureScreenshotBase64(targetId);
      } catch {
        // non-fatal — screenshot best-effort
      }
      this.tracker.recordNavigation(sessionId, { url: result.url, title, screenshotBase64 });
      this.#emit("workspace.browser.navigated", {
        sessionId,
        projectId: session.projectId,
        runId: session.runId,
        url: result.url,
        title,
        status: result.status
      });
      if (screenshotBase64) {
        this.#emit("workspace.browser.screenshot", {
          sessionId,
          projectId: session.projectId,
          runId: session.runId,
          screenshotBase64
        });
      }
      return { url: result.url, title, status: result.status, screenshotBase64 };
    } catch (err) {
      this.tracker.error(sessionId, err.message);
      throw err;
    }
  }

  async captureScreenshot(sessionId) {
    const { controller, targetId } = this.#resolve(sessionId);
    const screenshotBase64 = await controller.captureScreenshotBase64(targetId);
    this.tracker.updateScreenshot(sessionId, screenshotBase64);
    const session = this.tracker.get(sessionId);
    this.#emit("workspace.browser.screenshot", {
      sessionId,
      projectId: session?.projectId ?? null,
      runId: session?.runId ?? null,
      screenshotBase64
    });
    return screenshotBase64;
  }

  async getPageText(sessionId) {
    const { controller, targetId } = this.#resolve(sessionId);
    const snapshot = await controller.captureDomSnapshotForTarget(targetId);
    return {
      url: snapshot.url,
      title: snapshot.title,
      bodyText: snapshot.bodyText ?? "",
      interactiveElementCount: snapshot.interactiveElements?.length ?? 0
    };
  }

  async getDomSnapshot(sessionId) {
    const { controller, targetId } = this.#resolve(sessionId);
    return controller.captureDomSnapshotForTarget(targetId);
  }

  getCurrentState(sessionId) {
    const session = this.tracker.get(sessionId);
    return this.tracker.toPublicState(session);
  }

  getActiveSessionForProject(projectId) {
    // Prefer the JON persistent session if it's for this project or project matches
    const jonSession = this.getJonSession();
    if (jonSession) {
      return this.tracker.toPublicState(jonSession);
    }
    const session = this.tracker.getActiveByProject(projectId);
    return this.tracker.toPublicState(session);
  }

  async recordEvidence(sessionId, evidenceDir, label, extra = {}) {
    const { controller, targetId } = this.#resolve(sessionId);
    const session = this.tracker.get(sessionId);
    return controller.exportPageEvidence(targetId, evidenceDir, label, {
      ...extra,
      sessionId,
      projectId: session?.projectId ?? null,
      runId: session?.runId ?? null
    });
  }

  async closeSession(sessionId) {
    // Never close the JON persistent session via this path — it lives until explicit shutdown
    if (sessionId === this.jonSessionId) {
      return this.tracker.toPublicState(this.tracker.get(sessionId));
    }
    const controller = this.controllers.get(sessionId);
    const session = this.tracker.get(sessionId);
    if (!controller) return null;
    try {
      await controller.close();
    } catch {
      // best-effort close
    }
    this.controllers.delete(sessionId);
    this.targetIndex.delete(sessionId);
    const closed = this.tracker.close(sessionId);
    this.#emit("workspace.browser.session.closed", {
      sessionId,
      projectId: session?.projectId ?? null,
      runId: session?.runId ?? null
    });
    return this.tracker.toPublicState(closed);
  }

  async closeAllForProject(projectId) {
    const sessions = this.tracker.getByProject(projectId)
      .filter((s) => s.status !== BROWSER_SESSION_STATUS.CLOSED && s.id !== this.jonSessionId);
    for (const s of sessions) {
      await this.closeSession(s.id).catch(() => {});
    }
    this.tracker.cleanup(projectId);
  }

  async shutdownJonSession() {
    if (!this.jonSessionId) return;
    const sessionId = this.jonSessionId;
    const controller = this.jonController;
    this.jonSessionId = null;
    this.jonController = null;
    try {
      await controller?.close();
    } catch {
      // best-effort
    }
    this.controllers.delete(sessionId);
    this.targetIndex.delete(sessionId);
    const session = this.tracker.get(sessionId);
    const closed = this.tracker.close(sessionId);
    this.#emit("workspace.browser.session.closed", {
      sessionId,
      projectId: session?.projectId ?? null,
      runId: null
    });
    return this.tracker.toPublicState(closed);
  }

  #resolve(sessionId) {
    const controller = this.controllers.get(sessionId);
    const targetId = this.targetIndex.get(sessionId);
    const session = this.tracker.get(sessionId);
    if (!controller || !targetId) throw new Error(`Browser session not active: ${sessionId}`);
    return { controller, targetId, session };
  }

  async #getTitle(controller, targetId) {
    try {
      const state = await controller.getTargetState(targetId);
      return state.title ?? "";
    } catch {
      return "";
    }
  }

  #emit(type, payload) {
    if (this.onEvent) {
      try {
        this.onEvent({ type, payload, at: nowIso() });
      } catch {
        // never let event emission crash navigation
      }
    }
  }
}
