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

// SECURITY (audit T10): a launch URL is passed to Start-Process arguments. A
// value starting with "-"/"--" would be interpreted as a Chromium switch
// (e.g. --load-extension, --app), not a navigation target. Only allow http(s)
// (and about:blank); reject dangerous schemes and flag-like values.
export function sanitizeLaunchUrl(url) {
  const raw = String(url ?? "").trim().slice(0, 2048);
  if (!raw || raw.toLowerCase() === "about:blank") return "about:blank";
  if (raw.startsWith("-")) {
    throw Object.assign(new Error(`Refused browser launch URL that looks like a command-line flag: ${raw.slice(0, 40)}`), { code: "UNSAFE_LAUNCH_URL" });
  }
  let parsed;
  try { parsed = new URL(raw); } catch {
    throw Object.assign(new Error(`Refused invalid browser launch URL: ${raw.slice(0, 40)}`), { code: "UNSAFE_LAUNCH_URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw Object.assign(new Error(`Refused browser launch URL scheme "${parsed.protocol}" (only http/https allowed).`), { code: "UNSAFE_LAUNCH_URL" });
  }
  return parsed.toString();
}

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
//
// Self-correction: the daemon self-tests on first use (ping) and, if it ever
// fails to spawn or exits unexpectedly, it disables itself so callers fall back
// to the proven single-shot path. This guarantees desktop actuation keeps
// working even when the persistent mode is unavailable on a given machine.
class PersistentPsProcess {
  constructor() {
    this._proc = null;
    this._pending = new Map();
    this._idCtr = 0;
    this._buf = "";
    this._disabled = false;        // set true after an unrecoverable daemon failure
    this._disposing = false;       // distinguishes intentional shutdown from a crash
    this._disabledReason = null;
  }

  isDisabled() {
    return this._disabled;
  }

  disable(reason) {
    this._disabled = true;
    this._disabledReason = reason ?? "unknown";
  }

  _spawn() {
    let child;
    try {
      child = spawn("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", SCRIPT_PATH,
        "-PersistentMode"
      ], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      this.disable(`spawn_failed: ${error?.message ?? error}`);
      throw error;
    }

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
      const hadInflight = this._pending.size > 0;
      this._proc = null;
      for (const [, p] of this._pending) p.reject(new Error("PS daemon exited unexpectedly"));
      this._pending.clear();
      // An exit while requests were in flight (and not during dispose) means the
      // persistent mode is broken on this host. Disable it permanently so all
      // subsequent calls take the single-shot fallback instead of repeatedly
      // paying spawn+timeout on a daemon that will never answer.
      if (!this._disposing && hadInflight) {
        this.disable("daemon_exited_with_inflight_requests");
      }
    };
    child.on("error", onExit);
    child.on("close", onExit);

    this._proc = child;
  }

  send(command) {
    if (this._disabled) {
      return Promise.reject(new Error(`PS daemon disabled (${this._disabledReason})`));
    }
    if (!this._proc || this._proc.killed) {
      try {
        this._spawn();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise((resolve, reject) => {
      const id = String(++this._idCtr);
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          // The command WAS written to the daemon stdin, so it may still execute
          // late. Mark sent:true so the caller won't blindly re-run a destructive
          // action via the single-shot fallback (audit T9 double-actuation).
          reject(Object.assign(new Error(`PS daemon timeout (${Math.round(PS_DAEMON_TIMEOUT_MS / 1000)}s) for action: ${command.action ?? "unknown"}`), { code: "PS_DAEMON_TIMEOUT", sent: true }));
        }
      }, PS_DAEMON_TIMEOUT_MS);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      try {
        this._proc.stdin.write(JSON.stringify({ ...command, id }) + "\n");
      } catch (error) {
        this._pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  // Verify the daemon actually answers. Resolves true if persistent mode works,
  // false otherwise (caller should rely on single-shot).
  async selfTest() {
    if (this._disabled) return false;
    try {
      const res = await this.send({ action: "ping" });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  }

  dispose() {
    this._disposing = true;
    if (this._proc) {
      try { this._proc.stdin.end(); } catch { /* ignore */ }
    }
  }
}

// Module-level singleton — shared across all provider instances in this process.
const _daemon = new PersistentPsProcess();

// Maps a daemon command to the equivalent single-shot PowerShell invocation.
// This is the self-correcting fallback path: it uses the proven `switch ($Action)`
// branches that have always worked, at the cost of per-action process startup.
function singleShotHotAction(command) {
  const handle = command.handle ? ["-Handle", String(command.handle)] : [];
  switch (command.action) {
    case "ping":
      return runPowerShell(["-Action", "ping"]);
    case "typeText":
      return runPowerShell(["-Action", "typeText", "-Text", String(command.text ?? ""), ...handle]);
    case "sendHotkey":
      return runPowerShell(["-Action", "sendHotkey", "-Keys", String(command.keys ?? ""), ...handle]);
    case "clickPoint":
      return runPowerShell(["-Action", "clickPoint", "-X", String(command.x), "-Y", String(command.y), ...handle]);
    case "rightClick":
      return runPowerShell(["-Action", "rightClick", "-X", String(command.x), "-Y", String(command.y), ...handle]);
    case "doubleClick":
      return runPowerShell(["-Action", "doubleClick", "-X", String(command.x), "-Y", String(command.y), ...handle]);
    case "scroll":
      return runPowerShell(["-Action", "scroll", "-Delta", String(command.delta), ...handle]);
    case "captureScreen":
      return runPowerShell([
        "-Action", "captureScreen", "-OutputPath", String(command.outputPath),
        ...(command.maxWidth ? ["-MaxCaptureWidth", String(command.maxWidth)] : [])
      ]);
    default:
      throw new Error(`No single-shot fallback for action: ${command.action}`);
  }
}

// Send a hot-path action through the fast daemon, automatically falling back to
// the single-shot path if the daemon is unavailable or fails. Once the daemon
// proves broken it disables itself, so steady-state cost is one path only.
// Actions that are safe to re-run if the daemon timed out after dispatch.
// Everything else mutates the desktop and must NOT be auto-retried after a
// timeout (the daemon may have already actuated it) — audit T9.
const IDEMPOTENT_HOT_ACTIONS = new Set(["ping", "captureScreen"]);

// Pure decision (exported for tests): may we re-run this action via the
// single-shot fallback after a daemon error? No, when the action was already
// dispatched (timeout) AND is destructive — re-running would actuate twice.
export function canRetryHotActionAfterError(action, error) {
  const dispatched = error?.sent === true;
  if (dispatched && !IDEMPOTENT_HOT_ACTIONS.has(action)) return false;
  return true;
}

async function sendHotAction(command) {
  if (_daemon.isDisabled()) {
    return singleShotHotAction(command);
  }
  try {
    return await _daemon.send(command);
  } catch (daemonError) {
    // Self-correction: daemon failed -> mark it broken and use the proven path.
    if (!_daemon.isDisabled()) {
      _daemon.disable(`send_failed: ${daemonError?.message ?? daemonError}`);
    }
    // T9: if the command was already dispatched (timeout) and is destructive,
    // do NOT re-run it via single-shot — that would actuate twice.
    if (!canRetryHotActionAfterError(command.action, daemonError)) {
      throw Object.assign(
        new Error(`Desktop action "${command.action}" timed out after dispatch; not retried to avoid double-actuation.`),
        { code: "DESKTOP_ACTION_TIMEOUT_NO_RETRY" }
      );
    }
    return singleShotHotAction(command);
  }
}

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
      args.push("-LaunchUrl", sanitizeLaunchUrl(url));
    }
    return runPowerShell(args);
  }

  async launchApplication(appId) {
    return runPowerShell(["-Action", "launchApplication", "-AppId", String(appId ?? "").slice(0, 120)]);
  }

  async typeText(windowId, text) {
    const textStr = String(text ?? "").slice(0, 4000);
    const handle = validateWindowHandle(windowId);
    return sendHotAction({ action: "typeText", text: textStr, handle: handle ?? null });
  }

  async sendHotkey(windowId, keys) {
    const validatedKeys = validateHotkey(keys);
    const handle = validateWindowHandle(windowId);
    return sendHotAction({ action: "sendHotkey", keys: validatedKeys, handle: handle ?? null });
  }

  async clickPoint(windowId, point) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("clickPoint coordinates must be finite numbers.");
    }
    const handle = validateWindowHandle(windowId);
    return sendHotAction({ action: "clickPoint", x, y, handle: handle ?? null });
  }

  async scrollWindow(windowId, delta) {
    const deltaInt = Math.round(Number(delta));
    if (!Number.isFinite(deltaInt)) {
      throw new Error("scroll delta must be a finite number.");
    }
    const handle = validateWindowHandle(windowId);
    return sendHotAction({ action: "scroll", delta: deltaInt, handle: handle ?? null });
  }

  async rightClickPoint(windowId, point) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("rightClick coordinates must be finite numbers.");
    const handle = validateWindowHandle(windowId);
    return sendHotAction({ action: "rightClick", x, y, handle: handle ?? null });
  }

  async doubleClickPoint(windowId, point) {
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("doubleClick coordinates must be finite numbers.");
    const handle = validateWindowHandle(windowId);
    return sendHotAction({ action: "doubleClick", x, y, handle: handle ?? null });
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

  async captureScreen({ maxWidth = null } = {}) {
    const outputPath = await tempCapturePath("screen");
    const command = { action: "captureScreen", outputPath };
    if (Number.isFinite(Number(maxWidth)) && Number(maxWidth) > 0) {
      command.maxWidth = Math.round(Number(maxWidth));
    }
    const result = await sendHotAction(command);
    return {
      ...result,
      outputPath
    };
  }

  // Health probe for the self-test layer. Reports whether the real provider can
  // actuate (fast daemon or single-shot) so the runtime can surface a clear
  // diagnostic instead of failing mid-mission.
  async selfTest() {
    const checks = {};
    let ok = true;

    // 1. Window enumeration (single-shot path, always required).
    try {
      const windows = await this.listVisibleWindows();
      checks.listWindows = { ok: true, windowCount: Array.isArray(windows) ? windows.length : 0 };
    } catch (error) {
      ok = false;
      checks.listWindows = { ok: false, error: String(error?.message ?? error) };
    }

    // 2. Persistent daemon (fast path). Non-fatal: single-shot covers it.
    const daemonHealthy = await _daemon.selfTest();
    checks.persistentDaemon = {
      ok: daemonHealthy,
      mode: daemonHealthy ? "persistent" : "single_shot_fallback",
      disabled: _daemon.isDisabled()
    };

    // 3. Single-shot actuation path (ping via the proven switch). This is the
    //    floor: if it fails, interactive actions cannot work at all.
    try {
      const pong = await runPowerShell(["-Action", "ping"]);
      checks.singleShotActuation = { ok: Boolean(pong && pong.ok) };
      if (!pong || !pong.ok) ok = false;
    } catch (error) {
      ok = false;
      checks.singleShotActuation = { ok: false, error: String(error?.message ?? error) };
    }

    return {
      ok,
      provider: "powershell_window_provider",
      actuationMode: checks.persistentDaemon.ok ? "persistent" : "single_shot",
      checks
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
