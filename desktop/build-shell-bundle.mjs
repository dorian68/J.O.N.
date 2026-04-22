import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(repoRoot, "app", ".runtime-data", "release");
const appIconPath = path.join(repoRoot, "app", "ui", "assets", "cowork-mark.svg");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, {
    recursive: true
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, "utf8");
}

function parseArgs(argv) {
  const options = {
    outputRoot: path.join(repoRoot, "dist", "desktop-shell")
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output" && argv[index + 1]) {
      options.outputRoot = path.resolve(repoRoot, argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

function bundleManifest({ version, outputRoot }) {
  return {
    name: "cowork-desktop-shell",
    displayName: "Cowork Desktop",
    windowTitle: "Cowork Desktop | Local pilot",
    version,
    buildId: `desktop-shell-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    packageType: "local_wrapper_bundle",
    bundleVariant: "browser_app_wrapper",
    supportStatus: "local_pilot_only",
    targetPlatform: process.platform,
    targetArch: process.arch,
    icon: {
      path: path.join(outputRoot, "assets", "cowork-mark.svg"),
      format: "svg"
    },
    boundaries: {
      addsBusinessLogic: false,
      loopbackOnly: true,
      remoteNavigationAllowed: false,
      browserControlExpanded: false,
      computerControlExpanded: true,
      computerControlPosture: "approved_local_actions_with_accessibility_perception"
    },
    signing: {
      signedNativePackagingProven: false,
      codeSigningCertificateProvided: Boolean(process.env.COWORK_WINDOWS_SIGNING_CERT_PATH),
      productionInstallerProven: false,
      requiredForProduction: [
        "Windows code-signing certificate",
        "Native installer packaging",
        "SmartScreen reputation plan",
        "Install/uninstall smoke evidence on a clean target machine"
      ]
    },
    launchers: {
      powershell: path.join(outputRoot, "launch-cowork-desktop.ps1"),
      cmd: path.join(outputRoot, "launch-cowork-desktop.cmd")
    },
    smokeProcedure: [
      "Run launch-cowork-desktop.ps1 -DryRun",
      "Run launch-cowork-desktop.ps1",
      "Verify the operator surface opens and remains on loopback only"
    ],
    diagnostics: {
      localOnly: true,
      releaseRoot,
      manifestVersion: 1
    },
    usability: {
      intendedAudience: "single local operator",
      requiresExistingRuntime: true,
      signedNativePackagingProven: false,
      desktopAutonomyFoundation: "accessibility_perception_semantic_targets_checkpoints_recovery"
    }
  };
}

function powershellLauncher(repoRootPath) {
  const normalizedRepoRoot = repoRootPath.replace(/'/g, "''");
  return [
    "param(",
    "  [switch]$DryRun",
    ")",
    `$RepoRoot = '${normalizedRepoRoot}'`,
    "Push-Location $RepoRoot",
    "try {",
    "  if ($DryRun) {",
    "    node desktop\\launch-shell.mjs --dry-run",
    "  } else {",
    "    node desktop\\launch-shell.mjs",
    "  }",
    "} finally {",
    "  Pop-Location",
    "}"
  ].join("\r\n");
}

function cmdLauncher() {
  return [
    "@echo off",
    "setlocal",
    "set REPO_ROOT=%~dp0..\\..",
    "pushd %REPO_ROOT%",
    "node desktop\\launch-shell.mjs",
    "set EXITCODE=%ERRORLEVEL%",
    "popd",
    "exit /b %EXITCODE%"
  ].join("\r\n");
}

export async function buildDesktopShellBundle({ outputRoot } = {}) {
  const resolvedOutputRoot = outputRoot ?? path.join(repoRoot, "dist", "desktop-shell");
  const rootPackage = await readJson(path.join(repoRoot, "package.json"));
  const appPackage = await readJson(path.join(repoRoot, "app", "package.json"));
  await fs.rm(resolvedOutputRoot, {
    force: true,
    recursive: true
  });
  await ensureDir(resolvedOutputRoot);

  const manifest = bundleManifest({
    version: rootPackage.version ?? appPackage.version ?? "0.0.0-local",
    outputRoot: resolvedOutputRoot
  });

  await writeText(
    path.join(resolvedOutputRoot, "launch-cowork-desktop.ps1"),
    powershellLauncher(repoRoot)
  );
  await writeText(
    path.join(resolvedOutputRoot, "launch-cowork-desktop.cmd"),
    cmdLauncher()
  );
  await ensureDir(path.join(resolvedOutputRoot, "assets"));
  await fs.copyFile(
    appIconPath,
    path.join(resolvedOutputRoot, "assets", "cowork-mark.svg")
  );
  await writeText(
    path.join(resolvedOutputRoot, "desktop-shell-manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  await writeText(
    path.join(resolvedOutputRoot, "README.txt"),
    [
      "Cowork Desktop local shell bundle",
      "",
      "This is a thin local wrapper bundle for the current local pilot product surface.",
      "It is not a signed native installer and it does not bundle new business logic.",
      "It launches the existing local cowork surface through desktop/launch-shell.mjs.",
      `App version: ${manifest.version}`,
      `Build id: ${manifest.buildId}`,
      `Support status: ${manifest.supportStatus}`,
      `Bundle variant: ${manifest.bundleVariant}`,
      `Window title: ${manifest.windowTitle}`,
      "",
      "Included assets:",
      "  assets\\cowork-mark.svg",
      "",
      "Smoke:",
      "  powershell -ExecutionPolicy Bypass -File .\\launch-cowork-desktop.ps1 -DryRun"
    ].join("\r\n")
  );
  await writeText(
    path.join(resolvedOutputRoot, "SIGNING-REQUIREMENTS.txt"),
    [
      "Cowork Desktop production signing requirements",
      "",
      "This bundle is not a signed production installer.",
      "Production distribution still requires:",
      "  1. Windows code-signing certificate and secure key handling.",
      "  2. Native installer packaging with install/uninstall smoke proof.",
      "  3. SmartScreen reputation plan.",
      "  4. Clean-machine validation evidence.",
      "  5. A release approval record that does not contain secrets.",
      "",
      "Current supported posture: local pilot wrapper bundle."
    ].join("\r\n")
  );

  const report = {
    status: "ready",
    outputRoot: resolvedOutputRoot,
    manifestPath: path.join(resolvedOutputRoot, "desktop-shell-manifest.json"),
    buildId: manifest.buildId,
    version: manifest.version,
    displayName: manifest.displayName,
    packageType: manifest.packageType,
    bundleVariant: manifest.bundleVariant,
    supportStatus: manifest.supportStatus,
    targetPlatform: manifest.targetPlatform
  };
  await writeText(
    path.join(releaseRoot, "desktop-shell-bundle-latest.json"),
    JSON.stringify(report, null, 2)
  );

  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildDesktopShellBundle(options);
  console.log(JSON.stringify({
    status: "ready",
    ...result
  }, null, 2));
}
