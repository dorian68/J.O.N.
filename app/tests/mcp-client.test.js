import assert from "node:assert/strict";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpClientManager } from "../src/connectors/mcp-client.js";

// Proves REAL MCP tool invocation end-to-end: a genuine MCP server with a tool,
// linked to our client manager via the SDK's in-memory transport (no process,
// no network), then listTools + callTool.
export async function run() {
  const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "add",
      description: "Adds two numbers",
      inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] }
    }]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { a, b } = req.params.arguments ?? {};
    return { content: [{ type: "text", text: String(Number(a) + Number(b)) }] };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const manager = new McpClientManager();
  const tools = await manager.connectWithTransport("test-conn", clientTransport);

  // Tool was discovered.
  assert.ok(tools.some((t) => t.name === "add"), "tool 'add' discovered");
  assert.equal(manager.isConnected("test-conn"), true);

  // Tool actually invoked and returns the real result.
  const result = await manager.callTool("test-conn", "add", { a: 2, b: 3 });
  assert.equal(result.isError, false);
  assert.equal(result.text.trim(), "5", "MCP tool returned the computed value");

  await manager.disconnect("test-conn");
  assert.equal(manager.isConnected("test-conn"), false);
}
