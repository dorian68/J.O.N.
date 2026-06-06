// npm run jonify:execute -- ./manifest.json workflow-id [--inputs '{"name":"A"}'] [--confirm]
// V3 safe executor — DEFAULTS TO SIMULATE (no real actions). Live execution
// requires a surface adapter (wired through the operator/browser), not the CLI.
import { parseArgs, loadManifest } from "./jonify-cli.js";
import { executeWorkflow } from "../jonify/executor.js";

const args = parseArgs(process.argv.slice(2));
const manifest = loadManifest(args._[0]);
const workflowId = args._[1];
const inputs = args.inputs ? JSON.parse(args.inputs) : {};
const confirm = args.confirm ? async () => true : null;

const result = await executeWorkflow(manifest, workflowId, { mode: "simulate", inputs, confirm });
console.log(`Workflow: ${result.name ?? workflowId} — status: ${result.status} (mode: simulate)`);
for (const s of result.steps ?? []) {
  console.log(`  ${s.index}. ${s.action ?? s.actionId} · risque=${s.risk ?? "?"} · ${s.status}${s.missing ? " (manque: " + s.missing.join(", ") + ")" : ""}`);
}
if (result.status === "needs_confirmation") console.log("→ Action sensible : relancer avec --confirm pour autoriser.");
if (result.status === "needs_input") console.log("→ Fournir les données via --inputs '{\"name\":\"...\"}'.");
console.log("\n(Exécution réelle = via l'opérateur avec un adaptateur navigateur/desktop ; la CLI reste en simulation par sécurité.)");
process.exit(0);
