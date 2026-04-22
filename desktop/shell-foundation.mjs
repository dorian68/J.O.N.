import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const DEFAULT_OPERATOR_URL = "http://127.0.0.1:41732";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function candidateBrowserPaths({ env = process.env } = {}) {
  return [
    env.COWORK_DESKTOP_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);
}

export async function resolveBrowserPath({ env = process.env } = {}) {
  for (const candidate of candidateBrowserPaths({ env })) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No supported desktop shell browser was found. Set COWORK_DESKTOP_BROWSER_PATH to a local Edge/Chrome executable.");
}

export function assertLocalOperatorBaseUrl(baseUrl = DEFAULT_OPERATOR_URL) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid operator base URL: ${baseUrl}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error(`Desktop shell requires an http loopback operator URL. Received protocol ${parsed.protocol}`);
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(`Desktop shell only allows loopback operator hosts. Received ${parsed.hostname}`);
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function deriveOperatorPort(baseUrl = DEFAULT_OPERATOR_URL) {
  const normalized = new URL(assertLocalOperatorBaseUrl(baseUrl));
  return normalized.port ? Number.parseInt(normalized.port, 10) : 80;
}

export function buildShellProfilePath() {
  return path.join(os.tmpdir(), "cowork-prototype-desktop-shell");
}

export function buildShellLaunchSpec({
  baseUrl = DEFAULT_OPERATOR_URL,
  browserPath,
  profilePath = buildShellProfilePath()
}) {
  const normalizedBaseUrl = assertLocalOperatorBaseUrl(baseUrl);
  const appUrl = `${normalizedBaseUrl}/`;
  return {
    browserPath,
    profilePath,
    baseUrl: normalizedBaseUrl,
    appUrl,
    args: [
      `--app=${appUrl}`,
      `--user-data-dir=${profilePath}`,
      "--no-first-run",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-extensions",
      "--no-default-browser-check",
      "--disable-features=msEdgeSidebarV2"
    ]
  };
}

export async function waitForOperatorHealth({ baseUrl = DEFAULT_OPERATOR_URL, timeoutMs = 15_000, pollMs = 250 } = {}) {
  const normalizedBaseUrl = assertLocalOperatorBaseUrl(baseUrl);
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/api/health`, {
        method: "GET"
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Operator server did not become healthy within ${timeoutMs}ms at ${normalizedBaseUrl}.`);
}

export async function isOperatorHealthy({ baseUrl = DEFAULT_OPERATOR_URL } = {}) {
  try {
    await waitForOperatorHealth({
      baseUrl,
      timeoutMs: 250,
      pollMs: 50
    });
    return true;
  } catch {
    return false;
  }
}

