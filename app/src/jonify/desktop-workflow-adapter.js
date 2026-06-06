import fs from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "../config.js";
import { createId } from "../utils/ids.js";

function inputSelector(input = {}) {
  if (input.selector) return input.selector;
  if (input.preferredSelector) return input.preferredSelector;
  if (input.testId) return `automationId=${input.testId}`;
  if (input.name) return `name=${input.name}`;
  throw new Error("Desktop workflow input has no UIA selector.");
}

export class DesktopWorkflowAdapter {
  constructor({
    provider,
    windowId,
    manifest = {},
    evidenceDir = null
  } = {}) {
    if (!provider) throw new Error("DesktopWorkflowAdapter requires a desktop provider.");
    if (!windowId) throw new Error("DesktopWorkflowAdapter requires a windowId.");
    this.provider = provider;
    this.windowId = String(windowId);
    this.manifest = manifest;
    this.evidenceDir = evidenceDir ?? path.join(DATA_ROOT, "jonify", "live-desktop-evidence");
    this.captureIndex = 0;
  }

  async navigate(target) {
    return this.click(target);
  }

  async click(selector) {
    const invoked = await this.provider.invokeUiElement(this.windowId, selector);
    return { ok: invoked?.ok !== false, invoked };
  }

  async type(selector, value) {
    const updated = await this.provider.setUiValue(this.windowId, selector, String(value ?? ""));
    return { ok: updated?.ok !== false, updated };
  }

  async fillInputs(inputs = [], values = {}) {
    const filled = [];
    for (const input of inputs) {
      const name = input.name;
      if (!name || values[name] == null) continue;
      const selector = inputSelector(input);
      const updated = await this.provider.setUiValue(this.windowId, selector, String(values[name]));
      const ok = updated?.ok !== false;
      filled.push({ name, selector, ok });
      if (!ok) {
        return { ok: false, filled, error: `UIA ValuePattern failed for input: ${name}` };
      }
    }
    return { ok: true, filled };
  }

  async capture(label = "jonify-desktop-step") {
    this.captureIndex += 1;
    await fs.mkdir(this.evidenceDir, { recursive: true });
    const evidenceId = createId("ev");
    const safeLabel = `${label}-${String(this.captureIndex).padStart(2, "0")}-${evidenceId}`
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
    const snapshot = await this.provider.captureWindow(this.windowId);
    let screenshotPath = null;
    if (snapshot?.outputPath) {
      const extension = [".png", ".jpg", ".jpeg"].includes(path.extname(snapshot.outputPath).toLowerCase())
        ? path.extname(snapshot.outputPath).toLowerCase()
        : ".jpg";
      screenshotPath = path.join(this.evidenceDir, `${safeLabel}${extension}`);
      await fs.copyFile(snapshot.outputPath, screenshotPath);
    }
    const summaryPath = path.join(this.evidenceDir, `${safeLabel}.json`);
    await fs.writeFile(summaryPath, JSON.stringify({
      evidenceId,
      capturedAt: new Date().toISOString(),
      jonifyAppId: this.manifest.app?.id ?? null,
      windowId: this.windowId,
      screenshotPath,
      snapshot
    }, null, 2), "utf8");
    return {
      ok: true,
      path: screenshotPath,
      summaryPath,
      evidenceId
    };
  }

  async close() {}
}

export function createDesktopWorkflowAdapter(options = {}) {
  return new DesktopWorkflowAdapter(options);
}
