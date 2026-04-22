import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_HEADLESS,
  DEFAULT_TIMEOUT_MS,
  EVIDENCE_TYPE
} from "../config.js";
import { createId } from "../utils/ids.js";
import { captureDomSnapshot, inspectLocator, listInteractiveElements, rankCandidates } from "./dom-strategy.js";

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

export class BrowserController {
  constructor(options = {}) {
    this.headless = options.headless ?? DEFAULT_HEADLESS;
    this.channel = options.channel ?? DEFAULT_BROWSER_CHANNEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.browser = null;
    this.context = null;
    this.targets = new Map();
    this.activeTargetId = null;
    this.allowlistedHosts = [];
  }

  async openBrowserSession({ allowlistedHosts = [], headless = this.headless } = {}) {
    this.allowlistedHosts = allowlistedHosts;
    this.browser = await this.#launchBrowser(headless);
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 980 }
    });
    const page = await this.context.newPage();
    const targetId = this.#attachPage(page);
    await page.goto("about:blank");
    this.activeTargetId = targetId;
    return {
      targetId,
      headless,
      allowlistedHosts
    };
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
    this.targets.clear();
    this.activeTargetId = null;
  }

  listTargets() {
    return Array.from(this.targets.values()).map(({ id, page }) => ({
      id,
      url: page.url(),
      title: page.url() === "about:blank" ? "about:blank" : page.url()
    }));
  }

  async openTab(url = "about:blank") {
    const page = await this.context.newPage();
    const targetId = this.#attachPage(page);
    if (url !== "about:blank") {
      await this.navigate(targetId, url);
    }
    return targetId;
  }

  focusTab(targetId) {
    this.#getTarget(targetId);
    this.activeTargetId = targetId;
    return targetId;
  }

  async closeTab(targetId) {
    const target = this.#getTarget(targetId);
    await target.page.close();
    this.targets.delete(targetId);
    if (this.activeTargetId === targetId) {
      this.activeTargetId = this.targets.keys().next().value ?? null;
    }
  }

  async navigate(targetId, url) {
    if (!ensureAllowlisted(url, this.allowlistedHosts)) {
      throw new Error(`Target URL is not allowlisted: ${url}`);
    }
    const page = this.#getPage(targetId);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: this.timeoutMs
    });
    return {
      targetId,
      url: page.url(),
      status: response?.status() ?? null
    };
  }

  async waitForPageState(targetId, expectation = {}) {
    const page = this.#getPage(targetId);
    const state = expectation.state ?? "domcontentloaded";
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
    return {
      targetId,
      state,
      url: page.url()
    };
  }

  async captureDomSnapshotForTarget(targetId) {
    const page = this.#getPage(targetId);
    return captureDomSnapshot(page);
  }

  async queryDom(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const candidates = await listInteractiveElements(page);
    return rankCandidates(candidates, selectorSpec);
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
    return page.evaluate(() => ({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight
    }));
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
    await locator.click({ timeout: this.timeoutMs });
    return this.inspectElement(targetId, selectorSpec);
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
    return this.verifyOutcome(targetId, {
      type: "field_value",
      selector: selectorSpec,
      expectedValue: value
    });
  }

  async clearAndType(targetId, selectorSpec, value) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.fill(value);
    return this.verifyOutcome(targetId, {
      type: "field_value",
      selector: selectorSpec,
      expectedValue: value
    });
  }

  async selectOption(targetId, selectorSpec, optionValue) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    await locator.selectOption(optionValue);
    return this.verifyOutcome(targetId, {
      type: "field_value",
      selector: selectorSpec,
      expectedValue: optionValue
    });
  }

  async toggleCheckbox(targetId, selectorSpec, checked) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    const current = await locator.isChecked();
    if (current !== checked) {
      await locator.click();
    }
    return this.verifyOutcome(targetId, {
      type: "checkbox_checked",
      selector: selectorSpec,
      expectedChecked: checked
    });
  }

  async detectBlockers(targetId) {
    const page = this.#getPage(targetId);
    return page.evaluate(() => {
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
  }

  async handleModal(targetId, selectorSpec) {
    return this.clickElement(targetId, selectorSpec);
  }

  async extractTextContent(targetId, selectorSpec) {
    const page = this.#getPage(targetId);
    const locator = this.#locator(page, selectorSpec).first();
    return (await locator.innerText()).replace(/\s+/g, " ").trim();
  }

  async extractTextMap(targetId, fieldMap) {
    const entries = await Promise.all(Object.entries(fieldMap).map(async ([key, selectorSpec]) => {
      const value = await this.extractTextContent(targetId, selectorSpec);
      return [key, value];
    }));
    return Object.fromEntries(entries);
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
    return {
      targetId: newTargetId,
      url: absoluteUrl
    };
  }

  async getTargetMeta(targetId) {
    const page = this.#getPage(targetId);
    return {
      id: targetId,
      url: page.url(),
      title: await page.title()
    };
  }

  async verifyOutcome(targetId, expectation) {
    const page = this.#getPage(targetId);
    switch (expectation.type) {
      case "text_visible": {
        const locator = this.#locator(page, expectation.selector);
        const visible = await locator.first().isVisible().catch(() => false);
        const text = visible ? await locator.first().innerText().catch(() => "") : "";
        return {
          validated: visible && text.includes(expectation.expectedText),
          ambiguous: !visible,
          observed: text
        };
      }
      case "field_value": {
        const locator = this.#locator(page, expectation.selector);
        const value = await locator.first().inputValue().catch(() => null);
        return {
          validated: value === expectation.expectedValue,
          ambiguous: value == null,
          observed: value
        };
      }
      case "checkbox_checked": {
        const locator = this.#locator(page, expectation.selector);
        const checked = await locator.first().isChecked().catch(() => null);
        return {
          validated: checked === expectation.expectedChecked,
          ambiguous: checked == null,
          observed: checked
        };
      }
      case "url_includes": {
        const url = page.url();
        return {
          validated: url.includes(expectation.expectedValue),
          ambiguous: false,
          observed: url
        };
      }
      default:
        throw new Error(`Unsupported expectation type: ${expectation.type}`);
    }
  }

  async exportPageEvidence(targetId, evidenceDir, label, extra = {}) {
    const page = this.#getPage(targetId);
    const evidenceId = createId("ev");
    const screenshotPath = path.join(evidenceDir, `${label}-${evidenceId}.png`);
    const summaryPath = path.join(evidenceDir, `${label}-${evidenceId}.json`);
    const snapshot = await captureDomSnapshot(page);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await fs.writeFile(summaryPath, JSON.stringify({
      evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
      label,
      url: page.url(),
      snapshot,
      ...extra
    }, null, 2), "utf8");
    return {
      evidenceId,
      evidenceType: EVIDENCE_TYPE.PAGE_SCREENSHOT,
      screenshotPath,
      summaryPath,
      snapshot
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

  #attachPage(page) {
    const id = createId("target");
    this.targets.set(id, { id, page });
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
