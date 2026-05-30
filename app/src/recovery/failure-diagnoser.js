export const FAILURE_CAUSE = Object.freeze({
  ANTI_BOT: "anti_bot",
  AUTH_REQUIRED: "auth_required",
  PERMISSION_DENIED: "permission_denied",
  NAVIGATION_DEAD_END: "navigation_dead_end",
  PROVIDER_TIMEOUT: "provider_timeout",
  MALFORMED_LLM_OUTPUT: "malformed_llm_output",
  INSUFFICIENT_CONTEXT: "insufficient_context",
  TOOL_LIMITATION: "tool_limitation",
  EXTERNAL_SITE_BLOCK: "external_site_block",
  UNSAFE_OR_FORBIDDEN: "unsafe_or_forbidden_action",
  SHALLOW_SUCCESS: "shallow_success",
  UNKNOWN: "unknown"
});

export const FAILURE_SEVERITY = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
});

export function diagnoseFailure({
  runStatus,
  runSummary,
  blockerInfo = null,
  verificationResult = null,
  runError = null,
  runMetadata = {}
}) {
  const summary = String(runSummary ?? "").toLowerCase();
  const errorCategory = runError?.category ?? runMetadata?.errorCategory ?? null;
  const blockerType = blockerInfo?.type
    ?? runMetadata?.manualBrowserHandoff?.type
    ?? runMetadata?.blockerType
    ?? null;
  const httpStatus = blockerInfo?.httpStatus ?? runMetadata?.finalHttpStatus ?? null;
  const missionSpec = runMetadata?.missionSpec ?? {};

  // ── Provider timeout ─────────────────────────────────────────────────────
  if (
    errorCategory === "timeout" ||
    /timed?\s*out|provider.*timeout|timeout.*provider|request timed out/.test(summary)
  ) {
    return build(FAILURE_CAUSE.PROVIDER_TIMEOUT, FAILURE_SEVERITY.MEDIUM, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "The LLM provider did not respond within the allowed time.",
      whyFailed: "Provider timeout — the model took too long to generate a plan or response."
    });
  }

  // ── Malformed LLM output ─────────────────────────────────────────────────
  if (
    errorCategory === "malformed_output" ||
    /malformed.*output|deterministic.*fallback.*malformed|fallback_reason.*malformed|malformed.*llm/.test(summary)
  ) {
    return build(FAILURE_CAUSE.MALFORMED_LLM_OUTPUT, FAILURE_SEVERITY.MEDIUM, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "The LLM returned output that could not be parsed as a valid plan.",
      whyFailed: "Model output did not match the expected structured format."
    });
  }

  // ── Anti-bot / CAPTCHA ───────────────────────────────────────────────────
  if (
    blockerType === "captcha_or_automation_block" ||
    /captcha|anti.?robot|cloudflare.*challenge|challenge.*upwork|challenge.*cloudflare|un instant…/.test(summary)
  ) {
    return build(FAILURE_CAUSE.ANTI_BOT, FAILURE_SEVERITY.HIGH, true, {
      whatWasTried: `Navigated to ${blockerInfo?.observedUrl ?? runMetadata?.finalUrl ?? "the target URL"}`,
      whatFailed: "The page served an anti-bot challenge that blocked automated access.",
      whyFailed: "The browser was identified as automated; Cloudflare or bot-protection intercepted the request."
    });
  }

  // ── Auth required ────────────────────────────────────────────────────────
  if (
    blockerType === "auth_gate" ||
    httpStatus === 401 ||
    /401|log.?in required|authentication required|session expired|not logged.?in|connexion requise/.test(summary)
  ) {
    return build(FAILURE_CAUSE.AUTH_REQUIRED, FAILURE_SEVERITY.HIGH, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "Authentication was required to proceed.",
      whyFailed: "The target resource requires a logged-in user session."
    });
  }

  // ── Permission denied (403 without auth signals) ─────────────────────────
  if (httpStatus === 403 || /\b403\b|forbidden|permission denied|access denied/.test(summary)) {
    return build(FAILURE_CAUSE.PERMISSION_DENIED, FAILURE_SEVERITY.HIGH, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "Access to the resource was denied.",
      whyFailed: "HTTP 403 — the server refused to serve the requested resource."
    });
  }

  // ── Navigation dead end ──────────────────────────────────────────────────
  if (/\b404\b|not found|page.*inexist|page.*introuvable|doesn.?t exist|dead.?end|url.*invalide/.test(summary)) {
    return build(FAILURE_CAUSE.NAVIGATION_DEAD_END, FAILURE_SEVERITY.MEDIUM, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "The target page does not exist or could not be reached.",
      whyFailed: "404 or invalid URL — the resource was not found at the expected location."
    });
  }

  // ── Shallow success — ran but objective not satisfied ─────────────────────
  if (
    (runStatus === "completed" || runStatus === "failed") &&
    verificationResult?.objectiveSatisfied === false
  ) {
    return build(FAILURE_CAUSE.SHALLOW_SUCCESS, FAILURE_SEVERITY.HIGH, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "The technical action completed but the user's actual objective was not met.",
      whyFailed: verificationResult?.failureReason ?? "Semantic verification found the deliverable was not produced."
    });
  }

  // ── Terminal/agent finished without evidence ──────────────────────────────
  if (
    (runStatus === "completed" || runStatus === "failed") &&
    verificationResult?.verificationVerdict === "fail"
  ) {
    return build(FAILURE_CAUSE.SHALLOW_SUCCESS, FAILURE_SEVERITY.HIGH, true, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "Agent reported completion but provided no verifiable proof.",
      whyFailed: verificationResult?.failureReason ?? "No evidence of objective completion."
    });
  }

  // ── Tool limitation ──────────────────────────────────────────────────────
  if (/not supported|not available|cannot.*perform|capability.*missing|tool.*limitation/.test(summary)) {
    return build(FAILURE_CAUSE.TOOL_LIMITATION, FAILURE_SEVERITY.MEDIUM, false, {
      whatWasTried: describeWhatWasTried(runMetadata),
      whatFailed: "The required capability is not currently available.",
      whyFailed: "Tool or capability limitation."
    });
  }

  return build(FAILURE_CAUSE.UNKNOWN, FAILURE_SEVERITY.MEDIUM, true, {
    whatWasTried: describeWhatWasTried(runMetadata),
    whatFailed: "The run did not complete successfully.",
    whyFailed: String(runSummary ?? "").slice(0, 300) || "Unknown reason."
  });
}

function build(cause, severity, isRecoverable, detail) {
  return { cause, severity, isRecoverable, ...detail };
}

function describeWhatWasTried(meta = {}) {
  const action = meta.computerActionType ?? meta.actionType ?? null;
  const url = meta.finalUrl ?? meta.browserLaunchUrl ?? meta.targetWindowLabel ?? null;
  if (action && url) return `${action} on ${url}`;
  if (action) return action;
  if (url) return `Navigation to ${url}`;
  return "The requested action";
}
