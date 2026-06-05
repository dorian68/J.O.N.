import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { resolveBindConfig, authorizeRequest, isLoopbackAddress } from "../src/server/desktop-auth.js";
import { evaluateProductionReadiness } from "../src/server/production-readiness.js";
import { sanitizeForLogging } from "../src/security/redaction.js";
import { McpConnectorService } from "../src/connectors/mcp-connector-service.js";

const req = (remoteAddress, headers = {}) => ({ headers, socket: { remoteAddress } });
const tmpRegistry = () => path.join(os.tmpdir(), `jon-sec-${Math.abs(JSON.stringify(headersSeed).length)}-reg.json`);
const headersSeed = {};

export async function run() {
  // ── T1: secure-by-default bind ──────────────────────────────────────────────
  assert.equal(resolveBindConfig({}).bindHost, "127.0.0.1", "default bind is loopback");
  assert.equal(resolveBindConfig({}).lanEnabled, false);
  assert.equal(resolveBindConfig({ JON_ALLOW_LAN: "true" }).bindHost, "0.0.0.0", "LAN opt-in exposes");
  assert.equal(resolveBindConfig({ COWORK_LAN: "1" }).bindHost, "0.0.0.0", "legacy LAN opt-in still works");
  assert.equal(resolveBindConfig({ JON_BIND_HOST: "127.0.0.1", COWORK_LAN: "1" }).bindHost, "127.0.0.1", "explicit host wins");

  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("192.168.1.50"), false);

  // ── T1: central authorization gate ──────────────────────────────────────────
  const TOKEN = "secret-desktop-token-abc";
  // public path reachable from LAN without token
  assert.equal(authorizeRequest(req("192.168.1.50"), "/api/health", { desktopToken: TOKEN }).allowed, true, "health is public");
  assert.equal(authorizeRequest(req("192.168.1.50"), "/mobile/", { desktopToken: TOKEN }).allowed, true, "static UI is public");
  assert.equal(authorizeRequest(req("192.168.1.50"), "/api/mobile/pairing/start", { desktopToken: TOKEN }).allowed, true, "pairing start is public");
  // desktop route: loopback OK, LAN denied without token, allowed with token
  assert.equal(authorizeRequest(req("127.0.0.1"), "/api/dashboard", { desktopToken: TOKEN }).allowed, true, "loopback desktop allowed");
  assert.equal(authorizeRequest(req("192.168.1.50"), "/api/dashboard", { desktopToken: TOKEN }).allowed, false, "LAN desktop without token DENIED");
  assert.equal(authorizeRequest(req("192.168.1.50", { "x-jon-desktop-token": TOKEN }), "/api/dashboard", { desktopToken: TOKEN }).allowed, true, "LAN desktop with token allowed");
  assert.equal(authorizeRequest(req("192.168.1.50", { authorization: `Bearer ${TOKEN}` }), "/api/dashboard", { desktopToken: TOKEN }).allowed, true, "LAN desktop with Bearer token allowed");
  assert.equal(authorizeRequest(req("192.168.1.50", { "x-jon-desktop-token": "wrong" }), "/api/dashboard", { desktopToken: TOKEN }).allowed, false, "wrong token denied");
  // mobile routes pass the central gate (handler enforces session)
  assert.equal(authorizeRequest(req("192.168.1.50"), "/api/mobile/status", { desktopToken: TOKEN }).allowed, true, "mobile routes fall through to session check");
  // SSE/events sensitive
  assert.equal(authorizeRequest(req("192.168.1.50"), "/events", { desktopToken: TOKEN }).allowed, false, "LAN /events denied without token");

  // ── T2: MCP stdio disabled by default + allowlist enforced ──────────────────
  const fakeMcp = { connect: async (_id, opts) => { fakeMcp.lastOpts = opts; return [{ name: "tool_a" }]; }, lastOpts: null };
  const regPath = path.join(os.tmpdir(), `jon-sec-reg-${Date.now()}.json`);

  const disabled = new McpConnectorService({ env: {}, mcpManager: fakeMcp, registryPath: regPath });
  await assert.rejects(
    () => disabled.connectStdio("c1", { command: "calc.exe", args: [] }),
    (e) => e.code === "MCP_STDIO_DISABLED",
    "stdio disabled by default rejects arbitrary command"
  );

  const enabledNoList = new McpConnectorService({ env: { JON_ENABLE_MCP_STDIO: "true" }, mcpManager: fakeMcp, registryPath: regPath });
  await assert.rejects(
    () => enabledNoList.connectStdio("c2", { command: "calc.exe", args: ["x"] }),
    (e) => e.code === "MCP_STDIO_NOT_ALLOWLISTED",
    "enabled but client command not allowlisted rejects"
  );

  const allowlist = JSON.stringify({ filesystem: { command: "node", args: ["./mcp/fs.js"], allowedEnvKeys: ["FS_ROOT"] } });
  const enabled = new McpConnectorService({
    env: { JON_ENABLE_MCP_STDIO: "true", JON_MCP_STDIO_ALLOWLIST: allowlist, FS_ROOT: "/data", SECRET_KEY: "should-not-pass" },
    mcpManager: fakeMcp, registryPath: regPath
  });
  // client tries to smuggle a command, but only the allowlisted serverId matters
  const res = await enabled.connectStdio("c3", { serverId: "filesystem", command: "calc.exe", args: ["evil"] });
  assert.equal(res.connected, true);
  assert.equal(fakeMcp.lastOpts.command, "node", "server-defined command used, not client's");
  assert.deepEqual(fakeMcp.lastOpts.args, ["./mcp/fs.js"], "server-defined args used");
  assert.equal(fakeMcp.lastOpts.env.FS_ROOT, "/data", "allowlisted env key passed");
  assert.equal(fakeMcp.lastOpts.env.SECRET_KEY, undefined, "non-allowlisted env NOT leaked to stdio server");

  // ── T6: redaction covers custom keys, not only sk-/Bearer ───────────────────
  assert.match(sanitizeForLogging("token sk-ABCDEF0123456789 here"), /\[REDACTED\]/);
  assert.ok(!sanitizeForLogging("call failed: Authorization: Bearer ABCDEF0123456789xyz").includes("ABCDEF0123456789xyz"), "Bearer redacted");
  assert.ok(!sanitizeForLogging("x-api-key: supersecretvalue123456").includes("supersecretvalue123456"), "x-api-key value redacted");
  assert.ok(!sanitizeForLogging("config api_key=supersecretvalue123456;next").includes("supersecretvalue123456"), "api_key= value redacted");
  assert.ok(!JSON.stringify(sanitizeForLogging({ apiKey: "raw-secret-value", nested: { authorization: "raw" } })).includes("raw-secret-value"), "object key redacted");
  // a JWT in free text
  assert.ok(!sanitizeForLogging("got eyJhbGciOiJIUzI1NientICJ9.payloadpart.signaturepart here").includes("payloadpart"), "JWT redacted");

  // ── Production readiness ────────────────────────────────────────────────────
  const dev = evaluateProductionReadiness({});
  assert.equal(dev.ok, true, "default dev config is readiness-ok");
  assert.equal(dev.shouldRefuseStart, false);

  const badProd = evaluateProductionReadiness({ JON_PRODUCTION: "true", JON_ENABLE_MCP_STDIO: "true" });
  assert.equal(badProd.ok, false, "production + stdio without allowlist fails");
  assert.equal(badProd.shouldRefuseStart, true, "production refuses to start when a hard check fails");
  assert.ok(badProd.checks.find((c) => c.id === "mcp_stdio").status === "fail");

  const goodProd = evaluateProductionReadiness({
    JON_PRODUCTION: "true",
    JON_ENABLE_MCP_STDIO: "true",
    JON_MCP_STDIO_ALLOWLIST: allowlist
  }, { gatewayStatus: { availableProviders: ["openai_compatible"] } });
  assert.equal(goodProd.failCount, 0, "production with allowlist + live provider passes hard checks");
}
