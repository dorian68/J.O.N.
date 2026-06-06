// npm run jonify:execute -- ./manifest.json workflow-id [--inputs '{"name":"A"}'] [--confirm]
// Defaults to simulate. Browser live execution is explicit:
// npm run jonify:execute -- ./manifest.json workflow-id --live-browser --url http://127.0.0.1:41731 --confirm
import path from "node:path";
import { parseArgs, loadManifest } from "./jonify-cli.js";
import { executeWorkflow } from "../jonify/executor.js";
import { createBrowserWorkflowAdapter, inferBrowserAllowlistedHosts } from "../jonify/browser-adapter.js";
import { DATA_ROOT } from "../config.js";

const args = parseArgs(process.argv.slice(2));
const manifest = loadManifest(args._[0]);
const workflowId = args._[1];
const inputs = args.inputs ? JSON.parse(args.inputs) : {};
const confirm = args.confirm ? async () => true : null;
const liveBrowser = args["live-browser"] === true || args.live === "browser";
const mode = liveBrowser ? "live" : "simulate";
const startUrl = args.url ?? manifest.app?.baseUrl ?? null;

if (liveBrowser && !startUrl) {
  console.error("Live browser execution requires --url or manifest.app.baseUrl.");
  process.exit(1);
}

let adapter = null;
try {
  if (liveBrowser) {
    const evidenceDir = args["evidence-dir"] ?? path.join(DATA_ROOT, "jonify", "cli-live-browser", new Date().toISOString().replace(/[:.]/g, "-"));
    adapter = createBrowserWorkflowAdapter({
      manifest,
      startUrl,
      headless: args.headed ? false : args.headless !== "0",
      allowlistedHosts: inferBrowserAllowlistedHosts(manifest, startUrl, args.host ? [args.host] : []),
      evidenceDir,
      closeOnFinish: args["keep-open"] !== true
    });
  }

  const result = await executeWorkflow(manifest, workflowId, { mode, adapter, inputs, confirm });
  console.log(`Workflow: ${result.name ?? workflowId} - status: ${result.status} (mode: ${mode}${liveBrowser ? "/browser" : ""})`);
  for (const s of result.steps ?? []) {
    console.log(`  ${s.index}. ${s.action ?? s.actionId} · risque=${s.risk ?? "?"} · ${s.status}${s.missing ? " (manque: " + s.missing.join(", ") + ")" : ""}${s.evidence ? " · preuve=" + s.evidence : ""}`);
  }
  if (result.status === "needs_confirmation") console.log("-> Action sensible : relancer avec --confirm pour autoriser.");
  if (result.status === "needs_input") console.log("-> Fournir les données via --inputs '{\"name\":\"...\"}'.");
  if (!liveBrowser) console.log("\n(Par défaut la CLI reste en simulation. Ajouter --live-browser --url <url> pour exécuter sur navigateur contrôlé.)");
  process.exit(result.ok || ["needs_confirmation", "needs_input"].includes(result.status) ? 0 : 1);
} finally {
  await adapter?.close?.();
}
