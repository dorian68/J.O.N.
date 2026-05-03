import { createHash } from "node:crypto";
import { createId, nowIso } from "../utils/ids.js";

function hashValue(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 16);
}

function compactText(value, maxLength = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function interactiveSignature(elements = []) {
  return elements
    .slice(0, 20)
    .map((element) => [
      element.testId,
      element.id,
      element.role,
      element.tagName,
      compactText(element.text ?? element.label ?? element.ariaLabel, 60),
      element.hidden ? "hidden" : "visible",
      element.disabled ? "disabled" : "enabled"
    ].filter(Boolean).join(":"))
    .join("|");
}

function summarizeVisualFrame(screenshotBase64 = null, { retainScreenshotBase64 = false } = {}) {
  if (!screenshotBase64) {
    return {
      hasScreenshot: false,
      screenshotHash: null,
      byteLength: 0
    };
  }
  return {
    hasScreenshot: true,
    screenshotHash: hashValue(screenshotBase64),
    byteLength: Buffer.byteLength(screenshotBase64, "base64"),
    screenshotBase64: retainScreenshotBase64 ? screenshotBase64 : undefined
  };
}

function summarizeTarget(target = null, snapshot = null, blocker = null, visual = null) {
  if (!target && !snapshot) {
    return null;
  }
  const interactiveElements = snapshot?.interactiveElements ?? [];
  const bodyText = snapshot?.bodyText ?? "";
  return {
    targetId: target?.id ?? null,
    url: snapshot?.url ?? target?.url ?? null,
    title: snapshot?.title ?? target?.title ?? null,
    loadingState: target?.loadingState ?? null,
    blocker: blocker ?? target?.blocker ?? null,
    bodyTextLength: bodyText.length,
    bodyTextHash: hashValue(bodyText),
    bodyPreview: compactText(bodyText, 260),
    interactiveElementCount: interactiveElements.length || target?.detectedInteractiveElementCount || 0,
    interactiveSignatureHash: hashValue(interactiveSignature(interactiveElements)),
    visual: visual ?? {
      hasScreenshot: false,
      screenshotHash: null,
      byteLength: 0
    }
  };
}

function summarizeSession(session = null) {
  if (!session) {
    return {
      sessionId: null,
      activeTargetId: null,
      targetCount: 0,
      targets: []
    };
  }
  return {
    sessionId: session.sessionId ?? null,
    activeTargetId: session.activeTargetId ?? null,
    targetCount: session.targetCount ?? session.targets?.length ?? 0,
    targets: (session.targets ?? []).slice(0, 6).map((target) => ({
      targetId: target.id,
      url: target.url ?? null,
      title: target.title ?? null,
      loadingState: target.loadingState ?? null
    }))
  };
}

function blockerSignature(blocker = null) {
  if (!blocker) {
    return "none";
  }
  return JSON.stringify({
    blocked: Boolean(blocker.blocked),
    reason: compactText(blocker.reason, 180)
  });
}

function diffSignals(before = null, after = null) {
  if (!before || !after) {
    return [];
  }
  const reasons = [];
  if (before.session?.targetCount !== after.session?.targetCount) {
    reasons.push("target_count_changed");
  }
  if (before.session?.activeTargetId !== after.session?.activeTargetId) {
    reasons.push("active_target_changed");
  }
  if (before.activeTarget?.url !== after.activeTarget?.url) {
    reasons.push("url_changed");
  }
  if (before.activeTarget?.title !== after.activeTarget?.title) {
    reasons.push("title_changed");
  }
  if (before.activeTarget?.loadingState !== after.activeTarget?.loadingState) {
    reasons.push("loading_state_changed");
  }
  if (before.activeTarget?.bodyTextHash !== after.activeTarget?.bodyTextHash) {
    reasons.push("dom_changed");
  }
  if (before.activeTarget?.interactiveSignatureHash !== after.activeTarget?.interactiveSignatureHash) {
    reasons.push("interactive_elements_changed");
  }
  if (before.activeTarget?.visual?.screenshotHash !== after.activeTarget?.visual?.screenshotHash) {
    reasons.push("visual_changed");
  }
  if (blockerSignature(before.activeTarget?.blocker) !== blockerSignature(after.activeTarget?.blocker)) {
    reasons.push("blocker_changed");
  }
  return reasons;
}

export class BrowserRunWatcher {
  constructor({
    browser,
    intervalMs = 500,
    maxChanges = 24,
    includeDom = true,
    detectBlockers = true,
    includeScreenshot = true,
    retainScreenshotBase64 = false,
    screenshotWidth = 480
  } = {}) {
    if (!browser) {
      throw new Error("BrowserRunWatcher requires a BrowserController-compatible browser.");
    }
    this.browser = browser;
    this.intervalMs = intervalMs;
    this.maxChanges = maxChanges;
    this.includeDom = includeDom;
    this.detectBlockers = detectBlockers;
    this.includeScreenshot = includeScreenshot;
    this.retainScreenshotBase64 = retainScreenshotBase64;
    this.screenshotWidth = screenshotWidth;
    this.active = false;
    this.baseline = null;
    this.changes = [];
    this.timer = null;
    this.polling = false;
  }

  async start({ targetId = null } = {}) {
    if (this.active) {
      return this.baseline;
    }
    this.active = true;
    this.baseline = await this.#observe({ targetId });
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        this.checkNow({ targetId }).catch(() => {});
      }, this.intervalMs);
      this.timer.unref?.();
    }
    return this.baseline;
  }

  async stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkNow({ targetId = null } = {}) {
    if (!this.active || this.polling) {
      return [];
    }
    this.polling = true;
    try {
      const after = await this.#observe({ targetId });
      const reasons = diffSignals(this.baseline, after);
      if (reasons.length === 0) {
        this.baseline = after;
        return [];
      }
      const change = {
        id: createId("browser_watch"),
        detectedAt: nowIso(),
        reasons,
        before: this.baseline,
        after
      };
      this.changes.push(change);
      if (this.changes.length > this.maxChanges) {
        this.changes = this.changes.slice(-this.maxChanges);
      }
      this.baseline = after;
      return [change];
    } finally {
      this.polling = false;
    }
  }

  consumeChanges() {
    const output = [...this.changes];
    this.changes = [];
    return output;
  }

  async #observe({ targetId = null } = {}) {
    const session = await this.browser.getSessionState?.().catch(() => null);
    const sessionSummary = summarizeSession(session);
    const activeTargetId = targetId
      ?? sessionSummary.activeTargetId
      ?? this.browser.activeTargetId
      ?? this.browser.listTargets?.()?.[0]?.id
      ?? null;
    const target = activeTargetId
      ? (session?.targets ?? []).find((candidate) => candidate.id === activeTargetId)
        ?? await this.browser.getTargetState?.(activeTargetId).catch(() => null)
      : null;
    const snapshot = activeTargetId && this.includeDom
      ? await this.browser.captureDomSnapshotForTarget?.(activeTargetId).catch(() => null)
      : null;
    const blocker = activeTargetId && this.detectBlockers
      ? await this.browser.detectBlockers?.(activeTargetId).catch(() => target?.blocker ?? null)
      : target?.blocker ?? null;
    const screenshotBase64 = activeTargetId && this.includeScreenshot
      ? await this.browser.captureScreenshotBase64?.(activeTargetId, { width: this.screenshotWidth }).catch(() => null)
      : null;
    const visual = summarizeVisualFrame(screenshotBase64, {
      retainScreenshotBase64: this.retainScreenshotBase64
    });
    return {
      capturedAt: nowIso(),
      session: sessionSummary,
      activeTarget: summarizeTarget(target, snapshot, blocker, visual)
    };
  }
}

export function diffBrowserRunWatcherSignals(before, after) {
  return diffSignals(before, after);
}
