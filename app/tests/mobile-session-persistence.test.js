import assert from "node:assert/strict";
import { MobileDeviceRegistry } from "../src/mobile/mobile-device-registry.js";

// Reproduces the real failure: a JON restart wiped all paired devices + sessions
// (they were in-memory only), so the phone's stored token became invalid and
// every mobile call 401'd ("rien ne se passe / pas possible de sauvegarder").
// With persistence, a new registry built over the SAME store must still accept
// the phone's existing token.
//
// In-memory fake of the SQLite store (same method surface the DB exposes).
function makeFakeStore() {
  const devices = new Map();
  const sessions = new Map();
  return {
    _devices: devices,
    _sessions: sessions,
    upsertMobileDevice: (d) => devices.set(d.id, { ...d }),
    listMobileDevices: () => Array.from(devices.values()).map((d) => ({ ...d })),
    upsertMobileSession: (s) => sessions.set(s.tokenHash, { ...s }),
    listMobileSessions: () => Array.from(sessions.values()).map((s) => ({ ...s })),
    deleteMobileSession: (h) => sessions.delete(h),
    deleteMobileSessionsForDevice: (id) => {
      for (const [h, s] of sessions.entries()) if (s.deviceId === id) sessions.delete(h);
    }
  };
}

export async function run() {
  const store = makeFakeStore();

  // ── Pair a phone on the first server "process" ──────────────────────────────
  const reg1 = new MobileDeviceRegistry({ store });
  const { pairingCode } = reg1.startPairing();
  const { sessionToken, deviceId } = reg1.confirmPairing(pairingCode, { deviceName: "iPhone" });
  assert.ok(sessionToken, "pairing returns a session token");
  assert.ok(reg1.validateSession(sessionToken), "token valid in the original process");

  // Device + session were persisted, and the raw token is NEVER stored.
  assert.equal(store._devices.size, 1, "device persisted");
  assert.equal(store._sessions.size, 1, "session persisted");
  const persistedSession = store.listMobileSessions()[0];
  assert.ok(persistedSession.tokenHash && persistedSession.tokenHash !== sessionToken, "only the token HASH is stored");
  assert.ok(!JSON.stringify(store.listMobileSessions()).includes(sessionToken), "raw token never persisted");

  // ── Simulate a JON restart: brand-new registry over the SAME store ──────────
  const reg2 = new MobileDeviceRegistry({ store });
  const validated = reg2.validateSession(sessionToken);
  assert.ok(validated, "the phone's existing token STILL works after a restart");
  assert.equal(validated.device.id, deviceId, "resolves to the same device");
  assert.equal(reg2.listDevices().length, 1, "paired device reloaded after restart");

  // ── Revocation is persisted too ─────────────────────────────────────────────
  reg2.revokeDevice(deviceId);
  const reg3 = new MobileDeviceRegistry({ store });
  assert.equal(reg3.validateSession(sessionToken), null, "revoked device's token rejected after restart");

  // ── Expired sessions are dropped on load (not resurrected) ──────────────────
  const store2 = makeFakeStore();
  const regA = new MobileDeviceRegistry({ store: store2, sessionTtlMs: -1 }); // already expired
  const code = regA.startPairing().pairingCode;
  const { sessionToken: shortToken } = regA.confirmPairing(code, { deviceName: "Old" });
  const regB = new MobileDeviceRegistry({ store: store2 });
  assert.equal(regB.validateSession(shortToken), null, "expired session not accepted after reload");
  assert.equal(store2._sessions.size, 0, "expired session pruned from the store on load");

  // ── No store → still works purely in-memory (back-compat for unit tests) ────
  const memReg = new MobileDeviceRegistry({});
  const c = memReg.startPairing().pairingCode;
  const { sessionToken: memTok } = memReg.confirmPairing(c, { deviceName: "Mem" });
  assert.ok(memReg.validateSession(memTok), "in-memory mode still functions without a store");
}
