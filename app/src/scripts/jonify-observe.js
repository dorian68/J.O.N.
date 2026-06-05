// npm run jonify:observe -- --url https://example.com   (or --html file.html)
import { parseArgs, loadHtml } from "./jonify-cli.js";
import { observeHtml } from "../jonify/app-observer.js";

const args = parseArgs(process.argv.slice(2));
const { html, url } = await loadHtml(args);
const obs = observeHtml(html, { url });
const s = obs.pages[0].summary;
console.log(JSON.stringify({
  url, title: s.title,
  counts: s.counts,
  surfacesHint: (s.navLinks ?? []).map((l) => l.label),
  buttons: s.buttons.map((b) => b.label),
  inputs: s.inputs.map((i) => i.name ?? i.placeholder ?? i.type),
  forms: s.forms.map((f) => ({ action: f.action, required: f.requiredInputs }))
}, null, 2));
