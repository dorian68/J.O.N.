// Registry of JON-ified apps — persists generated manifests locally so JON can
// reason on them later. Stored under <DATA_ROOT>/jonify-apps/ (kept with the
// rest of JON's local state; gitignored via .runtime-data).

import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "../config.js";

const REGISTRY_DIR = path.join(DATA_ROOT, "jonify-apps");

function ensureDir() { fs.mkdirSync(REGISTRY_DIR, { recursive: true }); }
function safeId(id) { return String(id ?? "app").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "app"; }
function fileFor(appId) { return path.join(REGISTRY_DIR, `${safeId(appId)}.jonification.manifest.json`); }

export function registerJonifiedApp(manifest) {
  ensureDir();
  const appId = manifest?.app?.id;
  if (!appId) throw new Error("Cannot register a manifest without app.id");
  const record = { ...manifest, registeredAt: manifest.registeredAt ?? null, _registryId: safeId(appId) };
  fs.writeFileSync(fileFor(appId), JSON.stringify(record, null, 2));
  return { appId: safeId(appId), path: fileFor(appId) };
}

export function listJonifiedApps() {
  if (!fs.existsSync(REGISTRY_DIR)) return [];
  return fs.readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith(".jonification.manifest.json"))
    .map((f) => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), "utf8"));
        return {
          appId: m.app?.id,
          name: m.app?.name,
          environment: m.app?.environment ?? (m.app?.baseUrl ? "web" : "unknown"),
          businessPurpose: m.app?.businessPurpose ?? null,
          confidence: m.confidence,
          surfaces: m.surfaces?.length ?? 0,
          actions: m.actions?.length ?? 0,
          workflows: m.workflows?.length ?? 0
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

export function getJonifiedApp(appId) {
  const file = fileFor(appId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function removeJonifiedApp(appId) {
  const file = fileFor(appId);
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
  return false;
}

export { REGISTRY_DIR };
