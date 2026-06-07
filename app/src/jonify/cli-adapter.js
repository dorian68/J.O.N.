// CLI workflow adapter — runs a CLI tool's subcommand safely (no shell, argv
// array only) under an allowlist. Conforms to the executor adapter contract via
// runCli() (the executor routes trigger.type "cli_run" here).

import { spawn } from "node:child_process";

// Read-only commands that are safe to auto-run. Anything not here requires both
// confirmation (executor safety gate) AND explicit allowlisting.
const DEFAULT_READONLY = new Set([
  "ps", "ls", "list", "images", "image", "inspect", "logs", "version", "info",
  "search", "stats", "status", "show", "get", "config", "context", "top",
  "history", "diff", "events", "port", "volume", "network", "system", "node", "service", "container"
]);

export class CliWorkflowAdapter {
  constructor({ binary, allowlist = null, cwd = null, timeoutMs = 15000, maxOutput = 20000 } = {}) {
    if (!binary) throw new Error("CliWorkflowAdapter requires a binary.");
    this.binary = binary;
    // allowlist: Set of command names allowed to actually run. Default = read-only.
    this.allowlist = allowlist ? new Set(allowlist) : new Set(DEFAULT_READONLY);
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.maxOutput = maxOutput;
  }

  async runCli(command, args = []) {
    const name = String(command ?? "").trim();
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
      return { ok: false, error: `Refused unsafe command token: ${name}` };
    }
    if (!this.allowlist.has(name)) {
      return { ok: false, error: `Command "${this.binary} ${name}" is not allowlisted for execution.`, code: "CLI_NOT_ALLOWLISTED" };
    }
    const safeArgs = (Array.isArray(args) ? args : []).map((a) => String(a)).filter((a) => !a.startsWith("-") || /^-{1,2}[a-z0-9][a-z0-9-]*$/i.test(a));
    return await new Promise((resolve) => {
      let out = "", err = "", done = false;
      const child = spawn(this.binary, [name, ...safeArgs], { cwd: this.cwd ?? undefined, shell: false });
      const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ ok: false, error: "CLI command timed out" }); } }, this.timeoutMs);
      child.stdout?.on("data", (d) => { out += d.toString(); if (out.length > this.maxOutput) out = out.slice(0, this.maxOutput); });
      child.stderr?.on("data", (d) => { err += d.toString(); if (err.length > this.maxOutput) err = err.slice(0, this.maxOutput); });
      child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: e.message }); } });
      child.on("close", (codeNum) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: codeNum === 0, exitCode: codeNum, stdout: out.trim().slice(0, 4000), stderr: err.trim().slice(0, 1000) }); } });
    });
  }

  // No navigate/click/type for CLI; provided for adapter-contract compatibility.
  async navigate() { return { ok: false, error: "navigate not supported by CLI adapter" }; }
  async click() { return { ok: false, error: "click not supported by CLI adapter" }; }
  async type() { return { ok: false, error: "type not supported by CLI adapter" }; }
  async capture() { return null; }
  async close() {}
}

export function createCliWorkflowAdapter(options = {}) {
  return new CliWorkflowAdapter(options);
}
