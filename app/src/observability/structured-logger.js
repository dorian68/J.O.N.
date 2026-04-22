import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../utils/files.js";
import { sanitizeForLogging } from "../security/redaction.js";

export class StructuredLogger {
  constructor({ filePath, enabled = true } = {}) {
    this.filePath = filePath;
    this.enabled = enabled;
  }

  async log(entry) {
    if (!this.enabled || !this.filePath) {
      return;
    }
    const payload = sanitizeForLogging({
      ...entry,
      loggedAt: entry.loggedAt ?? new Date().toISOString()
    });
    await ensureDir(path.dirname(this.filePath));
    await fs.appendFile(this.filePath, `${JSON.stringify(payload)}\n`, "utf8");
  }

  async safeLog(entry) {
    try {
      await this.log(entry);
    } catch {
      // Logging must never become a runtime failure path.
    }
  }
}
