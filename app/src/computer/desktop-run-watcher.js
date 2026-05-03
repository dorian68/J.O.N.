import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { nowIso } from "../utils/ids.js";

function hashValue(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 16);
}

async function hashCapturePayload(capture = null) {
  if (!capture) {
    return {
      hasScreenshot: false,
      screenshotHash: null,
      byteLength: 0,
      outputPath: null
    };
  }
  const outputPath = capture.outputPath ?? null;
  if (outputPath) {
    const buffer = await fs.readFile(outputPath).catch(() => null);
    if (buffer) {
      return {
        hasScreenshot: true,
        screenshotHash: createHash("sha1").update(buffer).digest("hex").slice(0, 16),
        byteLength: buffer.length,
        outputPath
      };
    }
  }
  const serialized = JSON.stringify(capture);
  return {
    hasScreenshot: Boolean(serialized),
    screenshotHash: serialized ? hashValue(serialized) : null,
    byteLength: Buffer.byteLength(serialized ?? "", "utf8"),
    outputPath
  };
}

function compactWindow(windowState = null) {
  if (!windowState) {
    return null;
  }
  return {
    id: windowState.id ?? null,
    title: windowState.title ?? null,
    processName: windowState.processName ?? null,
    bounds: windowState.bounds ?? null
  };
}

function compactWindows(windows = []) {
  return windows.map(compactWindow).filter((windowState) => windowState?.id);
}

function windowSignature(windows = []) {
  return compactWindows(windows)
    .map((windowState) => `${windowState.id}:${windowState.title ?? ""}`)
    .sort()
    .join("|");
}

function semanticTargetSignature(inspection = null) {
  return (inspection?.semanticTargets ?? [])
    .slice(0, 12)
    .map((target) => `${target.role ?? ""}:${target.label ?? ""}`)
    .sort()
    .join("|");
}

function activeContentSignature(inspection = null) {
  const content = String(inspection?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const blocker = String(inspection?.blocker ?? "");
  return `${content}|${blocker}|${semanticTargetSignature(inspection)}`;
}

function compareSnapshots(before = null, after = null) {
  if (!before || !after) {
    return { significant: false, reasons: [] };
  }
  const reasons = [];
  if (before.activeWindow?.id !== after.activeWindow?.id) {
    reasons.push("active_window_changed");
  } else if (before.activeWindow?.title !== after.activeWindow?.title) {
    reasons.push("active_window_title_changed");
  }
  if (before.visibleWindowSignature !== after.visibleWindowSignature) {
    reasons.push("visible_windows_changed");
  }
  if (before.activeContentSignature !== after.activeContentSignature) {
    reasons.push("active_content_changed");
  }
  if (before.activeVisual?.screenshotHash !== after.activeVisual?.screenshotHash) {
    reasons.push("visual_changed");
  }
  return {
    significant: reasons.length > 0,
    reasons
  };
}

export class DesktopRunWatcher {
  constructor({
    computer,
    intervalMs = 750,
    maxChanges = 20,
    includeScreenshot = true,
    retainScreenshotPath = false
  } = {}) {
    if (!computer) {
      throw new Error("DesktopRunWatcher requires a computer control service.");
    }
    this.computer = computer;
    this.intervalMs = Math.max(100, Number(intervalMs) || 750);
    this.maxChanges = Math.max(1, Number(maxChanges) || 20);
    this.includeScreenshot = includeScreenshot !== false;
    this.retainScreenshotPath = Boolean(retainScreenshotPath);
    this.timer = null;
    this.polling = false;
    this.pollPromise = null;
    this.stopped = true;
    this.sequence = 0;
    this.baseline = null;
    this.latest = null;
    this.changes = [];
  }

  async start() {
    if (!this.stopped) {
      return this.latest;
    }
    this.stopped = false;
    await this.markBaseline();
    this.timer = setInterval(() => {
      this.observeNow().catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
    return this.latest;
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async captureSnapshot() {
    const [activeWindow, visibleWindows] = await Promise.all([
      Promise.resolve(this.computer.detectActiveWindow()).catch(() => null),
      Promise.resolve(this.computer.listVisibleWindows()).catch(() => [])
    ]);
    const inspection = activeWindow?.id
      ? await this.computer.inspectVisibleUi(activeWindow.id).catch((error) => ({
        available: false,
        reason: error.message,
        semanticTargets: [],
        content: ""
      }))
      : null;
    const capture = activeWindow?.id && this.includeScreenshot
      ? await this.computer.captureWindow(activeWindow.id).catch(() => null)
      : null;
    const activeVisual = await hashCapturePayload(capture);
    if (!this.retainScreenshotPath && activeVisual) {
      activeVisual.outputPath = null;
    }
    return {
      schemaVersion: "desktop_run_watcher_snapshot_v1",
      sequence: ++this.sequence,
      capturedAt: nowIso(),
      activeWindow: compactWindow(activeWindow),
      visibleWindows: compactWindows(visibleWindows),
      visibleWindowSignature: windowSignature(visibleWindows),
      activeContentSignature: activeContentSignature(inspection),
      activeVisual,
      activeSemanticTargets: (inspection?.semanticTargets ?? []).slice(0, 12).map((target) => ({
        id: target.id ?? null,
        label: target.label ?? null,
        role: target.role ?? null
      })),
      activeInspectionAvailable: Boolean(inspection?.available ?? inspection?.accessibility?.available)
    };
  }

  async observeNow() {
    if (this.stopped) {
      return { snapshot: this.latest, change: null };
    }
    while (this.pollPromise) {
      await this.pollPromise.catch(() => null);
      if (this.stopped) {
        return { snapshot: this.latest, change: null };
      }
    }
    const pollPromise = this.#observeOnce();
    this.pollPromise = pollPromise;
    try {
      return await pollPromise;
    } finally {
      if (this.pollPromise === pollPromise) {
        this.pollPromise = null;
      }
    }
  }

  async #observeOnce() {
    this.polling = true;
    try {
      const snapshot = await this.captureSnapshot();
      const comparison = compareSnapshots(this.baseline, snapshot);
      this.latest = snapshot;
      if (comparison.significant) {
        const change = {
          schemaVersion: "desktop_run_watcher_change_v1",
          at: snapshot.capturedAt,
          sequence: snapshot.sequence,
          reasons: comparison.reasons,
          before: this.baseline,
          after: snapshot
        };
        this.changes.push(change);
        this.changes = this.changes.slice(-this.maxChanges);
        this.baseline = snapshot;
        return { snapshot, change };
      }
      return { snapshot, change: null };
    } finally {
      this.polling = false;
    }
  }

  async markBaseline() {
    while (this.pollPromise) {
      await this.pollPromise.catch(() => null);
    }
    const pollPromise = (async () => {
      const snapshot = await this.captureSnapshot();
      this.baseline = snapshot;
      this.latest = snapshot;
      this.changes = [];
      return snapshot;
    })();
    this.pollPromise = pollPromise;
    try {
      return await pollPromise;
    } finally {
      if (this.pollPromise === pollPromise) {
        this.pollPromise = null;
      }
    }
  }

  consumeChanges() {
    const consumed = this.changes;
    this.changes = [];
    return consumed;
  }

  getLatestSnapshot() {
    return this.latest;
  }
}
