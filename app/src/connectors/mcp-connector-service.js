// MCP Connector Service — the Composio-like glue.
//
// Ties together: OAuth flow + token vault + MCP client. Exposes a small surface
// the operator service / UI use to (1) connect a service via OAuth, (2) connect
// a local stdio MCP server, (3) auto-discover tools, and (4) actually invoke a
// tool (with transparent token refresh). This is what makes "add a tool via MCP
// over OAuth, then use it" real end-to-end.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TokenVault } from "./token-vault.js";
import { McpClientManager } from "./mcp-client.js";
import { McpOAuthClientProvider } from "./mcp-oauth-provider.js";
import { resolveMcpServer } from "./mcp-server-catalog.js";
import { resolveOAuthProvider } from "./oauth-provider-catalog.js";
import {
  generatePkce,
  randomState,
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken as refreshOAuthToken,
  startCallbackServer
} from "./oauth-flow.js";

export class McpConnectorService {
  constructor({ env = process.env, tokenVault = null, mcpManager = null, logger = null, registryPath = null } = {}) {
    this.env = env;
    this.vault = tokenVault ?? new TokenVault();
    this.mcp = mcpManager ?? new McpClientManager();
    this.logger = logger;
    this._pending = new Map();   // connectorId -> flow status
    this._status = new Map();    // connectorId -> { connected, tools, error, provider, transport }
    // Persisted registry of connectors the user added — shared by JON desktop
    // and JON mobile (both talk to this one service), survives restarts.
    this._registryPath = registryPath ?? env.COWORK_MCP_CONNECTORS_PATH ?? path.join(os.homedir(), ".cowork", "mcp-connectors.json");
    this._registry = new Map(); // connectorId -> { id, kind, provider, label, connection, createdAt }
    this.#loadRegistry();
  }

  #loadRegistry() {
    try {
      const raw = fs.readFileSync(this._registryPath, "utf8");
      const parsed = JSON.parse(raw);
      for (const entry of parsed.connectors ?? []) {
        if (entry?.id) this._registry.set(entry.id, entry);
      }
    } catch { /* no registry yet */ }
  }

  #persistRegistry() {
    try {
      fs.mkdirSync(path.dirname(this._registryPath), { recursive: true });
      fs.writeFileSync(this._registryPath, JSON.stringify({ connectors: [...this._registry.values()] }, null, 2), "utf8");
    } catch (error) {
      this.#log({ event: "registry_persist_failed", error: error.message });
    }
  }

  #register(entry) {
    this._registry.set(entry.id, { ...this._registry.get(entry.id), ...entry, updatedAt: new Date().toISOString() });
    this.#persistRegistry();
  }

  // Unified list for the settings UI (desktop + mobile): persisted connectors,
  // each enriched with live status.
  listConnectors() {
    return [...this._registry.values()].map((entry) => ({
      ...entry,
      ...this.status(entry.id)
    }));
  }

  #log(entry) {
    try { this.logger?.safeLog?.({ kind: "mcp.connector", ...entry }); } catch { /* ignore */ }
  }

  status(connectorId) {
    const s = this._status.get(connectorId) ?? { connected: false, tools: [] };
    const pending = this._pending.get(connectorId) ?? null;
    return {
      connectorId,
      connected: Boolean(s.connected),
      authPending: Boolean(pending && pending.phase !== "done" && pending.phase !== "error"),
      phase: pending?.phase ?? (s.connected ? "connected" : "idle"),
      toolCount: s.tools?.length ?? 0,
      tools: s.tools ?? [],
      error: s.error ?? pending?.error ?? null,
      secureTokenStore: this.vault.isSecure()
    };
  }

  // ── Local stdio MCP server (no OAuth) ─────────────────────────────────────
  async connectStdio(connectorId, connection) {
    try {
      const tools = await this.mcp.connect(connectorId, { transport: "stdio", ...connection });
      this._status.set(connectorId, { connected: true, tools, transport: "stdio" });
      this.#register({ id: connectorId, kind: "stdio", label: connection.label ?? connectorId, connection, createdAt: new Date().toISOString() });
      this.#log({ event: "stdio_connected", connectorId, toolCount: tools.length });
      return { connected: true, tools };
    } catch (error) {
      this._status.set(connectorId, { connected: false, tools: [], error: error.message });
      this.#log({ event: "stdio_failed", connectorId, error: error.message });
      throw error;
    }
  }

  // ── Remote MCP server connect (spec OAuth: discovery + DCR, zero config) ──
  // The Composio-style path: pick a server from the catalog (or any URL), click
  // connect, consent — the SDK discovers the auth server and dynamically
  // registers JON. Tokens + the registered client are saved locally (DPAPI).
  async connectRemoteMcp(connectorId, serverConfigOrId, { scopes = null } = {}) {
    const server = resolveMcpServer(serverConfigOrId, { env: this.env });
    if (!server.url) {
      throw new Error(`MCP server "${server.id}" has no endpoint URL. Set COWORK_MCP_${server.id.toUpperCase()}_URL or pass a url.`);
    }

    // 1) Try connecting with any tokens already saved locally (reconnect path).
    const authProvider = new McpOAuthClientProvider({
      vault: this.vault, connectorId, redirectUri: null, clientName: "JON Cowork", scope: scopes ?? server.scope
    });
    // We need a redirect URI before the SDK may start a flow → spin a callback.
    const cb = await startCallbackServer({});
    authProvider._redirectUri = cb.redirectUri;
    let capturedAuthUrl = null;
    authProvider._onRedirect = (u) => { capturedAuthUrl = u; };

    this.#register({ id: connectorId, kind: "mcp_remote", label: server.label, connection: { transport: "http", url: server.url }, createdAt: new Date().toISOString() });

    let result;
    try {
      result = await this.mcp.connectHttpOAuth(connectorId, server.url, authProvider);
    } catch (error) {
      try { cb.close(); } catch { /* ignore */ }
      this._status.set(connectorId, { connected: false, tools: [], error: error.message, provider: server.id });
      throw error;
    }

    if (!result.authRequired) {
      // Connected straight away (saved tokens or open server).
      this._status.set(connectorId, { connected: true, tools: result.tools, transport: "http", provider: server.id });
      try { cb.close(); } catch { /* ignore */ }
      this.#log({ event: "remote_mcp_connected", connectorId, server: server.id, toolCount: result.tools.length });
      return { connectorId, connected: true, tools: result.tools };
    }

    // Needs consent: return the authorize URL, finish in the background.
    this._pending.set(connectorId, { phase: "awaiting_consent", provider: server.id });
    (async () => {
      try {
        const { code } = await cb.waitForCode();
        this._pending.set(connectorId, { phase: "exchanging_code", provider: server.id });
        const tools = await this.mcp.finishHttpOAuth(connectorId, code);
        this._status.set(connectorId, { connected: true, tools, transport: "http", provider: server.id });
        this._pending.set(connectorId, { phase: "done", provider: server.id });
        this.#log({ event: "remote_mcp_connected", connectorId, server: server.id, toolCount: tools.length, viaOAuth: true });
      } catch (error) {
        this._pending.set(connectorId, { phase: "error", provider: server.id, error: error.message });
        this._status.set(connectorId, { connected: false, tools: [], error: error.message, provider: server.id });
        this.#log({ event: "remote_mcp_failed", connectorId, server: server.id, error: error.message });
      }
    })();

    return { connectorId, authorizeUrl: capturedAuthUrl ?? authProvider.lastAuthorizeUrl, server: server.id };
  }

  // ── OAuth connect ─────────────────────────────────────────────────────────
  // Starts the flow: returns an authorize URL for the user to open. The rest
  // (callback → token exchange → MCP connect → tool discovery) completes in the
  // background; poll status() to observe progress.
  async startOAuthConnect(connectorId, providerConfigOrId, { scopes = null } = {}) {
    const provider = resolveOAuthProvider(providerConfigOrId, { env: this.env });
    if (!provider.authorizeUrl || !provider.tokenUrl) {
      throw new Error(`OAuth provider "${provider.id}" has no authorize/token URL configured.`);
    }
    if (!provider.clientId) {
      throw new Error(`OAuth provider "${provider.id}" is missing a client id. Set COWORK_OAUTH_${provider.id.toUpperCase()}_CLIENT_ID.`);
    }

    const cb = await startCallbackServer({});
    const pkce = provider.usesPkce ? generatePkce() : { verifier: null, challenge: null };
    const state = randomState();
    const authorizeUrl = buildAuthorizeUrl(provider, {
      redirectUri: cb.redirectUri,
      state,
      codeChallenge: pkce.challenge,
      scopes
    });

    this._pending.set(connectorId, { phase: "awaiting_consent", provider: provider.id, error: null });
    this.#register({ id: connectorId, kind: "oauth", provider: provider.id, label: provider.label ?? provider.id, createdAt: new Date().toISOString() });
    this.#log({ event: "oauth_started", connectorId, provider: provider.id });

    // Complete in the background.
    (async () => {
      try {
        const { code, state: returnedState } = await cb.waitForCode();
        if (returnedState !== state) throw new Error("OAuth state mismatch (possible CSRF).");
        this._pending.set(connectorId, { phase: "exchanging_code", provider: provider.id });
        const tokens = await exchangeCode(provider, { code, codeVerifier: pkce.verifier, redirectUri: cb.redirectUri });
        await this.vault.save(connectorId, { ...tokens, provider: provider.id });
        this._pending.set(connectorId, { phase: "connecting_mcp", provider: provider.id });

        // Connect the MCP session if the provider exposes one.
        if (provider.mcp?.url) {
          const tools = await this.mcp.connect(connectorId, { transport: provider.mcp.transport ?? "http", url: provider.mcp.url }, { bearerToken: tokens.accessToken });
          this._status.set(connectorId, { connected: true, tools, transport: "http", provider: provider.id });
        } else {
          // OAuth-only connector (no MCP server) — still "connected" for token use.
          this._status.set(connectorId, { connected: true, tools: [], transport: "oauth_only", provider: provider.id });
        }
        this._pending.set(connectorId, { phase: "done", provider: provider.id });
        this.#log({ event: "oauth_connected", connectorId, provider: provider.id, toolCount: this._status.get(connectorId)?.tools?.length ?? 0 });
      } catch (error) {
        this._pending.set(connectorId, { phase: "error", provider: provider.id, error: error.message });
        this._status.set(connectorId, { connected: false, tools: [], error: error.message, provider: provider.id });
        try { cb.close(); } catch { /* ignore */ }
        this.#log({ event: "oauth_failed", connectorId, provider: provider.id, error: error.message });
      }
    })();

    return { connectorId, authorizeUrl, redirectUri: cb.redirectUri, provider: provider.id };
  }

  // Ensure a live, authenticated MCP session — refreshing the token if expired.
  // Falls back to the persisted registry so a connector reconnects after a
  // restart without the caller re-supplying its connection details.
  async #ensureConnected(connectorId, { connection = null, providerConfig = null } = {}) {
    if (this.mcp.isConnected(connectorId)) return;

    const registered = this._registry.get(connectorId) ?? null;
    const effectiveConnection = connection ?? registered?.connection ?? null;

    // Local stdio connector.
    if (effectiveConnection?.command || effectiveConnection?.transport === "stdio") {
      await this.connectStdio(connectorId, effectiveConnection);
      return;
    }

    // OAuth/HTTP connector: refresh token if needed, then connect.
    const provider = resolveOAuthProvider(providerConfig ?? registered?.provider ?? this._status.get(connectorId)?.provider ?? {}, { env: this.env });
    let tokens = await this.vault.load(connectorId);
    if (!tokens?.accessToken) throw new Error(`Connector "${connectorId}" is not authenticated.`);

    const expired = tokens.expiresAt && new Date(tokens.expiresAt).getTime() - 60_000 <= Date.now();
    if (expired && tokens.refreshToken) {
      tokens = await refreshOAuthToken(provider, tokens.refreshToken);
      await this.vault.save(connectorId, { ...tokens, provider: provider.id });
      this.#log({ event: "token_refreshed", connectorId, provider: provider.id });
    }

    const url = effectiveConnection?.url ?? provider.mcp?.url;
    if (!url) throw new Error(`Connector "${connectorId}" has no MCP endpoint URL.`);
    const tools = await this.mcp.connect(connectorId, { transport: "http", url }, { bearerToken: tokens.accessToken });
    this._status.set(connectorId, { connected: true, tools, transport: "http", provider: provider.id });
  }

  async listTools(connectorId, opts = {}) {
    await this.#ensureConnected(connectorId, opts);
    return this.mcp.listTools(connectorId);
  }

  // Invoke a tool, with one transparent refresh+retry on auth failure.
  async callTool(connectorId, toolName, args = {}, opts = {}) {
    await this.#ensureConnected(connectorId, opts);
    try {
      const result = await this.mcp.callTool(connectorId, toolName, args);
      this.#log({ event: "tool_called", connectorId, tool: toolName, isError: result.isError });
      return result;
    } catch (error) {
      if (/401|unauthor|expired|token/i.test(error.message)) {
        // Force a reconnect with a refreshed token.
        await this.mcp.disconnect(connectorId);
        await this.#ensureConnected(connectorId, opts);
        const result = await this.mcp.callTool(connectorId, toolName, args);
        this.#log({ event: "tool_called_after_refresh", connectorId, tool: toolName });
        return result;
      }
      this.#log({ event: "tool_failed", connectorId, tool: toolName, error: error.message });
      throw error;
    }
  }

  async disconnect(connectorId) {
    await this.mcp.disconnect(connectorId);
    await this.vault.clear(connectorId);
    this._status.delete(connectorId);
    this._pending.delete(connectorId);
    this._registry.delete(connectorId);
    this.#persistRegistry();
    return { disconnected: true };
  }

  // All tools currently exposed across connected MCP connectors — for the planner
  // and the settings UI. Each carries its connectorId so it can be invoked.
  listAllConnectedTools() {
    const out = [];
    for (const [connectorId, s] of this._status.entries()) {
      if (!s.connected) continue;
      for (const tool of s.tools ?? []) {
        out.push({ connectorId, name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema ?? null });
      }
    }
    return out;
  }

  async close() {
    await this.mcp.disconnectAll();
  }
}
