import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { APP_ROOT, TEMP_RUNTIME_ROOT } from "../config.js";

const SCRIPT_PATH = path.join(APP_ROOT, "src", "computer", "windows-control.ps1");
const PS_DAEMON_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.COWORK_PS_DAEMON_TIMEOUT_MS ?? "15000", 10) || 15000
);
const POWERSHELL_COMMAND_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.COWORK_PS_COMMAND_TIMEOUT_MS ?? "12000", 10) || 12000
);

// Allowlisted hotkey patterns — only simple combos accepted
const NAMED_KEYS = "enter|return|escape|esc|tab|space|backspace|delete|home|end|pageup|pagedown|up|down|left|right|f1|f2|f3|f4|f5|f6|f7|f8|f9|f10|f11|f12";
const ALLOWED_HOTKEY_PATTERN = new RegExp(`^(?:(?:ctrl|alt|shift|win)\\+)*(?:[a-z0-9]|${NAMED_KEYS})$`, "i");
const ALLOWED_HOTKEY_NAMED = new Set([
  "return", "enter", "escape", "esc", "tab", "space", "backspace", "delete",
  "home", "end", "pageup", "pagedown",
  "up", "down", "left", "right",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
  "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "ctrl+y",
  "ctrl+s", "ctrl+w", "ctrl+t", "ctrl+r", "ctrl+l", "ctrl+f",
  "ctrl+up", "ctrl+down", "ctrl+left", "ctrl+right",
  "ctrl+home", "ctrl+end", "ctrl+pageup", "ctrl+pagedown",
  "shift+up", "shift+down", "shift+left", "shift+right",
  "shift+home", "shift+end", "shift+tab",
  "alt+up", "alt+down", "alt+left", "alt+right",
  "ctrl+shift+t", "ctrl+shift+n", "alt+f4", "alt+tab"
]);

function validateWindowHandle(windowId) {
  if (windowId == null) return null;
  const str = String(windowId).trim();
  if (!/^\d{1,10}$/.test(str)) {
    throw new Error(`Invalid window handle: must be a positive integer, got "${str.slice(0, 20)}"`);
  }
  return str;
}

function validateHotkey(keys) {
  const normalized = String(keys ?? "").trim().toLowerCase();
  if (!normalized) throw new Error("Hotkey is required.");
  if (!ALLOWED_HOTKEY_PATTERN.test(normalized) && !ALLOWED_HOTKEY_NAMED.has(normalized)) {
    throw new Error(`Hotkey "${normalized.slice(0, 40)}" is not in the allowed list.`);
  }
  return normalized;
}

function validateImagePath(imagePath) {
  const resolved = path.resolve(imagePath);
  const root = path.resolve(TEMP_RUNTIME_ROOT);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("imagePath must be within the runtime temp directory.");
  }
  return resolved;
}

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const actionIndex = args.indexOf("-Action");
    const action = actionIndex >= 0 ? args[actionIndex + 1] ?? "unknown" : "unknown";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`PowerShell provider timeout (${Math.round(POWERSHELL_COMMAND_TIMEOUT_MS / 1000)}s) for action: ${action}`));
    }, POWERSHELL_COMMAND_TIMEOUT_MS);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(reject, new Error(stderr || `PowerShell provider failed with code ${code}`));
        return;
      }
      const trimmed = stdout.trim();
      try {
        finish(resolve, trimmed ? JSON.parse(trimmed) : null);
      } catch (error) {
        finish(reject, error);
      }
    });
  });
}

// Persistent PowerShell process — eliminates ~800 ms per-action startup cost.
// One process is shared for all hot-path actions: clickPoint, scroll, typeText,
// sendHotkey, captureScreen.
class PersistentPsProcess {
  constructor() {
    this._proc = null;
    this._pending = new Map();
    this._idCtr = 0;
    this._buf = "";
  }

  _spawn() {
    const child = spawn("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", SCRIPT_PATH,
      "-PersistentMode"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    this._buf = "";

    child.stdout.on("data", (chunk) => {
      this._buf += chunk.toString();
      let nl;
      while ((nl = this._buf.indexOf("\n")) !== -1) {
        const line = this._buf.slice(0, nl).trim();
        this._buf = this._buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const p = this._pending.get(msg.id);
          if (p) {
            this._pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.result ?? null);
          }
        } catch { /* ignore malformed output */ }
      }
    });

    child.stderr.on("data", () => { /* suppress stderr noise */ });

    const onExit = () => {
      this._proc = null;
      for (const [, p] of this._pending) p.reject(new Error("PS daemon exited unexpectedly"));
      this._pending.clear();
    };
    child.on("error", onExit);
    child.on("close", onExit);

    this._proc = child;
  }

  send(command) {
    if (!this._proc || this._proc.killed) this._spawn();
    return new Promise((resolve, reject) => {
      const id = String(++this._idCtr);
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`PS daemon timeout (${Math.round(PS_DAEMON_TIMEOUT_MS / 1000)}s) for action: ${command.action ?? "unknown"}`));
        }
      }, PS_DAEMON_TIMEOUT_MS);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this._proc.stdin.write(JSON.stringify({ ...command, id }) + "\n");
    });
  }

  dispose() {
    if (this._proc) {
      try { this._proc.stdin.end(); } catch { /* ignore */ }
    }
  }
}

// Module-level singleton — shared across all provider instances in this process.
const _daemon = new PersistentPsProcess();

async function tempCapturePath(prefix) {
  await fs.mkdir(TEMP_RUNTIME_ROOT, { recursive: true });
  return path.join(TEMP_RUNTIME_ROOT, `${prefix}-${Date.now()}.jpg`);
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

  async listExternalTerminals() {
    const result = await runPowerShell(["-Action", "detectTerminals"]);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  async readExternalTerminalBuffer(processId, windowHandle = null) {
    if (!processId && !windowHandle) throw new Error("processId or windowHandle is required");
    const args = ["-Action", "readTerminalBuffer"];
    if (processId) args.push("-ProcessId", String(processId));
    if (windowHandle) args.push("-Handle", String(windowHandle));
    return runPowerShell(args);
  }

  async sendExternalTerminalInput(processId, text, windowHandle = null) {
    if (!processId && !windowHandle) throw new Error("processId or windowHandle is required");
    const safeText = String(text ?? "").slice(0, 8000);
    const args = ["-Action", "sendTerminalInput", "-Text", safeText];
    if (processId) args.push("-ProcessId", String(processId));
    if (windowHandle) args.push("-Handle", String(windowHandle));
    return runPowerShell(args);
  }

  async detectActiveWindow() {
    return runPowerShell(["-Action", "active"]);
  }

  async focusWindow(windowId) {
    const handle = validateWindowHandle(windowId);
    return runPowerShell(["-Action", "focus", "-Handle", handle]);
  }

  async launchBrowser(browserId, { url = null } = {}) {
    const args = ["-Action", "launchBrowser", "-BrowserId", String(browserId ?? "").slice(0, 60)];
    if (url) {
      args.push("-LaunchUrl", String(url).slice(0, 2048));
    }
    return runPowerShell(args);
  }

  async launchApplication(appId) {
    return runPowerShell(["-Action", "launchApplication", "-AppId", String(appId ?? "").slice(0, 120)]);
  }

  async typeText(windowId, text) {
    const textStr = String(text ?? "").slice(0, 4000);
    const handle = validateWindowHandle(windowId);
    return _daemon.send({ action: "typeText", text: textStr, handle: handle ?? null });
  }

  async sendHotkey(windowId, keys) {
    const validatedKeys = validateHotkey(keys);
    const handle = validateWindowHandle(windowId);
    return _daemon.send({ action: "sendHotkey", keys: validatedKeys, handle: handle ?? null });
  }

  async clickPoint(windowId, point) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("clickPoint coordinates must be finite numbers.");
    }
    const handle = validateWindowHandle(windowId);
    return _daemon.send({ action: "clickPoint", x, y, handle: handle ?? null });
  }

  async scrollWindow(windowId, delta) {
    const deltaInt = Math.round(Number(delta));
    if (!Number.isFinite(deltaInt)) {
      throw new Error("scroll delta must be a finite number.");
    }
    const handle = validateWindowHandle(windowId);
    return _daemon.send({ action: "scroll", delta: deltaInt, handle: handle ?? null });
  }

  async captureWindow(windowId) {
    const handle = validateWindowHandle(windowId);
    const outputPath = await tempCapturePath("window");
    const result = await runPowerShell(["-Action", "captureWindow", "-Handle", handle, "-OutputPath", outputPath]);
    return {
      ...result,
      outputPath
    };
  }

  async captureRegion(region) {
    const x = Math.round(Number(region.x));
    const y = Math.round(Number(region.y));
    const width = Math.round(Number(region.width));
    const height = Math.round(Number(region.height));
    if ([x, y, width, height].some((v) => !Number.isFinite(v) || v < 0)) {
      throw new Error("captureRegion dimensions must be non-negative finite numbers.");
    }
    const outputPath = await tempCapturePath("region");
    const args = [
      "-Action", "captureRegion",
      "-X", String(x),
      "-Y", String(y),
      "-Width", String(width),
      "-Height", String(height),
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
    const result = await _daemon.send({ action: "captureScreen", outputPath });
    return {
      ...result,
      outputPath
    };
  }

  async getWindowIcon(windowId) {
    const handle = validateWindowHandle(windowId);
    if (!handle) throw new Error("getWindowIcon requires a window handle.");
    return runPowerShell(["-Action", "getWindowIcon", "-Handle", handle]);
  }

  async ocrImage(imagePath) {
    const safeImagePath = validateImagePath(imagePath);
    return runPowerShell(["-Action", "ocrImage", "-ImagePath", safeImagePath]);
  }

  async inspectVisibleUi(windowId) {
    const handle = validateWindowHandle(windowId);
    const inspection = await runPowerShell(["-Action", "inspect", "-Handle", handle, "-MaxDepth", "3", "-MaxNodes", "80"]);
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
    const handle = validateWindowHandle(windowId);
    const depth = Math.min(Math.max(1, Math.round(Number(maxDepth) || 3)), 8);
    const nodes = Math.min(Math.max(1, Math.round(Number(maxNodes) || 80)), 200);
    return runPowerShell([
      "-Action", "accessibilityTree",
      "-Handle", handle,
      "-MaxDepth", String(depth),
      "-MaxNodes", String(nodes)
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
