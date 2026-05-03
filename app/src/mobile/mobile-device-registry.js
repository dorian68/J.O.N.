import crypto from "node:crypto";
import { nowIso } from "../utils/ids.js";

const DEFAULT_SESSION_TTL_MS = Number(process.env.COWORK_MOBILE_SESSION_TTL_MS ?? 14_400_000); // 4h
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

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export class MobileDeviceRegistry {
  constructor({ sessionTtlMs = DEFAULT_SESSION_TTL_MS, pairingTtlMs = DEFAULT_PAIRING_TTL_MS, maxDevices = DEFAULT_MAX_DEVICES } = {}) {
    this.sessionTtlMs = sessionTtlMs;
    this.pairingTtlMs = pairingTtlMs;
    this.maxDevices = maxDevices;
    this.devices = new Map();
    this.sessions = new Map();
    this.pairingCodes = new Map();
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

    return this.createSession(deviceId);
  }

  createSession(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device || device.status !== DEVICE_STATUS.TRUSTED) {
      throw Object.assign(new Error("Device not trusted."), { code: "DEVICE_NOT_TRUSTED" });
    }
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    const session = {
      token,
      deviceId,
      createdAt: nowIso(),
      expiresAt,
      lastUsedAt: nowIso()
    };
    this.sessions.set(token, session);
    device.lastSeenAt = nowIso();
    return { sessionToken: token, deviceId, deviceName: device.name, expiresAt };
  }

  validateSession(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(token);
      return null;
    }
    const device = this.devices.get(session.deviceId);
    if (!device || device.status !== DEVICE_STATUS.TRUSTED) {
      this.sessions.delete(token);
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
    for (const [token, session] of this.sessions.entries()) {
      if (session.deviceId === deviceId) {
        this.sessions.delete(token);
      }
    }
    return true;
  }

  revokeSession(token) {
    return this.sessions.delete(token);
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
    const session = this.sessions.get(token);
    if (!session) return null;
    return {
      deviceId: session.deviceId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      tokenHash: hashToken(token)
    };
  }

  pruneStaleSessions() {
    const now = new Date();
    for (const [token, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(token);
      }
    }
  }
}
