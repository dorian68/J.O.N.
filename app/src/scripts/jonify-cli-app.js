// npm run jonify:cli -- docker [--exec ps] [--args '["-a"]'] [--out manifest.json] [--register] [--confirm]
// JON-ify a CLI tool: run `<binary> --help`, generate a manifest of tools, and
// optionally execute one tool (read-only auto; mutating needs --confirm + allowlist).
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "./jonify-cli.js";
import { jonifyFromCliHelp, executeWorkflow, createCliWorkflowAdapter } from "../jonify/index.js";
import { registerJonifiedApp } from "../jonify/registry.js";

const args = parseArgs(process.argv.slice(2));
const binary = args._[0];
if (!binary) { console.error("Usage: jonify:cli -- <binary> [--exec <command>] [--args '[...]'] [--register] [--confirm]"); process.exit(1); }

const help = spawnSync(binary, ["--help"], { encoding: "utf8", shell: false });
if (help.error) { console.error(`Cannot run "${binary} --help": ${help.error.message}`); process.exit(1); }
const helpText = `${help.stdout ?? ""}\n${help.stderr ?? ""}`;

const { manifest, validation } = jonifyFromCliHelp(binary, helpText);
console.log(`\nJON-ified CLI "${binary}" — ${manifest.actions.length} tools, valid=${validation.valid}, confidence=${manifest.confidence}`);
const byRisk = (r) => manifest.actions.filter((a) => a.safety.riskLevel === r).map((a) => a.trigger.command);
console.log(`  read (auto):     ${byRisk("low").slice(0, 20).join(", ")}`);
console.log(`  high (confirm):  ${byRisk("high").join(", ")}`);
console.log(`  critical (conf): ${byRisk("critical").join(", ")}`);

if (typeof args.out === "string") { fs.writeFileSync(args.out, JSON.stringify(manifest, null, 2)); console.log(`  written: ${args.out}`); }
if (args.register && validation.valid) { const r = registerJonifiedApp(manifest); console.log(`  registered: ${r.appId}`); }

if (typeof args.exec === "string") {
  const wfId = `cli-${args.exec}-workflow`;
  const adapter = createCliWorkflowAdapter({ binary });
  const toolArgs = args.args ? JSON.parse(args.args) : [];
  const run = await executeWorkflow(manifest, wfId, { adapter, inputs: { args: toolArgs }, confirm: args.confirm ? async () => true : null });
  console.log(`\nexec "${binary} ${args.exec}" → status=${run.status}`);
  for (const s of run.steps ?? []) console.log(`  ${s.index}. ${s.action} · risk=${s.risk} · ${s.status}${s.error ? " · " + s.error : ""}`);
  const last = run.steps?.at(-1);
  if (last?.status === "executed") {
    // surface a snippet of stdout when available (re-run captured in adapter result is not returned; re-run read-only for display)
    console.log("  (executed; read-only output captured by the adapter)");
  }
  if (run.status === "needs_confirmation") console.log("  → mutating command: re-run with --confirm (and ensure it's allowlisted).");
}
