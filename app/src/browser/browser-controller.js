import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_BROWSER_STEALTH,
  DEFAULT_HEADLESS,
  DEFAULT_TIMEOUT_MS,
  EVIDENCE_TYPE
} from "../config.js";
import { createId, nowIso } from "../utils/ids.js";
import { captureDomSnapshot, inspectLocator, listInteractiveElements, rankCandidates } from "./dom-strategy.js";
import { classifyBrowserBlockerSignal } from "./browser-blockers.js";

const INTERACTIVE_SELECTOR = "a[href], button, input, select, textarea, [role='button'], [role='link']";

const BLOCKED_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "blob"]);

const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
];

// Optional diagnostics/compatibility mode only. It is disabled by default
// because mutating browser APIs can make challenge outcomes harder to reason about.
const STEALTH_IGNORE_DEFAULT_ARGS = ["--enable-automation"];

// Injected before any page script when COWORK_BROWSER_STEALTH=1. This must not be
// used as a recovery path for anti-bot, CAPTCHA, or Cloudflare blockers.
const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) { window.chrome = { runtime: {} }; }
  const _plugins = [1, 2, 3]; _plugins.item = i => _plugins[i];
  Object.defineProperty(navigator, 'plugins', { get: () => _plugins });
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  try {
    const _q = window.navigator.permissions && window.navigator.permissions.query;
    if (_q) {
      window.navigator.permissions.query = (p) => (
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : _q(p)
      );
    }
  } catch (e) {}
  try {
    const _gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';            // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return _gp.call(this, p);
    };
  } catch (e) {}
`;

const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

function hostnameFor(url) {
  const parsed = new URL(url);
  return parsed.hostname;
}

function normalizeHost(host) {
  return String(host ?? "").toLowerCase().replace(/^www\./, "").trim();
}

// Returns true if url is allowed by the allowlistedHosts policy.
// If allowlistedHosts is empty, all https/http URLs are allowed (open mode).
// Blocked schemes (javascript:, data:, file:, etc.) are always refused.
function ensureAllowlisted(url, allowlistedHosts = []) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    return false; // unparseable URL always blocked
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) {
    return false;
  }

  if (!["http", "https"].includes(scheme)) {
    return false;
  }

  if (!Array.isArray(allowlistedHosts) || allowlistedHosts.length === 0) {
    return true; // open mode — no allowlist configured
  }

  const urlHost = normalizeHost(parsed.hostname);
  for (const entry of allowlistedHosts) {
    const allowed = normalizeHost(entry);
    if (!allowed) continue;
    // Exact match or subdomain match (e.g. allowed=google.com matches maps.google.com)
    if (urlHost === allowed || urlHost.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

function compactValue(value, maxLength = 900) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return null;
    }
    if (serialized.length > maxLength) {
      return {
        summary: serialized.slice(0, maxLength)
      };
    }
    return JSON.parse(serialized);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

export class BrowserController {
  constructor(options = {}) {
    this.headless = options.headless ?? DEFAULT_HEADLESS;
    this.channel = options.channel ?? DEFAULT_BROWSER_CHANNEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userDataDir = options.userDataDir ?? null;
    this.stealth = options.stealth ?? DEFAULT_BROWSER_STEALTH;
    this.browser = null;
    this.context = null;
    this.targets = new Map();
    this.activeTargetId = null;
    this.allowlistedHosts = [];
    this.sessionId = null;
    this.recentActions = [];
    this.persistentFallbackReason = null;
  }

  async openBrowserSession({ allowlistedHosts = [], headless = this.headless } = {}) {
    this.allowlistedHosts = allowlistedHosts;
    if (this.isOpen()) {
      const targetId = this.activeTargetId ?? this.targets.keys().next().value ?? null;
      if (!targetId) {
        throw new Error("Browser session is open but no target is attached.");
      }
      this.sessionId = this.sessionId ?? createId("browser_session");
      this.activeTargetId = targetId;
      const page = this.#getPage(targetId);
      this.#recordTargetAction(targetId, "reuse_browser_session", {
        headless,
        allowlistedHosts,
        persistent: Boolean(this.userDataDir)
      }, {
        url: page.url(),
        reused: true
      });
      return {
        sessionId: this.sessionId,
        targetId,
        headless,
        allowlistedHosts,
        persistent: Boolean(this.userDataDir),
        reused: true
      };
    }
    this.sessionId = createId("browser_session");
    this.targets.clear();
    this.activeTargetId = null;
    if (this.userDataDir) {
      try {
        await this.#launchPersistentContext(headless);
        this.persistentFallbackReason = null;
      } catch (error) {
        this.persistentFallbackReason = error.message;
        this.userDataDir = null;
        await this.#launchEphemeralContext(headless).catch((fallbackError) => {
          throw new Error(`${error.message}; fallback browser launch also failed: ${fallbackError.message}`);
        });
      }
    } else {
      await this.#launchEphemeralContext(headless);
    }
    if (this.stealth) {
      await this.context.addInitScript(STEALTH_INIT_SCRIPT);
    }
    const existingPages = this.context.pages();
    const page = existingPages[0] ?? await this.context.newPage();
    const targetId = this.#attachPage(page);
    if (page.url() === "about:blank" || !page.url()) {
      await page.goto("about:blank");
    }
    this.activeTargetId = targetId;
    this.#recordTargetAction(targetId, "open_browser_session", {
      headless,
      allowlistedHosts,
      persistent: Boolean(this.userDataDir),
      persistentFallbackReason: this.persistentFallbackReason
    }, {
      url: page.url()
    });
    return {
      sessionId: this.sessionId,
      targetId,
      headless,
      allowlistedHosts,
      persistent: Boolean(this.userDataDir),
      persistentFallbackReason: this.persistentFallbackReason
    };
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
    this.targets.clear();
    this.activeTargetId = null;
    this.sessionId = null;
    this.recentActions = [];
  }

  isOpen() {
    if (!this.context || this.targets.size === 0) return false;
    try {
      if (typeof this.context.isClosed === "function" && this.context.isClosed()) {
        return false;
      }
      if (this.browser && typeof this.browser.isConnected === "function" && !this.browser.isConnected()) {
        return false;
      }
      this.#pruneClosedTargets();
      return this.targets.size > 0;
    } catch {
      return false;
    }
  }

  listTargets() {
    this.#pruneClosedTargets();
    return Array.from(this.targets.values()).map(({ id, page, state }) => ({
      id,
      url: page.url(),
      title: state.title || (page.url() === "about:blank" ? "about:blank" : page.url()),
      active: this.activeTargetId === id,
      loadingState: state.loadingState,
      lastAction: state.lastAction
    }));
  }

  async getSessionState() {
    const targets = [];
    for (const { id } of this.targets.values()) {
      targets.push(await this.getTargetState(id));
    }
    return {
      sessionId: this.sessionId,
      activeTargetId: this.activeTargetId,
      allowlistedHosts: [...this.allowlistedHosts],
      targetCount: targets.length,
      targets,
      recentActions: [...this.recentActions]
    };
  }

  async getTargetState(targetId) {
    const target = this.#getTarget(targetId);
    await this.#refreshTargetMeta(targetId);
    return {
      ...target.state,
      active: this.activeTargetId === targetId,
      navigationHistory: [...target.state.navigationHistory],
      recentActions: [...target.state.recentActions]
    };
  }

  async openTab(url = "about:blank") {
    if (!this.isOpen()) {
      throw new Error("Browser context is not open.");
    }
    const page = await this.context.newPage();
    const targetId = this.#attachPage(page);
    if (url !== "about:blank") {
      await this.navigate(targetId, url);
    } else {
      this.#recordTargetAction(targetId, "open_tab", { url }, { url });
    }
    return targetId;
  }

  focusTab(targetId) {
    this.#getTarget(targetId);
    this.activeTargetId = targetId;
    this.#recordTargetAction(targetId, "focus_tab", {}, { activeTargetId: targetId });
    return targetId;
  }

  async closeTab(targetId) {
    const target = this.#getTarget(targetId);
    await target.page.close();
    this.targets.delete(targetId);
    if (this.activeTargetId === targetId) {
      this.activeTargetId = this.targets.keys().next().value ?? null;
    }
    this.#recordSessionAction("close_tab", { targetId }, { activeTargetId: this.activeTargetId });
  }

  async navigate(targetId, url) {
    if (!ensureAllowlisted(url, this.allowlistedHosts)) {
      this.#recordTargetAction(targetId, "navigate", { url }, null, `Target URL is not allowlisted: ${url}`);
      throw new Error(`Target URL is not allowlisted: ${url}`);
    }
    const page = this.#getPage(targetId);
    this.#updateTargetState(targetId, {
      loadingState: "loading"
    });
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs
      });
      const result = {
        targetId,
        url: page.url(),
        status: response?.status() ?? null
      };
      await this.#refreshTargetMeta(targetId, {
        loadingState: "domcontentloaded",
        lastResult: result,
        lastError: null
      });
      this.#appendNavigation(targetId, result);
      this.#recordTargetAction(targetId, "navigate", { url }, result);
      return result;
    } catch (error) {
      this.#updateTargetState(targetId, {
        loadingState: "error",
        lastError: error?.message ?? String(error)
      });
      this.#recordTargetAction(targetId, "navigate", { url }, null, error?.message ?? String(error));
      throw error;
    }
  }

  async waitForPageState(targetId, expectation = {}) {
    const page = this.#getPage(targetId);
    const state = expectation.state ?? "domcontentloaded";
    try {
      await page.waitForLoadState(state, {
        timeout: expectation.timeoutMs ?? this.timeoutMs
      });
      if (expectation.selector) {
        const locator = this.#locator(page, expectation.selector);
        await locator.first().waitFor({
          state: "visible",
          timeout: expectation.timeoutMs ?? this.timeoutMs
        });
      }
      const result = {
        targetId,
        state,
        url: page.url()
      };
      await this.#refreshTargetMeta(targetId, {
        loadingState: state,
        lastResult: result,
        lastError: null
      });
      this.#recordTargetAction(targetId, "wait_for_page_state", {
        state,
        selector: expectation.selector ?? null
      }, result);
      return result;
    } catch (error) {
      this.#updateTargetState(targetId, {
        loadingState: "error",
        lastError: error?.message ?? String(error)
      });
      this.#recordTargetAction(targetId, "wait_for_page_state", {
        state,
        selector: expectation.selector ?? null
      }, null, error?.message ?? String(error));
      throw error;
    }
  }

  async waitForPageStable(targetId, { timeoutMs = 3000, settleMs = 120 } = {}) {
    const page = this.#getPage(targetId);
    const startedAt = Date.now();
    const observedStates = [];
    for (const state of ["domcontentloaded", "load", "networkidle"]) {
      const remainingMs = Math.max(250, timeoutMs - (Date.now() - startedAt));
      try {
        await page.waitForLoadState(state, {
          timeout: Math.min(remainingMs, state === "networkidle" ? 900 : 1200)
        });
        observedStates.push(state);
      } catch {
        // Dynamic pages often never reach every Playwright load state. Keep the
        // latest observable URL/title instead of treating that as failure.
      }
    }
    await page.waitForTimeout(settleMs).catch(() => {});
    const result = {
      targetId,
      url: page.url(),
      title: await page.title().catch(() => page.url()),
      observedStates,
      waitedMs: Date.now() - startedAt
    };
    await this.#refreshTargetMeta(targetId, {
      loadingState: observedStates.at(-1) ?? "stable_poll",
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "wait_for_page_stable", { timeoutMs, settleMs }, result);
    return result;
  }

  async captureDomSnapshotForTarget(targetId) {
    const page = this.#getPage(targetId);
    const snapshot = await captureDomSnapshot(page);
    await this.#refreshTargetMeta(targetId, {
      lastSnapshotSummary: {
        title: snapshot.title,
        url: snapshot.url,
        bodyTextLength: snapshot.bodyText?.length ?? 0,
        interactiveElementCount: snapshot.interactiveElements?.length ?? 0
      },
      lastResult: {
        snapshotTitle: snapshot.title,
        interactiveElementCount: snapshot.interactiveElements?.length ?? 0
      },
      lastError: null
    });
    this.#recordTargetAction(targetId, "capture_dom_snapshot", {}, {
      interactiveElementCount: snapshot.interactiveElements?.length ?? 0
    });
    return snapshot;
  }

  async queryDom(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const candidates = await listInteractiveElements(page);
    const result = rankCandidates(candidates, selectorSpec);
    await this.#refreshTargetMeta(targetId, {
      detectedInteractiveElementCount: candidates.length,
      lastResult: {
        ambiguous: result.ambiguous,
        best: result.best ? {
          tagName: result.best.tagName,
          text: result.best.text,
          score: result.best.score
        } : null
      },
      lastError: null
    });
    this.#recordTargetAction(targetId, "query_dom", { selectorSpec }, {
      ambiguous: result.ambiguous,
      candidateCount: result.ranked.length
    });
    return result;
  }

  async resolveInteractiveElements(targetId, selectorSpec) {
    return this.queryDom(targetId, selectorSpec);
  }

  async inspectElement(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec);
    return inspectLocator(locator);
  }

  async scrollViewport(targetId, { deltaY = 640 } = {}) {
    const page = this.#getPage(targetId);
    await page.mouse.wheel(0, deltaY);
    const result = await page.evaluate(() => ({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight
    }));
    await this.#refreshTargetMeta(targetId, {
      viewport: result,
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "scroll_viewport", { deltaY }, result);
    return result;
  }

  async clickAt(targetId, { x, y, normalized = true } = {}) {
    const page = this.#getPage(targetId);
    const point = await this.#resolveViewportPoint(page, { x, y, normalized });
    await page.mouse.click(point.x, point.y);
    const result = {
      targetId,
      x: point.x,
      y: point.y,
      normalizedX: point.normalizedX,
      normalizedY: point.normalizedY,
      url: page.url()
    };
    await this.#refreshTargetMeta(targetId, {
      viewport: point.viewport,
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "click_at", {
      normalizedX: point.normalizedX,
      normalizedY: point.normalizedY
    }, result);
    return result;
  }

  async typeIntoActive(targetId, value) {
    const page = this.#getPage(targetId);
    const text = String(value ?? "");
    await page.keyboard.type(text, { delay: 12 });
    const result = {
      targetId,
      valueLength: text.length,
      url: page.url()
    };
    await this.#refreshTargetMeta(targetId, {
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "type_into_active", {
      valueLength: text.length
    }, result);
    return result;
  }

  async pressKey(targetId, key) {
    const page = this.#getPage(targetId);
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) {
      throw new Error("pressKey requires a key.");
    }
    await page.keyboard.press(normalizedKey);
    const result = {
      targetId,
      key: normalizedKey,
      url: page.url()
    };
    await this.#refreshTargetMeta(targetId, {
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "press_key", { key: normalizedKey }, result);
    return result;
  }

  async goBack(targetId) {
    const page = this.#getPage(targetId);
    const response = await page.goBack({ waitUntil: "domcontentloaded", timeout: this.timeoutMs }).catch(() => null);
    const result = {
      targetId,
      url: page.url(),
      status: response?.status?.() ?? null
    };
    await this.#refreshTargetMeta(targetId, {
      loadingState: "domcontentloaded",
      lastResult: result,
      lastError: null
    });
    this.#appendNavigation(targetId, result);
    this.#recordTargetAction(targetId, "go_back", {}, result);
    return result;
  }

  async goForward(targetId) {
    const page = this.#getPage(targetId);
    const response = await page.goForward({ waitUntil: "domcontentloaded", timeout: this.timeoutMs }).catch(() => null);
    const result = {
      targetId,
      url: page.url(),
      status: response?.status?.() ?? null
    };
    await this.#refreshTargetMeta(targetId, {
      loadingState: "domcontentloaded",
      lastResult: result,
      lastError: null
    });
    this.#appendNavigation(targetId, result);
    this.#recordTargetAction(targetId, "go_forward", {}, result);
    return result;
  }

  async reload(targetId) {
    const page = this.#getPage(targetId);
    const response = await page.reload({ waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    const result = {
      targetId,
      url: page.url(),
      status: response?.status() ?? null
    };
    await this.#refreshTargetMeta(targetId, {
      loadingState: "domcontentloaded",
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "reload", {}, result);
    return result;
  }

  async evaluateScript(targetId, { expression, arg = null } = {}) {
    // SECURITY (audit T3): arbitrary in-page JS is disabled unless explicitly
    // enabled. This is the hard backstop regardless of what a plan requests.
    if (process.env.JON_ENABLE_BROWSER_EVAL !== "true") {
      throw Object.assign(new Error("Browser script evaluation is disabled (set JON_ENABLE_BROWSER_EVAL=true to allow)."), { code: "BROWSER_EVAL_DISABLED" });
    }
    const page = this.#getPage(targetId);
    const source = String(expression ?? "").trim();
    if (!source) {
      throw new Error("evaluateScript requires a JavaScript expression.");
    }
    const value = await page.evaluate(async ({ source: scriptSource, arg: scriptArg }) => {
      const evaluated = (0, eval)(scriptSource);
      if (typeof evaluated === "function") {
        return await evaluated(scriptArg);
      }
      return evaluated;
    }, { source, arg });
    const result = {
      targetId,
      value: compactValue(value, 3000),
      url: page.url()
    };
    await this.#refreshTargetMeta(targetId, {
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "evaluate_script", {
      expressionLength: source.length,
      hasArg: arg != null
    }, result);
    return result;
  }

  async dispatchCdpCommand(targetId, { method, params = {} } = {}) {
    // SECURITY (audit T3): raw CDP commands bypass the URL allowlist and can do
    // almost anything; disabled unless explicitly enabled.
    if (process.env.JON_ENABLE_BROWSER_EVAL !== "true") {
      throw Object.assign(new Error("Raw CDP commands are disabled (set JON_ENABLE_BROWSER_EVAL=true to allow)."), { code: "BROWSER_CDP_DISABLED" });
    }
    const page = this.#getPage(targetId);
    const cdpMethod = String(method ?? "").trim();
    if (!cdpMethod) {
      throw new Error("dispatchCdpCommand requires a CDP method.");
    }
    const session = await this.context.newCDPSession(page);
    try {
      const value = await session.send(cdpMethod, params && typeof params === "object" ? params : {});
      const result = {
        targetId,
        method: cdpMethod,
        value: compactValue(value, 3000),
        url: page.url()
      };
      await this.#refreshTargetMeta(targetId, {
        lastResult: result,
        lastError: null
      });
      this.#recordTargetAction(targetId, "cdp_command", {
        method: cdpMethod,
        paramKeys: Object.keys(params ?? {}).slice(0, 20)
      }, result);
      return result;
    } finally {
      await session.detach().catch(() => {});
    }
  }

  async scrollIntoView(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.scrollIntoViewIfNeeded();
    return this.inspectElement(targetId, selectorSpec);
  }

  async clickElement(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    try {
      await locator.click({ timeout: this.timeoutMs });
      const result = await this.inspectElement(targetId, selectorSpec);
      await this.#refreshTargetMeta(targetId, {
        lastResult: result,
        lastError: null
      });
      this.#recordTargetAction(targetId, "click_element", { selectorSpec }, result);
      return result;
    } catch (error) {
      this.#recordTargetAction(targetId, "click_element", { selectorSpec }, null, error?.message ?? String(error));
      throw error;
    }
  }

  async clickInteractiveCandidate(targetId, candidate) {
    if (!Number.isInteger(candidate?.index)) {
      throw new Error("Resolved browser candidate does not include a stable interactive index.");
    }
    const page = this.#getPage(targetId);
    const locator = page.locator(INTERACTIVE_SELECTOR).nth(candidate.index);
    try {
      await locator.click({ timeout: this.timeoutMs });
      const result = {
        found: true,
        index: candidate.index,
        text: candidate.text ?? candidate.ariaLabel ?? candidate.label ?? "",
        role: candidate.role ?? null,
        testId: candidate.testId ?? null,
        id: candidate.id ?? null,
        visible: await locator.isVisible().catch(() => false),
        enabled: await locator.isEnabled().catch(() => false)
      };
      await this.#refreshTargetMeta(targetId, {
        lastResult: result,
        lastError: null
      });
      this.#recordTargetAction(targetId, "click_interactive_candidate", { candidate }, result);
      return result;
    } catch (error) {
      this.#recordTargetAction(targetId, "click_interactive_candidate", { candidate }, null, error?.message ?? String(error));
      throw error;
    }
  }

  async focusElement(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.focus();
    return this.inspectElement(targetId, selectorSpec);
  }

  async typeText(targetId, selectorSpec, value) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.type(value, { delay: 20 });
    const result = await this.verifyOutcome(targetId, {
      type: "field_value",
      selector: selectorSpec,
      expectedValue: value
    });
    this.#recordTargetAction(targetId, "type_text", {
      selectorSpec,
      valueLength: String(value ?? "").length
    }, result);
    return result;
  }

  async clearAndType(targetId, selectorSpec, value) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.fill(value);
    const result = await this.verifyOutcome(targetId, {
      type: "field_value",
      selector: selectorSpec,
      expectedValue: value
    });
    this.#recordTargetAction(targetId, "clear_and_type", {
      selectorSpec,
      valueLength: String(value ?? "").length
    }, result);
    return result;
  }

  async selectOption(targetId, selectorSpec, optionValue) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.selectOption(optionValue);
    const result = await this.verifyOutcome(targetId, {
      type: "field_value",
      selector: selectorSpec,
      expectedValue: optionValue
    });
    this.#recordTargetAction(targetId, "select_option", { selectorSpec, optionValue }, result);
    return result;
  }

  async toggleCheckbox(targetId, selectorSpec, checked) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    const current = await locator.isChecked();
    if (current !== checked) {
      await locator.click();
    }
    const result = await this.verifyOutcome(targetId, {
      type: "checkbox_checked",
      selector: selectorSpec,
      expectedChecked: checked
    });
    this.#recordTargetAction(targetId, "toggle_checkbox", { selectorSpec, checked }, result);
    return result;
  }

  // Clears stale blocker state from a previous run and navigates to about:blank if
  // the current page URL is not on the new run's allowlistedHosts. Call before
  // re-using a persistent session for a different mission.
  async softResetForRun(targetId, newAllowlistedHosts = []) {
    const target = this.targets.get(targetId);
    if (!target) return;
    // Always clear the in-memory blocker state from the previous run
    target.state.blocker = null;
    target.state.lastResult = null;
    target.state.lastError = null;
    // Navigate to blank only if the current page is off the new allowlist
    const currentUrl = target.page.url();
    if (currentUrl && currentUrl !== "about:blank") {
      let shouldReset = false;
      try {
        const hostname = new URL(currentUrl).hostname.toLowerCase().replace(/^www\./, "");
        shouldReset = newAllowlistedHosts.length > 0 && !newAllowlistedHosts.some((h) => {
          const norm = String(h).toLowerCase().replace(/^www\./, "").replace(/\s+/g, "-");
          return hostname === norm || hostname.endsWith(`.${norm}`) ||
            hostname.replace(/\.[^.]+$/, "") === norm;
        });
      } catch {
        shouldReset = true;
      }
      if (shouldReset) {
        try {
          await target.page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 4000 });
          target.state.blocker = null;
          target.state.url = "about:blank";
        } catch {
          // soft reset — ignore navigation errors
        }
      }
    }
  }

  async #readBlockerSignal(targetId) {
    const page = this.#getPage(targetId);
    return page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("[data-blocking='true'], dialog[open], [role='dialog']"));
      const dialog = candidates.find((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      return {
        url: window.location.href,
        title: document.title,
        bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000),
        dialogText: dialog
          ? (dialog.getAttribute("data-testid") || dialog.getAttribute("aria-label") || dialog.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500)
          : ""
      };
    });
  }

  async detectBlockers(targetId) {
    let classified = classifyBrowserBlockerSignal(await this.#readBlockerSignal(targetId));

    // Passive anti-bot interstitials (e.g. Cloudflare "Just a moment…") clear by
    // themselves in a few seconds with a real, non-automated-looking browser.
    // Wait and re-check before escalating to a manual handoff, so JON doesn't
    // pause on a challenge that would have resolved on its own.
    if (classified.blocked && classified.type === "captcha_or_automation_block") {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        let next;
        try {
          next = classifyBrowserBlockerSignal(await this.#readBlockerSignal(targetId));
        } catch {
          break; // navigation in progress (challenge likely clearing)
        }
        if (!next.blocked || next.type !== "captcha_or_automation_block") {
          classified = next;
          break;
        }
        classified = next;
      }
    }

    await this.#refreshTargetMeta(targetId, {
      blocker: classified,
      lastResult: classified,
      lastError: null
    });
    this.#recordTargetAction(targetId, "detect_blockers", {}, classified);
    return classified;
  }

  async handleModal(targetId, selectorSpec) {
    return this.clickElement(targetId, selectorSpec);
  }

  async extractTextContent(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    const result = (await locator.innerText()).replace(/\s+/g, " ").trim();
    this.#recordTargetAction(targetId, "extract_text_content", { selectorSpec }, {
      textLength: result.length
    });
    return result;
  }

  async extractTextMap(targetId, fieldMap) {
    const entries = await Promise.all(Object.entries(fieldMap).map(async ([key, selectorSpec]) => {
      const value = await this.extractTextContent(targetId, selectorSpec);
      return [key, value];
    }));
    return Object.fromEntries(entries);
  }

  async extractStructuredRows(targetId, artifact) {
    const page = this.#getPage(targetId);
    const result = await page.evaluate((candidateArtifact) => {
      const textFor = (element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
      const plan = candidateArtifact?.extractionPlan ?? {};
      const fields = Array.isArray(plan.fields) && plan.fields.length > 0 ? plan.fields : ["title", "url", "summary"];
      const rowSelectors = Array.isArray(plan.rowSelectors) && plan.rowSelectors.length > 0
        ? plan.rowSelectors
        : ["[data-capability-row]", "[data-result]", "article", "li", "tr"];
      const fieldSelectors = plan.fieldSelectors ?? {};
      const rows = [];
      const seen = new Set();
      for (const selector of rowSelectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          const key = textFor(element).slice(0, 300);
          if (!key || seen.has(key)) {
            continue;
          }
          seen.add(key);
          const row = {};
          for (const field of fields) {
            if (field === "url") {
              const link = element.querySelector("a[href]");
              if (link?.href) {
                row.url = link.href;
              }
              continue;
            }
            const selectors = Array.isArray(fieldSelectors[field]) ? fieldSelectors[field] : [];
            let value = "";
            for (const fieldSelector of selectors) {
              const target = element.querySelector(fieldSelector);
              value = textFor(target);
              if (value) {
                break;
              }
            }
            if (!value) {
              const dataTarget = element.querySelector(`[data-field="${field}"]`);
              value = textFor(dataTarget);
            }
            if (value) {
              row[field] = value.slice(0, 500);
            }
          }
          if (!row.summary) {
            row.summary = textFor(element).slice(0, 500);
          }
          if (row.title || row.url || row.summary) {
            rows.push(row);
          }
          if (rows.length >= (plan.maxRows ?? 25)) {
            break;
          }
        }
        if (rows.length >= (plan.maxRows ?? 25)) {
          break;
        }
      }
      const minimumRows = Number.isFinite(Number(plan.minimumRows)) ? Number(plan.minimumRows) : 1;
      return {
        status: rows.length >= minimumRows ? "pass" : "fail",
        rowCount: rows.length,
        minimumRows,
        rows,
        url: window.location.href,
        title: document.title
      };
    }, artifact);
    await this.#refreshTargetMeta(targetId, {
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "extract_structured_rows", {
      artifactKind: artifact?.artifactKind ?? null,
      candidateId: artifact?.candidateId ?? null
    }, {
      status: result.status,
      rowCount: result.rowCount,
      minimumRows: result.minimumRows
    });
    return {
      ...result,
      extractedAt: nowIso()
    };
  }

  async openLinkInNewTab(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    const href = await locator.getAttribute("href");
    if (!href) {
      throw new Error("Target link has no href.");
    }
    const absoluteUrl = new URL(href, page.url()).toString();
    const newTargetId = await this.openTab(absoluteUrl);
    const result = {
      targetId: newTargetId,
      url: absoluteUrl
    };
    this.#recordTargetAction(targetId, "open_link_in_new_tab", { selectorSpec }, result);
    return result;
  }

  async getTargetMeta(targetId) {
    const page = this.#getPage(targetId);
    const result = {
      id: targetId,
      url: page.url(),
      title: await page.title()
    };
    await this.#refreshTargetMeta(targetId, {
      lastResult: result,
      lastError: null
    });
    return result;
  }

  async verifyOutcome(targetId, expectation) {
    const page = this.#getPage(targetId);
    switch (expectation.type) {
      case "text_visible": {
        const locator = this.#locator(page, expectation.selector);
        const visible = await locator.first().isVisible().catch(() => false);
        const text = visible ? await locator.first().innerText().catch(() => "") : "";
        const result = {
          validated: visible && text.includes(expectation.expectedText),
          ambiguous: !visible,
          observed: text
        };
        this.#recordTargetAction(targetId, "verify_outcome", { expectation }, result);
        return result;
      }
      case "field_value": {
        const locator = this.#locator(page, expectation.selector);
        const value = await locator.first().inputValue().catch(() => null);
        const result = {
          validated: value === expectation.expectedValue,
          ambiguous: value == null,
          observed: value
        };
        this.#recordTargetAction(targetId, "verify_outcome", { expectation }, result);
        return result;
      }
      case "checkbox_checked": {
        const locator = this.#locator(page, expectation.selector);
        const checked = await locator.first().isChecked().catch(() => null);
        const result = {
          validated: checked === expectation.expectedChecked,
          ambiguous: checked == null,
          observed: checked
        };
        this.#recordTargetAction(targetId, "verify_outcome", { expectation }, result);
        return result;
      }
      case "url_includes": {
        const url = page.url();
        const result = {
          validated: url.includes(expectation.expectedValue),
          ambiguous: false,
          observed: url
        };
        this.#recordTargetAction(targetId, "verify_outcome", { expectation }, result);
        return result;
      }
      default:
        throw new Error(`Unsupported expectation type: ${expectation.type}`);
    }
  }

  async captureScreenshotBase64(targetId, { width = 480 } = {}) {
    const page = this.#getPage(targetId);
    const buf = await page.screenshot({ fullPage: false, type: "png", clip: width ? undefined : undefined });
    this.#recordTargetAction(targetId, "capture_screenshot", { width }, { byteLength: buf.length });
    return buf.toString("base64");
  }

  async exportPageEvidence(targetId, evidenceDir, label, extra = {}) {
    const page = this.#getPage(targetId);
    const evidenceId = createId("ev");
    const screenshotPath = path.join(evidenceDir, `${label}-${evidenceId}.png`);
    const summaryPath = path.join(evidenceDir, `${label}-${evidenceId}.json`);
    const snapshot = await captureDomSnapshot(page);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const browserState = await this.getTargetState(targetId);
    await fs.writeFile(summaryPath, JSON.stringify({
      evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
      label,
      url: page.url(),
      snapshot,
      browserState,
      ...extra
    }, null, 2), "utf8");
    this.#recordTargetAction(targetId, "export_page_evidence", { label }, {
      evidenceId,
      summaryPath,
      screenshotPath
    });
    return {
      evidenceId,
      evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
      screenshotPath,
      summaryPath,
      snapshot,
      browserState
    };
  }

  #stealthLaunchExtras() {
    return this.stealth ? { args: ["--no-sandbox", ...STEALTH_ARGS], ignoreDefaultArgs: STEALTH_IGNORE_DEFAULT_ARGS } : { args: ["--no-sandbox"] };
  }

  // Real installed Chrome (channel: "chrome") is far harder for bot-detection to
  // fingerprint than bundled Chromium, so we prefer it and fall back to bundled.
  async #launchBrowser(headless) {
    const extras = this.#stealthLaunchExtras();
    try {
      return await chromium.launch({ headless, channel: "chrome", ...extras });
    } catch {
      try {
        return await chromium.launch({ headless, executablePath: chromium.executablePath(), ...extras });
      } catch (error) {
        throw new Error(`Failed to launch browser (chrome + bundled): ${error?.message ?? "Unknown launch error"}`);
      }
    }
  }

  async #launchEphemeralContext(headless) {
    const browser = await this.#launchBrowser(headless);
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 980 },
        ...(this.stealth ? { userAgent: STEALTH_USER_AGENT } : {})
      });
      this.browser = browser;
      this.context = context;
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  async #launchPersistentContext(headless) {
    const extras = this.#stealthLaunchExtras();
    const baseOpts = {
      headless,
      viewport: { width: 1440, height: 980 },
      ...extras,
      ...(this.stealth ? { userAgent: STEALTH_USER_AGENT } : {})
    };
    // Prefer real Chrome; fall back to bundled Chromium if not installed.
    try {
      this.context = await chromium.launchPersistentContext(this.userDataDir, { channel: "chrome", ...baseOpts });
    } catch {
      try {
        this.context = await chromium.launchPersistentContext(this.userDataDir, { executablePath: chromium.executablePath(), ...baseOpts });
      } catch (error) {
        throw new Error(`Failed to launch persistent browser context (chrome + bundled): ${error?.message ?? "Unknown launch error"}`);
      }
    }
  }

  #attachPage(page) {
    const id = createId("target");
    this.targets.set(id, {
      id,
      page,
      state: {
        id,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        url: page.url(),
        title: "",
        loadingState: "attached",
        navigationHistory: [],
        recentActions: [],
        lastAction: null,
        lastResult: null,
        lastError: null,
        blocker: null,
        viewport: null,
        detectedInteractiveElementCount: 0,
        lastSnapshotSummary: null
      }
    });
    page.on?.("close", () => {
      this.targets.delete(id);
      if (this.activeTargetId === id) {
        this.activeTargetId = this.targets.keys().next().value ?? null;
      }
      this.#recordSessionAction("target_closed", { targetId: id }, { activeTargetId: this.activeTargetId });
    });
    this.#recordSessionAction("attach_page", { targetId: id }, { url: page.url() });
    return id;
  }

  #pruneClosedTargets() {
    for (const [id, target] of this.targets.entries()) {
      if (target.page?.isClosed?.()) {
        this.targets.delete(id);
        if (this.activeTargetId === id) {
          this.activeTargetId = this.targets.keys().next().value ?? null;
        }
      }
    }
  }

  #getTarget(targetId) {
    const target = this.targets.get(targetId);
    if (!target) {
      throw new Error(`Unknown target: ${targetId}`);
    }
    return target;
  }

  #getPage(targetId) {
    return this.#getTarget(targetId).page;
  }

  #updateTargetState(targetId, patch = {}) {
    const target = this.#getTarget(targetId);
    target.state = {
      ...target.state,
      ...patch,
      updatedAt: nowIso()
    };
  }

  async #refreshTargetMeta(targetId, patch = {}) {
    const page = this.#getPage(targetId);
    const title = await page.title().catch(() => "");
    this.#updateTargetState(targetId, {
      url: page.url(),
      title: title || page.url(),
      ...patch
    });
  }

  #appendNavigation(targetId, entry) {
    const target = this.#getTarget(targetId);
    const navigationHistory = [
      ...target.state.navigationHistory,
      {
        at: nowIso(),
        url: entry.url,
        status: entry.status ?? null
      }
    ].slice(-20);
    this.#updateTargetState(targetId, {
      navigationHistory
    });
  }

  #recordSessionAction(action, details = {}, result = null, error = null) {
    const record = {
      id: createId("browser_action"),
      at: nowIso(),
      action,
      targetId: details?.targetId ?? null,
      details: compactValue(details),
      result: compactValue(result),
      error: error ? String(error).slice(0, 500) : null
    };
    this.recentActions = [...this.recentActions, record].slice(-40);
    return record;
  }

  #recordTargetAction(targetId, action, details = {}, result = null, error = null) {
    const target = this.#getTarget(targetId);
    const record = this.#recordSessionAction(action, {
      ...details,
      targetId
    }, result, error);
    target.state.recentActions = [...target.state.recentActions, record].slice(-20);
    target.state.lastAction = record;
    target.state.lastResult = error ? null : compactValue(result);
    target.state.lastError = error ? String(error).slice(0, 500) : null;
    target.state.updatedAt = nowIso();
    return record;
  }

  #locator(page, selectorSpec) {
    if (selectorSpec.testId) {
      return page.getByTestId(selectorSpec.testId);
    }
    if (selectorSpec.role && selectorSpec.name) {
      return page.getByRole(selectorSpec.role, { name: selectorSpec.name });
    }
    if (selectorSpec.label) {
      return page.getByLabel(selectorSpec.label);
    }
    if (selectorSpec.text) {
      return page.getByText(selectorSpec.text, { exact: selectorSpec.exact ?? false });
    }
    if (selectorSpec.css) {
      return page.locator(selectorSpec.css);
    }
    throw new Error(`Unsupported selector specification: ${JSON.stringify(selectorSpec)}`);
  }

  async #resolveViewportPoint(page, { x, y, normalized = true } = {}) {
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth || document.documentElement.clientWidth || 1,
      height: window.innerHeight || document.documentElement.clientHeight || 1,
      scrollX: window.scrollX || 0,
      scrollY: window.scrollY || 0
    }));
    const rawX = Number(x);
    const rawY = Number(y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      throw new Error("clickAt requires numeric x and y.");
    }
    const resolvedX = normalized ? rawX * viewport.width : rawX;
    const resolvedY = normalized ? rawY * viewport.height : rawY;
    const clampedX = Math.max(0, Math.min(viewport.width - 1, resolvedX));
    const clampedY = Math.max(0, Math.min(viewport.height - 1, resolvedY));
    return {
      x: clampedX,
      y: clampedY,
      normalizedX: viewport.width > 0 ? clampedX / viewport.width : 0,
      normalizedY: viewport.height > 0 ? clampedY / viewport.height : 0,
      viewport
    };
  }

  async #findSystemBrowser() {
    const candidates = [
      process.env.COWORK_BROWSER_EXECUTABLE_PATH,
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue.
      }
    }
    return null;
  }
}
