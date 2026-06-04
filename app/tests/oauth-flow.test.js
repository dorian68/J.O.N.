import assert from "node:assert/strict";
import http from "node:http";
import {
  generatePkce, randomState, buildAuthorizeUrl, exchangeCode, refreshToken, startCallbackServer
} from "../src/connectors/oauth-flow.js";
import { resolveOAuthProvider } from "../src/connectors/oauth-provider-catalog.js";
import { TokenVault } from "../src/connectors/token-vault.js";

function startMockTokenServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        res.writeHead(200, { "content-type": "application/json" });
        if (params.get("grant_type") === "authorization_code") {
          res.end(JSON.stringify({ access_token: "acc-1", refresh_token: "ref-1", token_type: "Bearer", expires_in: 3600, scope: "read" }));
        } else if (params.get("grant_type") === "refresh_token") {
          res.end(JSON.stringify({ access_token: "acc-2", token_type: "Bearer", expires_in: 3600 }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

export async function run() {
  // PKCE + authorize URL
  const pkce = generatePkce();
  assert.ok(pkce.verifier.length > 20 && pkce.challenge.length > 20);
  assert.notEqual(pkce.verifier, pkce.challenge);

  const mock = await startMockTokenServer();
  try {
    const provider = resolveOAuthProvider({
      id: "mockprov",
      authorizeUrl: "https://example.test/authorize",
      tokenUrl: `http://127.0.0.1:${mock.port}/token`,
      clientId: "client-123",
      usesPkce: true
    }, { env: {} });

    const state = randomState();
    const url = buildAuthorizeUrl(provider, { redirectUri: "http://127.0.0.1:9/cb", state, codeChallenge: pkce.challenge, scopes: ["read"] });
    assert.match(url, /response_type=code/);
    assert.match(url, /code_challenge_method=S256/);
    assert.match(url, /client_id=client-123/);

    // Code exchange against mock token server
    const tokens = await exchangeCode(provider, { code: "the-code", codeVerifier: pkce.verifier, redirectUri: "http://127.0.0.1:9/cb" });
    assert.equal(tokens.accessToken, "acc-1");
    assert.equal(tokens.refreshToken, "ref-1");
    assert.ok(tokens.expiresAt, "expiresAt computed from expires_in");

    // Refresh keeps old refresh token when provider omits a new one
    const refreshed = await refreshToken(provider, "ref-1");
    assert.equal(refreshed.accessToken, "acc-2");
    assert.equal(refreshed.refreshToken, "ref-1");

    // Loopback callback server captures code+state
    const cb = await startCallbackServer({});
    assert.match(cb.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    const codePromise = cb.waitForCode();
    await fetch(`${cb.redirectUri}?code=cb-code&state=${state}`);
    const received = await codePromise;
    assert.equal(received.code, "cb-code");
    assert.equal(received.state, state);
  } finally {
    mock.server.close();
  }

  // Token vault with an injected fake secret store (in-memory fallback path)
  const vault = new TokenVault({ secretStore: { isSupported: () => false } });
  assert.equal(vault.isSecure(), false);
  await vault.save("c1", { accessToken: "x", expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal((await vault.load("c1")).accessToken, "x");
  assert.equal(await vault.hasValidAccess("c1"), true);
  await vault.save("c2", { accessToken: "y", expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await vault.hasValidAccess("c2"), false, "expired token is invalid");
  await vault.clear("c1");
  assert.equal(await vault.load("c1"), null);
}
