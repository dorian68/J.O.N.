import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesktopShellBundle } from "./build-shell-bundle.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(repoRoot, "app", ".runtime-data", "release");

export async function smokeDesktopShellBundle() {
  const outputRoot = path.join(repoRoot, "dist", "desktop-shell-smoke");
  const bundle = await buildDesktopShellBundle({
    outputRoot
  });

  const manifest = JSON.parse(await fs.readFile(bundle.manifestPath, "utf8"));
  const powershellLauncher = path.join(outputRoot, "launch-cowork-desktop.ps1");
  const cmdLauncher = path.join(outputRoot, "launch-cowork-desktop.cmd");
  const iconPath = path.join(outputRoot, "assets", "cowork-mark.svg");
  await fs.access(powershellLauncher);
  await fs.access(cmdLauncher);
  await fs.access(iconPath);

  if (manifest.boundaries.loopbackOnly !== true) {
    throw new Error("Desktop shell bundle manifest must declare loopbackOnly=true.");
  }
  if (manifest.displayName !== "Cowork Desktop") {
    throw new Error("Desktop shell bundle manifest must declare the product display name.");
  }
  if (manifest.supportStatus !== "local_pilot_only") {
    throw new Error("Desktop shell bundle manifest must declare the current support status.");
  }

  const result = {
    status: "pass",
    outputRoot,
    manifestPath: bundle.manifestPath,
    iconPath
  };
  await fs.mkdir(releaseRoot, {
    recursive: true
  });
  await fs.writeFile(
    path.join(releaseRoot, "desktop-shell-smoke-latest.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const result = await smokeDesktopShellBundle();
  console.log(JSON.stringify(result, null, 2));
}
