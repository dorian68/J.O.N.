import assert from "node:assert/strict";
import { MobileDeviceRegistry, DEVICE_STATUS } from "../src/mobile/mobile-device-registry.js";
import { MobileGateway, MobileAuditLog } from "../src/mobile/mobile-gateway.js";
import { buildMobileEvent, MobileEventBuffer } from "../src/mobile/mobile-event-stream.js";

// ─── Helpers ──────────────────────────────────────────────────────

function makeRegistry(overrides = {}) {
  return new MobileDeviceRegistry({
    sessionTtlMs: 5000,
    pairingTtlMs: 2000,
    maxDevices: 3,
    ...overrides
  });
}

function makeAuditLog() {
  return new MobileAuditLog({ maxEntries: 50 });
}

function makeFakeService() {
  const approvals = new Map();
  const stoppedRuns = new Set();
  return {
    approvals,
    stoppedRuns,
    resolveApproval(id, decision) { approvals.set(id, decision); },
    stopRun(runId) { stoppedRuns.add(runId); },
    sendTerminalInput() {},
    startMission() { return { runId: "run_test_1" }; },
    getOrCreateActiveConversation() { return { id: "conv_1" }; }
  };
}

function makeGateway(registryOverrides = {}) {
  const registry = makeRegistry(registryOverrides);
  const auditLog = makeAuditLog();
  const svc = makeFakeService();
  const gateway = new MobileGateway({ deviceRegistry: registry, auditLog, operatorService: svc });
  return { registry, auditLog, svc, gateway };
}

async function pairDevice(registry, name = "TestPhone") {
  const { pairingCode } = registry.startPairing();
  return registry.confirmPairing(pairingCode, { deviceName: name });
}

// ─── Suite ────────────────────────────────────────────────────────

export async function run() {

  // ── Pairing: start generates a code ──────────────────────────
  {
    const reg = makeRegistry();
    const result = reg.startPairing();
    assert.ok(result.pairingCode, "pairingCode should be present");
    assert.equal(result.pairingCode.length, 6, "pairingCode should be 6 chars");
    assert.ok(result.qrData.startsWith("JON:pair:"), "qrData prefix");
    assert.ok(result.expiresAt, "expiresAt should be present");
  }

  // ── Pairing: confirm succeeds with valid code ─────────────────
  {
    const reg = makeRegistry();
    const { pairingCode } = reg.startPairing();
    const session = reg.confirmPairing(pairingCode, { deviceName: "iPhone" });
    assert.ok(session.sessionToken, "sessionToken should be present");
    assert.ok(session.deviceId, "deviceId should be present");
    assert.equal(session.deviceName, "iPhone");
    assert.ok(session.expiresAt, "expiresAt should be present");
  }

  // ── Pairing: invalid code is rejected ────────────────────────
  {
    const reg = makeRegistry();
    reg.startPairing();
    assert.throws(
      () => reg.confirmPairing("XXXXXX"),
      (err) => err.code === "INVALID_CODE"
    );
  }

  // ── Pairing: code can only be used once ──────────────────────
  {
    const reg = makeRegistry();
    const { pairingCode } = reg.startPairing();
    reg.confirmPairing(pairingCode, { deviceName: "Phone1" });
    assert.throws(
      () => reg.confirmPairing(pairingCode, { deviceName: "Phone2" }),
      (err) => err.code === "INVALID_CODE"
    );
  }

  // ── Pairing: expired code is rejected ────────────────────────
  {
    const reg = makeRegistry({ pairingTtlMs: 1 });
    const { pairingCode } = reg.startPairing();
    await new Promise((r) => setTimeout(r, 10));
    assert.throws(
      () => reg.confirmPairing(pairingCode, { deviceName: "Late" }),
      (err) => err.code === "CODE_EXPIRED"
    );
  }

  // ── Session: valid token returns session + device ─────────────
  {
    const reg = makeRegistry();
    const sess = await pairDevice(reg, "Android");
    const result = reg.validateSession(sess.sessionToken);
    assert.ok(result, "session should be valid");
    assert.equal(result.device.name, "Android");
    assert.equal(result.device.status, DEVICE_STATUS.TRUSTED);
  }

  // ── Session: unknown token returns null ──────────────────────
  {
    const reg = makeRegistry();
    assert.equal(reg.validateSession("not-a-real-token"), null);
  }

  // ── Session: expired session returns null ────────────────────
  {
    const reg = makeRegistry({ sessionTtlMs: 1 });
    const sess = await pairDevice(reg, "Expiring");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(reg.validateSession(sess.sessionToken), null);
  }

  // ── Device revocation: invalidates sessions ───────────────────
  {
    const reg = makeRegistry();
    const sess = await pairDevice(reg, "ToRevoke");
    assert.ok(reg.validateSession(sess.sessionToken), "session valid before revoke");
    const ok = reg.revokeDevice(sess.deviceId);
    assert.equal(ok, true);
    assert.equal(reg.validateSession(sess.sessionToken), null, "session invalid after revoke");
    const devices = reg.listDevices();
    const d = devices.find((x) => x.id === sess.deviceId);
    assert.equal(d.status, DEVICE_STATUS.REVOKED);
  }

  // ── Device revocation: unknown device returns false ───────────
  {
    const reg = makeRegistry();
    assert.equal(reg.revokeDevice("dev_nonexistent"), false);
  }

  // ── Session revocation ────────────────────────────────────────
  {
    const reg = makeRegistry();
    const sess = await pairDevice(reg, "SessionRevoke");
    assert.ok(reg.validateSession(sess.sessionToken));
    reg.revokeSession(sess.sessionToken);
    assert.equal(reg.validateSession(sess.sessionToken), null);
    // Device should still be TRUSTED
    const d = reg.listDevices().find((x) => x.id === sess.deviceId);
    assert.equal(d.status, DEVICE_STATUS.TRUSTED);
  }

  // ── Max devices limit ─────────────────────────────────────────
  {
    const reg = makeRegistry({ maxDevices: 2 });
    await pairDevice(reg, "D1");
    await pairDevice(reg, "D2");
    assert.throws(
      () => reg.startPairing(),
      (err) => err.code === "MAX_DEVICES"
    );
  }

  // ── listDevices shape ─────────────────────────────────────────
  {
    const reg = makeRegistry();
    const sess = await pairDevice(reg, "ListPhone");
    const list = reg.listDevices();
    assert.equal(list.length, 1);
    assert.ok("id" in list[0]);
    assert.ok("name" in list[0]);
    assert.ok("status" in list[0]);
    assert.ok("hasActiveSession" in list[0]);
    assert.equal(list[0].hasActiveSession, true);
  }

  // ── Command: allowed command dispatches ───────────────────────
  {
    const { registry, svc, gateway } = makeGateway();
    const sess = await pairDevice(registry, "CmdPhone");
    const result = await gateway.dispatch(
      "stopRun",
      { runId: "run_abc" },
      { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "proj_1" }
    );
    assert.equal(result.stopped, true);
    assert.ok(svc.stoppedRuns.has("run_abc"));
  }

  // ── Command: blocked command is rejected with BLOCKED_COMMAND ─
  {
    const { registry, gateway } = makeGateway();
    const sess = await pairDevice(registry, "BlockTest");
    await assert.rejects(
      () => gateway.dispatch("executeArbitraryTerminalCommand", {}, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" }),
      (err) => err.code === "BLOCKED_COMMAND"
    );
  }

  // ── Command: unknown command is rejected ──────────────────────
  {
    const { registry, gateway } = makeGateway();
    const sess = await pairDevice(registry, "UnknownTest");
    await assert.rejects(
      () => gateway.dispatch("hackThePlanet", {}, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" }),
      (err) => err.code === "UNKNOWN_COMMAND"
    );
  }

  // ── Command: sendChatMessage validates message ────────────────
  {
    const { registry, gateway } = makeGateway();
    const sess = await pairDevice(registry, "ChatTest");
    await assert.rejects(
      () => gateway.dispatch("sendChatMessage", { message: "" }, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" }),
      (err) => err.code === "INVALID_PARAMS"
    );
    await assert.rejects(
      () => gateway.dispatch("sendChatMessage", { message: "x".repeat(4001) }, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" }),
      (err) => err.code === "MESSAGE_TOO_LONG"
    );
  }

  // ── Command: startMission validates objective ─────────────────
  {
    const { registry, gateway } = makeGateway();
    const sess = await pairDevice(registry, "MissionTest");
    await assert.rejects(
      () => gateway.dispatch("startMission", { objective: "" }, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" }),
      (err) => err.code === "INVALID_PARAMS"
    );
  }

  // ── Command: approveAction requires approvalId ────────────────
  {
    const { registry, gateway } = makeGateway();
    const sess = await pairDevice(registry, "ApproveTest");
    await assert.rejects(
      () => gateway.dispatch("approveAction", {}, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" }),
      (err) => err.code === "INVALID_PARAMS"
    );
  }

  // ── Command: approveAction dispatches resolveApproval ─────────
  {
    const { registry, svc, gateway } = makeGateway();
    const sess = await pairDevice(registry, "ApproveOk");
    await gateway.dispatch("approveAction", { approvalId: "appr_001" }, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" });
    assert.equal(svc.approvals.get("appr_001"), "approved_once");
  }

  // ── Command: denyAction dispatches resolveApproval ────────────
  {
    const { registry, svc, gateway } = makeGateway();
    const sess = await pairDevice(registry, "DenyOk");
    await gateway.dispatch("denyAction", { approvalId: "appr_002" }, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" });
    assert.equal(svc.approvals.get("appr_002"), "stop_run");
  }

  // ── Audit log: blocked commands are recorded ──────────────────
  {
    const { registry, auditLog, gateway } = makeGateway();
    const sess = await pairDevice(registry, "AuditTest");
    try {
      await gateway.dispatch("deleteFile", {}, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" });
    } catch {}
    const entries = auditLog.list({ limit: 10 });
    const blocked = entries.find((e) => e.commandType === "deleteFile");
    assert.ok(blocked, "blocked command should be in audit log");
    assert.equal(blocked.status, "blocked");
  }

  // ── Audit log: allowed commands are recorded ──────────────────
  {
    const { registry, auditLog, gateway } = makeGateway();
    const sess = await pairDevice(registry, "AuditOk");
    await gateway.dispatch("stopRun", { runId: "r1" }, { deviceId: sess.deviceId, token: sess.sessionToken, projectId: "p" });
    const entries = auditLog.list({ limit: 10 });
    const ok = entries.find((e) => e.commandType === "stopRun");
    assert.ok(ok);
    assert.equal(ok.status, "ok");
  }

  // ── Audit log: filter by deviceId ────────────────────────────
  {
    const { registry, auditLog, gateway } = makeGateway();
    const s1 = await pairDevice(registry, "Dev1");
    const s2 = await pairDevice(registry, "Dev2");
    await gateway.dispatch("stopRun", { runId: "r1" }, { deviceId: s1.deviceId, token: s1.sessionToken, projectId: "p" });
    await gateway.dispatch("stopRun", { runId: "r2" }, { deviceId: s2.deviceId, token: s2.sessionToken, projectId: "p" });
    const dev1Entries = auditLog.list({ deviceId: s1.deviceId });
    assert.ok(dev1Entries.every((e) => e.deviceId === s1.deviceId));
  }

  // ── Event stream: buildMobileEvent returns structured event ───
  {
    const event = buildMobileEvent("run.started", { runId: "r1", mission: "Test mission" });
    assert.ok(event, "event should be built");
    assert.equal(event.type, "run.started");
    assert.ok(event.id.startsWith("mev_"));
    assert.ok(event.timestamp);
    assert.equal(event.severity, "low");
    assert.equal(event.runId, "r1");
    assert.ok(event.message.length > 0);
  }

  // ── Event stream: approval.required event has action suggestions
  {
    const event = buildMobileEvent("approval.required", { approvalId: "appr_123", actionLabel: "Submit form" });
    assert.ok(event.actionSuggestions, "should have action suggestions");
    const cmds = event.actionSuggestions.map((a) => a.command);
    assert.ok(cmds.includes("approveAction"));
    assert.ok(cmds.includes("denyAction"));
  }

  // ── Event stream: terminal.waiting_for_input has suggestions ──
  {
    const event = buildMobileEvent("terminal.waiting_for_input", { terminalId: "t1", label: "codex-cli" });
    assert.equal(event.severity, "medium");
    assert.ok(event.actionSuggestions);
    const cmds = event.actionSuggestions.map((a) => a.command);
    assert.ok(cmds.includes("answerTerminalPrompt"));
  }

  // ── Event stream: unknown type returns null ───────────────────
  {
    const result = buildMobileEvent("totally.unknown.event", {});
    assert.equal(result, null);
  }

  // ── Event stream: payload is sanitized (no raw/evidence) ──────
  {
    const event = buildMobileEvent("run.completed", {
      runId: "r1",
      summary: "Done",
      screenshotBase64: "base64data",
      domSnapshot: "<html>",
      raw: "rawdata",
      evidence: { secret: true }
    });
    assert.ok(!("screenshotBase64" in event.payload));
    assert.ok(!("domSnapshot" in event.payload));
    assert.ok(!("raw" in event.payload));
    assert.ok(!("evidence" in event.payload));
  }

  // ── Event buffer: push and retrieve since timestamp ──────────
  {
    const buffer = new MobileEventBuffer({ maxSize: 10 });
    const e1 = buildMobileEvent("run.started", { runId: "r1" });
    const e2 = buildMobileEvent("run.completed", { runId: "r1" });
    buffer.push(e1);
    buffer.push(e2);
    const all = buffer.since(null);
    assert.equal(all.length, 2);
    const after = buffer.since(e1.timestamp);
    assert.ok(after.length <= 1);
  }

  // ── Event buffer: subscriber is notified on push ─────────────
  {
    const buffer = new MobileEventBuffer();
    const received = [];
    const unsub = buffer.subscribe((e) => received.push(e));
    buffer.pushRaw("proof.created", { label: "screenshot.png" });
    assert.equal(received.length, 1);
    assert.equal(received[0].type, "proof.created");
    unsub();
    buffer.pushRaw("run.started", {});
    assert.equal(received.length, 1, "unsubscribed, no new event");
  }

  // ── Event buffer: maxSize is respected ───────────────────────
  {
    const buffer = new MobileEventBuffer({ maxSize: 3 });
    for (let i = 0; i < 5; i++) {
      buffer.push(buildMobileEvent("run.progress", { summary: `step ${i}` }));
    }
    assert.equal(buffer.since(null).length, 3);
  }

  // ── Prune stale sessions ─────────────────────────────────────
  {
    const reg = makeRegistry({ sessionTtlMs: 1 });
    const sess = await pairDevice(reg, "StalePhone");
    await new Promise((r) => setTimeout(r, 20));
    reg.pruneStaleSessions();
    assert.equal(reg.validateSession(sess.sessionToken), null);
  }

}
