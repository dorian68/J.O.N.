import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { sanitizeForLogging } from "../security/redaction.js";
import { nowIso } from "../utils/ids.js";
import { normalizeCliLaunchRequest } from "./cli-terminal-supervisor.js";

const require = createRequire(import.meta.url);
const nodePty = require("node-pty");

const DEFAULT_PTY_COLS = 120;
const DEFAULT_PTY_ROWS = 30;

function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\x1B\[[0-9;]*[mGKHFABCDEFJM]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function compactText(value, maxLength = 8000) {
  return String(value ?? "").replace(/\s+$/g, "").slice(-maxLength);
}

export class PtyTerminalSupervisor extends EventEmitter {
  constructor({ allowedCommands = null } = {}) {
    super();
    this.allowedCommands = allowedCommands;
    this.processes = new Map();
  }

  start(terminalId, payload = {}) {
    if (this.processes.has(terminalId)) {
      throw new Error(`PTY terminal process already exists: ${terminalId}.`);
    }
    const launch = normalizeCliLaunchRequest(payload, {
      allowedCommands: payload.allowedCommands ?? this.allowedCommands
    });
    const cols = Math.max(10, Math.min(500, Number(payload.cols) || DEFAULT_PTY_COLS));
    const rows = Math.max(5, Math.min(200, Number(payload.rows) || DEFAULT_PTY_ROWS));
    let pty;
    try {
      pty = nodePty.spawn(launch.command, launch.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: launch.cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" }
      });
    } catch (spawnError) {
      const spawnErrorEvent = { terminalId, message: spawnError.message ?? "PTY spawn failed.", createdAt: nowIso() };
      this.emit("error", spawnErrorEvent);
      throw spawnError;
    }
    const snapshot = {
      terminalId,
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      pid: pty.pid,
      cols,
      rows,
      startedAt: nowIso(),
      exitedAt: null,
      exitCode: null,
      signal: null
    };
    const record = { pty, snapshot, rawSubscribers: new Set() };
    this.processes.set(terminalId, record);

    pty.onData((data) => {
      for (const cb of record.rawSubscribers) {
        try { cb(data, null); } catch { /* subscriber error */ }
      }
      const text = sanitizeForLogging(compactText(stripAnsi(data), 8000));
      if (text) {
        this.emit("output", { terminalId, stream: "stdout", text, createdAt: nowIso() });
      }
    });

    pty.onExit(({ exitCode }) => {
      snapshot.exitedAt = nowIso();
      snapshot.exitCode = exitCode ?? null;
      snapshot.signal = null;
      // Notify raw subscribers of exit before removing the record
      for (const cb of record.rawSubscribers) {
        try { cb(null, { exitCode: exitCode ?? null }); } catch { /* subscriber error */ }
      }
      this.processes.delete(terminalId);
      this.emit("exit", {
        terminalId,
        exitCode: exitCode ?? null,
        signal: null,
        snapshot: { ...snapshot },
        createdAt: snapshot.exitedAt
      });
    });

    this.emit("started", { terminalId, snapshot: { ...snapshot }, createdAt: snapshot.startedAt });
    return { ...snapshot };
  }

  write(terminalId, input) {
    const record = this.processes.get(terminalId);
    if (!record) {
      throw new Error(`PTY terminal process is not active: ${terminalId}.`);
    }
    try {
      record.pty.write(String(input ?? ""));
    } catch (writeError) {
      this.emit("error", { terminalId, message: writeError.message ?? "PTY write failed.", createdAt: nowIso() });
      return;
    }
    this.emit("input", {
      terminalId,
      text: sanitizeForLogging(String(input ?? "").slice(0, 200)),
      createdAt: nowIso()
    });
  }

  resize(terminalId, { cols = DEFAULT_PTY_COLS, rows = DEFAULT_PTY_ROWS } = {}) {
    const record = this.processes.get(terminalId);
    if (!record) return false;
    const safeCols = Math.max(10, Math.min(500, Number(cols) || DEFAULT_PTY_COLS));
    const safeRows = Math.max(5, Math.min(200, Number(rows) || DEFAULT_PTY_ROWS));
    record.pty.resize(safeCols, safeRows);
    record.snapshot.cols = safeCols;
    record.snapshot.rows = safeRows;
    return true;
  }

  subscribeRaw(terminalId, cb) {
    const record = this.processes.get(terminalId);
    if (record) record.rawSubscribers.add(cb);
  }

  unsubscribeRaw(terminalId, cb) {
    const record = this.processes.get(terminalId);
    if (record) record.rawSubscribers.delete(cb);
  }

  isActive(terminalId) {
    return this.processes.has(terminalId);
  }

  stop(terminalId) {
    const record = this.processes.get(terminalId);
    if (!record) return false;
    try { record.pty.kill(); } catch { /* already dead */ }
    return true;
  }

  list() {
    return Array.from(this.processes.values()).map((r) => ({ ...r.snapshot }));
  }

  close() {
    for (const terminalId of Array.from(this.processes.keys())) {
      this.stop(terminalId);
    }
  }
}
