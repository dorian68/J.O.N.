// OAuthClientProvider for remote MCP servers — the zero-config path.
//
// The MCP authorization spec lets the client DISCOVER the auth server from the
// MCP endpoint and DYNAMICALLY REGISTER itself (RFC 7591), so connecting needs
// NO pre-registered client_id/secret. This provider plugs the SDK's built-in
// OAuth machinery into JON's local DPAPI vault: the dynamically-registered
// client and the resulting tokens are saved locally and reused across restarts.
import crypto from "node:crypto";

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class McpOAuthClientProvider {
  constructor({ vault, connectorId, redirectUri, clientName = "JON Cowork", scope = null, onRedirect = null }) {
    this.vault = vault;
    this.connectorId = connectorId;
    this._redirectUri = redirectUri;
    this._clientName = clientName;
    this._scope = scope;
    this._onRedirect = onRedirect;
    this._state = b64url(crypto.randomBytes(16));
    this._codeVerifier = null;
    this.lastAuthorizeUrl = null;
  }

  get redirectUrl() { return this._redirectUri; }

  get clientMetadata() {
    return {
      client_name: this._clientName,
      redirect_uris: [this._redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this._scope ? { scope: this._scope } : {})
    };
  }

  state() { return this._state; }

  async #record() {
    return (await this.vault.load(this.connectorId)) ?? {};
  }
  async #merge(patch) {
    const current = await this.#record();
    await this.vault.save(this.connectorId, { ...current, ...patch });
  }

  async clientInformation() {
    return (await this.#record()).clientInfo ?? undefined;
  }
  async saveClientInformation(info) {
    await this.#merge({ clientInfo: info });
  }

  async tokens() {
    return (await this.#record()).tokens ?? undefined;
  }
  async saveTokens(tokens) {
    await this.#merge({ tokens });
  }

  async redirectToAuthorization(authorizationUrl) {
    this.lastAuthorizeUrl = authorizationUrl.toString();
    if (this._onRedirect) this._onRedirect(this.lastAuthorizeUrl);
  }

  saveCodeVerifier(verifier) { this._codeVerifier = verifier; }
  codeVerifier() {
    if (!this._codeVerifier) throw new Error("No PKCE code verifier in this flow.");
    return this._codeVerifier;
  }
}
