import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECRETS_ROOT } from "../config.js";
import { ensureDir, sanitizeFilename } from "../utils/files.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WINDOWS_SECRET_SCRIPT = path.join(__dirname, "windows-dpapi-secret-store.ps1");

function defaultRunner(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Secret store command failed with exit code ${code}.`));
        return;
      }
      resolve({
        stdout,
        stderr,
        code
      });
    });

    if (options.stdinValue != null) {
      child.stdin?.write(options.stdinValue, "utf8");
    }
    child.stdin?.end();
  });
}

function getSecretFilePath(alias) {
  const safeAlias = sanitizeFilename(alias);
  return path.join(SECRETS_ROOT, `${safeAlias}.protected.json`);
}

export class OsSecretStore {
  constructor({
    platform = process.platform,
    runner = defaultRunner
  } = {}) {
    this.platform = platform;
    this.runner = runner;
  }

  get backend() {
    if (this.platform === "win32") {
      return "windows_dpapi_current_user";
    }
    return "unsupported";
  }

  isSupported() {
    return this.platform === "win32";
  }

  async getStatus(alias) {
    if (!this.isSupported()) {
      return {
        available: false,
        configured: false,
        backend: this.backend,
        reason: "unsupported_platform"
      };
    }

    await ensureDir(SECRETS_ROOT);
    try {
      const result = await this.runner("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_SECRET_SCRIPT,
        "-Action",
        "status",
        "-SecretPath",
        getSecretFilePath(alias)
      ]);
      const payload = JSON.parse(result.stdout.trim() || "{}");
      return {
        available: true,
        configured: payload.status === "present",
        backend: payload.backend ?? this.backend,
        updatedAt: payload.updatedAt ?? null
      };
    } catch (error) {
      const blockedByExecutionEnvironment = /EPERM|spawn/i.test(error.message);
      return {
        available: !blockedByExecutionEnvironment,
        configured: false,
        backend: this.backend,
        blockedByExecutionEnvironment,
        reason: error.message
      };
    }
  }

  async setSecret(alias, secretValue) {
    if (!this.isSupported()) {
      throw new Error("OS secret store is not supported on this platform.");
    }
    await ensureDir(SECRETS_ROOT);
    await this.runner("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOWS_SECRET_SCRIPT,
      "-Action",
      "store",
      "-SecretPath",
      getSecretFilePath(alias)
    ], {
      stdinValue: secretValue
    });
    return this.getStatus(alias);
  }

  async getSecret(alias) {
    if (!this.isSupported()) {
      return null;
    }
    try {
      const result = await this.runner("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_SECRET_SCRIPT,
        "-Action",
        "retrieve",
        "-SecretPath",
        getSecretFilePath(alias)
      ]);
      return result.stdout;
    } catch {
      return null;
    }
  }

  async clearSecret(alias) {
    if (!this.isSupported()) {
      return {
        available: false,
        cleared: false,
        backend: this.backend
      };
    }
    await ensureDir(SECRETS_ROOT);
    await this.runner("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOWS_SECRET_SCRIPT,
      "-Action",
      "delete",
      "-SecretPath",
      getSecretFilePath(alias)
    ]);
    return {
      available: true,
      cleared: true,
      backend: this.backend
    };
  }
}

export function createDefaultOsSecretStore(options = {}) {
  return new OsSecretStore(options);
}
