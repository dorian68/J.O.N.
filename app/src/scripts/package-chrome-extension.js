// Build/validate + package the JON Chrome extension into dist/jon-chrome-extension.zip.
//   npm run build:chrome-extension     (validate only)
//   npm run package:chrome-extension   (validate + write the zip)
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "../config.js";
import { validateExtension, buildExtensionZip } from "../browser/chrome-extension-package.js";

const packageMode = process.argv.includes("--package");

const validation = validateExtension();
if (!validation.valid) {
  console.error("❌ Chrome extension validation FAILED:");
  for (const e of validation.errors) console.error("   - " + e);
  process.exit(1);
}
console.log(`✅ Extension valid: ${validation.name} v${validation.version} (MV3)`);

if (packageMode) {
  const { buffer, fileCount, files, version } = buildExtensionZip();
  const distDir = path.join(APP_ROOT, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  const outPath = path.join(distDir, "jon-chrome-extension.zip");
  fs.writeFileSync(outPath, buffer);
  console.log(`📦 Packaged ${fileCount} files (${files.join(", ")}) → ${outPath} (${buffer.length} bytes, v${version})`);
}
