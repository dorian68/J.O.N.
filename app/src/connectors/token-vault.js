// Per-connector OAuth token vault.
//
// Stores access/refresh tokens for each connected MCP/tool integration, using
// the OS secret store (DPAPI on Windows) so tokens are encrypted at rest — the
// same backend already trusted for the LLM API key. On unsupported platforms it
// degrades to an in-memory store (tokens live only for the process) so tests and
// non-Windows dev still work, while reporting `secure: false`.
import { createDefaultOsSecretStore } from "../security/os-secret-store.js";

function aliasFor(connectorId) {
  return `connector-oauth-${String(connectorId).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
}

export class TokenVault {
  constructor({ secretStore = createDefaultOsSecretStore() } = {}) {
    this.secretStore = secretStore;
    this.secure = Boolean(secretStore?.isSupported?.());
    this._memory = new Map(); // fallback when DPAPI unavailable
  }

  isSecure() {
    return this.secure;
  }

  // tokens: { accessToken, refreshToken?, expiresAt?(ISO), scope?, tokenType? }
  async save(connectorId, tokens) {
    const payload = JSON.stringify({ ...tokens, savedAt: new Date().toISOString() });
    if (this.secure) {
      await this.secretStore.setSecret(aliasFor(connectorId), payload);
    } else {
      this._memory.set(connectorId, payload);
    }
    return true;
  }

  async load(connectorId) {
    let raw = null;
    if (this.secure) {
      try {
        raw = await this.secretStore.getSecret(aliasFor(connectorId));
      } catch {
        raw = null;
      }
    } else {
      raw = this._memory.get(connectorId) ?? null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async clear(connectorId) {
    if (this.secure) {
      try { await this.secretStore.deleteSecret?.(aliasFor(connectorId)); } catch { /* ignore */ }
    }
    this._memory.delete(connectorId);
    return true;
  }

  // True if a token is present and not expired (with a 60s safety margin).
  async hasValidAccess(connectorId) {
    const tokens = await this.load(connectorId);
    if (!tokens?.accessToken) return false;
    if (!tokens.expiresAt) return true;
    return new Date(tokens.expiresAt).getTime() - 60_000 > Date.now();
  }
}
