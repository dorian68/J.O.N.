import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import {
  assertLocalOperatorBaseUrl,
  buildShellLaunchSpec,
  deriveOperatorPort,
  isOperatorHealthy,
  resolveBrowserPath,
  waitForOperatorHealth
} from "./shell-foundation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(repoRoot, "app", ".runtime-data", "release");
const operatorScriptPath = path.join(repoRoot, "app", "src", "scripts", "start-operator-server.js");
const userUiBundlePath = path.join(repoRoot, "app", "ui", "assets", "react", "cowork-user.js");
const userUiSourcePaths = [
  path.join(repoRoot, "app", "ui", "src", "main.jsx"),
  path.join(repoRoot, "app", "ui", "vite.config.mjs"),
  path.join(repoRoot, "app", "package.json"),
  path.join(repoRoot, "app", "package-lock.json")
];
const operatorBaseUrl = assertLocalOperatorBaseUrl(process.env.COWORK_OPERATOR_BASE_URL || "http://127.0.0.1:41732");
const dryRun = process.argv.includes("--dry-run");

let operatorProcess = null;
let browserProcess = null;
let ownsOperatorServer = false;

function ensureUserUiBundle() {
  if (process.env.COWORK_SKIP_UI_BUILD === "1") {
    return;
  }
  if (process.env.COWORK_FORCE_UI_BUILD !== "1" && fsSync.existsSync(userUiBundlePath)) {
    const bundleMtime = fsSync.statSync(userUiBundlePath).mtimeMs;
    const sourceIsNewer = userUiSourcePaths.some((sourcePath) => (
      fsSync.existsSync(sourcePath) && fsSync.statSync(sourcePath).mtimeMs > bundleMtime
    ));
    if (!sourceIsNewer) {
      return;
    }
  }
  const result = spawnSync("npm", ["--prefix", "app", "run", "ui:build", "--silent"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    if (fsSync.existsSync(userUiBundlePath)) {
      console.warn("[desktop] User UI build failed; reusing the existing React bundle.");
      return;
    }
    throw new Error("User UI build failed.");
  }
}

function cleanup(exitCode = 0) {
  if (browserProcess && !browserProcess.killed) {
    browserProcess.kill();
  }
  if (ownsOperatorServer && operatorProcess && !operatorProcess.killed) {
    operatorProcess.kill();
  }
  process.exit(exitCode);
}

async function ensureOperatorServer() {
  if (await isOperatorHealthy({ baseUrl: operatorBaseUrl })) {
    return {
      reusedExistingServer: true
    };
  }

  ownsOperatorServer = true;
  operatorProcess = spawn(process.execPath, [operatorScriptPath], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      COWORK_OPERATOR_PORT: String(deriveOperatorPort(operatorBaseUrl))
    }
  });
  operatorProcess.on("exit", (code) => {
    if (code !== 0 && browserProcess && !browserProcess.killed) {
      browserProcess.kill();
    }
  });

  await waitForOperatorHealth({
    baseUrl: operatorBaseUrl
  });

  return {
    reusedExistingServer: false
  };
}

async function main() {
  ensureUserUiBundle();
  const browserPath = await resolveBrowserPath();
  const launchSpec = buildShellLaunchSpec({
    baseUrl: operatorBaseUrl,
    browserPath
  });
  const serverMode = await ensureOperatorServer();

  if (dryRun) {
    const report = {
      status: "ready",
      operatorBaseUrl,
      browserPath: launchSpec.browserPath,
      reusedExistingServer: serverMode.reusedExistingServer,
      args: launchSpec.args
    };
    await fs.mkdir(releaseRoot, {
      recursive: true
    });
    await fs.writeFile(
      path.join(releaseRoot, "desktop-shell-dry-run-latest.json"),
      JSON.stringify(report, null, 2),
      "utf8"
    );
    console.log(JSON.stringify(report, null, 2));
    cleanup(0);
    return;
  }

  browserProcess = spawn(launchSpec.browserPath, launchSpec.args, {
    cwd: repoRoot,
    stdio: "ignore",
    detached: false
  });
  browserProcess.on("exit", () => {
    cleanup(0);
  });
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

main().catch((error) => {
  console.error(error.message);
  cleanup(1);
});
