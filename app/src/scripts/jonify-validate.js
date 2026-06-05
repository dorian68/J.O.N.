// npm run jonify:validate -- ./manifest.json
import { parseArgs, loadManifest } from "./jonify-cli.js";
import { validateManifest } from "../jonify/manifest-validator.js";

const args = parseArgs(process.argv.slice(2));
const manifest = loadManifest(args._[0]);
const r = validateManifest(manifest);
console.log(`valid: ${r.valid}`);
if (r.errors.length) { console.log("errors:"); r.errors.forEach((e) => console.log("  - " + e)); }
if (r.warnings.length) { console.log("warnings:"); r.warnings.forEach((w) => console.log("  - " + w)); }
process.exit(r.valid ? 0 : 1);
