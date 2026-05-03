import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_HEADLESS,
  DEFAULT_TIMEOUT_MS,
  EVIDENCE_TYPE
} from "../config.js";
import { createId, nowIso } from "../utils/ids.js";
import { captureDomSnapshot, inspectLocator, listInteractiveElements, rankCandidates } from "./dom-strategy.js";

const INTERACTIVE_SELECTOR = "a[href], button, input, select, textarea, [role='button'], [role='link']";

function hostnameFor(url) {
  const parsed = new URL(url);
  return parsed.hostname;
}

function ensureAllowlisted(url, allowlistedHosts = []) {
  if (url.startsWith("about:blank")) {
    return true;
  }
  return allowlistedHosts.includes(hostnameFor(url));
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
    this.browser = null;
    this.context = null;
    this.targets = new Map();
    this.activeTargetId = null;
    this.allowlistedHosts = [];
    this.sessionId = null;
    this.recentActions = [];
  }

  async openBrowserSession({ allowlistedHosts = [], headless = this.headless } = {}) {
    this.allowlistedHosts = allowlistedHosts;
    this.sessionId = createId("browser_session");
    if (this.userDataDir) {
      await this.#launchPersistentContext(headless);
    } else {
      this.browser = await this.#launchBrowser(headless);
      this.context = await this.browser.newContext({
        viewport: { width: 1440, height: 980 }
      });
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
      persistent: Boolean(this.userDataDir)
    }, {
      url: page.url()
    });
    return {
      sessionId: this.sessionId,
      targetId,
      headless,
      allowlistedHosts,
      persistent: Boolean(this.userDataDir)
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
    return Boolean(this.context) && this.targets.size > 0;
  }

  listTargets() {
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

  async detectBlockers(targetId) {
    const page = this.#getPage(targetId);
    const result = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("[data-blocking='true'], dialog[open], [role='dialog']"));
      const dialog = candidates.find((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      if (!dialog) {
        return {
          blocked: false,
          reason: null
        };
      }
      return {
        blocked: true,
        reason: (dialog.getAttribute("data-testid") || dialog.getAttribute("aria-label") || dialog.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160)
      };
    });
    await this.#refreshTargetMeta(targetId, {
      blocker: result,
      lastResult: result,
      lastError: null
    });
    this.#recordTargetAction(targetId, "detect_blockers", {}, result);
    return result;
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

  async #launchBrowser(headless) {
    const executablePath = chromium.executablePath();
    try {
      return await chromium.launch({
        headless,
        executablePath,
        args: ["--no-sandbox"]
      });
    } catch (error) {
      const message = error?.message ?? "Unknown launch error";
      throw new Error(`Failed to launch bundled Chromium: ${message}`);
    }
  }

  async #launchPersistentContext(headless) {
    const executablePath = chromium.executablePath();
    try {
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless,
        executablePath,
        args: ["--no-sandbox"],
        viewport: { width: 1440, height: 980 }
      });
    } catch (error) {
      const message = error?.message ?? "Unknown launch error";
      throw new Error(`Failed to launch persistent Chromium context: ${message}`);
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
    this.#recordSessionAction("attach_page", { targetId: id }, { url: page.url() });
    return id;
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
