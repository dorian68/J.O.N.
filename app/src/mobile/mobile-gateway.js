import { nowIso } from "../utils/ids.js";
import crypto from "node:crypto";

const ALLOWED_COMMANDS = new Set([
  "sendChatMessage",
  "startMission",
  "approveAction",
  "denyAction",
  "stopRun",
  "continueRun",
  "answerTerminalPrompt",
  "requestScreenshot",
  "openProof",
  "loadNextStep"
]);

const BLOCKED_COMMANDS = new Set([
  "executeArbitraryTerminalCommand",
  "deleteFile",
  "submitForm",
  "installSoftware",
  "accessSecrets",
  "modifyServerConfig",
  "runScript"
]);

const SENSITIVE_COMMANDS = new Set([
  "answerTerminalPrompt",
  "approveAction"
]);

function validateCommand(commandType, params) {
  if (BLOCKED_COMMANDS.has(commandType)) {
    throw Object.assign(new Error(`Command '${commandType}' is not allowed from mobile.`), { code: "BLOCKED_COMMAND" });
  }
  if (!ALLOWED_COMMANDS.has(commandType)) {
    throw Object.assign(new Error(`Unknown command '${commandType}'.`), { code: "UNKNOWN_COMMAND" });
  }
  if (commandType === "sendChatMessage") {
    if (!params?.message || typeof params.message !== "string" || !params.message.trim()) {
      throw Object.assign(new Error("sendChatMessage requires a non-empty message."), { code: "INVALID_PARAMS" });
    }
    if (params.message.length > 4000) {
      throw Object.assign(new Error("Message too long (max 4000 chars)."), { code: "MESSAGE_TOO_LONG" });
    }
  }
  if (commandType === "startMission") {
    if (!params?.objective || typeof params.objective !== "string" || !params.objective.trim()) {
      throw Object.assign(new Error("startMission requires a non-empty objective."), { code: "INVALID_PARAMS" });
    }
    if (params.objective.length > 1000) {
      throw Object.assign(new Error("Objective too long (max 1000 chars)."), { code: "OBJECTIVE_TOO_LONG" });
    }
  }
  if ((commandType === "approveAction" || commandType === "denyAction") && !params?.approvalId) {
    throw Object.assign(new Error("approvalId required."), { code: "INVALID_PARAMS" });
  }
  if (commandType === "stopRun" && !params?.runId) {
    throw Object.assign(new Error("runId required."), { code: "INVALID_PARAMS" });
  }
  if (commandType === "answerTerminalPrompt") {
    if (!params?.terminalId) throw Object.assign(new Error("terminalId required."), { code: "INVALID_PARAMS" });
    if (params?.answer && String(params.answer).length > 2000) {
      throw Object.assign(new Error("Answer too long (max 2000 chars)."), { code: "ANSWER_TOO_LONG" });
    }
  }
}

export class MobileGateway {
  constructor({ deviceRegistry, auditLog, operatorService }) {
    this.deviceRegistry = deviceRegistry;
    this.auditLog = auditLog;
    this.operatorService = operatorService;
  }

  async dispatch(commandType, params, sessionContext) {
    const { deviceId, token } = sessionContext;
    let status = "ok";
    let result = null;
    let error = null;

    try {
      validateCommand(commandType, params);
      result = await this.#execute(commandType, params, sessionContext);
    } catch (err) {
      status = err.code === "BLOCKED_COMMAND" ? "blocked" : "error";
      error = { code: err.code ?? "UNKNOWN", message: err.message };
    }

    this.auditLog.record({
      deviceId,
      tokenHash: token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 16) : null,
      commandType,
      params: redactParams(commandType, params),
      status,
      error,
      createdAt: nowIso()
    });

    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return result;
  }

  async #execute(commandType, params, { projectId }) {
    const svc = this.operatorService;
    switch (commandType) {
    case "sendChatMessage": {
      const activeConv = svc.getOrCreateActiveConversation?.(projectId);
      if (!activeConv) throw Object.assign(new Error("No active conversation."), { code: "NO_CONVERSATION" });
      return { queued: true, conversationId: activeConv.id, message: params.message };
    }
    case "startMission": {
      const result = await svc.startMission(projectId, {
        objective: params.objective,
        constraints: params.constraints ?? "",
        source: "mobile"
      });
      return { runId: result?.runId ?? null, started: true };
    }
    case "approveAction": {
      await svc.resolveApproval(params.approvalId, "approved_once", { source: "mobile", deviceId: params._deviceId });
      return { resolved: true, decision: "approved_once", approvalId: params.approvalId };
    }
    case "denyAction": {
      await svc.resolveApproval(params.approvalId, "stop_run", { source: "mobile", deviceId: params._deviceId });
      return { resolved: true, decision: "stop_run", approvalId: params.approvalId };
    }
    case "stopRun": {
      await svc.stopRun(params.runId);
      return { stopped: true, runId: params.runId };
    }
    case "continueRun": {
      return { continued: true, runId: params.runId };
    }
    case "answerTerminalPrompt": {
      svc.sendTerminalInput?.(projectId, params.terminalId, params.answer ?? "");
      return { sent: true, terminalId: params.terminalId };
    }
    case "requestScreenshot": {
      const screenshot = await svc.requestMobileScreenshot?.(projectId);
      return { screenshotBase64: screenshot ?? null };
    }
    case "openProof": {
      const proof = svc.getProof?.(params.proofId);
      return { proof: proof ?? null };
    }
    case "loadNextStep": {
      return { loaded: true };
    }
    default:
      throw Object.assign(new Error(`Unhandled command: ${commandType}`), { code: "UNHANDLED" });
    }
  }
}

function redactParams(commandType, params) {
  if (!params) return {};
  const safe = { ...params };
  if (SENSITIVE_COMMANDS.has(commandType)) {
    delete safe.password;
    delete safe.token;
    delete safe.secret;
  }
  if (commandType === "answerTerminalPrompt" && safe.answer) {
    safe.answer = safe.answer.length > 40 ? `${safe.answer.slice(0, 40)}…[${safe.answer.length}]` : safe.answer;
  }
  return safe;
}

export class MobileAuditLog {
  constructor({ maxEntries = 2000 } = {}) {
    this.entries = [];
    this.maxEntries = maxEntries;
  }

  record(entry) {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  list({ limit = 100, deviceId = null } = {}) {
    let entries = deviceId ? this.entries.filter((e) => e.deviceId === deviceId) : this.entries;
    return entries.slice(-limit).reverse();
  }

  persistTo(database) {
    const pending = this.entries.filter((e) => !e._persisted);
    for (const entry of pending) {
      try {
        database.insertMobileAuditEntry?.(entry);
        entry._persisted = true;
      } catch {
        // best-effort
      }
    }
  }
}
