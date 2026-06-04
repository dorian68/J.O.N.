// OAuth provider catalog — the "Composio-like" registry of connectable services.
//
// Each entry declares the OAuth2 endpoints and scopes. Client credentials are
// NOT hard-coded: they are read from env (COWORK_OAUTH_<ID>_CLIENT_ID /
// _CLIENT_SECRET) or supplied per-connector, so the same code works for any
// provider the operator registers. A "custom" entry lets a user point at any
// OAuth2 + MCP endpoint without code changes (scalable by configuration).

const BUILTIN_PROVIDERS = {
  github: {
    id: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: ["repo", "read:user"],
    usesPkce: false,
    // Many remote MCP servers expose Streamable HTTP; the operator sets the URL.
    mcp: { transport: "http", urlEnv: "COWORK_MCP_GITHUB_URL" }
  },
  notion: {
    id: "notion",
    label: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    defaultScopes: [],
    usesPkce: false,
    mcp: { transport: "http", urlEnv: "COWORK_MCP_NOTION_URL" }
  },
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    usesPkce: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    mcp: { transport: "http", urlEnv: "COWORK_MCP_GOOGLE_URL" }
  }
};

function envCreds(id, env) {
  const upper = String(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return {
    clientId: env[`COWORK_OAUTH_${upper}_CLIENT_ID`] ?? null,
    clientSecret: env[`COWORK_OAUTH_${upper}_CLIENT_SECRET`] ?? null,
    mcpUrl: env[`COWORK_MCP_${upper}_URL`] ?? null
  };
}

// Resolve a provider descriptor, merging a built-in entry (if any) with a
// per-connector override (for fully custom OAuth2 endpoints) and env credentials.
export function resolveOAuthProvider(idOrConfig, { env = process.env } = {}) {
  const config = typeof idOrConfig === "string" ? { id: idOrConfig } : (idOrConfig ?? {});
  const base = BUILTIN_PROVIDERS[config.id] ?? null;

  const merged = {
    id: config.id ?? "custom",
    label: config.label ?? base?.label ?? config.id ?? "Custom",
    authorizeUrl: config.authorizeUrl ?? base?.authorizeUrl ?? null,
    tokenUrl: config.tokenUrl ?? base?.tokenUrl ?? null,
    defaultScopes: config.scopes ?? base?.defaultScopes ?? [],
    usesPkce: config.usesPkce ?? base?.usesPkce ?? true,
    extraAuthorizeParams: { ...(base?.extraAuthorizeParams ?? {}), ...(config.extraAuthorizeParams ?? {}) },
    mcp: config.mcp ?? base?.mcp ?? null
  };

  const creds = envCreds(merged.id, env);
  merged.clientId = config.clientId ?? creds.clientId ?? null;
  merged.clientSecret = config.clientSecret ?? creds.clientSecret ?? null;
  if (!merged.mcp?.url && creds.mcpUrl) {
    merged.mcp = { ...(merged.mcp ?? { transport: "http" }), url: creds.mcpUrl };
  }
  return merged;
}

export function listOAuthProviders({ env = process.env } = {}) {
  return Object.values(BUILTIN_PROVIDERS).map((p) => {
    const creds = envCreds(p.id, env);
    return {
      id: p.id,
      label: p.label,
      usesPkce: p.usesPkce,
      configured: Boolean(creds.clientId), // can we even start the flow?
      scopes: p.defaultScopes
    };
  });
}

export { BUILTIN_PROVIDERS };
