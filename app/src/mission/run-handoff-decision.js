function validateRecommendationObject(value, label) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object or null.`), {
      category: "malformed_output"
    });
  }
  const objective = String(value.objective ?? "").trim();
  const deliverable = String(value.deliverable ?? "").trim();
  const preferredMode = String(value.preferredMode ?? "").trim();
  const rationale = String(value.rationale ?? "").trim();
  const parameters = value.parameters && typeof value.parameters === "object" && !Array.isArray(value.parameters)
    ? value.parameters
    : null;
  if (!objective || !deliverable || !preferredMode || !rationale) {
    throw Object.assign(new Error(`${label} is missing required fields.`), {
      category: "malformed_output"
    });
  }
  if (!["research", "form", "computer"].includes(preferredMode)) {
    throw Object.assign(new Error(`${label} must contain a valid preferredMode.`), {
      category: "malformed_output"
    });
  }
  return {
    objective,
    deliverable,
    preferredMode,
    rationale,
    parameters
  };
}

export function validateRunHandoffDecisionOutput(output) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Run handoff decision output must be an object."), {
      category: "malformed_output"
    });
  }

  const decision = String(output.decision ?? "").trim();
  const decisionSummary = String(output.decisionSummary ?? "").trim();
  const reason = String(output.reason ?? "").trim();
  const selectedRecommendationSlot = String(output.selectedRecommendationSlot ?? "").trim() || "none";
  const clarificationQuestion = String(output.clarificationQuestion ?? "").trim();
  const selectedRecommendation = validateRecommendationObject(output.selectedRecommendation ?? null, "selectedRecommendation");

  if (!["continue_now", "stop_here", "needs_clarification"].includes(decision)) {
    throw Object.assign(new Error("Run handoff decision must contain a valid decision."), {
      category: "malformed_output"
    });
  }
  if (!decisionSummary || !reason) {
    throw Object.assign(new Error("Run handoff decision is missing required narrative fields."), {
      category: "malformed_output"
    });
  }
  if (!["next", "later", "none"].includes(selectedRecommendationSlot)) {
    throw Object.assign(new Error("Run handoff decision must contain a valid selectedRecommendationSlot."), {
      category: "malformed_output"
    });
  }
  if (decision === "continue_now" && !selectedRecommendation) {
    throw Object.assign(new Error("Run handoff decision must include a selectedRecommendation when continuing."), {
      category: "malformed_output"
    });
  }
  if (decision !== "continue_now" && selectedRecommendationSlot !== "none" && !selectedRecommendation) {
    throw Object.assign(new Error("Run handoff decision selected a recommendation slot without a recommendation payload."), {
      category: "malformed_output"
    });
  }
  if (decision === "needs_clarification" && !clarificationQuestion) {
    throw Object.assign(new Error("Run handoff decision needs a clarificationQuestion when clarification is required."), {
      category: "malformed_output"
    });
  }

  return {
    decision,
    decisionSummary,
    reason,
    selectedRecommendationSlot,
    selectedRecommendation,
    clarificationQuestion: decision === "needs_clarification" ? clarificationQuestion : ""
  };
}

export function buildDeterministicRunHandoffDecision(input = {}) {
  const outcomeSummary = input.outcomeSummary ?? {};
  const chainContext = input.chainContext ?? {};
  const nextRecommendation = outcomeSummary.recommendedNextStep?.recommendation ?? null;
  const laterRecommendation = outcomeSummary.maybeLater?.recommendation ?? null;
  const currentIndex = Number(chainContext.runIndex ?? 1);
  const maxRuns = Number(chainContext.maxAutoRuns ?? 1);

  if (outcomeSummary.requiresClarification) {
    return {
      decision: "needs_clarification",
      decisionSummary: "The cowork needs one short clarification before continuing to another bounded run.",
      reason: "The current run outcome still carries an unresolved clarification requirement.",
      selectedRecommendationSlot: "none",
      selectedRecommendation: null,
      clarificationQuestion: outcomeSummary.clarificationQuestion || "What should the cowork prioritize for the next bounded step?"
    };
  }

  if (currentIndex >= maxRuns) {
    return {
      decision: "stop_here",
      decisionSummary: "The automatic chain stops here because the bounded chain limit has been reached.",
      reason: `The chain already used ${currentIndex} runs, which meets the configured maximum of ${maxRuns}.`,
      selectedRecommendationSlot: "none",
      selectedRecommendation: null,
      clarificationQuestion: ""
    };
  }

  if (nextRecommendation) {
    return {
      decision: "continue_now",
      decisionSummary: "The cowork should continue with the next bounded run now.",
      reason: "The current run completed a credible first step and the next bounded recommendation is ready without requiring a new clarification.",
      selectedRecommendationSlot: "next",
      selectedRecommendation: nextRecommendation,
      clarificationQuestion: ""
    };
  }

  if (laterRecommendation) {
    return {
      decision: "continue_now",
      decisionSummary: "The cowork can continue with a later bounded step now because no better immediate next run is available.",
      reason: "The later recommendation is the best remaining bounded step after the current run.",
      selectedRecommendationSlot: "later",
      selectedRecommendation: laterRecommendation,
      clarificationQuestion: ""
    };
  }

  return {
    decision: "stop_here",
    decisionSummary: "No further bounded run is recommended automatically after this step.",
    reason: "The current run either fully covered the safe scope or there is no credible next bounded recommendation to continue with.",
    selectedRecommendationSlot: "none",
    selectedRecommendation: null,
    clarificationQuestion: ""
  };
}

export function reconcileRunHandoffDecision(output, input = {}) {
  const normalized = validateRunHandoffDecisionOutput(output);
  const deterministic = buildDeterministicRunHandoffDecision(input);

  if (
    normalized.decision === "stop_here"
    && deterministic.decision === "continue_now"
    && normalized.selectedRecommendation == null
  ) {
    return {
      ...deterministic,
      reason: `${deterministic.reason} The bounded handoff reconciled a more conservative LLM stop decision with an already-prepared next bounded recommendation.`
    };
  }

  return normalized;
}
