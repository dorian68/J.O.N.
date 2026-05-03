import { nowIso } from "../utils/ids.js";
import crypto from "node:crypto";

const MOBILE_EVENT_TYPES = new Set([
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
  "run.stopped",
  "approval.required",
  "approval.granted",
  "approval.denied",
  "terminal.waiting_for_input",
  "terminal.completed",
  "terminal.error",
  "terminal.started",
  "browser.navigated",
  "browser.session.opened",
  "browser.session.closed",
  "proof.created",
  "artifact.created",
  "jon.needs_user",
  "jon.reply",
  "jon.thinking",
  "cost.threshold_warning",
  "workspace.state_changed"
]);

const SEVERITY_MAP = {
  "approval.required": "high",
  "jon.needs_user": "high",
  "run.failed": "high",
  "terminal.error": "medium",
  "terminal.waiting_for_input": "medium",
  "cost.threshold_warning": "medium",
  "run.started": "low",
  "run.progress": "low",
  "run.completed": "low",
  "run.stopped": "low",
  "approval.granted": "low",
  "approval.denied": "low",
  "terminal.started": "low",
  "terminal.completed": "low",
  "browser.navigated": "low",
  "browser.session.opened": "low",
  "browser.session.closed": "low",
  "proof.created": "low",
  "artifact.created": "low",
  "jon.reply": "low",
  "jon.thinking": "info",
  "workspace.state_changed": "info"
};

function extractRunId(rawEvent) {
  return rawEvent?.runId ?? rawEvent?.payload?.runId ?? null;
}

function extractTerminalId(rawEvent) {
  return rawEvent?.terminalId ?? rawEvent?.payload?.terminalId ?? null;
}

function buildUserMessage(type, payload) {
  switch (type) {
  case "run.started": return `Mission démarrée${payload?.mission ? ` : ${String(payload.mission).slice(0, 80)}` : ""}`;
  case "run.completed": return `Mission terminée${payload?.summary ? ` : ${String(payload.summary).slice(0, 80)}` : ""}`;
  case "run.failed": return `Mission échouée${payload?.error ? ` : ${String(payload.error).slice(0, 80)}` : ""}`;
  case "run.stopped": return "Mission arrêtée par l'opérateur";
  case "run.progress": return payload?.summary ?? "Mission en cours…";
  case "approval.required": return `Approbation requise : ${payload?.actionLabel ?? "action en attente"}`;
  case "approval.granted": return "Action approuvée";
  case "approval.denied": return "Action refusée";
  case "terminal.waiting_for_input": return `Terminal en attente : ${payload?.label ?? payload?.terminalId ?? "unknown"}`;
  case "terminal.completed": return `Terminal terminé : ${payload?.label ?? ""}`;
  case "terminal.error": return `Erreur terminal : ${payload?.label ?? ""}`;
  case "terminal.started": return `Terminal démarré : ${payload?.label ?? ""}`;
  case "browser.navigated": return `Navigation : ${payload?.url ?? ""}`;
  case "browser.session.opened": return "Session browser ouverte";
  case "browser.session.closed": return "Session browser fermée";
  case "proof.created": return `Preuve créée : ${payload?.label ?? ""}`;
  case "artifact.created": return `Artefact produit : ${payload?.title ?? ""}`;
  case "jon.needs_user": return payload?.message ?? "JON a besoin de votre attention";
  case "jon.reply": return payload?.reply ?? payload?.message ?? "";
  case "jon.thinking": return "JON réfléchit…";
  case "cost.threshold_warning": return `Alerte budget tokens : ${payload?.used ?? ""} / ${payload?.limit ?? ""}`;
  case "workspace.state_changed": return "État du workspace mis à jour";
  default: return type;
  }
}

function buildActionSuggestions(type, payload) {
  if (type === "approval.required") {
    return [
      { label: "Approuver", command: "approveAction", params: { approvalId: payload?.approvalId } },
      { label: "Refuser", command: "denyAction", params: { approvalId: payload?.approvalId } }
    ];
  }
  if (type === "terminal.waiting_for_input") {
    return [
      { label: "Répondre", command: "answerTerminalPrompt", params: { terminalId: payload?.terminalId } },
      { label: "Arrêter", command: "stopTerminal", params: { terminalId: payload?.terminalId } }
    ];
  }
  if (type === "run.failed" || type === "jon.needs_user") {
    return [
      { label: "Voir le run", command: "openRun", params: { runId: payload?.runId } }
    ];
  }
  return null;
}

export function buildMobileEvent(rawType, rawPayload) {
  const mappedType = mapToMobileEventType(rawType, rawPayload);
  if (!mappedType) return null;

  return {
    id: `mev_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    timestamp: nowIso(),
    type: mappedType,
    severity: SEVERITY_MAP[mappedType] ?? "info",
    runId: extractRunId(rawPayload),
    terminalId: extractTerminalId(rawPayload),
    projectId: rawPayload?.projectId ?? null,
    message: buildUserMessage(mappedType, rawPayload),
    actionSuggestions: buildActionSuggestions(mappedType, rawPayload),
    payload: sanitizePayload(mappedType, rawPayload)
  };
}

function mapToMobileEventType(rawType, payload) {
  if (MOBILE_EVENT_TYPES.has(rawType)) return rawType;
  if (rawType === "workspace.browser.navigated") return "browser.navigated";
  if (rawType === "workspace.browser.session.opened") return "browser.session.opened";
  if (rawType === "workspace.browser.session.closed") return "browser.session.closed";
  if (rawType === "workspace.state_changed") return "workspace.state_changed";
  return null;
}

function sanitizePayload(type, payload) {
  if (!payload) return {};
  const safe = { ...payload };
  delete safe.screenshotBase64;
  delete safe.domSnapshot;
  delete safe.raw;
  delete safe.evidence;
  return safe;
}

export class MobileEventBuffer {
  constructor({ maxSize = 200 } = {}) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.listeners = new Set();
  }

  push(event) {
    if (!event) return;
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  pushRaw(type, payload) {
    const event = buildMobileEvent(type, payload);
    if (event) this.push(event);
  }

  since(isoTimestamp) {
    if (!isoTimestamp) return [...this.buffer];
    return this.buffer.filter((e) => e.timestamp > isoTimestamp);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
