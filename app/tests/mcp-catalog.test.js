import assert from "node:assert/strict";
import { listMcpServerCatalog, resolveMcpServer } from "../src/connectors/mcp-server-catalog.js";
import { McpOAuthClientProvider } from "../src/connectors/mcp-oauth-provider.js";

function memVault() {
  const m = new Map();
  return {
    isSecure: () => false,
    save: async (id, v) => { m.set(id, v); },
    load: async (id) => m.get(id) ?? null,
    clear: async (id) => { m.delete(id); }
  };
}

export async function run() {
  // Catalog returns many entries with a connectable flag.
  const catalog = listMcpServerCatalog({ env: {} });
  assert.ok(catalog.length >= 20, "catalog has a broad set of servers");
  assert.ok(catalog.some((e) => e.id === "notion" && e.connectable), "known server is connectable");
  assert.ok(catalog.every((e) => typeof e.label === "string" && typeof e.category === "string"));

  // Env can supply/override a server URL (operator points an entry at a URL).
  const withEnv = listMcpServerCatalog({ env: { COWORK_MCP_ASANA_URL: "https://mcp.asana.test/mcp" } });
  const asana = withEnv.find((e) => e.id === "asana");
  assert.equal(asana.connectable, true);
  assert.equal(asana.url, "https://mcp.asana.test/mcp");

  // resolveMcpServer merges config + env.
  const r = resolveMcpServer({ id: "custom", url: "https://x.test/mcp", label: "X" }, { env: {} });
  assert.equal(r.url, "https://x.test/mcp");

  // OAuth client provider persists DCR client info + tokens in the vault.
  const vault = memVault();
  let redirected = null;
  const provider = new McpOAuthClientProvider({
    vault, connectorId: "c1", redirectUri: "http://127.0.0.1:9/oauth/callback",
    clientName: "JON", onRedirect: (u) => { redirected = u; }
  });
  assert.match(provider.redirectUrl, /oauth\/callback/);
  const meta = provider.clientMetadata;
  assert.deepEqual(meta.grant_types, ["authorization_code", "refresh_token"]);
  assert.equal(meta.token_endpoint_auth_method, "none");
  assert.ok(provider.state().length > 10);

  await provider.saveClientInformation({ client_id: "dyn-123" });
  assert.equal((await provider.clientInformation()).client_id, "dyn-123");
  await provider.saveTokens({ access_token: "a", token_type: "Bearer", refresh_token: "r" });
  assert.equal((await provider.tokens()).access_token, "a");
  // client info preserved after saving tokens (merge, not overwrite)
  assert.equal((await provider.clientInformation()).client_id, "dyn-123");

  provider.saveCodeVerifier("verifier-xyz");
  assert.equal(provider.codeVerifier(), "verifier-xyz");

  await provider.redirectToAuthorization(new URL("https://auth.test/authorize?x=1"));
  assert.match(redirected, /auth\.test\/authorize/);
}
