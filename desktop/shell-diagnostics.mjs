import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_OPERATOR_URL,
  assertLocalOperatorBaseUrl,
  buildShellLaunchSpec,
  isOperatorHealthy,
  resolveBrowserPath
} from "./shell-foundation.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const releaseRoot = path.join(repoRoot, "app", ".runtime-data", "release");

export async function buildDesktopDryRunReport({
  env = process.env,
  baseUrl = env.COWORK_OPERATOR_BASE_URL || DEFAULT_OPERATOR_URL,
  includeHealthCheck = true
} = {}) {
  const operatorBaseUrl = assertLocalOperatorBaseUrl(baseUrl);
  const browserPath = await resolveBrowserPath({
    env
  });
  const launchSpec = buildShellLaunchSpec({
    baseUrl: operatorBaseUrl,
    browserPath
  });
  const operatorHealthy = includeHealthCheck
    ? await isOperatorHealthy({
      baseUrl: operatorBaseUrl
    })
    : null;

  return {
    status: "ready",
    operatorBaseUrl,
    operatorHealthy,
    browserPath: launchSpec.browserPath,
    args: launchSpec.args
  };
}

export async function persistDesktopDryRunReport(report) {
  await fs.mkdir(releaseRoot, {
    recursive: true
  });
  const outputPath = path.join(releaseRoot, "desktop-shell-dry-run-latest.json");
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  return {
    latestPath: outputPath
  };
}
