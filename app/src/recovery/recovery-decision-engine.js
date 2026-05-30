export const RECOVERY_ACTION = Object.freeze({
  AUTO_RETRY: "auto_retry",
  ESCALATE: "escalate"
});

// Minimum probability for an auto-retry (no user input, safe, no approval needed)
const AUTO_RETRY_THRESHOLD = 0.65;

export function decideRecovery({ alternatives, diagnosis }) {
  if (!alternatives || alternatives.length === 0) {
    return {
      action: RECOVERY_ACTION.ESCALATE,
      selectedAlternative: null,
      allAlternatives: [],
      reason: "no_safe_alternatives_available",
      confidence: 0.95
    };
  }

  const ranked = rankAlternatives(alternatives);
  const best = ranked[0];

  const canAutoRetry =
    best.safetyLevel === "safe" &&
    !best.requiresUserInput &&
    !best.requiresApproval &&
    (best.estimatedSuccessProbability ?? 0) >= AUTO_RETRY_THRESHOLD;

  if (canAutoRetry) {
    return {
      action: RECOVERY_ACTION.AUTO_RETRY,
      selectedAlternative: best,
      allAlternatives: ranked,
      reason: "safe_high_probability_no_user_input",
      confidence: best.estimatedSuccessProbability
    };
  }

  const reason = best.requiresUserInput
    ? "best_alternative_requires_user_input"
    : best.requiresApproval
    ? "best_alternative_requires_approval"
    : "probability_below_auto_retry_threshold";

  return {
    action: RECOVERY_ACTION.ESCALATE,
    selectedAlternative: best,
    allAlternatives: ranked,
    reason,
    confidence: best.estimatedSuccessProbability ?? 0.5
  };
}

function rankAlternatives(alts) {
  return [...alts].sort((a, b) => {
    // Safety first
    const safetyScore = s => s === "safe" ? 2 : s === "needs_review" ? 1 : 0;
    const sd = safetyScore(b.safetyLevel) - safetyScore(a.safetyLevel);
    if (sd !== 0) return sd;

    // Autonomous (no user input) beats user-input alternatives — auto-retry depends on this
    if (!a.requiresUserInput && b.requiresUserInput) return -1;
    if (a.requiresUserInput && !b.requiresUserInput) return 1;

    // Within same autonomy tier, rank by probability
    const pd = (b.estimatedSuccessProbability ?? 0) - (a.estimatedSuccessProbability ?? 0);
    return pd;
  });
}
