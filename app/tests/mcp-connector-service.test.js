import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { McpConnectorService } from "../src/connectors/mcp-connector-service.js";

const tmpRegistry = path.join(os.tmpdir(), `jon-mcp-registry-${process.pid}.json`);

// Fake MCP manager to test orchestration logic deterministically.
function fakeManager() {
  const connected = new Set();
  let calls = 0;
  return {
    connected,
    isConnected: (id) => connected.has(id),
    connect: async (id) => { connected.add(id); return [{ name: "echo", description: "echo" }]; },
    listTools: async () => [{ name: "echo", description: "echo" }],
    callTool: async (id, name, args) => { calls += 1; return { isError: false, text: `${name}:${JSON.stringify(args)}`, content: [], structured: null }; },
    disconnect: async (id) => { connected.delete(id); return true; },
    disconnectAll: async () => connected.clear(),
    get calls() { return calls; }
  };
}

const inMemoryVault = () => new (class {
  constructor() { this.m = new Map(); }
  isSecure() { return false; }
  async save(id, t) { this.m.set(id, t); }
  async load(id) { return this.m.get(id) ?? null; }
  async clear(id) { this.m.delete(id); }
  async hasValidAccess(id) { return this.m.has(id); }
})();

export async function run() {
  const mgr = fakeManager();
  // Secure stdio model: enabled + allowlisted server id (no raw client command).
  const stdioEnv = {
    JON_ENABLE_MCP_STDIO: "true",
    JON_MCP_STDIO_ALLOWLIST: JSON.stringify({ local1: { command: "node", args: ["server.js"], label: "local1" } })
  };
  const svc = new McpConnectorService({ env: stdioEnv, tokenVault: inMemoryVault(), mcpManager: mgr, registryPath: tmpRegistry });

  // stdio connect → discovers tools, status reflects connection
  const r = await svc.connectStdio("local1", { serverId: "local1" });
  assert.equal(r.connected, true);
  assert.deepEqual(r.tools.map((t) => t.name), ["echo"]);
  const status = svc.status("local1");
  assert.equal(status.connected, true);
  assert.equal(status.toolCount, 1);

  // Registry lists the connector (shared by desktop + mobile, persisted).
  const list = svc.listConnectors();
  assert.ok(list.some((c) => c.id === "local1" && c.connected), "connector listed in registry");
  assert.ok(svc.listAllConnectedTools().some((t) => t.connectorId === "local1" && t.name === "echo"), "connected tool exposed");

  // callTool routes to the manager
  const out = await svc.callTool("local1", "echo", { x: 1 });
  assert.equal(out.isError, false);
  assert.match(out.text, /echo:\{"x":1\}/);

  // disconnect clears state
  await svc.disconnect("local1");
  assert.equal(svc.status("local1").connected, false);
  assert.equal(mgr.isConnected("local1"), false);

  // OAuth start requires a configured client id → clear error
  await assert.rejects(
    () => svc.startOAuthConnect("gh1", { id: "github", authorizeUrl: "https://x/a", tokenUrl: "https://x/t" }),
    /client id/i
  );
}
