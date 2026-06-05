// Shared helpers for the jonify:* CLI scripts.
import fs from "node:fs";

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]?.startsWith("--") ? true : argv[++i]; out[k] = v ?? true; }
    else out._.push(a);
  }
  return out;
}

// Load page HTML from --html <file> or --url <url> (node fetch, V1: server-rendered).
export async function loadHtml(args) {
  if (args.html) return { html: fs.readFileSync(args.html, "utf8"), url: args.url ?? `file://${args.html}` };
  if (args.url) {
    const res = await fetch(args.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status} for ${args.url}`);
    return { html: await res.text(), url: args.url };
  }
  throw new Error("Provide --html <file> or --url <url>. (V1 --url fetches server-rendered HTML; SPAs need the browser path in V2.)");
}

export function loadManifest(file) {
  if (!file) throw new Error("Provide a manifest path.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
