import fs from "node:fs/promises";
import path from "node:path";
import { BrowserController } from "../browser/browser-controller.js";
import { DATA_ROOT } from "../config.js";

function normalizeHost(host) {
  return String(host ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function hostFromUrl(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function attrSelector(name, value) {
  const escaped = String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[${name}="${escaped}"]`;
}

export function inferBrowserAllowlistedHosts(manifest = {}, startUrl = null, extraHosts = []) {
  const hosts = [
    hostFromUrl(startUrl),
    hostFromUrl(manifest.app?.baseUrl),
    ...(Array.isArray(extraHosts) ? extraHosts.map(normalizeHost) : [])
  ].filter(Boolean);
  return Array.from(new Set(hosts));
}

export function selectorToBrowserSpec(selector) {
  if (!selector) {
    throw new Error("Browser workflow adapter requires a selector for this action.");
  }
  if (typeof selector === "object") {
    return selector;
  }
  const raw = String(selector).trim();
  const testIdMatch = raw.match(/^\[data-testid=(["'])(.+?)\1\]$/i);
  if (testIdMatch) {
    return { testId: testIdMatch[2] };
  }
  return { css: raw };
}

export function inputToBrowserSelector(input = {}) {
  if (input.selector) {
    return selectorToBrowserSpec(input.selector);
  }
  if (input.testId) {
    return { testId: input.testId };
  }
  if (input.name) {
    return { css: attrSelector("name", input.name) };
  }
  if (input.placeholder) {
    return { css: attrSelector("placeholder", input.placeholder) };
  }
  throw new Error(`Cannot resolve browser selector for input: ${input.name ?? input.placeholder ?? "unknown"}`);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function resolveNavigationTarget(target, baseUrl) {
  const raw = String(target ?? "").trim();
  if (!raw) {
    throw new Error("Browser workflow navigation requires a URL.");
  }
  if (isHttpUrl(raw)) {
    return raw;
  }
  if (raw.startsWith("/") && baseUrl) {
    return new URL(raw, baseUrl).toString();
  }
  return null;
}

export class BrowserWorkflowAdapter {
  constructor({
    browserController = null,
    targetId = null,
    manifest = {},
    startUrl = null,
    allowlistedHosts = null,
    headless = true,
    evidenceDir = null,
    closeOnFinish = true,
    ownsController = false
  } = {}) {
    this.controller = browserController ?? new BrowserController({ headless });
    this.targetId = targetId;
    this.manifest = manifest;
    this.startUrl = startUrl ?? manifest.app?.baseUrl ?? null;
    this.allowlistedHosts = Array.isArray(allowlistedHosts)
      ? allowlistedHosts
      : inferBrowserAllowlistedHosts(manifest, this.startUrl);
    this.headless = headless;
    this.evidenceDir = evidenceDir ?? path.join(DATA_ROOT, "jonify", "live-browser-evidence");
    this.closeOnFinish = closeOnFinish;
    this.ownsController = ownsController || !browserController;
    this.started = Boolean(targetId && this.controller?.isOpen?.());
    this.captureIndex = 0;
  }

  async start() {
    if (this.started) {
      this.controller.allowlistedHosts = this.allowlistedHosts;
    } else {
      const session = await this.controller.openBrowserSession({
        allowlistedHosts: this.allowlistedHosts,
        headless: this.headless
      });
      this.targetId = session.targetId;
      this.started = true;
    }

    if (this.startUrl) {
      const current = await this.controller.getTargetState(this.targetId).catch(() => null);
      if (!current?.url || current.url === "about:blank" || current.url !== this.startUrl) {
        await this.controller.navigate(this.targetId, this.startUrl);
      }
    }
    return { ok: true, targetId: this.targetId };
  }

  async navigate(target) {
    await this.start();
    const resolvedUrl = resolveNavigationTarget(target, this.manifest.app?.baseUrl ?? this.startUrl);
    if (!resolvedUrl) {
      return this.click(target);
    }
    const navigation = await this.controller.navigate(this.targetId, resolvedUrl);
    await this.controller.waitForPageStable(this.targetId).catch(() => {});
    return { ok: true, navigation };
  }

  async click(selector) {
    await this.start();
    const selectorSpec = selectorToBrowserSpec(selector);
    const click = await this.controller.clickElement(this.targetId, selectorSpec);
    const pageStable = await this.controller.waitForPageStable(this.targetId).catch((error) => ({
      ok: false,
      error: error.message
    }));
    return { ok: true, click, pageStable };
  }

  async type(selector, value) {
    await this.start();
    const selectorSpec = selectorToBrowserSpec(selector);
    const typed = await this.controller.clearAndType(this.targetId, selectorSpec, String(value ?? ""));
    return { ok: typed?.validated !== false, typed };
  }

  async fillInputs(inputs = [], values = {}) {
    await this.start();
    const filled = [];
    for (const input of inputs) {
      const name = input.name;
      if (!name || values[name] == null) {
        continue;
      }
      const selectorSpec = inputToBrowserSelector(input);
      const typed = await this.controller.clearAndType(this.targetId, selectorSpec, String(values[name]));
      filled.push({ name, ok: typed?.validated !== false });
      if (typed?.validated === false) {
        return { ok: false, filled, error: `Input did not validate after typing: ${name}` };
      }
    }
    return { ok: true, filled };
  }

  async capture(label = "jonify-workflow-step") {
    await this.start();
    this.captureIndex += 1;
    await fs.mkdir(this.evidenceDir, { recursive: true });
    const safeLabel = `${label}-${String(this.captureIndex).padStart(2, "0")}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const evidence = await this.controller.exportPageEvidence(this.targetId, this.evidenceDir, safeLabel, {
      jonifyAppId: this.manifest.app?.id ?? null,
      jonifyWorkflow: true
    });
    return {
      ok: true,
      path: evidence.screenshotPath,
      summaryPath: evidence.summaryPath,
      evidenceId: evidence.evidenceId
    };
  }

  async close() {
    if (this.closeOnFinish && this.ownsController) {
      await this.controller.close().catch(() => {});
    }
  }
}

export function createBrowserWorkflowAdapter(options = {}) {
  return new BrowserWorkflowAdapter({
    ...options,
    ownsController: options.ownsController ?? !options.browserController
  });
}
