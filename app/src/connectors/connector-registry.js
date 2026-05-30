import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { nowIso, createId } from "../utils/ids.js";
import { TEMP_RUNTIME_ROOT } from "../config.js";

// ─── Connector definitions ────────────────────────────────────────────────────
// Each connector declares its capabilities and which actions require explicit
// user approval before execution.

const CONNECTOR_DEFINITIONS = [
  {
    connectorId: "email_draft",
    name: "Email (brouillon local)",
    description: "Crée des brouillons d'email en local. Aucun envoi sans approbation explicite.",
    category: "communication",
    capabilities: ["draft_email", "read_draft"],
    requiresApprovalFor: ["send_email"],
    requiresAuth: false,
    authType: null
  },
  {
    connectorId: "gmail",
    name: "Gmail",
    description: "Lit et envoie des emails via Gmail. Nécessite une authentification OAuth.",
    category: "communication",
    capabilities: ["draft_email", "send_email", "search_email", "read_email"],
    requiresApprovalFor: ["send_email", "delete_email"],
    requiresAuth: true,
    authType: "oauth2"
  },
  {
    connectorId: "google_calendar",
    name: "Google Calendar",
    description: "Lit et crée des événements Calendar.",
    category: "calendar",
    capabilities: ["list_events", "create_event"],
    requiresApprovalFor: ["create_event", "delete_event"],
    requiresAuth: true,
    authType: "oauth2"
  },
  {
    connectorId: "google_drive",
    name: "Google Drive",
    description: "Lit et crée des fichiers Drive.",
    category: "storage",
    capabilities: ["read_file", "create_file", "list_files"],
    requiresApprovalFor: ["delete_file", "create_file"],
    requiresAuth: true,
    authType: "oauth2"
  },
  {
    connectorId: "notion",
    name: "Notion",
    description: "Lit et écrit des pages Notion.",
    category: "knowledge",
    capabilities: ["read_page", "create_page", "search"],
    requiresApprovalFor: ["create_page", "update_page"],
    requiresAuth: true,
    authType: "api_key"
  },
  {
    connectorId: "slack",
    name: "Slack",
    description: "Envoie des messages Slack. Nécessite un token bot.",
    category: "communication",
    capabilities: ["send_message", "list_channels"],
    requiresApprovalFor: ["send_message"],
    requiresAuth: true,
    authType: "api_key"
  },
  {
    connectorId: "github",
    name: "GitHub",
    description: "Lit repos, issues et PRs. Crée des issues.",
    category: "development",
    capabilities: ["list_repos", "read_issue", "create_issue", "list_prs"],
    requiresApprovalFor: ["create_issue", "merge_pr"],
    requiresAuth: true,
    authType: "api_key"
  },
  {
    connectorId: "local_files",
    name: "Fichiers locaux",
    description: "Lit et écrit des fichiers dans le répertoire de travail JON.",
    category: "storage",
    capabilities: ["read_file", "write_file", "list_files"],
    requiresApprovalFor: ["delete_file"],
    requiresAuth: false,
    authType: null
  }
];

const CUSTOM_CONNECTORS_SCHEMA_VERSION = "jon_custom_connectors_v1";

function cleanText(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeConnectorId(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stringList(value, { maxItems = 24, maxLength = 120 } = {}) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/);
  const output = [];
  const seen = new Set();
  for (const item of source) {
    const text = cleanText(item, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeConnectorTools(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((tool, index) => {
    const name = safeConnectorId(tool?.name ?? tool?.id ?? `tool_${index + 1}`) || `tool_${index + 1}`;
    return {
      name,
      title: cleanText(tool?.title ?? tool?.label ?? tool?.name ?? name, 160),
      description: cleanText(tool?.description ?? tool?.summary ?? "", 1200),
      inputSchema: tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : null,
      outputSchema: tool?.outputSchema && typeof tool.outputSchema === "object" ? tool.outputSchema : null,
      tags: stringList(tool?.tags ?? [], { maxItems: 10, maxLength: 80 }),
      affordances: stringList(tool?.affordances ?? [], { maxItems: 8, maxLength: 140 })
    };
  });
}

function normalizeCustomConnector(input = {}) {
  const type = safeConnectorId(input.type ?? input.connectorType ?? "mcp") || "mcp";
  const name = cleanText(input.name ?? input.label ?? input.connectorId ?? "MCP connector", 180);
  const connectorId = safeConnectorId(input.connectorId ?? input.id ?? name);
  if (!connectorId) {
    throw Object.assign(new Error("Connector id or name is required."), { code: "INVALID_PARAMS" });
  }
  const tools = normalizeConnectorTools(input.tools);
  const capabilities = stringList(input.capabilities?.length ? input.capabilities : tools.map((tool) => tool.name), {
    maxItems: 50,
    maxLength: 120
  });
  const normalizedCapabilities = capabilities.length ? capabilities : ["invoke_tool"];
  return {
    connectorId,
    name,
    description: cleanText(input.description ?? `${name} external connector`, 900),
    category: cleanText(input.category ?? (type === "mcp" ? "mcp" : "external"), 80),
    type,
    source: cleanText(input.source ?? "user_configured", 80),
    capabilities: normalizedCapabilities,
    requiresApprovalFor: stringList(input.requiresApprovalFor ?? normalizedCapabilities, { maxItems: 50, maxLength: 120 }),
    requiresAuth: Boolean(input.requiresAuth ?? false),
    authType: input.authType == null ? null : cleanText(input.authType, 80),
    enabled: input.enabled !== false,
    connection: {
      transport: cleanText(input.connection?.transport ?? input.transport ?? (input.url ? "http" : "stdio"), 80),
      command: cleanText(input.connection?.command ?? input.command ?? "", 500),
      args: stringList(input.connection?.args ?? input.args ?? [], { maxItems: 20, maxLength: 220 }),
      url: cleanText(input.connection?.url ?? input.url ?? "", 1000),
      envKeys: stringList(input.connection?.envKeys ?? input.envKeys ?? [], { maxItems: 20, maxLength: 120 })
    },
    tools,
    createdAt: input.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
}

// ─── ConnectorRegistry ────────────────────────────────────────────────────────

export class ConnectorRegistry {
  constructor({ draftsDir = null, registryPath = null } = {}) {
    this._draftsDir = draftsDir ?? path.join(TEMP_RUNTIME_ROOT, "connector-drafts");
    this._registryPath = registryPath ?? process.env.COWORK_CONNECTORS_PATH ?? path.join(os.homedir(), ".cowork", "connectors.json");
    this._customLoaded = false;
    this._customConnectors = [];
    // In-memory connection state — future: persist to DB
    this._connected = new Map([
      ["email_draft", true],   // always available — no auth needed
      ["local_files", true]    // always available — no auth needed
    ]);
    this._actionLog = [];
  }

  // Returns all connectors with their current status
  listConnectors() {
    this._loadCustomConnectors();
    return [...CONNECTOR_DEFINITIONS, ...this._customConnectors].map((def) => ({
      ...def,
      status: this._connectorConnected(def) ? "connected" : "not_connected"
    }));
  }

  // Returns a single connector's public state
  getConnector(connectorId) {
    this._loadCustomConnectors();
    const def = [...CONNECTOR_DEFINITIONS, ...this._customConnectors].find((d) => d.connectorId === connectorId);
    if (!def) return null;
    return { ...def, status: this._connectorConnected(def) ? "connected" : "not_connected" };
  }

  async addConnector(input = {}) {
    this._loadCustomConnectors();
    const connector = normalizeCustomConnector(input);
    if (CONNECTOR_DEFINITIONS.some((def) => def.connectorId === connector.connectorId)) {
      throw Object.assign(new Error(`Built-in connector cannot be replaced: ${connector.connectorId}`), { code: "BUILTIN_CONNECTOR" });
    }
    this._customConnectors = [
      ...this._customConnectors.filter((entry) => entry.connectorId !== connector.connectorId),
      connector
    ].sort((left, right) => left.name.localeCompare(right.name));
    await this._saveCustomConnectors();
    this._connected.set(connector.connectorId, connector.enabled !== false);
    this._logAction({
      connectorId: connector.connectorId,
      capability: "configure_connector",
      params: { type: connector.type, toolCount: connector.tools.length },
      result: { status: this._connectorConnected(connector) ? "connected" : "not_connected" }
    });
    return this.getConnector(connector.connectorId);
  }

  async removeConnector(connectorId) {
    this._loadCustomConnectors();
    const before = this._customConnectors.length;
    this._customConnectors = this._customConnectors.filter((entry) => entry.connectorId !== connectorId);
    if (this._customConnectors.length === before) {
      throw Object.assign(new Error(`Connector not found: ${connectorId}`), { code: "NOT_FOUND" });
    }
    await this._saveCustomConnectors();
    this._connected.delete(connectorId);
    this._logAction({
      connectorId,
      capability: "remove_connector",
      params: {},
      result: { removed: true }
    });
    return { connectorId, removed: true };
  }

  listExternalToolProviders() {
    return this.listConnectors()
      .filter((connector) => connector.type === "mcp" && connector.status === "connected")
      .map((connector) => ({
        id: connector.connectorId,
        name: connector.name,
        label: connector.name,
        enabled: connector.enabled !== false,
        trustLevel: connector.requiresAuth ? "authenticated_external" : "configured_external",
        tools: connector.tools ?? []
      }))
      .filter((provider) => provider.tools.length > 0);
  }

  // Check if an action is available on a connector
  canExecute(connectorId, capability) {
    const connector = this.getConnector(connectorId);
    if (!connector) throw Object.assign(new Error(`Unknown connector: ${connectorId}`), { code: "UNKNOWN_CONNECTOR" });
    if (connector.status !== "connected") {
      throw Object.assign(
        new Error(`Connector "${connector.name}" is not connected. Configure it first.`),
        { code: "CONNECTOR_NOT_CONNECTED", connectorId }
      );
    }
    if (connector.requiresApprovalFor.includes(capability)) {
      throw Object.assign(
        new Error(`Action "${capability}" on "${connector.name}" requires explicit user approval before execution.`),
        { code: "REQUIRES_APPROVAL", connectorId, capability }
      );
    }
    if (!connector.capabilities.includes(capability)) {
      throw Object.assign(
        new Error(`Connector "${connector.name}" does not support: ${capability}`),
        { code: "UNSUPPORTED_CAPABILITY", connectorId, capability }
      );
    }
    return true;
  }

  // ── email_draft connector ────────────────────────────────────────────────────
  // Creates a local draft file — never sends without approval

  async draftEmail({ to, subject, body, attachments = [], runId = null, requestedBy = null } = {}) {
    if (!to) throw Object.assign(new Error("draftEmail requires 'to'."), { code: "INVALID_PARAMS" });
    if (!subject) throw Object.assign(new Error("draftEmail requires 'subject'."), { code: "INVALID_PARAMS" });
    if (!body) throw Object.assign(new Error("draftEmail requires 'body'."), { code: "INVALID_PARAMS" });

    await fs.mkdir(this._draftsDir, { recursive: true });

    const draftId = createId("draft");
    const draft = {
      draftId,
      connectorId: "email_draft",
      status: "pending_approval",
      to: Array.isArray(to) ? to : [to],
      subject: String(subject).slice(0, 500),
      body: String(body).slice(0, 50000),
      attachments,
      runId,
      requestedBy,
      createdAt: nowIso(),
      approvedAt: null,
      sentAt: null
    };

    const draftPath = path.join(this._draftsDir, `${draftId}.json`);
    await fs.writeFile(draftPath, JSON.stringify(draft, null, 2), "utf8");

    this._logAction({
      connectorId: "email_draft",
      capability: "draft_email",
      params: { to: draft.to, subject: draft.subject, bodyLength: draft.body.length },
      result: { draftId, draftPath, status: "pending_approval" },
      runId
    });

    return {
      draftId,
      draftPath,
      status: "pending_approval",
      message: `Email brouillon créé. Approbation requise avant envoi réel. Fichier: ${draftPath}`,
      preview: {
        to: draft.to,
        subject: draft.subject,
        bodyPreview: draft.body.slice(0, 300) + (draft.body.length > 300 ? "…" : "")
      }
    };
  }

  async readDraft(draftId) {
    const draftPath = path.join(this._draftsDir, `${draftId}.json`);
    const raw = await fs.readFile(draftPath, "utf8").catch(() => null);
    if (!raw) throw Object.assign(new Error(`Draft not found: ${draftId}`), { code: "NOT_FOUND" });
    return JSON.parse(raw);
  }

  async listDrafts() {
    try {
      await fs.mkdir(this._draftsDir, { recursive: true });
      const files = await fs.readdir(this._draftsDir);
      const drafts = [];
      for (const f of files.filter((n) => n.endsWith(".json"))) {
        try {
          const raw = await fs.readFile(path.join(this._draftsDir, f), "utf8");
          drafts.push(JSON.parse(raw));
        } catch { /* skip malformed */ }
      }
      return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  // ── Action log ───────────────────────────────────────────────────────────────

  _logAction({ connectorId, capability, params, result, error = null, runId = null }) {
    this._actionLog.push({
      id: createId("conn_log"),
      connectorId,
      capability,
      params,
      result,
      error,
      runId,
      at: nowIso()
    });
    // Keep last 200 entries in memory
    if (this._actionLog.length > 200) this._actionLog.shift();
  }

  getActionLog({ limit = 50, connectorId = null } = {}) {
    let log = this._actionLog;
    if (connectorId) log = log.filter((e) => e.connectorId === connectorId);
    return log.slice(-limit).reverse();
  }

  _connectorConnected(def = {}) {
    if (this._connected.has(def.connectorId)) {
      return this._connected.get(def.connectorId);
    }
    return def.enabled !== false && def.source === "user_configured";
  }

  _loadCustomConnectors() {
    if (this._customLoaded) return;
    this._customLoaded = true;
    try {
      const raw = fsSync.readFileSync(this._registryPath, "utf8");
      const parsed = JSON.parse(raw);
      const connectors = Array.isArray(parsed?.connectors) ? parsed.connectors : [];
      this._customConnectors = connectors.map((entry) => normalizeCustomConnector(entry));
      for (const connector of this._customConnectors) {
        this._connected.set(connector.connectorId, connector.enabled !== false);
      }
    } catch {
      this._customConnectors = [];
    }
  }

  async _saveCustomConnectors() {
    await fs.mkdir(path.dirname(this._registryPath), { recursive: true });
    await fs.writeFile(this._registryPath, JSON.stringify({
      schemaVersion: CUSTOM_CONNECTORS_SCHEMA_VERSION,
      updatedAt: nowIso(),
      connectors: this._customConnectors
    }, null, 2), "utf8");
  }
}
