import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "../config.js";
import { createZip } from "../server/zip-archive.js";

// Packaging for the downloadable JON Chrome extension. Reads the extension source
// folder, validates the manifest, and builds a STORED zip the user can download,
// unzip, and "Load unpacked" in chrome://extensions.

export const EXTENSION_DIR = path.join(APP_ROOT, "browser-extension", "jon-tab-bridge");
const REQUIRED_FILES = ["manifest.json", "background.js", "content.js"];

function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

export function readExtensionManifest() {
  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

// Validates the extension is loadable. Returns { valid, version, name, errors }.
export function validateExtension() {
  const errors = [];
  if (!fs.existsSync(EXTENSION_DIR)) {
    return { valid: false, version: null, name: null, errors: [`Extension directory missing: ${EXTENSION_DIR}`] };
  }
  let manifest = null;
  try {
    manifest = readExtensionManifest();
  } catch (error) {
    return { valid: false, version: null, name: null, errors: [`manifest.json invalid JSON: ${error.message}`] };
  }
  if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3 (MV3)");
  if (!manifest.name) errors.push("manifest.name missing");
  if (!manifest.version) errors.push("manifest.version missing");
  const sw = manifest.background?.service_worker;
  if (!sw) errors.push("background.service_worker missing");
  else if (!fs.existsSync(path.join(EXTENSION_DIR, sw))) errors.push(`background.service_worker file not found: ${sw}`);
  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(EXTENSION_DIR, f))) errors.push(`required file missing: ${f}`);
  }
  return { valid: errors.length === 0, version: manifest.version ?? null, name: manifest.name ?? null, errors, manifest };
}

// Builds the downloadable zip. Throws if the extension is invalid.
export function buildExtensionZip() {
  const validation = validateExtension();
  if (!validation.valid) {
    throw Object.assign(new Error(`Chrome extension invalid: ${validation.errors.join("; ")}`), { code: "EXTENSION_INVALID" });
  }
  const files = listFilesRecursive(EXTENSION_DIR);
  const entries = files.map((rel) => ({ name: rel, content: fs.readFileSync(path.join(EXTENSION_DIR, rel)) }));
  const buffer = createZip(entries);
  return { buffer, version: validation.version, name: validation.name, fileCount: entries.length, files };
}
