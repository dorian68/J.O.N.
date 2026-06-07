import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliHelp, jonifyCli, cliCommandRisk } from "../src/jonify/cli-jonify.js";
import { CliWorkflowAdapter } from "../src/jonify/cli-adapter.js";
import { classifyApp } from "../src/jonify/app-classifier.js";
import { jonifyFromCliHelp, executeWorkflow } from "../src/jonify/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function run() {
  // ── App classifier (the "intelligence") ────────────────────────────────────
  assert.equal(classifyApp({ command: "docker" }).method, "cli", "explicit command → cli");
  assert.equal(classifyApp({ url: "https://app.example.com" }).method, "web-dom", "url → web-dom");
  // Electron Docker Desktop (empty UIA tree) → recommend its CLI
  const dockerWin = classifyApp({ window: { title: "Containers - Docker Desktop", processName: "Docker Desktop", accessibility: { tree: null } } });
  assert.equal(dockerWin.kind, "electron", "Docker Desktop classified as electron");
  assert.equal(dockerWin.method, "cli", "electron-with-CLI → cli method");
  assert.equal(dockerWin.cliBinary, "docker", "routes to docker CLI");
  // Electron without a known CLI + empty tree → vision fallback
  assert.equal(classifyApp({ window: { title: "Slack", processName: "slack", accessibility: { tree: null } } }).method, "vision", "electron, no CLI, empty UIA → vision");
  // Native app with UIA controls → uia
  const nativeWin = classifyApp({ window: { title: "Calculator", accessibility: { tree: { controlType: "Window", children: [{ controlType: "Button", name: "1" }, { controlType: "Button", name: "2" }] } } } });
  assert.equal(nativeWin.method, "uia", "native app with UIA controls → uia");

  // ── CLI risk classification ─────────────────────────────────────────────────
  assert.equal(cliCommandRisk("ps"), "low");
  assert.equal(cliCommandRisk("run"), "high");
  assert.equal(cliCommandRisk("rm"), "critical");
  assert.equal(cliCommandRisk("prune"), "critical");

  // ── Parse the REAL docker --help fixture → tools ────────────────────────────
  const dockerHelp = fs.readFileSync(path.join(HERE, "..", "fixtures", "jonify", "docker-help.txt"), "utf8");
  const cmds = parseCliHelp(dockerHelp).map((c) => c.name);
  for (const expected of ["ps", "run", "build", "push", "version", "info"]) {
    assert.ok(cmds.includes(expected), `docker help exposes "${expected}"`);
  }
  assert.ok(!cmds.includes("help"), "help command excluded");

  const { manifest, validation } = jonifyFromCliHelp("docker", dockerHelp);
  assert.equal(validation.valid, true, `cli manifest valid: ${validation.errors.join("; ")}`);
  assert.equal(manifest.app.environment, "cli");
  const ps = manifest.actions.find((a) => a.trigger.command === "ps");
  const run = manifest.actions.find((a) => a.trigger.command === "run");
  assert.equal(ps.safety.riskLevel, "low", "docker ps is read-only");
  assert.equal(ps.safety.requiresConfirmation, false);
  assert.equal(run.safety.riskLevel, "high", "docker run is high risk");
  assert.equal(run.safety.requiresConfirmation, true);
  assert.ok(manifest.workflows.some((w) => w.id === "cli-ps-workflow"), "a runnable workflow per command");

  // ── Safe execution gating with a FAKE cli adapter (no real process) ─────────
  const calls = [];
  const fakeCli = { runCli: async (cmd, a) => { calls.push([cmd, a]); return { ok: true, exitCode: 0, stdout: "CONTAINER ID" }; } };
  const psRun = await executeWorkflow(manifest, "cli-ps-workflow", { adapter: fakeCli, inputs: { args: ["-a"] } });
  assert.equal(psRun.status, "completed", "read-only ps runs");
  assert.deepEqual(calls.at(-1), ["ps", ["-a"]], "adapter invoked with the right command + args");
  const runBlocked = await executeWorkflow(manifest, "cli-run-workflow", { adapter: fakeCli });
  assert.equal(runBlocked.status, "needs_confirmation", "mutating command blocked without confirmation");

  // ── CliWorkflowAdapter allowlist (defense in depth, no spawn) ───────────────
  const adapter = new CliWorkflowAdapter({ binary: "docker" });
  assert.ok(adapter.allowlist.has("ps"), "ps is allowlisted (read-only)");
  assert.ok(!adapter.allowlist.has("rm"), "rm NOT allowlisted by default");
  const refused = await adapter.runCli("rm", ["x"]); // checked before spawn
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "CLI_NOT_ALLOWLISTED", "non-allowlisted command refused before spawn");
  const badToken = await adapter.runCli("rm; echo pwned");
  assert.equal(badToken.ok, false, "unsafe token rejected");
}
