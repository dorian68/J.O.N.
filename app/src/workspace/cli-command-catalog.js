import fs from "node:fs";
import path from "node:path";
import { TERMINAL_AGENT_KIND } from "./terminal-orchestration.js";

const SHELL_CANDIDATES_WIN = Object.freeze([
  { id: "powershell", command: "powershell", label: "PowerShell", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI },
  { id: "pwsh", command: "pwsh", label: "PowerShell 7", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI },
  { id: "bash", command: "bash", label: "Bash", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI },
  { id: "cmd", command: "cmd", label: "Command Prompt", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI }
]);

const SHELL_CANDIDATES_UNIX = Object.freeze([
  { id: "bash", command: "bash", label: "Bash", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI },
  { id: "sh", command: "sh", label: "Shell", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI },
  { id: "zsh", command: "zsh", label: "Zsh", agentKind: TERMINAL_AGENT_KIND.GENERIC_CLI }
]);

const SHELL_CANDIDATES = process.platform === "win32" ? SHELL_CANDIDATES_WIN : SHELL_CANDIDATES_UNIX;

export const DEFAULT_CLI_AGENT_CANDIDATES = Object.freeze([
  ...SHELL_CANDIDATES,
  {
    id: "codex",
    command: "codex",
    label: "Codex CLI",
    agentKind: TERMINAL_AGENT_KIND.CODEX_CLI
  },
  {
    id: "claude",
    command: "claude",
    label: "Claude Code CLI",
    agentKind: TERMINAL_AGENT_KIND.CLAUDE_CODE_CLI
  }
]);

function normalizedPathEntries(env = process.env) {
  return String(env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .map((entry) => String(entry ?? "").trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);
}

function executableExtensions(env = process.env) {
  if (process.platform !== "win32") {
    return [""];
  }
  const raw = String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1");
  const extensions = raw
    .split(";")
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(["", ...extensions]));
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function candidatePaths(command, env = process.env) {
  const normalizedCommand = String(command ?? "").trim();
  if (!normalizedCommand) {
    return [];
  }
  const hasExtension = Boolean(path.extname(normalizedCommand));
  const extensions = hasExtension ? [""] : executableExtensions(env);
  const hasPathSeparator = /[\\/]/.test(normalizedCommand);

  if (path.isAbsolute(normalizedCommand) || hasPathSeparator) {
    const basePath = path.resolve(normalizedCommand);
    return extensions.map((extension) => `${basePath}${extension}`);
  }

  return normalizedPathEntries(env).flatMap((directory) => (
    extensions.map((extension) => path.join(directory, `${normalizedCommand}${extension}`))
  ));
}

export function resolveCliCommandPath(command, { env = process.env } = {}) {
  for (const candidate of candidatePaths(command, env)) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function listAvailableCliAgents({
  env = process.env,
  candidates = DEFAULT_CLI_AGENT_CANDIDATES
} = {}) {
  return candidates
    .map((candidate) => {
      const resolvedCommand = resolveCliCommandPath(candidate.command, { env });
      if (!resolvedCommand) {
        return null;
      }
      return {
        id: candidate.id,
        command: candidate.command,
        label: candidate.label,
        agentKind: candidate.agentKind,
        availability: "local_path",
        resolvedCommand
      };
    })
    .filter(Boolean);
}

export function listAllowlistedCliCommandsFromCatalog(cliAgents = []) {
  return Array.from(new Set(
    cliAgents
      .map((agent) => String(agent?.command ?? "").trim())
      .filter(Boolean)
  ));
}
