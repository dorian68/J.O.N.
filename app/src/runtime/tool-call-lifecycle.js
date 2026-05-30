import { EVENT_ACTOR } from "../config.js";
import { createEvent } from "./events.js";
import { createId, nowIso } from "../utils/ids.js";

export const TOOL_CALL_STATUS = Object.freeze({
  PLANNED: "planned",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped",
  BLOCKED: "blocked"
});

const TERMINAL_STATUSES = new Set([
  TOOL_CALL_STATUS.SUCCEEDED,
  TOOL_CALL_STATUS.FAILED,
  TOOL_CALL_STATUS.SKIPPED,
  TOOL_CALL_STATUS.BLOCKED
]);

function clean(value, maxLength = 260) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function nowIfEmpty(value) {
  return value ?? nowIso();
}

export function desktopToolNameForPrimitive(primitive = "") {
  switch (primitive) {
    case "observe_windows": return "desktop.inspectWindows";
    case "launch_application": return "desktop.launchApplication";
    case "focus_window": return "desktop.focusWindow";
    case "type_text": return "desktop.typeText";
    case "capture_window": return "desktop.captureScreenshot";
    case "read_visible_text":
    case "describe_window": return "desktop.inspectWindow";
    case "list_directory":
    case "read_text_file": return "file.read";
    case "create_text_file":
    case "write_text_file":
    case "copy_path":
    case "rename_path":
    case "move_path":
    case "delete_path": return "file.write";
    case "launch_workspace_cli": return "terminal.launch";
    case "open_workspace_browser": return "browser.open";
    default: return clean(primitive, 80) ? `desktop.${clean(primitive, 80)}` : "workspace.action";
  }
}

export function browserToolNameForAction(action = "") {
  switch (action) {
    case "launch_browser_search": return "browser.navigate";
    case "launch_browser": return "browser.open";
    case "capture_browser_window": return "browser.captureScreenshot";
    case "open_session": return "browser.open";
    case "navigate": return "browser.navigate";
    case "wait_state": return "browser.waitForLoad";
    case "read_state": return "browser.readState";
    case "read_dom": return "browser.extractDom";
    case "query_interactive": return "browser.queryDom";
    case "click": return "browser.click";
    case "type": return "browser.typeText";
    case "select": return "browser.selectOption";
    case "extract_text": return "browser.extractText";
    case "extract_structured_rows": return "browser.extractStructuredRows";
    case "detect_blockers": return "browser.detectBlockers";
    case "verify_outcome": return "verifier.checkOutcome";
    case "capture_evidence": return "browser.captureScreenshot";
    case "stop_manual_handoff": return "approval.request";
    default: return clean(action, 80) ? `browser.${clean(action, 80)}` : "browser.open";
  }
}

export function createToolCall({
  runId = null,
  stepId = null,
  toolName,
  surface = "workspace",
  reason = "",
  inputSummary = "",
  expectedEvidenceIds = []
} = {}) {
  return {
    id: createId("tool"),
    runId,
    stepId,
    toolName: clean(toolName, 120) || "workspace.action",
    surface: clean(surface, 60) || "workspace",
    reason: clean(reason),
    status: TOOL_CALL_STATUS.PLANNED,
    inputSummary: clean(inputSummary),
    outputSummary: null,
    evidenceIds: Array.isArray(expectedEvidenceIds) ? expectedEvidenceIds.filter(Boolean) : [],
    startedAt: null,
    completedAt: null,
    error: null,
    createdAt: nowIso()
  };
}

export function transitionToolCall(toolCall = {}, status, patch = {}) {
  const nextStatus = clean(status, 40);
  const next = {
    ...toolCall,
    ...patch,
    status: nextStatus
  };
  if (nextStatus === TOOL_CALL_STATUS.RUNNING) {
    next.startedAt = nowIfEmpty(next.startedAt);
  }
  if (TERMINAL_STATUSES.has(nextStatus)) {
    next.completedAt = nowIfEmpty(next.completedAt);
  }
  if (patch.evidenceId && !next.evidenceIds?.includes(patch.evidenceId)) {
    next.evidenceIds = [...(next.evidenceIds ?? []), patch.evidenceId];
  }
  if (Array.isArray(patch.evidenceIds)) {
    next.evidenceIds = Array.from(new Set([...(next.evidenceIds ?? []), ...patch.evidenceIds.filter(Boolean)]));
  }
  return next;
}

export function createToolCallLifecycleEvent(toolCall = {}, status, {
  actor = EVENT_ACTOR.COMPUTER,
  summary = "",
  primitive = null,
  payload = {}
} = {}) {
  const next = transitionToolCall(toolCall, status, payload);
  const eventType = `tool.${status}`;
  return {
    toolCall: next,
    event: createEvent(eventType, actor, summary || `${next.toolName} ${status}.`, {
      toolCallId: next.id,
      runId: next.runId,
      stepId: next.stepId,
      toolName: next.toolName,
      tool: next.toolName,
      surface: next.surface,
      primitive: primitive ?? payload.primitive ?? null,
      reason: next.reason,
      status: next.status,
      inputSummary: next.inputSummary,
      outputSummary: next.outputSummary,
      evidenceIds: next.evidenceIds,
      evidenceId: next.evidenceIds?.[0] ?? null,
      startedAt: next.startedAt,
      completedAt: next.completedAt,
      error: next.error,
      durationMs: next.startedAt && next.completedAt
        ? Math.max(0, new Date(next.completedAt).getTime() - new Date(next.startedAt).getTime())
        : null
    })
  };
}
