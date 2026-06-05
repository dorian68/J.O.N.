import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { OperatorService } from "../src/service/operator-service.js";
import { sanitizeLaunchUrl, canRetryHotActionAfterError } from "../src/computer/powershell-window-provider.js";
import { criticalPathReason } from "../src/computer/file-primitives.js";

// Lot 3 — core reliability (audit T7-T11).
export async function run() {
  // ── T7: single startMission (the dead duplicate is removed) ─────────────────
  // The active one is startMission(projectId, missionRequest) → arity 2.
  // The removed dead one was startMission(projectId, {...}={}) → arity 1.
  assert.equal(OperatorService.prototype.startMission.length, 2, "single (projectId, missionRequest) startMission remains");
  assert.equal(typeof OperatorService.prototype.startMission, "function");

  // ── T10: browser launch URL flag-injection blocked ──────────────────────────
  assert.equal(sanitizeLaunchUrl("https://example.com/"), "https://example.com/");
  assert.equal(sanitizeLaunchUrl(""), "about:blank");
  assert.equal(sanitizeLaunchUrl("about:blank"), "about:blank");
  for (const bad of ["--load-extension=/evil", "-foo", "file:///C:/secret.txt", "javascript:alert(1)", "data:text/html,x", "chrome://flags"]) {
    assert.throws(() => sanitizeLaunchUrl(bad), /UNSAFE_LAUNCH_URL|flag|scheme|invalid/i, `must reject launch URL: ${bad}`);
  }

  // ── T9: no auto-retry of a destructive action after a daemon DISPATCH timeout ─
  const timeoutDispatched = { code: "PS_DAEMON_TIMEOUT", sent: true };
  const notSent = { sent: false };
  assert.equal(canRetryHotActionAfterError("typeText", timeoutDispatched), false, "typeText not retried after dispatch timeout");
  assert.equal(canRetryHotActionAfterError("clickPoint", timeoutDispatched), false, "click not retried after dispatch timeout");
  assert.equal(canRetryHotActionAfterError("sendHotkey", timeoutDispatched), false);
  assert.equal(canRetryHotActionAfterError("scroll", timeoutDispatched), false);
  assert.equal(canRetryHotActionAfterError("captureScreen", timeoutDispatched), true, "idempotent capture may retry");
  assert.equal(canRetryHotActionAfterError("ping", timeoutDispatched), true);
  assert.equal(canRetryHotActionAfterError("typeText", notSent), true, "not-dispatched destructive action may retry safely");

  // ── T11: file path traversal / sensitive paths blocked ──────────────────────
  const home = os.homedir();
  // Allowed: a normal file under the workspace (home by default).
  assert.equal(criticalPathReason(path.join(home, "Documents", "notes.txt")), null, "normal file under home allowed");
  // Blocked: sensitive subpaths inside home.
  assert.ok(criticalPathReason(path.join(home, "AppData", "Roaming", "x", "secret")), "AppData blocked");
  assert.ok(criticalPathReason(path.join(home, ".ssh", "id_rsa")), ".ssh blocked");
  assert.ok(criticalPathReason(path.join(home, ".cowork", "secrets", "llm.json")), "cowork secrets blocked");
  // Blocked: user profile root + system root + drive root.
  assert.ok(criticalPathReason(home), "home root blocked");
  assert.ok(criticalPathReason(path.parse(home).root), "drive/system root blocked");

  // T11 with an explicit tighter workspace root: outside it is refused.
  const prev = process.env.JON_WORKSPACE_ROOT;
  // NB: not under os.tmpdir() — on Windows that lives in AppData, which is a
  // blocked sensitive subpath (that block is itself verified above).
  const sandbox = path.join(home, "jon-ws-sandbox-test");
  process.env.JON_WORKSPACE_ROOT = sandbox;
  try {
    assert.equal(criticalPathReason(path.join(sandbox, "out.txt")), null, "inside sandbox allowed");
    assert.ok(criticalPathReason(path.join(home, "Documents", "x.txt")), "outside sandbox refused when JON_WORKSPACE_ROOT set");
  } finally {
    if (prev === undefined) delete process.env.JON_WORKSPACE_ROOT; else process.env.JON_WORKSPACE_ROOT = prev;
  }
}
