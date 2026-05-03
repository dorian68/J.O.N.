import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserOperator } from "../src/browser/browser-operator.js";
import { BrowserRunWatcher } from "../src/browser/browser-run-watcher.js";

class FakeBrowserSurface {
  constructor() {
    this.activeTargetId = "target_fake";
    this.state = {
      url: "about:blank",
      title: "Blank",
      loadingState: "domcontentloaded",
      bodyText: "Idle",
      interactiveElements: [],
      blocker: { blocked: false, reason: null }
    };
    this.closed = false;
  }

  mutate(patch) {
    this.state = {
      ...this.state,
      ...patch
    };
  }

  listTargets() {
    return [this.#targetState()];
  }

  async getSessionState() {
    return {
      sessionId: "browser_session_fake",
      activeTargetId: this.activeTargetId,
      targetCount: 1,
      targets: [this.#targetState()],
      recentActions: []
    };
  }

  async getTargetState() {
    return this.#targetState();
  }

  async captureDomSnapshotForTarget() {
    return {
      url: this.state.url,
      title: this.state.title,
      bodyText: this.state.bodyText,
      interactiveElements: this.state.interactiveElements
    };
  }

  async detectBlockers() {
    return this.state.blocker;
  }

  async captureScreenshotBase64() {
    return Buffer.from([
      this.state.url,
      this.state.title,
      this.state.bodyText,
      this.state.blocker?.blocked ? this.state.blocker.reason : "unblocked"
    ].join("|")).toString("base64");
  }

  async openBrowserSession() {
    return {
      sessionId: "browser_session_fake",
      targetId: this.activeTargetId,
      headless: true,
      allowlistedHosts: ["fixture.local"]
    };
  }

  async navigate(_targetId, url) {
    this.mutate({
      url,
      title: "Outcome fixture",
      bodyText: "Status pending",
      interactiveElements: [{
        tagName: "button",
        text: "Promote status",
        role: "button",
        testId: "button-promote-status",
        disabled: false,
        hidden: false
      }]
    });
    return { targetId: this.activeTargetId, url, status: 200 };
  }

  async waitForPageState() {
    return { targetId: this.activeTargetId, state: this.state.loadingState, url: this.state.url };
  }

  async queryDom() {
    return {
      ambiguous: false,
      best: {
        index: 0,
        score: 100,
        visible: true,
        disabled: false,
        outsideViewport: false,
        reasons: ["testId"],
        testId: "button-promote-status",
        text: "Promote status"
      },
      ranked: []
    };
  }

  async clickElement() {
    this.mutate({
      bodyText: "Status ready",
      interactiveElements: [{
        tagName: "button",
        text: "Promote status",
        role: "button",
        testId: "button-promote-status",
        disabled: false,
        hidden: false
      }]
    });
    return { found: true, text: "Promote status", visible: true, enabled: true };
  }

  async waitForPageStable() {
    return { targetId: this.activeTargetId, url: this.state.url, title: this.state.title, observedStates: ["domcontentloaded"] };
  }

  async verifyOutcome(_targetId, expectation) {
    const expected = expectation.expectedText ?? expectation.expectedValue ?? "";
    return {
      validated: this.state.bodyText.includes(expected),
      ambiguous: false,
      observed: this.state.bodyText
    };
  }

  async exportPageEvidence() {
    const browserState = await this.getTargetState();
    return {
      evidenceId: "ev_fake_browser",
      evidenceType: "page_screenshot",
      screenshotPath: "fake.png",
      summaryPath: "fake.json",
      snapshot: await this.captureDomSnapshotForTarget(),
      browserState
    };
  }

  async close() {
    this.closed = true;
  }

  #targetState() {
    return {
      id: this.activeTargetId,
      url: this.state.url,
      title: this.state.title,
      loadingState: this.state.loadingState,
      blocker: this.state.blocker,
      detectedInteractiveElementCount: this.state.interactiveElements.length,
      navigationHistory: [],
      recentActions: []
    };
  }
}

export async function run() {
  const browser = new FakeBrowserSurface();
  const watcher = new BrowserRunWatcher({
    browser,
    intervalMs: 0
  });

  const baseline = await watcher.start({ targetId: browser.activeTargetId });
  assert.equal(baseline.activeTarget.url, "about:blank");
  assert.equal(baseline.activeTarget.visual.hasScreenshot, true);

  browser.mutate({
    bodyText: "Ready content",
    interactiveElements: [{ tagName: "button", text: "Continue", role: "button", testId: "continue" }]
  });
  await watcher.checkNow({ targetId: browser.activeTargetId });
  const domChanges = watcher.consumeChanges();
  assert.equal(domChanges.length, 1);
  assert.equal(domChanges[0].reasons.includes("dom_changed"), true);
  assert.equal(domChanges[0].reasons.includes("interactive_elements_changed"), true);
  assert.equal(domChanges[0].reasons.includes("visual_changed"), true);

  browser.mutate({ blocker: { blocked: true, reason: "Authentication required" } });
  await watcher.checkNow({ targetId: browser.activeTargetId });
  const blockerChanges = watcher.consumeChanges();
  assert.equal(blockerChanges.length, 1);
  assert.equal(blockerChanges[0].reasons.includes("blocker_changed"), true);
  assert.equal(blockerChanges[0].after.activeTarget.blocker.blocked, true);
  await watcher.stop();

  const operatorEvents = [];
  const operatorBrowser = new FakeBrowserSurface();
  const evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "browser-run-watcher-"));
  const operator = new BrowserOperator({
    browserController: operatorBrowser,
    runId: "run_browser_watch_fake",
    evidenceRoot,
    onEvent: (event) => operatorEvents.push(event),
    describeVisualFrame: async ({ frame, screenshotBase64, phase, step, visionDetail }) => ({
      id: "browser_vision_fake",
      status: "described",
      createdAt: new Date().toISOString(),
      phase,
      stepId: step?.id ?? null,
      stepAction: step?.action ?? null,
      url: frame.url,
      title: frame.title,
      visualHash: frame.visual?.screenshotHash ?? null,
      hasScreenshot: Boolean(screenshotBase64),
      visionDetail,
      description: `Visible browser frame: ${frame.title} ${frame.bodyPreview}`,
      keyElements: [frame.title, frame.bodyPreview].filter(Boolean),
      pageType: "browser_page",
      llmCallId: null,
      generationMode: "test_fake"
    })
  });
  const result = await operator.runMission({
    mission: "Open the fixture, promote the status, verify ready and capture evidence.",
    startUrl: "http://fixture.local/outcome-status.html",
    allowlistedHosts: ["fixture.local"],
    browserWatchIntervalMs: 0,
    browserVisionPolicy: {
      defaultDetail: "low",
      interactionDetail: "high",
      blockerDetail: "high"
    },
    stepHints: [
      {
        id: "click_ready",
        action: "click",
        selector: { testId: "button-promote-status" }
      },
      {
        id: "verify_ready",
        action: "verify_outcome",
        expectation: {
          type: "text_visible",
          selector: { testId: "status-value" },
          expectedText: "ready"
        }
      }
    ],
    closeBrowser: true
  });

  assert.equal(result.status, "completed");
  assert.equal(result.browserWatchChanges.some((change) => change.reasons.includes("url_changed")), true);
  assert.equal(result.browserWatchChanges.some((change) => change.reasons.includes("dom_changed")), true);
  assert.equal(result.browserWatchChanges.some((change) => change.reasons.includes("visual_changed")), true);
  assert.equal(result.browserWatchChanges.some((change) => change.after?.activeTarget?.visual?.screenshotBase64), false);
  assert.equal(result.multimodalFrames.length >= 1, true);
  assert.equal(result.multimodalFrames.every((frame) => frame.hasScreenshot), true);
  assert.equal(result.multimodalFrames.some((frame) => frame.visionDetail === "low"), true);
  assert.equal(result.multimodalFrames.some((frame) => frame.visionDetail === "high"), true);
  assert.equal(operatorEvents.some((event) => event.type === "browser.watch_started"), true);
  assert.equal(operatorEvents.some((event) => event.type === "browser.watch_changed"), true);
  assert.equal(operatorBrowser.closed, true);
}
