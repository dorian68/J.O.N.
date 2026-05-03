import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { sanitizeForLogging } from "../security/redaction.js";
import { nowIso } from "../utils/ids.js";
import { resolveCliCommandPath } from "./cli-command-catalog.js";

const DEFAULT_ALLOWED_COMMANDS = Object.freeze(["codex", "claude"]);
const COMMAND_META_PATTERN = /[;&|<>`]/;
const SENSITIVE_INPUT_PATTERN = /\b(password|passcode|api[-_ ]?key|token|secret|bearer|cookie|mot de passe|clé api|cle api|sk-[a-z0-9])/i;

function compactText(value, maxLength = 8000) {
  return String(value ?? "").replace(/\s+$/g, "").slice(-maxLength);
}

function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\x1B\[[0-9;]*[mGKHFABCDEFJM]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.map((arg) => String(arg ?? "").slice(0, 2000));
}

function commandName(command) {
  const base = path.basename(String(command ?? "").trim()).toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

function safeEnv(extraEnv = {}) {
  const allowedKeys = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC"
  ];
  const next = {};
  for (const key of allowedKeys) {
    if (process.env[key]) {
      next[key] = process.env[key];
    }
  }
  // Force non-interactive, no-color environment so CLI agent output is clean text.
  next.NO_COLOR = "1";
  next.TERM = "dumb";
  next.COLORTERM = "";
  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    if (/^(api[-_]?key|authorization|token|secret|password|cookie)$/i.test(key)) {
      continue;
    }
    next[key] = String(value ?? "");
  }
  return next;
}

export function hasSensitiveTerminalInput(input) {
  return SENSITIVE_INPUT_PATTERN.test(String(input ?? ""));
}

export function normalizeCliLaunchRequest(payload = {}, { allowedCommands = DEFAULT_ALLOWED_COMMANDS } = {}) {
  const command = String(payload.command ?? "").trim();
  if (!command) {
    throw new Error("CLI launch requires a command.");
  }
  if (COMMAND_META_PATTERN.test(command)) {
    throw new Error("CLI command must be an executable name/path, not a shell expression.");
  }
  const normalizedCommandName = commandName(command);
  const allowed = new Set((allowedCommands ?? DEFAULT_ALLOWED_COMMANDS).map((entry) => commandName(entry)));
  if (!allowed.has(normalizedCommandName)) {
    throw new Error(`CLI command is not allowlisted for workspace orchestration: ${normalizedCommandName}.`);
  }
  const resolvedCommand = resolveCliCommandPath(command);
  if (!resolvedCommand) {
    throw new Error(`CLI command is not available on this machine: ${normalizedCommandName}.`);
  }
  const args = normalizeArgs(payload.args);
  return {
    command: resolvedCommand,
    requestedCommand: command,
    displayCommand: command,
    args,
    cwd: payload.cwd ? String(payload.cwd) : process.cwd(),
    env: safeEnv(payload.env),
    label: String(payload.label ?? command).slice(0, 160),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
  };
}

export class CliTerminalSupervisor extends EventEmitter {
  constructor({ allowedCommands = DEFAULT_ALLOWED_COMMANDS } = {}) {
    super();
    this.allowedCommands = allowedCommands;
    this.processes = new Map();
  }

  start(terminalId, payload = {}) {
    if (this.processes.has(terminalId)) {
      throw new Error(`CLI terminal process already exists: ${terminalId}.`);
    }
    const launch = normalizeCliLaunchRequest(payload, {
      allowedCommands: payload.allowedCommands ?? this.allowedCommands
    });
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const snapshot = {
      terminalId,
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      pid: child.pid,
      startedAt: nowIso(),
      exitedAt: null,
      exitCode: null,
      signal: null
    };
    const record = {
      child,
      snapshot,
      outputSubscribers: new Set()
    };
    this.processes.set(terminalId, record);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#emitOutput(terminalId, "stdout", chunk));
    child.stderr.on("data", (chunk) => this.#emitOutput(terminalId, "stderr", chunk));
    child.on("error", (error) => {
      this.emit("error", {
        terminalId,
        message: sanitizeForLogging(error.message),
        createdAt: nowIso()
      });
    });
    child.on("exit", (exitCode, signal) => {
      snapshot.exitedAt = nowIso();
      snapshot.exitCode = exitCode;
      snapshot.signal = signal;
      for (const cb of record.outputSubscribers) {
        try { cb(null, { exitCode: exitCode ?? null }); } catch { /* subscriber error */ }
      }
      record.outputSubscribers.clear();
      this.processes.delete(terminalId);
      this.emit("exit", {
        terminalId,
        exitCode,
        signal,
        snapshot: { ...snapshot },
        createdAt: snapshot.exitedAt
      });
    });
    this.emit("started", {
      terminalId,
      snapshot: { ...snapshot },
      createdAt: snapshot.startedAt
    });
    return { ...snapshot };
  }

  write(terminalId, input) {
    const record = this.processes.get(terminalId);
    if (!record) {
      throw new Error(`CLI terminal process is not active: ${terminalId}.`);
    }
    const text = String(input ?? "");
    if (!text) {
      throw new Error("Terminal input is empty.");
    }
    if (hasSensitiveTerminalInput(text)) {
      throw new Error("Terminal input appears to contain a secret or credential and was blocked.");
    }
    record.child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
    this.emit("input", {
      terminalId,
      text: sanitizeForLogging(compactText(text, 1000)),
      createdAt: nowIso()
    });
  }

  stop(terminalId, { signal = "SIGTERM" } = {}) {
    const record = this.processes.get(terminalId);
    if (!record) {
      return false;
    }
    record.child.kill(signal);
    return true;
  }

  list() {
    return Array.from(this.processes.values()).map((record) => ({ ...record.snapshot }));
  }

  close() {
    for (const terminalId of Array.from(this.processes.keys())) {
      this.stop(terminalId);
    }
  }

  subscribeOutput(terminalId, cb) {
    const record = this.processes.get(terminalId);
    if (record) record.outputSubscribers.add(cb);
  }

  unsubscribeOutput(terminalId, cb) {
    const record = this.processes.get(terminalId);
    if (record) record.outputSubscribers.delete(cb);
  }

  isActive(terminalId) {
    return this.processes.has(terminalId);
  }

  #emitOutput(terminalId, stream, chunk) {
    const text = sanitizeForLogging(compactText(stripAnsi(chunk), 8000));
    if (!text) {
      return;
    }
    const record = this.processes.get(terminalId);
    if (record) {
      for (const cb of record.outputSubscribers) {
        try { cb(text, null); } catch { /* subscriber error */ }
      }
    }
    this.emit("output", {
      terminalId,
      stream,
      text,
      createdAt: nowIso()
    });
  }
}
