import crypto from "node:crypto";
import { nowIso } from "../utils/ids.js";

// 30 days: a personal mobile coworker should stay paired across days/restarts,
// not re-pair every few hours. Override with COWORK_MOBILE_SESSION_TTL_MS.
const DEFAULT_SESSION_TTL_MS = Number(process.env.COWORK_MOBILE_SESSION_TTL_MS ?? 2_592_000_000); // 30d
const DEFAULT_PAIRING_TTL_MS = Number(process.env.COWORK_MOBILE_PAIRING_TTL_MS ?? 300_000);   // 5min
const DEFAULT_MAX_DEVICES = Number(process.env.COWORK_MOBILE_MAX_DEVICES ?? 5);

export const DEVICE_STATUS = Object.freeze({
  PENDING: "pending",
  TRUSTED: "trusted",
  REVOKED: "revoked"
});

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("");
}

// Full sha256 hex — used both as the persisted session key and (sliced) for
// audit display. We never store the raw bearer token, only its hash.
function sessionKey(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class MobileDeviceRegistry {
  // `store` is optional. When provided (the SQLite database) devices + sessions
  // are persisted and reloaded on construction so a JON restart does NOT
  // silently log out a paired phone. Without a store the registry is purely
  // in-memory (used by unit tests).
  constructor({
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    pairingTtlMs = DEFAULT_PAIRING_TTL_MS,
    maxDevices = DEFAULT_MAX_DEVICES,
    store = null
  } = {}) {
    this.sessionTtlMs = sessionTtlMs;
    this.pairingTtlMs = pairingTtlMs;
    this.maxDevices = maxDevices;
    this.store = store;
    this.devices = new Map();
    this.sessions = new Map();   // keyed by token hash (never the raw token)
    this.pairingCodes = new Map();
    this.#loadFromStore();
  }

  #loadFromStore() {
    if (!this.store) return;
    try {
      for (const device of this.store.listMobileDevices?.() ?? []) {
        this.devices.set(device.id, device);
      }
      const now = Date.now();
      for (const session of this.store.listMobileSessions?.() ?? []) {
        const expired = new Date(session.expiresAt).getTime() <= now;
        const device = this.devices.get(session.deviceId);
        if (expired || !device || device.status !== DEVICE_STATUS.TRUSTED) {
          this.store.deleteMobileSession?.(session.tokenHash);
          continue;
        }
        this.sessions.set(session.tokenHash, { ...session });
      }
    } catch {
      // Persistence is best-effort; never block startup on a bad row.
    }
  }

  #persistDevice(device) {
    try { this.store?.upsertMobileDevice?.(device); } catch { /* best-effort */ }
  }

  #persistSession(session) {
    try { this.store?.upsertMobileSession?.(session); } catch { /* best-effort */ }
  }

  startPairing() {
    const trustedCount = Array.from(this.devices.values()).filter((d) => d.status === DEVICE_STATUS.TRUSTED).length;
    if (trustedCount >= this.maxDevices) {
      throw Object.assign(new Error(`Max devices reached (${this.maxDevices}). Revoke a device first.`), { code: "MAX_DEVICES" });
    }
    const code = randomCode(6);
    const expiresAt = new Date(Date.now() + this.pairingTtlMs).toISOString();
    const qrData = `JON:pair:${code}`;
    this.pairingCodes.set(code, { code, expiresAt, usedAt: null });
    return { pairingCode: code, qrData, expiresAt };
  }

  confirmPairing(code, { deviceName = "Mobile", deviceFingerprint = null } = {}) {
    const entry = this.pairingCodes.get(code);
    if (!entry) {
      throw Object.assign(new Error("Invalid pairing code."), { code: "INVALID_CODE" });
    }
    if (new Date(entry.expiresAt) < new Date()) {
      this.pairingCodes.delete(code);
      throw Object.assign(new Error("Pairing code expired."), { code: "CODE_EXPIRED" });
    }
    if (entry.usedAt) {
      throw Object.assign(new Error("Pairing code already used."), { code: "CODE_USED" });
    }
    entry.usedAt = nowIso();
    this.pairingCodes.delete(code);

    const deviceId = `dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const device = {
      id: deviceId,
      name: String(deviceName ?? "Mobile").slice(0, 64),
      fingerprint: deviceFingerprint ?? null,
      status: DEVICE_STATUS.TRUSTED,
      pairedAt: nowIso(),
      lastSeenAt: nowIso(),
      revokedAt: null
    };
    this.devices.set(deviceId, device);
    this.#persistDevice(device);

    return this.createSession(deviceId);
  }

  createSession(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device || device.status !== DEVICE_STATUS.TRUSTED) {
      throw Object.assign(new Error("Device not trusted."), { code: "DEVICE_NOT_TRUSTED" });
    }
    const token = crypto.randomUUID();
    const tokenHash = sessionKey(token);
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    const session = {
      tokenHash,
      deviceId,
      createdAt: nowIso(),
      expiresAt,
      lastUsedAt: nowIso()
    };
    this.sessions.set(tokenHash, session);
    this.#persistSession(session);
    device.lastSeenAt = nowIso();
    this.#persistDevice(device);
    // The raw token is returned to the client exactly once; only its hash is kept.
    return { sessionToken: token, deviceId, deviceName: device.name, expiresAt };
  }

  validateSession(token) {
    const tokenHash = sessionKey(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(tokenHash);
      try { this.store?.deleteMobileSession?.(tokenHash); } catch { /* best-effort */ }
      return null;
    }
    const device = this.devices.get(session.deviceId);
    if (!device || device.status !== DEVICE_STATUS.TRUSTED) {
      this.sessions.delete(tokenHash);
      try { this.store?.deleteMobileSession?.(tokenHash); } catch { /* best-effort */ }
      return null;
    }
    session.lastUsedAt = nowIso();
    device.lastSeenAt = nowIso();
    return { session, device };
  }

  revokeDevice(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    device.status = DEVICE_STATUS.REVOKED;
    device.revokedAt = nowIso();
    this.#persistDevice(device);
    for (const [tokenHash, session] of this.sessions.entries()) {
      if (session.deviceId === deviceId) {
        this.sessions.delete(tokenHash);
      }
    }
    try { this.store?.deleteMobileSessionsForDevice?.(deviceId); } catch { /* best-effort */ }
    return true;
  }

  revokeSession(token) {
    const tokenHash = sessionKey(token);
    const existed = this.sessions.delete(tokenHash);
    try { this.store?.deleteMobileSession?.(tokenHash); } catch { /* best-effort */ }
    return existed;
  }

  listDevices() {
    return Array.from(this.devices.values()).map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt ?? null,
      hasActiveSession: Array.from(this.sessions.values()).some((s) => s.deviceId === d.id && new Date(s.expiresAt) > new Date())
    }));
  }

  getSessionInfo(token) {
    const tokenHash = sessionKey(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    return {
      deviceId: session.deviceId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      tokenHash: tokenHash.slice(0, 16)
    };
  }

  pruneStaleSessions() {
    const now = new Date();
    for (const [tokenHash, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(tokenHash);
        try { this.store?.deleteMobileSession?.(tokenHash); } catch { /* best-effort */ }
      }
    }
  }
}
