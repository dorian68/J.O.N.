import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { createId, nowIso } from "../utils/ids.js";

const require = createRequire(import.meta.url);

let _WebSocketServer = null;
try { ({ WebSocketServer: _WebSocketServer } = require("ws")); } catch {}

const WS_PATH = "/api/browser-extension/ws";
const DEFAULT_COMMAND_TIMEOUT_MS = 15000;
const MAX_EVENT_STRING_LENGTH = 12000;
const MAX_EVENT_ARRAY_ITEMS = 100;
const MAX_EVENT_OBJECT_KEYS = 120;
const SENSITIVE_KEY_RE = /(password|passwd|pwd|cookie|token|authorization|secret|credential|session|csrf|xsrf|api[-_]?key)/i;
const ALLOWED_COMMANDS = new Set([
  "observe",
  "read_dom",
  "navigate",
  "click",
  "type",
  "select",
  "scroll",
  "press_key",
  "extract_text",
  "highlight"
]);

function clipText(value, limit = MAX_EVENT_STRING_LENGTH) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
}

function sanitizeForLog(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return clipText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);
  if (depth > 6) return "[truncated-depth]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_EVENT_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1));
  }
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, MAX_EVENT_OBJECT_KEYS)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeForLog(child, depth + 1);
  }
  return output;
}

function normalizeTabPayload(payload = {}, fallback = {}) {
  return {
    id: String(payload.tabSessionId ?? payload.id ?? fallback.tabSessionId ?? createId("bext_tab")),
    projectId: payload.projectId ?? fallback.projectId ?? null,
    extensionInstanceId: payload.extensionInstanceId ?? fallback.extensionInstanceId ?? null,
    browserTabId: payload.browserTabId ?? payload.tabId ?? null,
    windowId: payload.windowId ?? null,
    url: typeof payload.url === "string" ? clipText(payload.url, 2048) : null,
    title: typeof payload.title === "string" ? clipText(payload.title, 512) : null,
    status: String(payload.status ?? fallback.status ?? "attached"),
    metadata: sanitizeForLog(payload.metadata ?? {}),
    attachedAt: payload.attachedAt ?? fallback.attachedAt ?? nowIso(),
    lastSeenAt: payload.lastSeenAt ?? nowIso()
  };
}

function normalizeCommand(rawCommand = {}) {
  const action = String(rawCommand.action ?? rawCommand.type ?? "").trim();
  if (!ALLOWED_COMMANDS.has(action)) {
    const error = new Error(`Unsupported browser extension command: ${action || "(empty)"}.`);
    error.code = "INVALID_BROWSER_EXTENSION_COMMAND";
    throw error;
  }
  return {
    action,
    target: sanitizeForLog(rawCommand.target ?? null),
    value: typeof rawCommand.value === "string" ? clipText(rawCommand.value, 8000) : sanitizeForLog(rawCommand.value ?? null),
    options: sanitizeForLog(rawCommand.options ?? {})
  };
}

function isLoopbackAddress(address = "") {
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1"
    || address === "localhost";
}

function isAllowedOrigin(origin = "") {
  if (process.env.COWORK_BROWSER_EXTENSION_TRUST_ANY_ORIGIN === "1") return true;
  return String(origin ?? "").startsWith("chrome-extension://");
}

export class BrowserExtensionBridge extends EventEmitter {
  constructor({ database, onEvent = null, logger = console, resolveDefaultProjectId = null } = {}) {
    super();
    if (!database) {
      throw new Error("BrowserExtensionBridge requires a database.");
    }
    this.database = database;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.logger = logger;
    this.resolveDefaultProjectId = typeof resolveDefaultProjectId === "function" ? resolveDefaultProjectId : null;
    this.connections = new Map();
    this.tabConnections = new Map();
    this.pendingCommands = new Map();
    this.attached = false;
    this.wss = null;
  }

  attachToServer(httpServer) {
    if (this.attached) return true;
    if (!_WebSocketServer) {
      this.logger?.warn?.("[browser-extension] ws package not available - extension bridge disabled.");
      return false;
    }
    this.wss = new _WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname !== WS_PATH) return;

        const remoteAddress = request.socket?.remoteAddress ?? "";
        const allowLan = process.env.COWORK_BROWSER_EXTENSION_ALLOW_LAN === "1";
        if (!allowLan && !isLoopbackAddress(remoteAddress)) {
          socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
          socket.destroy();
          return;
        }

        if (!isAllowedOrigin(request.headers.origin ?? "")) {
          socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => this.#handleConnection(ws, request));
      } catch {
        try { socket.destroy(); } catch {}
      }
    });
    this.attached = true;
    return true;
  }

  close() {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("Browser extension bridge closed."), { code: "BRIDGE_CLOSED" }));
    }
    this.pendingCommands.clear();
    for (const connection of this.connections.values()) {
      try { connection.ws?.close?.(1001, "bridge closed"); } catch {}
    }
    this.connections.clear();
    this.tabConnections.clear();
    try { this.wss?.close?.(); } catch {}
  }

  getHealth() {
    return {
      available: Boolean(_WebSocketServer),
      websocketPath: WS_PATH,
      connectedClients: this.connections.size,
      connectedTabs: this.tabConnections.size,
      pendingCommands: this.pendingCommands.size,
      localOnly: process.env.COWORK_BROWSER_EXTENSION_ALLOW_LAN !== "1",
      cdpEnabled: false
    };
  }

  listTabs({ projectId = null, includeClosed = false, limit = 50 } = {}) {
    return this.database.listBrowserExtensionTabs({ projectId, includeClosed, limit }).map((tab) => ({
      ...tab,
      connected: this.tabConnections.has(tab.id)
    }));
  }

  getTab(tabSessionId) {
    const tab = this.database.getBrowserExtensionTab(tabSessionId);
    return tab ? { ...tab, connected: this.tabConnections.has(tab.id) } : null;
  }

  listEvents(filter = {}) {
    return this.database.listBrowserExtensionEvents(filter);
  }

  async sendCommand(tabSessionId, rawCommand, { projectId = null, runId = null, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    const tab = this.getTab(tabSessionId);
    if (!tab) {
      const error = new Error(`Attached browser tab not found: ${tabSessionId}.`);
      error.code = "BROWSER_EXTENSION_TAB_NOT_FOUND";
      throw error;
    }
    const connection = this.tabConnections.get(tabSessionId);
    if (!connection || connection.ws?.readyState !== 1) {
      const error = new Error(`Attached browser tab is not connected: ${tabSessionId}.`);
      error.code = "BROWSER_EXTENSION_TAB_NOT_CONNECTED";
      throw error;
    }

    const command = normalizeCommand(rawCommand);
    const commandId = createId("bext_cmd");
    const frame = {
      type: "command",
      commandId,
      tabSessionId,
      ...command
    };
    this.#recordEvent({
      tabSessionId,
      projectId: projectId ?? tab.projectId ?? null,
      runId,
      eventType: `command.${command.action}`,
      direction: "outbound",
      actionId: commandId,
      payload: frame
    });

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(Object.assign(new Error(`Browser extension command timed out: ${command.action}.`), {
          code: "BROWSER_EXTENSION_COMMAND_TIMEOUT"
        }));
      }, Math.max(1000, Math.min(Number(timeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS, 120000)));
      // Bind the pending command to the connection it was sent on (audit T4):
      // a result is only accepted back from that same connection.
      this.pendingCommands.set(commandId, { resolve, reject, timer, tabSessionId, connectionId: connection.id });
      try {
        connection.sendJson(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pendingCommands.delete(commandId);
        reject(error);
      }
    });
  }

  #defaultProjectId() {
    try {
      return this.resolveDefaultProjectId?.() ?? null;
    } catch {
      return null;
    }
  }

  #handleConnection(ws, request) {
    const connection = {
      id: createId("bext_conn"),
      ws,
      origin: request.headers.origin ?? null,
      extensionInstanceId: null,
      projectId: null,
      tabSessionIds: new Set(),
      connectedAt: nowIso(),
      sendJson: (payload) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      }
    };
    this.connections.set(connection.id, connection);
    connection.sendJson({
      type: "server_ready",
      connectionId: connection.id,
      websocketPath: WS_PATH,
      cdpEnabled: false,
      connectedAt: connection.connectedAt
    });
    ws.on("message", (message) => this.#handleMessage(connection, message));
    ws.on("close", () => this.#handleDisconnect(connection));
    ws.on("error", () => this.#handleDisconnect(connection));
  }

  #handleDisconnect(connection) {
    if (!this.connections.has(connection.id)) return;
    this.connections.delete(connection.id);
    for (const tabSessionId of connection.tabSessionIds) {
      const current = this.tabConnections.get(tabSessionId);
      if (current?.id === connection.id) {
        this.tabConnections.delete(tabSessionId);
        const existing = this.database.getBrowserExtensionTab(tabSessionId);
        if (existing && existing.status !== "closed") {
          this.database.upsertBrowserExtensionTab({
            ...existing,
            status: "disconnected",
            lastSeenAt: nowIso()
          });
          this.#recordEvent({
            tabSessionId,
            projectId: existing.projectId,
            eventType: "tab.disconnected",
            direction: "inbound",
            payload: { connectionId: connection.id }
          });
        }
      }
    }
  }

  #handleMessage(connection, rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      connection.sendJson({ type: "error", code: "INVALID_JSON", message: "Message is not valid JSON." });
      return;
    }
    const type = String(message.type ?? "");
    try {
      if (type === "hello") {
        this.#handleHello(connection, message);
        return;
      }
      if (type === "tab_attached" || type === "tab_updated" || type === "tab_closed") {
        this.#handleTabMessage(connection, type, message);
        return;
      }
      if (type === "observation" || type === "log") {
        this.#handleTelemetry(connection, type, message);
        return;
      }
      if (type === "command_result") {
        this.#handleCommandResult(connection, message);
        return;
      }
      connection.sendJson({ type: "error", code: "UNKNOWN_MESSAGE_TYPE", message: `Unknown message type: ${type}.` });
    } catch (error) {
      connection.sendJson({ type: "error", code: error.code ?? "BRIDGE_ERROR", message: error.message });
    }
  }

  #handleHello(connection, message) {
    connection.extensionInstanceId = String(message.extensionInstanceId ?? message.instanceId ?? createId("bext_ext"));
    connection.projectId = message.projectId ?? this.#defaultProjectId();
    connection.sendJson({
      type: "hello_ack",
      connectionId: connection.id,
      extensionInstanceId: connection.extensionInstanceId,
      connectedAt: connection.connectedAt,
      cdpEnabled: false
    });
    this.#recordEvent({
      projectId: connection.projectId,
      eventType: "extension.hello",
      direction: "inbound",
      payload: {
        connectionId: connection.id,
        extensionInstanceId: connection.extensionInstanceId,
        version: message.version ?? null,
        browser: message.browser ?? null
      }
    });
  }

  // SECURITY (audit T4): a tab session may only be (re)claimed by the connection
  // that already owns it, or when it is free / the previous owner is dead. This
  // prevents a second local connection from hijacking another's tab routing.
  #canClaimTab(connection, tabSessionId) {
    const current = this.tabConnections.get(tabSessionId);
    if (!current) return true;
    if (current.id === connection.id) return true;
    if (current.ws?.readyState !== 1) return true;
    return false;
  }

  #handleTabMessage(connection, type, message) {
    const status = type === "tab_closed" ? "closed" : (message.status ?? (type === "tab_attached" ? "attached" : "active"));
    const tab = normalizeTabPayload(message, {
      extensionInstanceId: connection.extensionInstanceId,
      projectId: message.projectId ?? connection.projectId ?? this.#defaultProjectId(),
      status
    });
    const saved = this.database.upsertBrowserExtensionTab(tab);
    if (saved.status === "closed") {
      if (this.tabConnections.get(saved.id)?.id === connection.id) this.tabConnections.delete(saved.id);
    } else if (this.#canClaimTab(connection, saved.id)) {
      connection.tabSessionIds.add(saved.id);
      this.tabConnections.set(saved.id, connection);
    } else {
      this.#recordEvent({
        tabSessionId: saved.id, projectId: saved.projectId,
        eventType: "security.tab_takeover_rejected", direction: "inbound",
        payload: { reason: "owned_by_other_connection", connectionId: connection.id }
      });
      connection.sendJson({ type: "error", code: "TAB_OWNED_BY_OTHER_CONNECTION", tabSessionId: saved.id });
      return;
    }
    connection.sendJson({
      type: "tab_ack",
      tabSessionId: saved.id,
      browserTabId: saved.browserTabId,
      status: saved.status
    });
    this.#recordEvent({
      tabSessionId: saved.id,
      projectId: saved.projectId,
      eventType: type.replace("_", "."),
      direction: "inbound",
      payload: {
        tab: saved,
        connectionId: connection.id
      }
    });
  }

  #handleTelemetry(connection, type, message) {
    const tabSessionId = message.tabSessionId ?? null;
    let projectId = message.projectId ?? connection.projectId ?? null;
    if (tabSessionId) {
      // Don't let telemetry hijack a tab owned by another live connection (T4).
      if (!this.#canClaimTab(connection, tabSessionId)) {
        this.#recordEvent({
          tabSessionId, projectId,
          eventType: "security.telemetry_rejected", direction: "inbound",
          payload: { reason: "owned_by_other_connection", connectionId: connection.id }
        });
        return;
      }
      connection.tabSessionIds.add(tabSessionId);
      this.tabConnections.set(tabSessionId, connection);
      const existing = this.database.getBrowserExtensionTab(tabSessionId);
      projectId = projectId ?? existing?.projectId ?? this.#defaultProjectId();
      if (existing && existing.status !== "closed") {
        this.database.upsertBrowserExtensionTab({
          ...existing,
          url: message.url ?? existing.url,
          title: message.title ?? existing.title,
          status: "active",
          lastSeenAt: nowIso()
        });
      }
    }
    this.#recordEvent({
      tabSessionId,
      projectId,
      runId: message.runId ?? null,
      eventType: type,
      direction: "inbound",
      actionId: message.observationId ?? message.actionId ?? null,
      payload: {
        ...message,
        connectionId: connection.id
      }
    });
  }

  #handleCommandResult(connection, message) {
    const commandId = String(message.commandId ?? "");
    const pending = this.pendingCommands.get(commandId);
    // SECURITY (audit T4): only the connection that issued the command may
    // resolve it. Reject spoofed results from any other connection.
    if (pending && pending.connectionId && pending.connectionId !== connection.id) {
      this.#recordEvent({
        tabSessionId: pending.tabSessionId ?? null,
        projectId: connection.projectId ?? this.#defaultProjectId(),
        eventType: "security.command_result_rejected",
        direction: "inbound",
        actionId: commandId || null,
        payload: { reason: "connection_mismatch", connectionId: connection.id }
      });
      return;
    }
    const tabSessionId = message.tabSessionId ?? pending?.tabSessionId ?? null;
    const existing = tabSessionId ? this.database.getBrowserExtensionTab(tabSessionId) : null;
    this.#recordEvent({
      tabSessionId,
      projectId: message.projectId ?? connection.projectId ?? existing?.projectId ?? this.#defaultProjectId(),
      runId: message.runId ?? null,
      eventType: "command.result",
      direction: "inbound",
      actionId: commandId || null,
      payload: {
        ...message,
        connectionId: connection.id
      }
    });
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingCommands.delete(commandId);
    pending.resolve({
      ok: message.ok === true,
      commandId,
      tabSessionId,
      result: sanitizeForLog(message.result ?? null),
      error: sanitizeForLog(message.error ?? null),
      receivedAt: nowIso()
    });
  }

  #recordEvent({ tabSessionId = null, projectId = null, runId = null, eventType, direction, actionId = null, payload = {} }) {
    const record = {
      id: createId("bext_evt"),
      tabSessionId,
      projectId,
      runId,
      eventType,
      direction,
      actionId,
      payload: sanitizeForLog(payload),
      createdAt: nowIso()
    };
    try {
      this.database.insertBrowserExtensionEvent(record);
    } catch {
      // Extension telemetry is best-effort; command flow should not fail because audit persistence failed.
    }
    this.emit("event", record);
    this.onEvent?.({ type: "browser_extension.event", payload: record });
    return record;
  }
}

export function getBrowserExtensionBridgeInfo() {
  return {
    websocketPath: WS_PATH,
    commands: Array.from(ALLOWED_COMMANDS),
    backendFirst: true,
    domFirst: true,
    cdpEnabled: false
  };
}
