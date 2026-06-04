// OAuth2 Authorization-Code (+ PKCE) flow — hand-rolled, dependency-free.
//
// Implements the "connect a service" half of a Composio-like experience:
//   buildAuthorizeUrl → user consents in browser → loopback callback captures
//   the code → exchangeCode → tokens → (refresh when expired).
//
// A short-lived loopback HTTP server on 127.0.0.1 receives the provider's
// redirect, so no public callback URL is required.
import http from "node:http";
import crypto from "node:crypto";

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState() {
  return base64url(crypto.randomBytes(16));
}

export function buildAuthorizeUrl(provider, { redirectUri, state, codeChallenge, scopes }) {
  if (!provider.authorizeUrl || !provider.clientId) {
    throw new Error(`OAuth provider "${provider.id}" is not configured (missing authorizeUrl or clientId).`);
  }
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  const scopeList = (scopes ?? provider.defaultScopes ?? []);
  if (scopeList.length > 0) url.searchParams.set("scope", scopeList.join(" "));
  if (provider.usesPkce && codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(provider.extraAuthorizeParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

// Normalizes a provider token response into our token shape.
function normalizeTokenResponse(data) {
  const expiresIn = Number(data.expires_in);
  return {
    accessToken: data.access_token ?? null,
    refreshToken: data.refresh_token ?? null,
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope ?? null,
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    raw: data
  };
}

async function postToken(provider, params) {
  const body = new URLSearchParams(params);
  // Provider may want the secret in the body or as Basic auth; send both-safe.
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (provider.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString("base64")}`;
  }
  const res = await fetch(provider.tokenUrl, { method: "POST", headers, body });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = Object.fromEntries(new URLSearchParams(text)); }
  if (!res.ok || data.error) {
    const err = new Error(`Token endpoint error (${res.status}): ${data.error_description ?? data.error ?? text.slice(0, 200)}`);
    err.code = "OAUTH_TOKEN_ERROR";
    throw err;
  }
  return normalizeTokenResponse(data);
}

export async function exchangeCode(provider, { code, codeVerifier, redirectUri }) {
  const params = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId
  };
  if (provider.clientSecret) params.client_secret = provider.clientSecret;
  if (provider.usesPkce && codeVerifier) params.code_verifier = codeVerifier;
  return postToken(provider, params);
}

export async function refreshToken(provider, refreshTokenValue) {
  const params = {
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
    client_id: provider.clientId
  };
  if (provider.clientSecret) params.client_secret = provider.clientSecret;
  const tokens = await postToken(provider, params);
  // Some providers omit a new refresh token on refresh — keep the old one.
  if (!tokens.refreshToken) tokens.refreshToken = refreshTokenValue;
  return tokens;
}

// Convenience: start callback server and return { redirectUri, waitForCode }.
export function startCallbackServer({ path = "/oauth/callback", timeoutMs = 300_000 } = {}) {
  let resolveCode, rejectCode;
  const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  let settled = false;
  const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); try { server.close(); } catch {} fn(); };

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, "http://127.0.0.1");
    if (reqUrl.pathname !== path) { res.writeHead(404); res.end("Not found"); return; }
    const code = reqUrl.searchParams.get("code");
    const state = reqUrl.searchParams.get("state");
    const error = reqUrl.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:3rem">
      <h2>${error ? "❌ Connexion refusée" : "✅ Connecté à JON"}</h2>
      <p>${error || "Vous pouvez fermer cet onglet et revenir à JON."}</p></body>`);
    if (error) finish(() => { const e = new Error(`OAuth authorization failed: ${error}`); e.code = "OAUTH_DENIED"; rejectCode(e); });
    else if (!code) finish(() => { const e = new Error("OAuth callback missing code."); e.code = "OAUTH_NO_CODE"; rejectCode(e); });
    else finish(() => resolveCode({ code, state }));
  });
  const timer = setTimeout(() => finish(() => { const e = new Error("OAuth callback timed out."); e.code = "OAUTH_TIMEOUT"; rejectCode(e); }), timeoutMs);
  server.on("error", (e) => finish(() => rejectCode(e)));

  return new Promise((resolveServer, rejectServer) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolveServer({
        port,
        redirectUri: `http://127.0.0.1:${port}${path}`,
        waitForCode: () => codePromise,
        close: () => finish(() => {})
      });
    });
    server.on("error", rejectServer);
  });
}
