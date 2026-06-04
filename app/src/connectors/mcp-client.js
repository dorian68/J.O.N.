// MCP client manager — real tool invocation over the Model Context Protocol.
//
// Opens and pools MCP sessions per connector (stdio for local servers, Streamable
// HTTP for remote/OAuth-protected servers), auto-discovers tools (listTools), and
// invokes them (callTool). This is the piece that was entirely missing: it turns
// a connector definition into actually-callable tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

const CLIENT_INFO = { name: "jon-cowork", version: "1.0.0" };

function buildTransport(connection, { bearerToken } = {}) {
  const transport = connection?.transport ?? (connection?.command ? "stdio" : "http");
  if (transport === "stdio") {
    if (!connection.command) throw new Error("MCP stdio connection requires a `command`.");
    return new StdioClientTransport({
      command: connection.command,
      args: Array.isArray(connection.args) ? connection.args : [],
      env: { ...process.env, ...(connection.env ?? {}) }
    });
  }
  if (transport === "http" || transport === "sse" || transport === "streamable_http") {
    if (!connection.url) throw new Error("MCP http connection requires a `url`.");
    const requestInit = bearerToken
      ? { headers: { authorization: `Bearer ${bearerToken}` } }
      : undefined;
    return new StreamableHTTPClientTransport(new URL(connection.url), requestInit ? { requestInit } : undefined);
  }
  throw new Error(`Unsupported MCP transport: ${transport}`);
}

export class McpClientManager {
  constructor() {
    this._sessions = new Map(); // connectorId -> { client, transport, tools }
    this._pendingAuth = new Map(); // connectorId -> { client, transport } awaiting OAuth code
  }

  isConnected(connectorId) {
    return this._sessions.has(connectorId);
  }

  async #registerSession(connectorId, client, transport) {
    const listed = await client.listTools();
    const tools = (listed?.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema ?? null }));
    this._sessions.set(connectorId, { client, transport, tools });
    return tools;
  }

  // Connect to a REMOTE MCP server with SDK-driven OAuth (discovery + dynamic
  // client registration + PKCE). If the server requires consent, returns
  // { authRequired: true } after the provider captured the authorize URL; the
  // caller opens it, gets the code, and calls finishHttpOAuth().
  async connectHttpOAuth(connectorId, url, authProvider) {
    if (this._sessions.has(connectorId)) return { tools: this._sessions.get(connectorId).tools };
    const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider });
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    try {
      await client.connect(transport);
      const tools = await this.#registerSession(connectorId, client, transport);
      return { tools };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        this._pendingAuth.set(connectorId, { client, transport });
        return { authRequired: true };
      }
      try { await transport.close?.(); } catch { /* ignore */ }
      throw error;
    }
  }

  // Complete a remote OAuth connect after the user consented (authorization code
  // captured by the loopback callback).
  async finishHttpOAuth(connectorId, authorizationCode) {
    const pending = this._pendingAuth.get(connectorId);
    if (!pending) throw new Error(`No pending OAuth for connector: ${connectorId}`);
    await pending.transport.finishAuth(authorizationCode);
    await pending.client.connect(pending.transport);
    this._pendingAuth.delete(connectorId);
    return this.#registerSession(connectorId, pending.client, pending.transport);
  }

  // Opens (or reuses) a session and returns its discovered tools.
  async connect(connectorId, connection, { bearerToken = null } = {}) {
    if (this._sessions.has(connectorId)) {
      return this._sessions.get(connectorId).tools;
    }
    const transport = buildTransport(connection, { bearerToken });
    return this.connectWithTransport(connectorId, transport);
  }

  // Connect using a pre-built transport (used for in-memory/custom transports).
  async connectWithTransport(connectorId, transport) {
    if (this._sessions.has(connectorId)) {
      return this._sessions.get(connectorId).tools;
    }
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = (listed?.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? null
    }));
    this._sessions.set(connectorId, { client, transport, tools });
    return tools;
  }

  async listTools(connectorId) {
    const session = this._sessions.get(connectorId);
    if (!session) throw new Error(`MCP connector not connected: ${connectorId}`);
    const listed = await session.client.listTools();
    session.tools = (listed?.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema ?? null }));
    return session.tools;
  }

  async callTool(connectorId, toolName, args = {}) {
    const session = this._sessions.get(connectorId);
    if (!session) throw new Error(`MCP connector not connected: ${connectorId}`);
    const result = await session.client.callTool({ name: toolName, arguments: args ?? {} });
    // Normalize MCP content blocks into a flat text + structured payload.
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return {
      isError: Boolean(result?.isError),
      text,
      content,
      structured: result?.structuredContent ?? null
    };
  }

  async disconnect(connectorId) {
    const session = this._sessions.get(connectorId);
    if (!session) return false;
    try { await session.client.close(); } catch { /* ignore */ }
    try { await session.transport.close?.(); } catch { /* ignore */ }
    this._sessions.delete(connectorId);
    return true;
  }

  async disconnectAll() {
    for (const id of [...this._sessions.keys()]) {
      await this.disconnect(id);
    }
  }
}
