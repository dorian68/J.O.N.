# MCP & Tools Connector — Architecture & Specification

> A **local-first, Composio-style tool/integration layer**: a catalog of services,
> 2-click OAuth connection, encrypted local token storage, and real tool
> invocation over the **Model Context Protocol (MCP)** — exposed to an LLM agent.
>
> This document specifies the component **completely enough to re-implement it
> from scratch** in another codebase. It is deliberately exhaustive: capabilities,
> module-by-module API, data models, flows, HTTP surface, security, dependencies,
> extension points, and a port checklist.

---

## 1. Purpose & value proposition

Most agents can *describe* tools but can't *connect to* and *call* them. This
component closes that gap, **without a third-party SaaS**:

- **Catalog** of connectable services (remote MCP servers + OAuth providers).
- **2-click connect** via OAuth — and for spec-compliant MCP servers, **zero
  developer pre-registration** thanks to OAuth **Dynamic Client Registration**.
- **Local, encrypted token storage** (Windows DPAPI; pluggable).
- **Real tool invocation** over MCP (stdio + Streamable HTTP), with auto tool
  discovery and transparent token refresh.
- **Agent exposure**: connected tools become capabilities the planner can see and
  the conversation agent can auto-invoke.
- **Shared** across surfaces (one service instance ⇒ desktop and mobile UIs see
  the same connectors).

Comparison with Composio: same four pillars (catalog → managed auth → tools →
invocation), but **local/private** (tokens never leave the machine) and **no
vendor lock-in**. The only thing Composio adds is *hosted OAuth apps for direct
(non-MCP) APIs*; this component avoids that need by targeting **MCP servers**
(which self-register via DCR) and, optionally, direct-API OAuth when you supply a
client id/secret.

---

## 2. Three connection modes

| Mode | When | Pre-registration | Entry point |
|---|---|---|---|
| **Remote MCP (recommended)** | A hosted MCP server (e.g. `https://mcp.notion.com/mcp`) | **None** — discovery + Dynamic Client Registration (RFC 7591) + PKCE | `connectRemoteMcp()` |
| **Local stdio MCP** | A local MCP server process (`npx some-mcp`) | None (no auth) | `connectStdio()` |
| **Direct-API OAuth** | A SaaS REST API behind OAuth2 (no MCP) | You set `CLIENT_ID/SECRET` env | `startOAuthConnect()` |

All three converge to the same registry, token vault, status model, and tool list.

---

## 3. Architecture

### 3.1 Module map

```
connectors/
  mcp-server-catalog.js      # directory of remote MCP servers (data-driven)
  oauth-provider-catalog.js  # directory of direct-API OAuth providers
  oauth-flow.js              # hand-rolled OAuth2 + PKCE + loopback callback
  token-vault.js             # encrypted per-connector token storage (DPAPI + fallback)
  mcp-oauth-provider.js      # SDK OAuthClientProvider backed by the vault (DCR)
  mcp-client.js              # MCP sessions: connect / discover / callTool
  mcp-connector-service.js   # ORCHESTRATOR: ties everything together (the public face)
```

Dependency direction (no cycles):

```
mcp-connector-service ─┬─> mcp-client ──────────> @modelcontextprotocol/sdk
                       ├─> mcp-oauth-provider ──> token-vault ──> OS secret store
                       ├─> oauth-flow                 (DPAPI / Keychain / libsecret / file)
                       ├─> oauth-provider-catalog
                       └─> mcp-server-catalog
```

### 3.2 Layering

```
UI (any surface) ──HTTP──> Host service methods ──> McpConnectorService ──> {mcp-client, oauth, vault}
                                   │
                                   └─> Planner/agent exposure (capability graph + conversation capability)
```

The component is **transport-agnostic above the service**: any HTTP server (or
even direct in-process calls) can drive `McpConnectorService`.

---

## 4. Data models

### 4.1 Connector registry entry (persisted)
```jsonc
{
  "id": "notion",                 // connectorId (stable key)
  "kind": "mcp_remote",           // "mcp_remote" | "stdio" | "oauth"
  "provider": "notion",           // catalog/provider id (when applicable)
  "label": "Notion",
  "connection": { "transport": "http", "url": "https://mcp.notion.com/mcp" }, // stdio: {command,args,env}
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```
Persisted as `{ connectors: [...] }` at `~/.cowork/mcp-connectors.json`
(override: `COWORK_MCP_CONNECTORS_PATH`).

### 4.2 Token record (encrypted at rest, keyed by connectorId)
```jsonc
// Direct-API OAuth (oauth-flow shape):
{ "accessToken": "...", "refreshToken": "...", "tokenType": "Bearer",
  "scope": "read", "expiresAt": "ISO", "savedAt": "ISO", "provider": "github" }

// Remote MCP (SDK OAuthClientProvider shape):
{ "clientInfo": { "client_id": "dyn-...", ... },   // DCR-registered client
  "tokens": { "access_token": "...", "refresh_token": "...", "expires_in": 3600 } }
```

### 4.3 Tool descriptor (discovered)
```jsonc
{ "connectorId": "notion", "name": "search",
  "description": "...", "inputSchema": { "type": "object", ... } }
```

### 4.4 Status object
```jsonc
{ "connectorId": "notion", "connected": true, "authPending": false,
  "phase": "connected",          // idle|awaiting_consent|exchanging_code|connecting_mcp|done|error|connected
  "toolCount": 7, "tools": [...], "error": null, "secureTokenStore": true }
```

### 4.5 Tool-call result (normalized)
```jsonc
{ "isError": false, "text": "flattened text content",
  "content": [ ...raw MCP content blocks... ], "structured": { ... } | null }
```

---

## 5. Module specifications

### 5.1 `token-vault.js` — `class TokenVault`
Encrypted, per-connector token storage.

- `constructor({ secretStore = createDefaultOsSecretStore() })` — `secure =
  secretStore.isSupported()`. If unsupported (non-Windows/test), uses an
  in-memory `Map` and reports `secure:false`.
- `isSecure(): boolean`
- `async save(connectorId, tokens)` — stores `JSON.stringify({...tokens, savedAt})`
  under alias `connector-oauth-<sanitizedId>`.
- `async load(connectorId): object|null`
- `async clear(connectorId)`
- `async hasValidAccess(connectorId): boolean` — token present and (no `expiresAt`
  or `expiresAt - 60s > now`).

**Secret store contract** (swap per platform): `isSupported()`, `setSecret(alias,
value)`, `getSecret(alias)`, optional `deleteSecret(alias)`. JON's impl is DPAPI
via a PowerShell `ProtectedData.Protect/Unprotect` round-trip. Replace with
Keychain (macOS), libsecret (Linux), or an encrypted file for portability.

### 5.2 `oauth-flow.js` — hand-rolled OAuth2 Authorization-Code + PKCE
No external OAuth dependency (node `http`/`crypto`/`fetch`).

- `generatePkce(): { verifier, challenge }` — `challenge = base64url(sha256(verifier))`.
- `randomState(): string`
- `buildAuthorizeUrl(provider, { redirectUri, state, codeChallenge, scopes }): string`
  — sets `response_type=code`, `client_id`, `redirect_uri`, `state`, `scope`,
  and (if `usesPkce`) `code_challenge` + `code_challenge_method=S256`, plus any
  `provider.extraAuthorizeParams`.
- `async exchangeCode(provider, { code, codeVerifier, redirectUri }): tokens`
- `async refreshToken(provider, refreshTokenValue): tokens` — keeps the old
  refresh token if the provider omits a new one.
- `startCallbackServer({ path = "/oauth/callback", timeoutMs = 300000 }):
  Promise<{ port, redirectUri, waitForCode(): Promise<{code,state}>, close() }>`
  — a one-shot **loopback HTTP server** on `127.0.0.1:<random>` that captures the
  provider redirect (so **no public callback URL** is needed) and serves a
  "you can close this tab" page.
- Internals: `normalizeTokenResponse` → `{ accessToken, refreshToken, tokenType,
  scope, expiresAt, raw }`; token POST is form-encoded with optional HTTP Basic
  (`client_id:client_secret`).

### 5.3 `oauth-provider-catalog.js` — direct-API OAuth providers
- `BUILTIN_PROVIDERS` map; each entry: `{ id, label, authorizeUrl, tokenUrl,
  defaultScopes, usesPkce, extraAuthorizeParams?, mcp?: { transport, urlEnv } }`.
- Credentials are **never hard-coded** — read from env:
  `COWORK_OAUTH_<ID>_CLIENT_ID`, `COWORK_OAUTH_<ID>_CLIENT_SECRET`,
  `COWORK_MCP_<ID>_URL`.
- `resolveOAuthProvider(idOrConfig, { env }): provider` — merges a builtin entry +
  per-connector overrides + env creds (also supports a fully custom provider via a
  config object with `authorizeUrl/tokenUrl`).
- `listOAuthProviders({ env }): [{ id, label, usesPkce, configured, scopes }]`
  (`configured` = a client id is present).

### 5.4 `mcp-server-catalog.js` — remote MCP server directory
- `CATALOG`: array of `{ id, label, category, url? }` (~70 entries; grows by data).
- URL resolution from env `COWORK_MCP_<ID>_URL` (so an operator points an entry at
  the current official endpoint; any URL can be added ad hoc).
- `listMcpServerCatalog({ env }): [{ id, label, category, url, connectable }]`
  (`connectable` = a URL is known/configured).
- `resolveMcpServer(idOrConfig, { env }): { id, label, category, url, scope }`.

### 5.5 `mcp-oauth-provider.js` — `class McpOAuthClientProvider`
Implements the MCP SDK's `OAuthClientProvider` interface, backed by `TokenVault`.
This is what enables **zero-config** remote connections (the SDK drives discovery
+ DCR + PKCE and persists results locally).

- `constructor({ vault, connectorId, redirectUri, clientName, scope, onRedirect })`
- `get redirectUrl()` → loopback callback URI.
- `get clientMetadata()` → `{ client_name, redirect_uris:[redirectUri],
  grant_types:["authorization_code","refresh_token"], response_types:["code"],
  token_endpoint_auth_method:"none", scope? }` (public client + PKCE).
- `state()` → random CSRF state.
- `clientInformation()/saveClientInformation(info)` → vault record `.clientInfo`
  (the DCR-registered client).
- `tokens()/saveTokens(tokens)` → vault record `.tokens`.
- `redirectToAuthorization(url)` → captures the authorize URL (via `onRedirect` +
  `lastAuthorizeUrl`) so the host can open it.
- `saveCodeVerifier(v)/codeVerifier()` → PKCE verifier (per-flow, in-memory).

### 5.6 `mcp-client.js` — `class McpClientManager`
Wraps `@modelcontextprotocol/sdk` clients & transports.

- `isConnected(connectorId)`
- `async connect(connectorId, connection, { bearerToken }): tools` — builds a
  transport (stdio if `connection.command`, else Streamable HTTP from
  `connection.url`, with `Authorization: Bearer` when a token is supplied).
- `async connectWithTransport(connectorId, transport): tools` — for in-memory /
  custom transports (used in tests).
- `async connectHttpOAuth(connectorId, url, authProvider): { tools } | { authRequired:true }`
  — connects with the SDK `authProvider`; on `UnauthorizedError`, stores the
  half-open session and returns `authRequired`.
- `async finishHttpOAuth(connectorId, authorizationCode): tools` —
  `transport.finishAuth(code)` then re-`connect`, then discover tools.
- `async listTools(connectorId): tools`
- `async callTool(connectorId, name, args): { isError, text, content, structured }`
- `async disconnect(connectorId)` / `async disconnectAll()`
- Internal `#registerSession` → `client.listTools()` → normalize → cache.

Transports used: `StdioClientTransport`, `StreamableHTTPClientTransport`
(SSE also available). Tool discovery is `tools/list`; invocation is `tools/call`.

### 5.7 `mcp-connector-service.js` — `class McpConnectorService` (orchestrator)
The single public face. Holds a persisted **registry**, live **status**, and a
**pending** map for in-flight OAuth.

- `constructor({ env, tokenVault, mcpManager, logger, registryPath })`
- `listConnectors()` → registry entries enriched with live status.
- `status(connectorId)` → status object (§4.4).
- `listAllConnectedTools()` → `[{ connectorId, name, description, inputSchema }]`.
- **Local stdio:** `async connectStdio(connectorId, connection)` → discover +
  register (`kind:"stdio"`).
- **Remote MCP (DCR):** `async connectRemoteMcp(connectorId, serverConfigOrId,
  { scopes })`:
  1. resolve server URL; spin a loopback callback (`startCallbackServer`);
  2. build `McpOAuthClientProvider` (redirect = callback URI, `onRedirect`
     captures the authorize URL);
  3. `mcp.connectHttpOAuth(...)`:
     - if it connects (saved tokens / open server) → mark connected, return tools;
     - if `authRequired` → **return the `authorizeUrl`** and, in the background,
       `await cb.waitForCode()` → `mcp.finishHttpOAuth(code)` → mark connected.
- **Direct-API OAuth:** `async startOAuthConnect(connectorId, providerConfigOrId,
  { scopes })`: loopback callback + `buildAuthorizeUrl`; background `waitForCode`
  → `exchangeCode` → `vault.save` → optionally open an MCP session if the provider
  declares an `mcp.url`.
- **Invocation:** `async listTools(...)`, `async callTool(connectorId, tool, args)`
  — both call `#ensureConnected` first (reconnect from the registry: stdio by
  command, OAuth by refreshing the token then HTTP-connecting). `callTool`
  performs **one transparent refresh+retry on a 401/expired** error.
- `async disconnect(connectorId)` → close session, clear vault, remove from
  registry. `async close()` → disconnect all.
- Persistence: `#loadRegistry/#persistRegistry/#register` (JSON file).
- Lifecycle phases surfaced via `status().phase`.

---

## 6. HTTP API surface (host integration)

Two mirror surfaces in JON (desktop loopback `/api/mcp/*`, authenticated mobile
`/api/mobile/mcp/*`). They are thin wrappers over the service.

| Method & path | Service call | Body / returns |
|---|---|---|
| `GET  /mcp/catalog` | `listMcpCatalog()` | `{ catalog: [...] }` |
| `GET  /mcp/providers` | `listMcpProviders()` | `{ providers: [...] }` (direct-API OAuth) |
| `GET  /mcp/connectors` | `listMcpConnectors()` + `listConnectedMcpTools()` | `{ connectors, tools }` |
| `POST /mcp/remote/connect` | `connectRemoteMcpServer(connectorId, server, {scopes})` | → `{ connected }` or `{ authorizeUrl }` |
| `POST /mcp/oauth/start` | `startMcpOAuthConnect(connectorId, providerConfig, {scopes})` | → `{ authorizeUrl }` |
| `POST /mcp/stdio/connect` | `connectMcpStdio(connectorId, connection)` | → `{ connected, tools }` |
| `GET  /mcp/{id}/status` | `getMcpConnectorStatus(id)` | status object |
| `GET  /mcp/{id}/tools` | `listMcpTools(id)` | `{ tools }` |
| `POST /mcp/{id}/call` | `callMcpTool(id, tool, args)` | tool-call result |
| `DELETE /mcp/{id}` | `disconnectMcpConnector(id)` | `{ disconnected }` |

The host service methods (`listMcpCatalog`, `connectRemoteMcpServer`,
`callMcpTool`, …) are 1-line delegations to `McpConnectorService`.

---

## 7. Agent / planner exposure

Two integration points make connected tools *usable by the LLM*:

1. **Capability graph** (planning awareness): connected tools are injected as an
   external tool provider `mcp_live`, each node carrying
   `payload = { providerType: "mcp_live", connectorId, tool }`. The planner can
   then select them.
2. **Conversation auto-invocation**: the agent's capability descriptor advertises
   a `call_mcp_tool` capability (with the list of available `connectorId/tool`),
   and the capability executor runs it via an injected `callMcpTool(connectorId,
   tool, args)`. So in chat the agent can decide to call a connected tool.

(Re-implementation note: this is the only part coupled to the host's agent loop;
everything else is self-contained.)

---

## 8. Key flows (sequence)

### 8.1 Connect a remote MCP server (zero pre-registration)
```
UI: click "Connect Notion"
 → POST /mcp/remote/connect { connectorId:"notion", server:"notion" }
 → service.connectRemoteMcp:
     startCallbackServer() → redirectUri (127.0.0.1:PORT/oauth/callback)
     McpOAuthClientProvider(vault, redirectUri, onRedirect)
     mcp.connectHttpOAuth(url, provider)
        SDK: discover protected-resource + auth-server metadata
        SDK: dynamic client registration (no client_id needed)
        SDK: PKCE authorize → provider.redirectToAuthorization(URL)  ← captured
        throws UnauthorizedError → { authRequired:true }
 ← returns { authorizeUrl }
UI: window.open(authorizeUrl)  → user consents → provider redirects to loopback
 (background) cb.waitForCode() resolves { code }
   → mcp.finishHttpOAuth(code): transport.finishAuth(code) → client.connect() → listTools()
   → status: connected; tokens + DCR client saved in vault
UI: poll /mcp/{id}/status until connected
```

### 8.2 Call a tool (with refresh)
```
callTool(id, "search", {q}) → #ensureConnected(id)
  if not live: load tokens; if expired & refresh present → refreshToken → save
              → mcp.connect(http, bearerToken)
  mcp.callTool → result
  on 401: disconnect → ensureConnected (forces refresh) → retry once
```

### 8.3 Local stdio
```
connectStdio(id, {command:"npx", args:["some-mcp"]})
  → StdioClientTransport spawns the server → listTools → register
```

---

## 9. Security model

- **Tokens encrypted at rest** via the OS secret store (DPAPI on Windows; the
  store is a pluggable interface). In-memory fallback only when no secure store.
- **Public client + PKCE** (`token_endpoint_auth_method: "none"`); no client
  secret stored for MCP/DCR connections.
- **CSRF**: `state` generated and verified on callback (direct-API flow) /
  handled by the SDK (remote MCP).
- **Loopback-only callback** (`127.0.0.1`), one-shot, with timeout.
- **Tool risk gating**: tool descriptors carry `riskLevel`/`requiresApproval`;
  the host should require explicit approval before mutating/destructive tool
  calls (read/list/search run freely).
- **No third party**: credentials and traffic never leave the machine.

---

## 10. Dependencies

- **`@modelcontextprotocol/sdk`** — `Client`, `StdioClientTransport`,
  `StreamableHTTPClientTransport`, `client/auth.js` (`UnauthorizedError`),
  and for tests `server/index.js` + `inMemory.js` (`InMemoryTransport`).
- **Node built-ins** for OAuth: `http`, `crypto`, global `fetch`.
- **OS secret store** (DPAPI here) — replaceable interface.
- No OAuth library required (hand-rolled), no SaaS.

---

## 11. Extension points

- **Add a remote MCP server** → one entry in `mcp-server-catalog.js` (`{id,label,
  category,url?}`) or set `COWORK_MCP_<ID>_URL`.
- **Add a direct-API OAuth provider** → one entry in `oauth-provider-catalog.js` +
  `COWORK_OAUTH_<ID>_CLIENT_ID/SECRET`.
- **Add a custom connector at runtime** → pass a config object (with
  `url`/`authorizeUrl`/`tokenUrl`) instead of an id.
- **Swap secret storage** → implement the `{isSupported,setSecret,getSecret,
  deleteSecret}` interface (Keychain/libsecret/encrypted-file).
- **New surface (UI)** → call the same HTTP routes; connectors are shared.

---

## 12. Testing strategy (deterministic, no network)

- **MCP invocation** → a real `Server` linked to the client via
  `InMemoryTransport.createLinkedPair()`; assert `listTools` + `callTool`.
- **OAuth flow** → a local mock token server; assert PKCE URL, `exchangeCode`,
  `refreshToken`, and the loopback `startCallbackServer` capturing `?code&state`.
- **Token vault** → inject a fake `{isSupported:()=>false}` store (memory path).
- **Catalog** → assert entries + env URL override + `resolveMcpServer`.
- **Orchestrator** → inject a fake `mcpManager` + memory vault; assert connect,
  list, callTool, status, registry persistence (use a temp `registryPath`).
- **OAuthClientProvider** → assert metadata, vault round-trip of clientInfo+tokens.

---

## 13. Re-implementation checklist (port to another stack)

1. Pick an MCP client SDK for your language (TS/Python both exist).
2. Implement the **secret store** interface for your OS (or encrypted file).
3. Port `token-vault` (thin wrapper over the store).
4. Port `oauth-flow` (PKCE + authorize URL + loopback callback + exchange/refresh)
   — or use your stack's OAuth lib.
5. Implement the SDK's `OAuthClientProvider` backed by the vault
   (`mcp-oauth-provider`) — **this unlocks DCR/zero-config**.
6. Port `mcp-client` (sessions, `connect`, `connectHttpOAuth`/`finishHttpOAuth`,
   `listTools`, `callTool`).
7. Port the two **catalogs** (remote MCP servers + direct-API OAuth providers) as
   data files.
8. Port the **orchestrator** (`mcp-connector-service`): registry persistence +
   the three connect modes + `#ensureConnected` + `callTool` refresh/retry.
9. Expose the **HTTP routes** (§6) on your server.
10. Wire **agent exposure** (§7) to your planner/conversation loop.
11. Add the **tests** (§12) to lock behavior.

---

## 14. Edge cases & failure handling

- **No secure store** → memory fallback; `status.secureTokenStore=false` (warn).
- **Provider omits refresh token on refresh** → keep the previous one.
- **OAuth denied / timeout** → `status.phase="error"` with a clear message; callback
  server always closed.
- **Token expired mid-call** → one transparent refresh+retry; if it still fails,
  surface a structured error (caller may re-trigger consent).
- **Server requires no auth** → `connectHttpOAuth` connects directly (no redirect).
- **Restart** → registry reloaded; `#ensureConnected` reconnects from saved tokens
  without user action (until refresh token expires).
- **Renderer/UI offline** → service is headless-usable (call methods directly).

---

## 15. File reference (this repo)

```
app/src/connectors/token-vault.js
app/src/connectors/oauth-flow.js
app/src/connectors/oauth-provider-catalog.js
app/src/connectors/mcp-server-catalog.js
app/src/connectors/mcp-oauth-provider.js
app/src/connectors/mcp-client.js
app/src/connectors/mcp-connector-service.js
app/src/service/operator-service.js        # host methods (listMcp*, callMcpTool, …)
app/src/server/operator-server.js          # /api/mcp/* and /api/mobile/mcp/* routes
app/src/conversation/safe-capabilities.js  # call_mcp_tool capability executor
app/tests/mcp-client.test.js, oauth-flow.test.js, mcp-connector-service.test.js,
app/tests/mcp-catalog.test.js, conversation-mcp-tool.test.js
```

---

*Self-contained except §7 (agent exposure), which couples to the host planner.
Everything else can be lifted as-is into another project.*
