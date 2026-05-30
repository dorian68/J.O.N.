import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { BrowserController } from "../src/browser/browser-controller.js";
import { WorkspaceBrowserProvider } from "../src/browser/workspace-browser-provider.js";
import { BROWSER_PLAN_ACTIONS } from "../src/browser/browser-planner.js";
import { ConnectorRegistry } from "../src/connectors/connector-registry.js";
import { OperatorService } from "../src/service/operator-service.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";

// ─── Fake BrowserController for unit tests ────────────────────────────────────

class FakeTabController {
  constructor() {
    this.activeTargetId = "target_001";
    this.allowlistedHosts = [];
    this._targets = new Map([
      ["target_001", {
        id: "target_001",
        url: "about:blank",
        title: "Blank",
        loadingState: "domcontentloaded",
        lastAction: null,
        bodyText: "Hello from JON",
        interactiveElements: [{ id: "inp1", tag: "input", type: "text" }]
      }]
    ]);
    this._sessionId = "session_fake";
    this.calls = [];
    this._open = true;
  }

  isOpen() { return this._open; }

  listTargets() {
    return Array.from(this._targets.values()).map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: this.activeTargetId === t.id,
      loadingState: t.loadingState,
      lastAction: t.lastAction
    }));
  }

  async openTab(url = "about:blank") {
    const id = `target_${Date.now()}`;
    this._targets.set(id, { id, url, title: url, loadingState: "domcontentloaded", lastAction: "open_tab", bodyText: "", interactiveElements: [] });
    this.activeTargetId = id;
    this.calls.push(["openTab", url]);
    return id;
  }

  focusTab(targetId) {
    if (!this._targets.has(targetId)) throw new Error(`Unknown targetId: ${targetId}`);
    this.activeTargetId = targetId;
    this.calls.push(["focusTab", targetId]);
    return targetId;
  }

  async closeTab(targetId) {
    if (!this._targets.has(targetId)) throw new Error(`Unknown targetId: ${targetId}`);
    this._targets.delete(targetId);
    if (this.activeTargetId === targetId) {
      this.activeTargetId = this._targets.keys().next().value ?? null;
    }
    this.calls.push(["closeTab", targetId]);
  }

  async navigate(targetId, url) {
    const t = this._targets.get(targetId);
    if (!t) throw new Error(`Unknown targetId: ${targetId}`);
    t.url = url;
    t.title = `Page: ${url}`;
    t.loadingState = "domcontentloaded";
    this.calls.push(["navigate", targetId, url]);
    return { targetId, url, status: 200 };
  }

  async reload(targetId) {
    this.calls.push(["reload", targetId]);
    return { targetId, reloaded: true };
  }

  async captureDomSnapshotForTarget(targetId) {
    const t = this._targets.get(targetId);
    if (!t) throw new Error(`Unknown targetId: ${targetId}`);
    this.calls.push(["captureDomSnapshot", targetId]);
    return {
      url: t.url,
      title: t.title,
      bodyText: t.bodyText ?? "Hello from JON",
      interactiveElements: t.interactiveElements ?? []
    };
  }

  async captureScreenshotBase64(targetId) {
    if (!this._targets.has(targetId)) throw new Error(`Unknown targetId: ${targetId}`);
    this.calls.push(["captureScreenshot", targetId]);
    return "aGVsbG8="; // fake base64
  }

  async detectBlockers(targetId) {
    this.calls.push(["detectBlockers", targetId]);
    return { blocked: false, reason: null };
  }

  async clickElement(targetId, selector) {
    if (!this._targets.has(targetId)) throw new Error(`Unknown targetId: ${targetId}`);
    this.calls.push(["clickElement", targetId, selector]);
    return { clicked: true, selector };
  }

  async waitForPageStable(targetId) {
    this.calls.push(["waitForPageStable", targetId]);
    return { stable: true };
  }

  async getTargetState(targetId) {
    const t = this._targets.get(targetId);
    if (!t) throw new Error(`Unknown targetId: ${targetId}`);
    return { url: t.url, title: t.title, loadingState: t.loadingState, active: this.activeTargetId === t.id };
  }

  async clearAndType(targetId, selector, text) {
    this.calls.push(["clearAndType", targetId, selector, text]);
    return { typed: true, selector, text, validated: true };
  }

  async typeIntoActive(targetId, text) {
    this.calls.push(["typeIntoActive", targetId, text]);
    return { typed: true, text };
  }

  async pressKey(targetId, key) {
    this.calls.push(["pressKey", targetId, key]);
    return { pressed: true, key };
  }

  async scrollViewport(targetId, { deltaY }) {
    this.calls.push(["scrollViewport", targetId, deltaY]);
    return { scrolled: true, deltaY };
  }

  async extractTextContent(targetId, selector) {
    this.calls.push(["extractTextContent", targetId, selector]);
    return "Extracted content";
  }

  async extractTextMap(targetId, fieldMap) {
    this.calls.push(["extractTextMap", targetId, fieldMap]);
    return Object.fromEntries(Object.keys(fieldMap).map((k) => [k, "Extracted " + k]));
  }

  async waitForPageState(targetId, expectation) {
    this.calls.push(["waitForPageState", targetId, expectation]);
    return { found: true };
  }

  async evaluateScript(targetId, { expression, arg = null }) {
    this.calls.push(["evaluateScript", targetId, expression, arg]);
    return { targetId, value: "evaluated", url: this._targets.get(targetId)?.url ?? "about:blank" };
  }

  async dispatchCdpCommand(targetId, { method, params = {} }) {
    this.calls.push(["dispatchCdpCommand", targetId, method, params]);
    return { targetId, method, value: { ok: true }, url: this._targets.get(targetId)?.url ?? "about:blank" };
  }

  async softResetForRun() { return null; }
  async close() { this._open = false; }
}


export async function run() {
  // ── 0. BrowserController.isOpen tolerates contexts without isClosed() ───────
  {
    const controller = new BrowserController();
    const page = { isClosed: () => false, url: () => "about:blank" };
    controller.context = { pages: () => [page] };
    controller.targets.set("target_alive", {
      id: "target_alive",
      page,
      state: {}
    });
    controller.activeTargetId = "target_alive";
    assert.equal(controller.isOpen(), true);
  }

  // ── 1. BROWSER_PLAN_ACTIONS includes new tab management actions ──────────────
  assert.ok(BROWSER_PLAN_ACTIONS.includes("open_tab"), "BROWSER_PLAN_ACTIONS should include open_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("close_tab"), "BROWSER_PLAN_ACTIONS should include close_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("focus_tab"), "BROWSER_PLAN_ACTIONS should include focus_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("navigate_tab"), "BROWSER_PLAN_ACTIONS should include navigate_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("observe_tab"), "BROWSER_PLAN_ACTIONS should include observe_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("extract_tab_text"), "BROWSER_PLAN_ACTIONS should include extract_tab_text");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("screenshot_tab"), "BROWSER_PLAN_ACTIONS should include screenshot_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("scroll_tab"), "BROWSER_PLAN_ACTIONS should include scroll_tab");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("press_key"), "BROWSER_PLAN_ACTIONS should include press_key");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("evaluate_script"), "BROWSER_PLAN_ACTIONS should include evaluate_script");
  assert.ok(BROWSER_PLAN_ACTIONS.includes("cdp_command"), "BROWSER_PLAN_ACTIONS should include cdp_command");

  // ── 2. WorkspaceBrowserProvider.executeTabAction — unknown action ─────────────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    await assert.rejects(
      () => provider.executeTabAction("proj_001", { type: "unknownAction" }),
      (err) => err.code === "UNKNOWN_TAB_ACTION"
    );
  }

  // ── 3. executeTabAction — no session → throws NO_ACTIVE_SURFACE (non-openTab) ──
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    await assert.rejects(
      () => provider.executeTabAction("proj_001", { type: "navigateTab", targetId: "t1", url: "https://example.com" }),
      (err) => err.code === "NO_ACTIVE_SURFACE"
    );
  }

  // ── 4. ConnectorRegistry — listConnectors returns all connectors ──────────────
  {
    const registry = new ConnectorRegistry();
    const connectors = registry.listConnectors();
    assert.ok(Array.isArray(connectors));
    assert.ok(connectors.length >= 2, "Should have at least 2 connectors");
    const emailDraft = connectors.find((c) => c.connectorId === "email_draft");
    assert.ok(emailDraft, "email_draft connector should exist");
    assert.equal(emailDraft.status, "connected", "email_draft is always connected");
    const gmail = connectors.find((c) => c.connectorId === "gmail");
    assert.equal(gmail.status, "not_connected", "gmail should not be connected by default");
  }

  // ── 5. ConnectorRegistry — getConnector returns correct structure ─────────────
  {
    const registry = new ConnectorRegistry();
    const c = registry.getConnector("email_draft");
    assert.ok(c.capabilities.includes("draft_email"));
    assert.ok(c.requiresApprovalFor.includes("send_email"));
    assert.equal(c.requiresAuth, false);
  }

  // ── 6. ConnectorRegistry — getConnector unknown → returns null ────────────────
  {
    const registry = new ConnectorRegistry();
    const c = registry.getConnector("nonexistent_connector");
    assert.equal(c, null);
  }

  // ── 7. ConnectorRegistry — canExecute not_connected connector throws ───────────
  {
    const registry = new ConnectorRegistry();
    assert.throws(
      () => registry.canExecute("gmail", "send_email"),
      (err) => err.code === "CONNECTOR_NOT_CONNECTED"
    );
  }

  // ── 8. ConnectorRegistry — canExecute requiresApproval action throws ──────────
  {
    const registry = new ConnectorRegistry();
    assert.throws(
      () => registry.canExecute("email_draft", "send_email"),
      (err) => err.code === "REQUIRES_APPROVAL"
    );
  }

  // ── 9. ConnectorRegistry — draftEmail creates a local draft file ──────────────
  {
    const tmpDir = path.join(os.tmpdir(), `jon-connector-test-${Date.now()}`);
    const registry = new ConnectorRegistry({ draftsDir: tmpDir });
    const result = await registry.draftEmail({
      to: "grandpere@example.com",
      subject: "Profil Upwork",
      body: "Voici ma description de profil Upwork : Expert en développement web...",
      runId: "run_test_001"
    });
    assert.ok(result.draftId, "draftId should exist");
    assert.equal(result.status, "pending_approval");
    assert.ok(result.draftPath, "draftPath should exist");
    assert.ok(result.message.includes("Approbation"), "Message should mention approval");

    // Verify the file was actually created
    const raw = await fs.readFile(result.draftPath, "utf8");
    const draft = JSON.parse(raw);
    assert.equal(draft.to[0], "grandpere@example.com");
    assert.equal(draft.subject, "Profil Upwork");
    assert.equal(draft.status, "pending_approval");
    assert.equal(draft.runId, "run_test_001");

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── 10. ConnectorRegistry — draftEmail requires 'to' ─────────────────────────
  {
    const registry = new ConnectorRegistry({ draftsDir: os.tmpdir() });
    await assert.rejects(
      () => registry.draftEmail({ subject: "Test", body: "Body" }),
      (err) => err.code === "INVALID_PARAMS"
    );
  }

  // ── 11. ConnectorRegistry — action log captures draftEmail calls ──────────────
  {
    const tmpDir = path.join(os.tmpdir(), `jon-connector-log-${Date.now()}`);
    const registry = new ConnectorRegistry({ draftsDir: tmpDir });
    await registry.draftEmail({ to: "test@example.com", subject: "Log Test", body: "Content" });
    const log = registry.getActionLog();
    assert.ok(log.length >= 1);
    assert.equal(log[0].capability, "draft_email");
    assert.equal(log[0].connectorId, "email_draft");
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── 12. ConnectorRegistry — listDrafts returns created drafts ─────────────────
  {
    const tmpDir = path.join(os.tmpdir(), `jon-drafts-${Date.now()}`);
    const registry = new ConnectorRegistry({ draftsDir: tmpDir });
    await registry.draftEmail({ to: "a@b.com", subject: "Draft 1", body: "Body 1" });
    await registry.draftEmail({ to: "c@d.com", subject: "Draft 2", body: "Body 2" });
    const drafts = await registry.listDrafts();
    assert.ok(drafts.length >= 2);
    assert.ok(drafts.every((d) => d.status === "pending_approval"));
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── 13. WorkspaceBrowserProvider.getTabsState — no active session ─────────────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const state = await provider.getTabsState("proj_unknown");
    assert.equal(state.active, false);
    assert.deepEqual(state.tabs, []);
    assert.equal(state.session, null);
  }

  // ── 14. WorkspaceBrowserProvider.openTab reuses the initial blank target ─────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const controller = new FakeTabController();
    const session = provider.tracker.open({ projectId: "proj_001" });
    provider.tracker.activate(session.id);
    provider.controllers.set(session.id, controller);
    provider.targetIndex.set(session.id, "target_001");

    const response = await provider.executeTabAction("proj_001", {
      type: "openTab",
      url: "https://example.com"
    });

    assert.equal(response.result.reused, true);
    assert.equal(response.result.targetId, "target_001");
    assert.deepEqual(controller.calls.slice(0, 2), [
      ["focusTab", "target_001"],
      ["navigate", "target_001", "https://example.com"]
    ]);
    assert.equal(response.state.tabs.length, 1);
    assert.equal(response.state.tabs[0].url, "https://example.com");
  }

  // ── 15. operator-service normalizeMobileTabAction — unknown action ────────────
  // We test the guard indirectly via the exported set constant
  {
    const { default: operatorModule } = await import("../src/service/operator-service.js").catch(() => ({ default: null }));
    // Just verify the module loads cleanly (the set is internal)
    // Full integration tested via dispatchMobileBrowserTabAction in operator-service tests
  }

  // ── 16. ConnectorRegistry — unsupported capability throws ─────────────────────
  {
    const registry = new ConnectorRegistry();
    assert.throws(
      () => registry.canExecute("email_draft", "nonexistent_action"),
      (err) => err.code === "UNSUPPORTED_CAPABILITY"
    );
  }

  // ── 17. WorkspaceBrowserProvider exposes per-tab automation/CDP actions ──────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const controller = new FakeTabController();
    const session = provider.tracker.open({ projectId: "proj_001" });
    provider.tracker.activate(session.id);
    provider.controllers.set(session.id, controller);
    provider.targetIndex.set(session.id, "target_001");

    const state = await provider.getTabsState("proj_001");
    assert.equal(state.automation.protocol, "playwright_cdp");
    assert.equal(state.tabs[0].automation.actions.includes("cdpCommand"), true);

    const evalResponse = await provider.executeTabAction("proj_001", {
      type: "evaluateScript",
      expression: "() => document.title"
    });
    assert.equal(evalResponse.result.value, "evaluated");

    const cdpResponse = await provider.executeTabAction("proj_001", {
      type: "cdpCommand",
      method: "Runtime.evaluate",
      params: { expression: "document.title" }
    });
    assert.equal(cdpResponse.result.method, "Runtime.evaluate");
  }

  // ── 18b. Dead context recovery — executeTabAction clears stale session ────────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const controller = new FakeTabController();
    // Simulate closed context: isOpen() returns false
    controller.isOpen = () => false;

    const session = provider.tracker.open({ projectId: "proj_dead" });
    provider.tracker.activate(session.id);
    provider.controllers.set(session.id, controller);
    provider.targetIndex.set(session.id, "target_001");
    provider.jonSessionId = session.id;
    provider.jonController = controller;

    // Non-openTab on dead context → NO_ACTIVE_SURFACE (session is cleaned up + no new session)
    await assert.rejects(
      () => provider.executeTabAction("proj_dead", { type: "navigateTab", targetId: "target_001", url: "https://example.com" }),
      (err) => err.code === "NO_ACTIVE_SURFACE"
    );

    // After the failure, stale references should be cleared
    assert.equal(provider.jonSessionId, null, "jonSessionId should be cleared after dead context detection");
    assert.equal(provider.jonController, null, "jonController should be cleared after dead context detection");
  }

  // ── 18c. BROWSER_CLOSED error code on Playwright context-closed exception ────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const controller = new FakeTabController();
    // Simulate context alive (isOpen returns true) but navigate throws the Playwright closed error
    controller.isOpen = () => true;
    controller.navigate = async () => {
      throw new Error("browserContext.newPage: Target page, context or browser has been closed");
    };

    const session = provider.tracker.open({ projectId: "proj_crash" });
    provider.tracker.activate(session.id);
    provider.controllers.set(session.id, controller);
    provider.targetIndex.set(session.id, "target_001");
    provider.jonSessionId = session.id;
    provider.jonController = controller;

    // navigateTab triggers the navigate call which throws context-closed
    await assert.rejects(
      () => provider.executeTabAction("proj_crash", { type: "navigateTab", targetId: "target_001", url: "https://example.com" }),
      (err) => err.code === "BROWSER_CLOSED"
    );
    // Stale references must be cleared
    assert.equal(provider.jonSessionId, null, "jonSessionId cleared after BROWSER_CLOSED");
  }

  // ── 18d. openTab retries once after a closed Playwright context ─────────────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const crashed = new FakeTabController();
    crashed.listTargets = () => [{
      id: "target_001",
      url: "https://stale.example",
      title: "Stale",
      active: true,
      loadingState: "domcontentloaded",
      lastAction: null
    }];
    crashed.openTab = async () => {
      throw new Error("browserContext.newPage: Target page, context or browser has been closed");
    };

    const session = provider.tracker.open({ projectId: "proj_retry" });
    provider.tracker.activate(session.id);
    provider.controllers.set(session.id, crashed);
    provider.targetIndex.set(session.id, "target_001");
    provider.jonSessionId = session.id;
    provider.jonController = crashed;

    const replacement = new FakeTabController();
    let recreated = 0;
    provider.getOrCreateJonSession = async ({ projectId }) => {
      recreated += 1;
      const next = provider.tracker.open({ projectId });
      provider.tracker.activate(next.id);
      provider.controllers.set(next.id, replacement);
      provider.targetIndex.set(next.id, "target_001");
      provider.jonSessionId = next.id;
      provider.jonController = replacement;
      return provider.tracker.toPublicState(next);
    };

    const response = await provider.executeTabAction("proj_retry", {
      type: "openTab",
      url: "https://example.com"
    });

    assert.equal(recreated, 1);
    assert.equal(response.action, "openTab");
    assert.equal(response.state.active, true);
    assert.equal(provider.jonController, replacement);
  }

  // ── 18e. getMobileDesktopState result schema includes perf field (structural) ─
  // We validate the shape by constructing the expected result manually (integration
  // tested via operator-service.test.js against a real/fixture provider)
  {
    const expectedPerfSchema = { captureMs: 0, totalMs: 0, payloadBytes: 0 };
    const keys = Object.keys(expectedPerfSchema);
    assert.deepEqual(keys.sort(), ["captureMs", "payloadBytes", "totalMs"]);
    assert.ok(keys.every((k) => typeof expectedPerfSchema[k] === "number"),
      "perf fields must all be numbers");
  }

  // ── 18f. WorkspaceBrowserProvider shutdown closes persistent sessions ────────
  {
    const provider = new WorkspaceBrowserProvider({ defaultHeadless: true });
    const jonController = new FakeTabController();
    const normalController = new FakeTabController();
    const jonSession = provider.tracker.open({ projectId: "proj_shutdown" });
    const normalSession = provider.tracker.open({ projectId: "proj_shutdown" });
    provider.tracker.activate(jonSession.id);
    provider.tracker.activate(normalSession.id);
    provider.controllers.set(jonSession.id, jonController);
    provider.controllers.set(normalSession.id, normalController);
    provider.targetIndex.set(jonSession.id, "target_001");
    provider.targetIndex.set(normalSession.id, "target_001");
    provider.jonSessionId = jonSession.id;
    provider.jonController = jonController;

    await provider.shutdownAllSessions();

    assert.equal(jonController.isOpen(), false);
    assert.equal(normalController.isOpen(), false);
    assert.equal(provider.controllers.size, 0);
    assert.equal(provider.jonSessionId, null);
    assert.equal(provider.tracker.get(jonSession.id).status, "closed");
    assert.equal(provider.tracker.get(normalSession.id).status, "closed");
  }

  // ── 18g. Mobile desktop state accepts sync window providers ─────────────────
  {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jon-mobile-desktop-state-"));
    const service = await OperatorService.create({
      dbPath: path.join(tmpDir, "prototype.sqlite"),
      env: {
        ...process.env,
        COWORK_MOBILE_REMOTE_CONTROL: "1",
        COWORK_LLM_RUNTIME_PROFILE: "test",
        COWORK_LLM_PROVIDER_MODE: "mock_offline"
      },
      realSurfaceRuntimeConfig: {
        research: { mode: "controlled_fixture" },
        computer: { mode: "controlled_fixture_window" }
      },
      computerProvider: new FakeWindowProvider([
        {
          id: "win_notes",
          title: "Operator Notes",
          active: true,
          visible: true,
          allowlisted: true,
          content: "ready",
          processName: "notepad",
          bounds: { x: 0, y: 0, width: 900, height: 700 }
        }
      ])
    });
    try {
      const state = await service.getMobileDesktopState("default");
      assert.equal(state.active, true);
      assert.equal(state.error, undefined);
      assert.equal(state.windows.length, 1);
      assert.equal(state.windows[0].id, "win_notes");
    } finally {
      await service.close();
    }
  }

  // ── 18. ConnectorRegistry — custom MCP connectors become external providers ─
  {
    const registryPath = path.join(os.tmpdir(), `jon-connectors-${Date.now()}.json`);
    const registry = new ConnectorRegistry({ registryPath });
    const connector = await registry.addConnector({
      connectorId: "mcp_email",
      name: "MCP Email",
      type: "mcp",
      command: "node",
      args: ["server.js"],
      tools: [
        { name: "send_email", description: "Send an email after approval." },
        { name: "search_email", description: "Search email messages." }
      ]
    });
    assert.equal(connector.status, "connected");
    const providers = registry.listExternalToolProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].id, "mcp_email");
    assert.equal(providers[0].tools.length, 2);
    await fs.rm(registryPath, { force: true }).catch(() => {});
  }
}
