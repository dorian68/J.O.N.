// Catalog of remote MCP servers — the Composio-style "app directory".
//
// Each entry is a remote MCP endpoint. Connecting uses the MCP OAuth spec
// (discovery + dynamic client registration), so NO per-app developer setup is
// required for spec-compliant servers — just click connect and consent.
//
// URLs are resolvable from env (COWORK_MCP_<ID>_URL) so an operator can point an
// entry at the current official endpoint without code changes, and ANY remote
// MCP URL can be added ad hoc. The list is intentionally broad and grouped; it
// grows by data, not code.
const CATALOG = [
  // Productivity & docs
  { id: "notion", label: "Notion", category: "Productivity", url: "https://mcp.notion.com/mcp" },
  { id: "linear", label: "Linear", category: "Productivity", url: "https://mcp.linear.app/mcp" },
  { id: "asana", label: "Asana", category: "Productivity" },
  { id: "clickup", label: "ClickUp", category: "Productivity" },
  { id: "todoist", label: "Todoist", category: "Productivity" },
  { id: "atlassian", label: "Jira / Confluence (Atlassian)", category: "Productivity", url: "https://mcp.atlassian.com/v1/sse" },
  { id: "monday", label: "monday.com", category: "Productivity" },

  // Dev
  { id: "github", label: "GitHub", category: "Developer", url: "https://api.githubcopilot.com/mcp/" },
  { id: "gitlab", label: "GitLab", category: "Developer" },
  { id: "sentry", label: "Sentry", category: "Developer", url: "https://mcp.sentry.dev/mcp" },
  { id: "vercel", label: "Vercel", category: "Developer", url: "https://mcp.vercel.com" },
  { id: "cloudflare", label: "Cloudflare", category: "Developer" },

  // Communication
  { id: "slack", label: "Slack", category: "Communication" },
  { id: "discord", label: "Discord", category: "Communication" },
  { id: "intercom", label: "Intercom", category: "Communication", url: "https://mcp.intercom.com/mcp" },

  // Google / Microsoft
  { id: "google_drive", label: "Google Drive", category: "Files" },
  { id: "google_calendar", label: "Google Calendar", category: "Productivity" },
  { id: "gmail", label: "Gmail", category: "Communication" },
  { id: "microsoft365", label: "Microsoft 365", category: "Productivity" },

  // Files & storage
  { id: "dropbox", label: "Dropbox", category: "Files" },
  { id: "box", label: "Box", category: "Files" },

  // CRM & business
  { id: "hubspot", label: "HubSpot", category: "CRM" },
  { id: "salesforce", label: "Salesforce", category: "CRM" },
  { id: "stripe", label: "Stripe", category: "Payments", url: "https://mcp.stripe.com" },
  { id: "shopify", label: "Shopify", category: "Commerce" },
  { id: "airtable", label: "Airtable", category: "Data" },

  // Design & media
  { id: "figma", label: "Figma", category: "Design" },

  // Knowledge / search
  { id: "exa", label: "Exa Search", category: "Search", url: "https://mcp.exa.ai/mcp" },
  { id: "perplexity", label: "Perplexity", category: "Search" },
  { id: "brave_search", label: "Brave Search", category: "Search" },
  { id: "tavily", label: "Tavily", category: "Search" },
  { id: "wikipedia", label: "Wikipedia", category: "Search" },

  // Productivity & docs (extended)
  { id: "trello", label: "Trello", category: "Productivity" },
  { id: "coda", label: "Coda", category: "Productivity" },
  { id: "confluence", label: "Confluence", category: "Productivity" },
  { id: "calendly", label: "Calendly", category: "Productivity" },
  { id: "zoom", label: "Zoom", category: "Communication" },
  { id: "microsoft_teams", label: "Microsoft Teams", category: "Communication" },
  { id: "outlook", label: "Outlook", category: "Communication" },

  // Developer (extended)
  { id: "bitbucket", label: "Bitbucket", category: "Developer" },
  { id: "jira", label: "Jira", category: "Developer" },
  { id: "pagerduty", label: "PagerDuty", category: "Developer" },
  { id: "datadog", label: "Datadog", category: "Developer" },
  { id: "grafana", label: "Grafana", category: "Developer", url: "https://mcp.grafana.com/mcp" },
  { id: "netlify", label: "Netlify", category: "Developer", url: "https://mcp.netlify.com/mcp" },
  { id: "render", label: "Render", category: "Developer" },
  { id: "supabase", label: "Supabase", category: "Data" },
  { id: "neon", label: "Neon", category: "Data", url: "https://mcp.neon.tech/mcp" },
  { id: "postgres", label: "PostgreSQL", category: "Data" },
  { id: "mongodb", label: "MongoDB", category: "Data" },
  { id: "snowflake", label: "Snowflake", category: "Data" },
  { id: "bigquery", label: "Google BigQuery", category: "Data" },

  // CRM / business (extended)
  { id: "pipedrive", label: "Pipedrive", category: "CRM" },
  { id: "zendesk", label: "Zendesk", category: "CRM" },
  { id: "freshdesk", label: "Freshdesk", category: "CRM" },
  { id: "mailchimp", label: "Mailchimp", category: "Marketing" },
  { id: "sendgrid", label: "SendGrid", category: "Marketing" },
  { id: "twilio", label: "Twilio", category: "Communication" },
  { id: "quickbooks", label: "QuickBooks", category: "Finance" },
  { id: "xero", label: "Xero", category: "Finance" },
  { id: "plaid", label: "Plaid", category: "Finance", url: "https://api.dashboard.plaid.com/mcp/sandbox" },
  { id: "paypal", label: "PayPal", category: "Payments", url: "https://mcp.paypal.com/mcp" },
  { id: "square", label: "Square", category: "Payments", url: "https://mcp.squareup.com/sse" },

  // Commerce / media / design (extended)
  { id: "woocommerce", label: "WooCommerce", category: "Commerce" },
  { id: "webflow", label: "Webflow", category: "Design", url: "https://mcp.webflow.com/sse" },
  { id: "canva", label: "Canva", category: "Design", url: "https://mcp.canva.com/mcp" },
  { id: "youtube", label: "YouTube", category: "Media" },
  { id: "spotify", label: "Spotify", category: "Media" },
  { id: "google_sheets", label: "Google Sheets", category: "Data" },
  { id: "google_docs", label: "Google Docs", category: "Productivity" }
];

function urlEnvKey(id) {
  return `COWORK_MCP_${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_URL`;
}

// Returns the catalog with resolved URLs and a `connectable` flag (true when an
// endpoint URL is known/configured). Entries without a URL still display so the
// operator can set COWORK_MCP_<ID>_URL.
export function listMcpServerCatalog({ env = process.env } = {}) {
  return CATALOG.map((entry) => {
    const envUrl = env[urlEnvKey(entry.id)] ?? null;
    const url = envUrl ?? entry.url ?? null;
    // Honest status (audit F2): only entries with a real endpoint are
    // "available". The rest are "coming_soon" instead of masquerading as working
    // integrations. The UI must keep "Connecter" disabled unless available.
    const status = url ? "available" : "coming_soon";
    return {
      id: entry.id,
      label: entry.label,
      category: entry.category,
      url,
      connectable: Boolean(url),
      status,
      configuredViaEnv: Boolean(envUrl)
    };
  });
}

export function resolveMcpServer(idOrConfig, { env = process.env } = {}) {
  const config = typeof idOrConfig === "string" ? { id: idOrConfig } : (idOrConfig ?? {});
  const base = CATALOG.find((e) => e.id === config.id) ?? null;
  const url = config.url ?? env[urlEnvKey(config.id)] ?? base?.url ?? null;
  return {
    id: config.id ?? "custom",
    label: config.label ?? base?.label ?? config.id ?? "Custom MCP",
    category: base?.category ?? "Custom",
    url,
    scope: config.scope ?? null
  };
}
