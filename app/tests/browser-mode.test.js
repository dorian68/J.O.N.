import assert from "node:assert/strict";
import {
  BROWSER_MODE,
  BROWSER_SESSION_STATUS,
  resolveBrowserMode,
  describeBrowserMode,
  BrowserSessionTracker
} from "../src/browser/browser-mode.js";

export async function run() {
  // Constants are frozen and correct
  assert.equal(BROWSER_MODE.WORKSPACE, "workspace_browser");
  assert.equal(BROWSER_MODE.SYSTEM, "system_browser");
  assert.equal(BROWSER_MODE.FIXTURE, "fixture_browser");
  assert.ok(Object.isFrozen(BROWSER_MODE));

  assert.equal(BROWSER_SESSION_STATUS.INACTIVE, "inactive");
  assert.equal(BROWSER_SESSION_STATUS.ACTIVE, "active");
  assert.ok(Object.isFrozen(BROWSER_SESSION_STATUS));

  // resolveBrowserMode
  assert.equal(resolveBrowserMode(null), BROWSER_MODE.WORKSPACE);
  assert.equal(resolveBrowserMode(BROWSER_MODE.SYSTEM), BROWSER_MODE.SYSTEM);
  assert.equal(resolveBrowserMode(BROWSER_MODE.WORKSPACE), BROWSER_MODE.WORKSPACE);
  assert.equal(resolveBrowserMode(null, { fixtureMode: true }), BROWSER_MODE.FIXTURE);
  assert.equal(resolveBrowserMode(BROWSER_MODE.SYSTEM, { fixtureMode: true }), BROWSER_MODE.FIXTURE);

  // describeBrowserMode
  assert.ok(describeBrowserMode(BROWSER_MODE.WORKSPACE).length > 0);
  assert.ok(describeBrowserMode(BROWSER_MODE.SYSTEM).length > 0);
  assert.ok(describeBrowserMode(BROWSER_MODE.FIXTURE).length > 0);
  assert.ok(describeBrowserMode("unknown_mode").length > 0);

  // BrowserSessionTracker — open
  const tracker = new BrowserSessionTracker();
  const session = tracker.open({ projectId: "proj_1", runId: "run_1" });
  assert.ok(session.id);
  assert.equal(session.projectId, "proj_1");
  assert.equal(session.runId, "run_1");
  assert.equal(session.mode, BROWSER_MODE.WORKSPACE);
  assert.equal(session.status, BROWSER_SESSION_STATUS.OPENING);
  assert.ok(session.openedAt);

  // activate
  const activated = tracker.activate(session.id);
  assert.equal(activated.status, BROWSER_SESSION_STATUS.ACTIVE);

  // recordNavigation
  const navigated = tracker.recordNavigation(session.id, {
    url: "https://example.com",
    title: "Example",
    screenshotBase64: "abc123"
  });
  assert.equal(navigated.currentUrl, "https://example.com");
  assert.equal(navigated.currentTitle, "Example");
  assert.equal(navigated.screenshotBase64, "abc123");
  assert.equal(navigated.navigationHistory.length, 1);
  assert.equal(navigated.navigationHistory[0].url, "https://example.com");

  // navigation history capped at 20
  for (let i = 0; i < 25; i++) {
    tracker.recordNavigation(session.id, { url: `https://example.com/page${i}`, title: `Page ${i}` });
  }
  const full = tracker.get(session.id);
  assert.equal(full.navigationHistory.length, 20);

  // updateScreenshot
  tracker.updateScreenshot(session.id, "newscreenshot");
  assert.equal(tracker.get(session.id).screenshotBase64, "newscreenshot");

  // getByProject
  tracker.open({ projectId: "proj_1", runId: "run_2" });
  const byProject = tracker.getByProject("proj_1");
  assert.equal(byProject.length, 2);

  // getActiveByProject returns most recently active session
  const active = tracker.getActiveByProject("proj_1");
  assert.ok(active);

  // close
  const closed = tracker.close(session.id);
  assert.equal(closed.status, BROWSER_SESSION_STATUS.CLOSED);

  // getActiveByProject after close
  const stillActive = tracker.getActiveByProject("proj_1");
  assert.equal(stillActive, null);

  // error
  const session2 = tracker.open({ projectId: "proj_2" });
  tracker.error(session2.id, "Launch failed");
  assert.equal(tracker.get(session2.id).status, BROWSER_SESSION_STATUS.ERROR);
  assert.equal(tracker.get(session2.id).errorMessage, "Launch failed");

  // toPublicState
  const pub = tracker.toPublicState(tracker.get(session.id));
  assert.ok("id" in pub);
  assert.ok("status" in pub);
  assert.ok("hasScreenshot" in pub);
  assert.ok("modeLabel" in pub);
  assert.ok(Array.isArray(pub.navigationHistory));
  assert.ok(pub.navigationHistory.length <= 5);

  // toPublicState(null) → null
  assert.equal(tracker.toPublicState(null), null);

  // cleanup removes closed sessions
  tracker.cleanup("proj_1");
  const afterCleanup = tracker.getByProject("proj_1");
  assert.ok(afterCleanup.every((s) => s.status !== BROWSER_SESSION_STATUS.CLOSED));

  // get unknown session
  assert.equal(tracker.get("nonexistent"), null);

  // Custom sessionId preserved
  const custom = tracker.open({ projectId: "proj_3", sessionId: "my_custom_id" });
  assert.equal(custom.id, "my_custom_id");
}
