import assert from "node:assert/strict";
import { createZip } from "../src/server/zip-archive.js";
import { validateExtension, buildExtensionZip } from "../src/browser/chrome-extension-package.js";
import { validateBrowserPlanOutput } from "../src/browser/browser-planner.js";

// Lot 2 — Chrome extension packaging + browser eval/CDP gating (audit T3).
export async function run() {
  // ── zip-archive: produces a valid, parseable STORED zip ─────────────────────
  const zip = createZip([
    { name: "a.txt", content: "hello" },
    { name: "dir/b.json", content: "{\"x\":1}" }
  ]);
  assert.ok(Buffer.isBuffer(zip));
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "starts with local file header signature (PK\\x03\\x04)");
  // End-of-central-directory present with 2 entries.
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) { if (zip.readUInt32LE(i) === eocdSig) { eocd = i; break; } }
  assert.ok(eocd >= 0, "has end-of-central-directory record");
  assert.equal(zip.readUInt16LE(eocd + 10), 2, "records 2 entries");
  assert.ok(zip.includes(Buffer.from("a.txt")) && zip.includes(Buffer.from("dir/b.json")), "filenames present");
  assert.ok(zip.includes(Buffer.from("hello")), "content stored");

  // ── extension validates + packages ──────────────────────────────────────────
  const v = validateExtension();
  assert.equal(v.valid, true, `extension should validate: ${v.errors?.join("; ")}`);
  assert.ok(v.version, "has a version");
  assert.equal(v.manifest.manifest_version, 3, "MV3");

  const pkg = buildExtensionZip();
  assert.ok(pkg.buffer.length > 100, "non-empty zip");
  assert.equal(pkg.buffer.readUInt32LE(0), 0x04034b50, "valid zip header");
  assert.ok(pkg.files.includes("manifest.json"), "zip contains manifest.json");
  assert.ok(pkg.files.includes("background.js"), "zip contains background.js");
  assert.equal(pkg.version, v.version);

  // ── T3: evaluate_script / cdp_command rejected by default ───────────────────
  const prev = process.env.JON_ENABLE_BROWSER_EVAL;
  delete process.env.JON_ENABLE_BROWSER_EVAL;
  for (const action of ["evaluate_script", "cdp_command"]) {
    assert.throws(
      () => validateBrowserPlanOutput({ steps: [{ action, expression: "1+1", method: "Page.navigate" }] }, { allowlistedHosts: ["example.com"] }),
      /disabled for safety|JON_ENABLE_BROWSER_EVAL/i,
      `${action} must be rejected when eval is disabled`
    );
  }
  // A normal action is still accepted (gate is specific, not blanket).
  const okPlan = validateBrowserPlanOutput(
    { startUrl: "https://example.com", steps: [{ action: "navigate", url: "https://example.com" }] },
    { allowlistedHosts: ["example.com"] }
  );
  assert.ok(Array.isArray(okPlan.steps) && okPlan.steps.length >= 1, "normal plan still validates");

  // ── T3: when explicitly enabled, the gate no longer rejects on that ground ──
  process.env.JON_ENABLE_BROWSER_EVAL = "true";
  let rejectedForDisabled = false;
  try {
    validateBrowserPlanOutput({ steps: [{ action: "evaluate_script", expression: "1+1" }] }, { allowlistedHosts: ["example.com"] });
  } catch (e) {
    if (/disabled for safety/i.test(e.message)) rejectedForDisabled = true;
  }
  assert.equal(rejectedForDisabled, false, "with eval enabled, not rejected for being disabled");
  // restore
  if (prev === undefined) delete process.env.JON_ENABLE_BROWSER_EVAL; else process.env.JON_ENABLE_BROWSER_EVAL = prev;
}
