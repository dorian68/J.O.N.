// npm run jonify:generate -- --url https://example.com [--out manifest.json] [--purpose "..."] [--register]
import fs from "node:fs";
import { parseArgs, loadHtml } from "./jonify-cli.js";
import { jonifyFromHtml } from "../jonify/index.js";
import { registerJonifiedApp } from "../jonify/registry.js";

const args = parseArgs(process.argv.slice(2));
const { html, url } = await loadHtml(args);
const { manifest, validation } = jonifyFromHtml(html, { url, businessPurpose: typeof args.purpose === "string" ? args.purpose : null });

const out = typeof args.out === "string" ? args.out : null;
if (out) { fs.writeFileSync(out, JSON.stringify(manifest, null, 2)); }
if (args.register) {
  const reg = registerJonifiedApp(manifest);
  console.log(`Registered app "${reg.appId}" → ${reg.path}`);
}

console.log(`\nJON-ified "${manifest.app.name}" (${manifest.app.id})`);
console.log(`  confidence: ${manifest.confidence} | surfaces: ${manifest.surfaces.length} | actions: ${manifest.actions.length} | workflows: ${manifest.workflows.length}`);
console.log(`  manifest valid: ${validation.valid}${validation.errors.length ? " — " + validation.errors.join("; ") : ""}`);
console.log(`  human-review questions: ${manifest.humanReview.questions.length}`);
if (out) console.log(`  written: ${out}`);
if (!out && !args.register) console.log("\n" + JSON.stringify(manifest, null, 2));
process.exit(validation.valid ? 0 : 1);
