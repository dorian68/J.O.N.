function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function classifyFailure({ failure = null, verification = null, workspaceSnapshot = null, action = null } = {}) {
  const combined = lower([
    failure?.category,
    failure?.code,
    failure?.message,
    verification?.failureReason,
    verification?.unsatisfiedOutcomes?.join(" "),
    action?.primitive,
    action?.action
  ].filter(Boolean).join(" "));

  if (workspaceSnapshot?.approvals?.pendingCount > 0 || combined.includes("approval")) {
    return "approval_required";
  }
  if (combined.includes("malformed_output") || combined.includes("non-json") || combined.includes("schema")) {
    return "malformed_llm_output";
  }
  if (combined.includes("evidence") && combined.includes("align")) {
    return "evidence_misaligned";
  }
  if (combined.includes("screenshot") || combined.includes("capture") || combined.includes("proof") || combined.includes("evidence")) {
    return "missing_evidence";
  }
  if (combined.includes("window") && (combined.includes("not found") || combined.includes("introuvable") || combined.includes("visible"))) {
    return "window_not_found";
  }
  if (combined.includes("browser") && (combined.includes("closed") || combined.includes("page") || combined.includes("navigation"))) {
    return "browser_state_lost";
  }
  if (combined.includes("terminal") && (combined.includes("waiting") || combined.includes("blocked"))) {
    return "terminal_waiting";
  }
  if (combined.includes("ambiguous") || combined.includes("clarification")) {
    return "ambiguous_action";
  }
  return "generic_failure";
}

export class RecoveryPlanner {
  plan({
    failure = null,
    verification = null,
    workspaceSnapshot = null,
    action = null,
    attemptCount = 0,
    maxRetries = 2
  } = {}) {
    const failureType = classifyFailure({ failure, verification, workspaceSnapshot, action });
    const canRetry = attemptCount < maxRetries;
    const base = {
      schemaVersion: "recovery_plan_v1",
      failureType,
      attemptCount,
      maxRetries,
      canRetry,
      createdAt: new Date().toISOString()
    };

    switch (failureType) {
      case "approval_required":
        return {
          ...base,
          strategy: "request_user_approval",
          autoExecutable: false,
          nextAction: "Surface the pending approval with action, risk, expected effect, and consequence of refusal.",
          stopCondition: "Stop or pause until the operator resolves the approval."
        };
      case "malformed_llm_output":
        return {
          ...base,
          strategy: canRetry ? "repair_llm_output" : "fallback_or_block",
          autoExecutable: canRetry,
          nextAction: canRetry
            ? "Ask the provider for a schema-only repair, then validate again."
            : "Use deterministic fallback if available; otherwise mark blocked/needs_review.",
          stopCondition: "Never crash the server because of malformed model output."
        };
      case "evidence_misaligned":
        return {
          ...base,
          strategy: "reobserve_target_surface",
          autoExecutable: canRetry,
          nextAction: canRetry
            ? "Re-open or refocus the target surface, collect fresh evidence, and re-run semantic verification."
            : "Mark the run failed/blocked and explain the missing aligned proof.",
          stopCondition: "Do not mark completed with off-target evidence."
        };
      case "missing_evidence":
        return {
          ...base,
          strategy: "capture_missing_proof",
          autoExecutable: canRetry,
          nextAction: canRetry
            ? "Capture the relevant window/page or create the required artifact, then verify again."
            : "Mark failed/partial and expose missing evidence.",
          stopCondition: "Completion remains blocked until required proof exists."
        };
      case "window_not_found":
        return {
          ...base,
          strategy: canRetry ? "reobserve_and_refocus" : "ask_user_for_surface",
          autoExecutable: canRetry,
          nextAction: canRetry
            ? "Refresh visible windows, resolve the semantic target again, then focus only if the target is clear."
            : "Ask the user to open or identify the target window.",
          stopCondition: "Avoid guessing a hidden or unrelated window."
        };
      case "browser_state_lost":
        return {
          ...base,
          strategy: canRetry ? "restore_workspace_browser" : "request_user_browser_help",
          autoExecutable: canRetry,
          nextAction: canRetry
            ? "Recreate the controlled browser session, navigate to the expected URL, and verify title/domain."
            : "Ask the user before using a user profile or system browser.",
          stopCondition: "Never silently switch to an uncontrolled browser profile."
        };
      case "terminal_waiting":
        return {
          ...base,
          strategy: "terminal_safe_intervention",
          autoExecutable: false,
          nextAction: "Explain what the terminal is asking and inject input only when the terminal is authorized and the suggested input is non-sensitive.",
          stopCondition: "Keep mission blocked while a terminal awaits unsafe or unauthorized input."
        };
      case "ambiguous_action":
        return {
          ...base,
          strategy: "ask_clarification",
          autoExecutable: false,
          nextAction: "Ask the smallest clarification needed to choose the next safe primitive.",
          stopCondition: "Do not continue by guessing between materially different targets."
        };
      default:
        return {
          ...base,
          strategy: canRetry ? "retry_after_observation" : "fail_with_evidence",
          autoExecutable: canRetry,
          nextAction: canRetry
            ? "Observe current workspace state, retry once with the latest state, then verify the objective."
            : "Stop cleanly and persist failure evidence.",
          stopCondition: "No completed status unless semantic verification passes."
        };
    }
  }
}

export function buildRecoveryPlanner() {
  return new RecoveryPlanner();
}
