import assert from "node:assert/strict";
import { executeSafeConversationCapabilities } from "../src/conversation/safe-capabilities.js";

// Verifies that the conversation agent can auto-invoke a connected MCP tool via
// the `call_mcp_tool` capability (mid-session auto-invocation).
export async function run() {
  const calls = [];
  const callMcpTool = async (connectorId, tool, args) => {
    calls.push({ connectorId, tool, args });
    return { isError: false, text: `ok:${tool}:${JSON.stringify(args)}`, content: [] };
  };

  const out = await executeSafeConversationCapabilities({
    requests: [{ id: "call_mcp_tool", reason: "user asked", parameters: { connectorId: "notion", tool: "search", args: { q: "roadmap" } } }],
    callMcpTool
  });

  assert.equal(calls.length, 1, "tool invoked once");
  assert.deepEqual(calls[0], { connectorId: "notion", tool: "search", args: { q: "roadmap" } });
  assert.match(out.text, /ok:search/);
  assert.equal(out.capabilityResults[0].status, "ok");
  assert.equal(out.capabilityResults[0].connectorId, "notion");

  // Missing params → graceful error, no crash.
  const bad = await executeSafeConversationCapabilities({
    requests: [{ id: "call_mcp_tool", parameters: {} }],
    callMcpTool
  });
  assert.equal(bad.capabilityResults[0].status, "error");

  // Without a callMcpTool injected, the request is safely ignored.
  const none = await executeSafeConversationCapabilities({
    requests: [{ id: "call_mcp_tool", parameters: { connectorId: "x", tool: "y" } }]
  });
  assert.equal(none.capabilityResults.length, 0);
}
