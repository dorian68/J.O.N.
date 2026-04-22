import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { APP_ROOT, TEMP_RUNTIME_ROOT } from "../config.js";

const SCRIPT_PATH = path.join(APP_ROOT, "src", "computer", "windows-control.ps1");

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell provider failed with code ${code}`));
        return;
      }
      const trimmed = stdout.trim();
      resolve(trimmed ? JSON.parse(trimmed) : null);
    });
  });
}

async function tempCapturePath(prefix) {
  await fs.mkdir(TEMP_RUNTIME_ROOT, { recursive: true });
  return path.join(TEMP_RUNTIME_ROOT, `${prefix}-${Date.now()}.png`);
}

export class PowerShellWindowProvider {
  async listInstalledBrowsers() {
    const result = await runPowerShell(["-Action", "listBrowsers"]);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  async listInstalledApplications() {
    const result = await runPowerShell(["-Action", "listApplications"]);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  async listVisibleWindows() {
    const result = await runPowerShell(["-Action", "list"]);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  async detectActiveWindow() {
    return runPowerShell(["-Action", "active"]);
  }

  async focusWindow(windowId) {
    return runPowerShell(["-Action", "focus", "-Handle", windowId]);
  }

  async launchBrowser(browserId, { url = null } = {}) {
    const args = ["-Action", "launchBrowser", "-BrowserId", browserId];
    if (url) {
      args.push("-LaunchUrl", url);
    }
    return runPowerShell(args);
  }

  async launchApplication(appId) {
    return runPowerShell(["-Action", "launchApplication", "-AppId", appId]);
  }

  async typeText(windowId, text) {
    const args = ["-Action", "typeText", "-Text", String(text ?? "")];
    if (windowId) {
      args.push("-Handle", windowId);
    }
    return runPowerShell(args);
  }

  async sendHotkey(windowId, keys) {
    const args = ["-Action", "sendHotkey", "-Keys", String(keys ?? "")];
    if (windowId) {
      args.push("-Handle", windowId);
    }
    return runPowerShell(args);
  }

  async clickPoint(windowId, point) {
    const args = [
      "-Action", "clickPoint",
      "-X", String(point.x),
      "-Y", String(point.y)
    ];
    if (windowId) {
      args.push("-Handle", windowId);
    }
    return runPowerShell(args);
  }

  async scrollWindow(windowId, delta) {
    const args = ["-Action", "scroll", "-Delta", String(delta)];
    if (windowId) {
      args.push("-Handle", windowId);
    }
    return runPowerShell(args);
  }

  async captureWindow(windowId) {
    const outputPath = await tempCapturePath("window");
    const result = await runPowerShell(["-Action", "captureWindow", "-Handle", windowId, "-OutputPath", outputPath]);
    return {
      ...result,
      outputPath
    };
  }

  async captureRegion(region) {
    const outputPath = await tempCapturePath("region");
    const args = [
      "-Action", "captureRegion",
      "-X", String(region.x),
      "-Y", String(region.y),
      "-Width", String(region.width),
      "-Height", String(region.height),
      "-OutputPath", outputPath
    ];
    const result = await runPowerShell(args);
    return {
      ...result,
      outputPath
    };
  }

  async captureScreen() {
    const outputPath = await tempCapturePath("screen");
    const result = await runPowerShell(["-Action", "captureScreen", "-OutputPath", outputPath]);
    return {
      ...result,
      outputPath
    };
  }

  async ocrImage(imagePath) {
    return runPowerShell(["-Action", "ocrImage", "-ImagePath", imagePath]);
  }

  async inspectVisibleUi(windowId) {
    const inspection = await runPowerShell(["-Action", "inspect", "-Handle", windowId, "-MaxDepth", "3", "-MaxNodes", "80"]);
    return {
      windowId: inspection?.window?.id ?? String(windowId),
      title: inspection?.observation?.title ?? inspection?.window?.title ?? null,
      bounds: inspection?.observation?.bounds ?? inspection?.window?.bounds ?? null,
      content: inspection?.observation?.content ?? inspection?.window?.title ?? null,
      accessibility: inspection?.observation?.accessibility ?? null,
      raw: inspection
    };
  }

  async inspectAccessibilityTree(windowId, { maxDepth = 3, maxNodes = 80 } = {}) {
    return runPowerShell([
      "-Action", "accessibilityTree",
      "-Handle", windowId,
      "-MaxDepth", String(maxDepth),
      "-MaxNodes", String(maxNodes)
    ]);
  }

  async detectBlockingOverlay(windowId) {
    const inspection = await this.inspectVisibleUi(windowId);
    return {
      blocked: false,
      reason: null,
      inspection
    };
  }
}
