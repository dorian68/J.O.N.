import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDesktopShellBundle } from "../../desktop/build-shell-bundle.mjs";

export async function run() {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-desktop-bundle-"));
  try {
    const result = await buildDesktopShellBundle({
      outputRoot
    });
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.boundaries.loopbackOnly, true);
    assert.equal(manifest.displayName, "Cowork Desktop");
    assert.equal(manifest.supportStatus, "local_pilot_only");
    assert.equal(manifest.bundleVariant, "browser_app_wrapper");
    assert.equal(manifest.icon.format, "svg");
    await fs.access(path.join(outputRoot, "launch-cowork-desktop.ps1"));
    await fs.access(path.join(outputRoot, "launch-cowork-desktop.cmd"));
    await fs.access(path.join(outputRoot, "assets", "cowork-mark.svg"));
  } finally {
    await fs.rm(outputRoot, {
      force: true,
      recursive: true
    });
  }
}
