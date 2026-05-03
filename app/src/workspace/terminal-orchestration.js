import { createId, nowIso } from "../utils/ids.js";

export const TERMINAL_STATUS = Object.freeze({
  ATTACHED: "attached",
  RUNNING: "running",
  WAITING_FOR_INPUT: "waiting_for_input",
  COMPLETED: "completed",
  ERROR: "error",
  NEEDS_ATTENTION: "needs_attention",
  DETACHED: "detached"
});

export const TERMINAL_AGENT_KIND = Object.freeze({
  CODEX_CLI: "codex_cli",
  CLAUDE_CODE_CLI: "claude_code_cli",
  GENERIC_CLI: "generic_cli",
  UNKNOWN: "unknown"
});

export const TERMINAL_AUTONOMY_MODE = Object.freeze({
  ASSISTED: "assisted",
  SUPERVISED_AUTONOMY: "supervised_autonomy",
  MANUAL_ONLY: "manual_only"
});

const WAITING_PATTERNS = [
  /\b(waiting for input|awaiting input|needs input|input required)\b/i,
  /\b(press enter|press any key|continue\?|proceed\?|confirm|approve|allow|deny)\b/i,
  /\b(y\/n|yes\/no|\[y\/n\]|\(y\/n\))\b/i,
  /\b(select an option|choose an option|which option)\b/i,
  /\b(autoriser|confirmer|continuer|choisissez|attend une entrée|attente utilisateur)\b/i
];

const ERROR_PATTERNS = [
  /\b(error|failed|failure|fatal|exception|traceback|npm err|panic)\b/i,
  /\b(erreur|échec|echec|fatal|exception)\b/i
];

const COMPLETED_PATTERNS = [
  /\b(done|completed|success|finished|all tests passed|task complete)\b/i,
  /\b(terminé|termine|réussi|reussi|succès|succes)\b/i
];

function compactText(value, maxLength = 4000) {
  return String(value ?? "").replace(/\s+$/g, "").slice(-maxLength);
}

function includesPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function detectCliAgentKind({ command = "", title = "", recentOutput = "" } = {}) {
  // Primary check: command name and title (authoritative, not noisy)
  const commandAndTitle = `${command}\n${title}`.toLowerCase();
  if (/\bcodex\b/.test(commandAndTitle) || commandAndTitle.includes("openai codex")) {
    return TERMINAL_AGENT_KIND.CODEX_CLI;
  }
  // Match 'claude' only in command/title; recentOutput can contain the word "claude" in any context
  if (commandAndTitle.includes("claude code") || /\bclaude\b/.test(commandAndTitle)) {
    return TERMINAL_AGENT_KIND.CLAUDE_CODE_CLI;
  }
  if (commandAndTitle.includes("powershell") || commandAndTitle.includes("cmd.exe") || commandAndTitle.includes("bash") || commandAndTitle.includes("terminal")) {
    return TERMINAL_AGENT_KIND.GENERIC_CLI;
  }
  // Secondary check: recentOutput only for unambiguous patterns
  const output = String(recentOutput ?? "").toLowerCase();
  if (output.includes("openai codex") || output.includes("codex cli")) {
    return TERMINAL_AGENT_KIND.CODEX_CLI;
  }
  if (output.includes("claude code cli") || output.includes("claude code is")) {
    return TERMINAL_AGENT_KIND.CLAUDE_CODE_CLI;
  }
  if (/\bcodex\b/.test(commandAndTitle)) {
    return TERMINAL_AGENT_KIND.CODEX_CLI;
  }
  return TERMINAL_AGENT_KIND.UNKNOWN;
}

export function detectTerminalState({
  recentOutput = "",
  processRunning = true,
  exitCode = null,
  explicitStatus = null
} = {}) {
  if (explicitStatus && Object.values(TERMINAL_STATUS).includes(explicitStatus)) {
    return {
      status: explicitStatus,
      reason: "Explicit terminal status supplied by attached surface.",
      confidence: 1
    };
  }
  // Process exit codes take priority over text-based heuristics.
  if (exitCode != null && exitCode !== 0) {
    return {
      status: TERMINAL_STATUS.ERROR,
      reason: `Terminal exited with code ${exitCode}.`,
      confidence: 0.95
    };
  }
  if (exitCode === 0) {
    return {
      status: TERMINAL_STATUS.COMPLETED,
      reason: "Terminal exited successfully.",
      confidence: 0.95
    };
  }
  // Text-based heuristics for live processes (exitCode === null).
  const text = compactText(recentOutput).toLowerCase();
  if (includesPattern(text, ERROR_PATTERNS)) {
    return {
      status: TERMINAL_STATUS.ERROR,
      reason: "Recent terminal output contains an error marker.",
      confidence: 0.82
    };
  }
  if (includesPattern(text, WAITING_PATTERNS)) {
    return {
      status: TERMINAL_STATUS.WAITING_FOR_INPUT,
      reason: "Recent terminal output appears to request user input or confirmation.",
      confidence: 0.86
    };
  }
  if (includesPattern(text, COMPLETED_PATTERNS)) {
    return {
      status: TERMINAL_STATUS.COMPLETED,
      reason: "Recent terminal output contains a completion marker.",
      confidence: 0.78
    };
  }
  if (processRunning) {
    return {
      status: TERMINAL_STATUS.RUNNING,
      reason: "Terminal is attached and process is still reported as running.",
      confidence: 0.72
    };
  }
  return {
    status: TERMINAL_STATUS.ATTACHED,
    reason: "Terminal is attached but no active process state was supplied.",
    confidence: 0.55
  };
}

export function normalizeTerminalAutonomyMode(value) {
  return Object.values(TERMINAL_AUTONOMY_MODE).includes(value)
    ? value
    : TERMINAL_AUTONOMY_MODE.ASSISTED;
}

export function buildWorkspaceMissionBrief({
  id = createId("wmb"),
  projectId,
  conversationId = null,
  objective,
  status = "active",
  progress = [],
  blockers = [],
  decisions = [],
  nextSteps = [],
  metadata = {},
  createdAt = nowIso(),
  updatedAt = createdAt
} = {}) {
  if (!projectId) {
    throw new Error("Workspace mission brief requires projectId.");
  }
  const compactObjective = String(objective ?? "").trim();
  if (!compactObjective) {
    throw new Error("Workspace mission brief requires objective.");
  }
  return {
    id,
    projectId,
    conversationId,
    objective: compactObjective.slice(0, 2000),
    status,
    progress: Array.isArray(progress) ? progress.slice(0, 20) : [],
    blockers: Array.isArray(blockers) ? blockers.slice(0, 20) : [],
    decisions: Array.isArray(decisions) ? decisions.slice(0, 30) : [],
    nextSteps: Array.isArray(nextSteps) ? nextSteps.slice(0, 20) : [],
    metadata,
    createdAt,
    updatedAt
  };
}

export function normalizeTerminalSession({
  id = createId("term"),
  projectId,
  conversationId = null,
  label = "",
  command = "",
  cwd = "",
  title = "",
  agentKind = null,
  status = null,
  autonomyMode = TERMINAL_AUTONOMY_MODE.ASSISTED,
  authorized = false,
  recentOutput = "",
  lastPrompt = "",
  metadata = {},
  createdAt = nowIso(),
  updatedAt = createdAt
} = {}) {
  if (!projectId) {
    throw new Error("Workspace terminal requires projectId.");
  }
  const detectedAgentKind = agentKind && Object.values(TERMINAL_AGENT_KIND).includes(agentKind)
    ? agentKind
    : detectCliAgentKind({ command, title, recentOutput });
  return {
    id,
    projectId,
    conversationId,
    label: String(label || title || command || "Terminal attaché").slice(0, 160),
    agentKind: detectedAgentKind,
    command: String(command ?? "").slice(0, 1000),
    cwd: String(cwd ?? "").slice(0, 1000),
    status: Object.values(TERMINAL_STATUS).includes(status) ? status : TERMINAL_STATUS.ATTACHED,
    autonomyMode: normalizeTerminalAutonomyMode(autonomyMode),
    authorized: Boolean(authorized),
    recentOutput: compactText(recentOutput),
    lastPrompt: String(lastPrompt ?? "").slice(0, 2000),
    metadata,
    createdAt,
    updatedAt
  };
}

export function evaluateTerminalIntervention({ terminal, missionBrief = null, detection = null } = {}) {
  const status = detection?.status ?? terminal?.status ?? TERMINAL_STATUS.ATTACHED;
  const autonomyMode = normalizeTerminalAutonomyMode(terminal?.autonomyMode);
  const authorized = Boolean(terminal?.authorized);
  const agentKind = terminal?.agentKind ?? TERMINAL_AGENT_KIND.UNKNOWN;
  const supportedAgent = [TERMINAL_AGENT_KIND.CODEX_CLI, TERMINAL_AGENT_KIND.CLAUDE_CODE_CLI].includes(agentKind);

  if (!authorized) {
    return {
      decisionType: "terminal_authorization",
      action: "request_human_approval",
      reason: "Terminal is not authorized for JON orchestration.",
      requiresApproval: true,
      confidence: 0.92
    };
  }
  if (status === TERMINAL_STATUS.ERROR) {
    return {
      decisionType: "terminal_error",
      action: "escalate_human",
      reason: "Attached terminal reports an error; JON should not hide or auto-recover without review.",
      requiresApproval: false,
      confidence: detection?.confidence ?? 0.8
    };
  }
  if (status === TERMINAL_STATUS.WAITING_FOR_INPUT || status === TERMINAL_STATUS.NEEDS_ATTENTION) {
    if (!supportedAgent) {
      return {
        decisionType: "terminal_attention",
        action: "suggest_user_reply",
        reason: "Terminal needs attention but the CLI agent type is not trusted for automatic context injection.",
        requiresApproval: false,
        confidence: detection?.confidence ?? 0.75
      };
    }
    if (autonomyMode === TERMINAL_AUTONOMY_MODE.SUPERVISED_AUTONOMY) {
      return {
        decisionType: "terminal_autonomy",
        action: "auto_inject_context",
        reason: "Authorized CLI agent is waiting and supervised autonomy permits non-sensitive context injection.",
        requiresApproval: false,
        confidence: detection?.confidence ?? 0.78,
        payload: {
          missionObjective: missionBrief?.objective ?? null,
          allowedInjection: "non_sensitive_context_only"
        }
      };
    }
    return {
      decisionType: "terminal_attention",
      action: "request_human_approval",
      reason: "Authorized CLI agent is waiting; assisted mode requires human confirmation before JON replies.",
      requiresApproval: true,
      confidence: detection?.confidence ?? 0.78
    };
  }
  if (status === TERMINAL_STATUS.COMPLETED) {
    return {
      decisionType: "terminal_completion",
      action: "observe_only",
      reason: "Attached terminal appears completed; JON should update the workspace mission state.",
      requiresApproval: false,
      confidence: detection?.confidence ?? 0.76
    };
  }
  return {
    decisionType: "terminal_observation",
    action: "observe_only",
    reason: "No intervention is currently needed.",
    requiresApproval: false,
    confidence: detection?.confidence ?? 0.6
  };
}

export function buildWorkspaceStateSummary({ missionBrief = null, terminals = [], decisions = [] } = {}) {
  const activeTerminals = terminals.filter((terminal) => ![TERMINAL_STATUS.COMPLETED, TERMINAL_STATUS.DETACHED].includes(terminal.status));
  const waitingTerminals = terminals.filter((terminal) => [TERMINAL_STATUS.WAITING_FOR_INPUT, TERMINAL_STATUS.NEEDS_ATTENTION].includes(terminal.status));
  const blockedTerminals = terminals.filter((terminal) => terminal.status === TERMINAL_STATUS.ERROR);
  return {
    objective: missionBrief?.objective ?? "",
    missionStatus: missionBrief?.status ?? "not_started",
    terminalCount: terminals.length,
    activeTerminalCount: activeTerminals.length,
    waitingTerminalCount: waitingTerminals.length,
    blockedTerminalCount: blockedTerminals.length,
    latestDecision: decisions.at(-1) ?? null,
    nextSteps: missionBrief?.nextSteps ?? []
  };
}
