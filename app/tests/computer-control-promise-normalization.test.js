import assert from "node:assert/strict";
import { ComputerControlService } from "../src/computer/computer-control-service.js";

// Regression for "this.computer.detectActiveWindow(...).catch is not a function":
// the desktop runtime calls `.catch()` on detectActiveWindow()/listVisibleWindows()
// in many places. Providers may implement those SYNCHRONOUSLY (controlled /
// simulated / FakeWindowProvider). The service must normalize to a Promise so
// sync providers don't crash a real desktop run the instant it inspects a window.
export async function run() {
  // A provider with SYNCHRONOUS window methods (the shape that crashed).
  const syncProvider = {
    detectActiveWindow() { return { id: "win-1", title: "Notepad" }; },
    listVisibleWindows() { return [{ id: "win-1", title: "Notepad" }]; }
  };
  const svc = new ComputerControlService(syncProvider);

  // The results must be thenable AND .catch-able, not raw values.
  const da = svc.detectActiveWindow();
  assert.equal(typeof da.then, "function", "detectActiveWindow() returns a thenable");
  assert.equal(typeof da.catch, "function", "detectActiveWindow() result is .catch-able");
  const lv = svc.listVisibleWindows();
  assert.equal(typeof lv.catch, "function", "listVisibleWindows() result is .catch-able");

  // The exact runtime usage pattern must not throw and must resolve to the value.
  const active = await svc.detectActiveWindow().catch(() => null);
  assert.equal(active.id, "win-1", "sync provider value flows through the normalized promise");
  const windows = await svc.listVisibleWindows().catch(() => []);
  assert.equal(windows.length, 1);

  // An ASYNC provider must keep working unchanged.
  const asyncProvider = {
    async detectActiveWindow() { return { id: "win-async" }; },
    async listVisibleWindows() { return [{ id: "win-async" }]; }
  };
  const svc2 = new ComputerControlService(asyncProvider);
  const active2 = await svc2.detectActiveWindow().catch(() => null);
  assert.equal(active2.id, "win-async", "async provider still works");

  // A provider that THROWS synchronously should be caught by .catch, not crash.
  const throwingProvider = {
    detectActiveWindow() { throw new Error("boom"); },
    listVisibleWindows() { return []; }
  };
  const svc3 = new ComputerControlService(throwingProvider);
  const safe = await svc3.detectActiveWindow().catch(() => "recovered");
  assert.equal(safe, "recovered", "a synchronous throw is funnelled into .catch");
}
