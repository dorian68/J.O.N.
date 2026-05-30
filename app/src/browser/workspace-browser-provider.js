import path from "node:path";
import os from "node:os";
import { BrowserController } from "./browser-controller.js";
import { BROWSER_MODE, BROWSER_SESSION_STATUS, BrowserSessionTracker } from "./browser-mode.js";
import { createId, nowIso } from "../utils/ids.js";

const JON_PROFILE_DIR = process.env.COWORK_JON_BROWSER_PROFILE_DIR
  ?? path.join(os.homedir(), ".cowork", "jon-browser-profile");

const TAB_AUTOMATION_ACTIONS = Object.freeze([
  "observeTab",
  "screenshotTab",
  "clickElement",
  "typeText",
  "pressKey",
  "scrollTab",
  "extractText",
  "waitForSelector",
  "evaluateScript",
  "cdpCommand"
]);

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
    const sessionId = this.jonSessionId;
    const session = this.tracker.get(this.jonSessionId);
    if (!session || session.status === BROWSER_SESSION_STATUS.CLOSED) {
      this.#discardSession(sessionId);
      return null;
    }
    if (!this.jonController?.isOpen()) {
      this.#discardSession(sessionId);
      return null;
    }
    return session;
  }

  // Creates (or reuses) the persistent JON browser session
  async getOrCreateJonSession({ projectId, runId = null, allowlistedHosts = [] } = {}) {
    const existing = this.getJonSession();
    if (existing) {
      // Update allowlist on the controller
      if (allowlistedHosts.length > 0) {
        this.jonController.allowlistedHosts = allowlistedHosts;
      }
      // Clear stale blocker state and navigate to blank if current page is off
      // the new run's allowlist — prevents contamination across runs
      const targetId = this.targetIndex.get(existing.id);
      if (targetId) {
        await this.jonController.softResetForRun(targetId, allowlistedHosts).catch(() => {});
      }
      existing.projectId = projectId ?? existing.projectId;
      existing.runId = runId ?? existing.runId;
      existing.lastActivityAt = nowIso();
      this.#emit("workspace.browser.session.reused", {
        sessionId: existing.id,
        projectId: existing.projectId,
        runId: existing.runId,
        mode: BROWSER_MODE.WORKSPACE,
        allowlistedHosts,
        persistent: true
      });
      return this.tracker.toPublicState(existing);
    }

    const controller = new BrowserController({
      headless: false,
      userDataDir: JON_PROFILE_DIR
    });
    const session = this.tracker.open({
      projectId,
      runId,
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
        runId,
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
      return this.getOrCreateJonSession({ projectId, runId, allowlistedHosts });
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

  async getControlState(projectId) {
    const session = this.getActiveSessionForProject(projectId);
    if (!session?.id) {
      return {
        surface: "browser",
        active: false,
        session: null,
        screenshotBase64: null,
        currentUrl: null,
        currentTitle: null
      };
    }
    let screenshotBase64 = session.screenshotBase64 ?? null;
    if (!screenshotBase64) {
      screenshotBase64 = await this.captureScreenshot(session.id).catch(() => null);
    }
    const current = this.getCurrentState(session.id);
    return {
      surface: "browser",
      active: Boolean(current),
      session: current,
      screenshotBase64: current?.screenshotBase64 ?? screenshotBase64,
      currentUrl: current?.currentUrl ?? null,
      currentTitle: current?.currentTitle ?? null
    };
  }

  async executeControlAction(projectId, action = {}) {
    const actionType = String(action.type ?? action.action ?? "").trim();
    if (!actionType) {
      throw Object.assign(new Error("Control action type required."), { code: "INVALID_PARAMS" });
    }

    if (actionType === "openSession") {
      const session = await this.getOrCreateJonSession({ projectId, allowlistedHosts: action.allowlistedHosts ?? [] });
      const state = await this.getControlState(projectId);
      return { action: actionType, result: { sessionId: session?.id ?? null }, state };
    }

    let session = this.getActiveSessionForProject(projectId);
    if (!session?.id && ["navigate", "capture"].includes(actionType)) {
      session = await this.getOrCreateJonSession({ projectId, allowlistedHosts: action.allowlistedHosts ?? [] });
    }
    if (!session?.id) {
      throw Object.assign(new Error("No active browser surface. Open the browser first."), { code: "NO_ACTIVE_SURFACE" });
    }

    const { controller, targetId } = this.#resolve(session.id);
    if (Array.isArray(action.allowlistedHosts)) {
      controller.allowlistedHosts = action.allowlistedHosts;
    }
    let result;
    switch (actionType) {
    case "capture":
      result = { screenshotBase64: await this.captureScreenshot(session.id) };
      break;
    case "navigate":
      result = await this.navigate(session.id, action.url);
      break;
    case "clickAt":
      result = await controller.clickAt(targetId, {
        x: action.x,
        y: action.y,
        normalized: action.normalized !== false
      });
      break;
    case "typeText":
      result = await controller.typeIntoActive(targetId, action.text ?? "");
      break;
    case "pressKey":
      result = await controller.pressKey(targetId, action.key);
      break;
    case "scroll":
      result = await controller.scrollViewport(targetId, { deltaY: action.deltaY ?? 640 });
      break;
    case "back":
      result = await controller.goBack(targetId);
      break;
    case "forward":
      result = await controller.goForward(targetId);
      break;
    case "reload":
      result = await controller.reload(targetId);
      break;
    default:
      throw Object.assign(new Error(`Unsupported control action: ${actionType}`), { code: "UNKNOWN_CONTROL_ACTION" });
    }

    if (!["capture", "navigate"].includes(actionType)) {
      await controller.waitForPageStable(targetId, { timeoutMs: 1800, settleMs: 80 }).catch(() => {});
    }
    const state = await this.#refreshControlState(session.id);
    this.#emit("workspace.browser.control_action", {
      sessionId: session.id,
      projectId,
      runId: state.session?.runId ?? null,
      action: actionType,
      url: state.currentUrl,
      title: state.currentTitle
    });
    return { action: actionType, result, state };
  }

  async getTabsState(projectId) {
    const session = this.getActiveSessionForProject(projectId);
    if (!session?.id) {
      return {
        active: false,
        session: null,
        tabs: []
      };
    }
    try {
      const { controller } = this.#resolve(session.id);
      if (!controller.isOpen()) {
        this.#discardSession(session.id);
        return { active: false, session: null, tabs: [] };
      }
      return {
        active: true,
        session: this.tracker.toPublicState(this.tracker.get(session.id)),
        tabs: controller.listTargets().map((tab) => ({
          ...tab,
          automation: {
            controlled: true,
            protocol: "playwright_cdp",
            actions: [...TAB_AUTOMATION_ACTIONS]
          }
        })),
        automation: {
          controlled: true,
          protocol: "playwright_cdp",
          persistent: session.id === this.jonSessionId || Boolean(controller.userDataDir),
          actions: [...TAB_AUTOMATION_ACTIONS]
        }
      };
    } catch {
      return { active: false, session: null, tabs: [] };
    }
  }

  async executeTabAction(projectId, action = {}) {
    const actionType = String(action.type ?? action.action ?? "").trim();
    const LIFECYCLE_ACTIONS = new Set(["openTab", "focusTab", "closeTab", "navigateTab", "reloadTab"]);
    const AGENTIC_ACTIONS = new Set([
      "observeTab", "screenshotTab",
      "clickElement", "typeText", "pressKey", "scrollTab",
      "extractText", "waitForSelector",
      "evaluateScript", "cdpCommand"
    ]);
    if (!LIFECYCLE_ACTIONS.has(actionType) && !AGENTIC_ACTIONS.has(actionType)) {
      throw Object.assign(new Error(`Unsupported tab action: ${actionType || "missing"}`), { code: "UNKNOWN_TAB_ACTION" });
    }

    let session = this.getActiveSessionForProject(projectId);

    // Detect dead context — tracker still shows session active but Playwright closed it
    if (session?.id) {
      const existingController = this.controllers.get(session.id);
      if (existingController && !existingController.isOpen()) {
        this.#discardSession(session.id);
        session = null;
      }
    }

    if (!session?.id) {
      if (actionType !== "openTab") {
        throw Object.assign(new Error("Le navigateur JON a été fermé. Ouvre un onglet pour le relancer."), { code: "NO_ACTIVE_SURFACE" });
      }
      try {
        session = await this.getOrCreateJonSession({ projectId, allowlistedHosts: action.allowlistedHosts ?? [] });
      } catch (err) {
        if (WorkspaceBrowserProvider.#isBrowserClosedError(err) && !action._retriedAfterBrowserClosed) {
          return this.executeTabAction(projectId, {
            ...action,
            _retriedAfterBrowserClosed: true
          });
        }
        throw err;
      }
    }
    const { controller } = this.#resolve(session.id);
    if (Array.isArray(action.allowlistedHosts)) {
      controller.allowlistedHosts = action.allowlistedHosts;
    }

    // Resolve the target for this action
    const resolveTarget = (fallbackToActive = true) => {
      const tid = action.targetId || (fallbackToActive ? controller.activeTargetId : null);
      if (!tid) throw Object.assign(new Error("targetId is required for this action."), { code: "INVALID_PARAMS" });
      return tid;
    };

    let result;

    try {

    // ── Lifecycle actions ─────────────────────────────────────────────────────
    if (actionType === "openTab") {
      const url = action.url || "about:blank";
      const currentTargets = controller.listTargets();
      const reusableBlankTarget = currentTargets.length === 1 && currentTargets[0]?.url === "about:blank"
        ? currentTargets[0]
        : null;

      if (reusableBlankTarget) {
        const targetId = reusableBlankTarget.id;
        controller.focusTab(targetId);
        this.targetIndex.set(session.id, targetId);
        if (url !== "about:blank") {
          const navigation = await controller.navigate(targetId, url);
          result = { targetId, reused: true, navigation };
        } else {
          result = { targetId, reused: true };
        }
      } else {
        const targetId = await controller.openTab(url);
        controller.focusTab(targetId);
        this.targetIndex.set(session.id, targetId);
        result = { targetId, reused: false };
      }
    } else if (actionType === "focusTab") {
      const tid = resolveTarget(false);
      controller.focusTab(tid);
      this.targetIndex.set(session.id, tid);
      result = { targetId: tid };
    } else if (actionType === "closeTab") {
      const tid = resolveTarget(false);
      await controller.closeTab(tid);
      if (controller.activeTargetId) this.targetIndex.set(session.id, controller.activeTargetId);
      result = { targetId: tid, closed: true };
    } else if (actionType === "navigateTab") {
      const tid = resolveTarget();
      controller.focusTab(tid);
      this.targetIndex.set(session.id, tid);
      result = await controller.navigate(tid, action.url);
    } else if (actionType === "reloadTab") {
      const tid = resolveTarget();
      result = await controller.reload(tid);
    }

    // ── Agentic observation + interaction actions ─────────────────────────────
    else if (actionType === "observeTab") {
      const tid = resolveTarget();
      const [snapshot, screenshotBase64] = await Promise.all([
        controller.captureDomSnapshotForTarget(tid),
        controller.captureScreenshotBase64(tid).catch(() => null)
      ]);
      const blockers = await controller.detectBlockers(tid).catch(() => ({ blocked: false }));
      result = {
        targetId: tid,
        url: snapshot.url,
        title: snapshot.title,
        bodyText: (snapshot.bodyText ?? "").slice(0, 8000),
        bodyTextLength: snapshot.bodyText?.length ?? 0,
        interactiveElementCount: snapshot.interactiveElements?.length ?? 0,
        interactiveElements: (snapshot.interactiveElements ?? []).slice(0, 30),
        blocker: blockers,
        screenshotBase64,
        observedAt: nowIso()
      };
      this.tracker.updateScreenshot(session.id, screenshotBase64 ?? null);
    } else if (actionType === "screenshotTab") {
      const tid = resolveTarget();
      const screenshotBase64 = await controller.captureScreenshotBase64(tid);
      this.tracker.updateScreenshot(session.id, screenshotBase64);
      result = { targetId: tid, screenshotBase64, capturedAt: nowIso() };
    } else if (actionType === "clickElement") {
      const tid = resolveTarget();
      if (!action.selector) throw Object.assign(new Error("clickElement requires selector."), { code: "INVALID_PARAMS" });
      const click = await controller.clickElement(tid, action.selector);
      await controller.waitForPageStable(tid, { timeoutMs: 2000, settleMs: 80 }).catch(() => {});
      result = { targetId: tid, click, url: (await controller.getTargetState(tid).catch(() => null))?.url ?? null };
    } else if (actionType === "typeText") {
      const tid = resolveTarget();
      const text = String(action.text ?? action.value ?? "").slice(0, 4000);
      if (!text) throw Object.assign(new Error("typeText requires text."), { code: "INVALID_PARAMS" });
      if (action.selector) {
        result = await controller.clearAndType(tid, action.selector, text);
      } else {
        result = await controller.typeIntoActive(tid, text);
      }
    } else if (actionType === "pressKey") {
      const tid = resolveTarget();
      if (!action.key) throw Object.assign(new Error("pressKey requires key."), { code: "INVALID_PARAMS" });
      result = await controller.pressKey(tid, action.key);
      await controller.waitForPageStable(tid, { timeoutMs: 1500, settleMs: 80 }).catch(() => {});
    } else if (actionType === "scrollTab") {
      const tid = resolveTarget();
      const deltaY = Number(action.deltaY ?? action.delta ?? 640);
      result = await controller.scrollViewport(tid, { deltaY: Number.isFinite(deltaY) ? deltaY : 640 });
    } else if (actionType === "extractText") {
      const tid = resolveTarget();
      if (action.fieldMap && typeof action.fieldMap === "object") {
        result = { targetId: tid, extracted: await controller.extractTextMap(tid, action.fieldMap) };
      } else if (action.selector) {
        const text = await controller.extractTextContent(tid, action.selector);
        result = { targetId: tid, extracted: { text }, selector: action.selector };
      } else {
        const snapshot = await controller.captureDomSnapshotForTarget(tid);
        result = { targetId: tid, extracted: { text: (snapshot.bodyText ?? "").slice(0, 12000) }, url: snapshot.url, title: snapshot.title };
      }
    } else if (actionType === "waitForSelector") {
      const tid = resolveTarget();
      if (!action.selector) throw Object.assign(new Error("waitForSelector requires selector."), { code: "INVALID_PARAMS" });
      await controller.waitForPageState(tid, { selector: action.selector, state: action.state ?? "visible" });
      result = { targetId: tid, selector: action.selector, found: true };
    } else if (actionType === "evaluateScript") {
      const tid = resolveTarget();
      result = await controller.evaluateScript(tid, {
        expression: action.expression,
        arg: action.arg ?? null
      });
    } else if (actionType === "cdpCommand") {
      const tid = resolveTarget();
      result = await controller.dispatchCdpCommand(tid, {
        method: action.method,
        params: action.params ?? {}
      });
    }

    } catch (err) {
      // Playwright context died mid-action — reset state so next openTab recreates cleanly
      if (WorkspaceBrowserProvider.#isBrowserClosedError(err)) {
        this.#discardSession(session.id);
        if (actionType === "openTab" && !action._retriedAfterBrowserClosed) {
          return this.executeTabAction(projectId, {
            ...action,
            _retriedAfterBrowserClosed: true
          });
        }
        throw Object.assign(
          new Error("Le navigateur JON s'est fermé. Ouvre un nouvel onglet pour le relancer."),
          { code: "BROWSER_CLOSED", originalMessage: err.message }
        );
      }
      throw err;
    }

    await this.#refreshControlState(session.id).catch(() => null);
    this.#emit("workspace.browser.tabs_changed", {
      sessionId: session.id,
      projectId,
      action: actionType,
      targetId: result?.targetId ?? null
    });
    return {
      action: actionType,
      result,
      state: await this.getTabsState(projectId)
    };
  }

  // Detect if an error is a Playwright context/browser closure
  static #isBrowserClosedError(err) {
    const msg = err?.message ?? "";
    return (
      msg.includes("context or browser has been closed") ||
      msg.includes("browserContext.newPage") ||
      msg.includes("Target page, context") ||
      msg.includes("Browser has been closed") ||
      msg.includes("Browser context is not open") ||
      msg.includes("page.goto: Target closed")
    );
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

  getAutomationHandle(sessionId = null) {
    const resolvedSessionId = sessionId ?? this.jonSessionId;
    if (!resolvedSessionId) {
      return null;
    }
    const { controller, targetId, session } = this.#resolve(resolvedSessionId);
    return {
      session: this.tracker.toPublicState(session),
      controller,
      targetId,
      persistent: resolvedSessionId === this.jonSessionId || Boolean(controller.userDataDir)
    };
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

  async shutdownAllSessions() {
    const sessionIds = [...this.controllers.keys()];
    if (this.jonSessionId) {
      await this.shutdownJonSession().catch(() => {});
    }
    for (const sessionId of sessionIds) {
      if (this.controllers.has(sessionId)) {
        await this.closeSession(sessionId).catch(() => {});
      }
    }
  }

  #resolve(sessionId) {
    const controller = this.controllers.get(sessionId);
    if (controller && !controller.isOpen()) {
      this.#discardSession(sessionId);
      throw Object.assign(new Error(`Browser session not active: ${sessionId}`), { code: "BROWSER_CLOSED" });
    }
    const targetId = controller?.activeTargetId ?? this.targetIndex.get(sessionId);
    if (controller?.activeTargetId) {
      this.targetIndex.set(sessionId, controller.activeTargetId);
    }
    const session = this.tracker.get(sessionId);
    if (!controller || !targetId) throw new Error(`Browser session not active: ${sessionId}`);
    return { controller, targetId, session };
  }

  #discardSession(sessionId) {
    if (!sessionId) return;
    if (sessionId === this.jonSessionId) {
      this.jonSessionId = null;
      this.jonController = null;
    }
    this.controllers.delete(sessionId);
    this.targetIndex.delete(sessionId);
    const session = this.tracker.get(sessionId);
    if (session && session.status !== BROWSER_SESSION_STATUS.CLOSED) {
      this.tracker.close(sessionId);
    }
  }

  async #getTitle(controller, targetId) {
    try {
      const state = await controller.getTargetState(targetId);
      return state.title ?? "";
    } catch {
      return "";
    }
  }

  async #refreshControlState(sessionId) {
    const { controller, targetId, session } = this.#resolve(sessionId);
    const targetState = await controller.getTargetState(targetId).catch(() => null);
    const screenshotBase64 = await controller.captureScreenshotBase64(targetId).catch(() => null);
    if (targetState?.url || screenshotBase64) {
      this.tracker.recordNavigation(sessionId, {
        url: targetState?.url ?? session?.currentUrl ?? "about:blank",
        title: targetState?.title ?? session?.currentTitle ?? "",
        screenshotBase64
      });
    }
    if (screenshotBase64) {
      this.#emit("workspace.browser.screenshot", {
        sessionId,
        projectId: session?.projectId ?? null,
        runId: session?.runId ?? null,
        screenshotBase64
      });
    }
    const current = this.tracker.toPublicState(this.tracker.get(sessionId));
    return {
      surface: "browser",
      active: Boolean(current),
      session: current,
      screenshotBase64: current?.screenshotBase64 ?? screenshotBase64,
      currentUrl: current?.currentUrl ?? null,
      currentTitle: current?.currentTitle ?? null
    };
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
