import crypto from "node:crypto";
import { DEFAULT_LLM_BUDGETS, LLM_MODEL_ALIAS, REASONING_STAGE } from "../config.js";

const DEFAULT_RECORD_LIMIT = 5;
const DEFAULT_EVENT_REDUCTION_ORDER = ["events", "evidence", "artifacts", "sources"];
const NON_BLOCKING_MANDATORY_BUDGET_REASONS = Object.freeze(new Set([
  "stage_token_budget_would_be_exceeded",
  "stage_usd_budget_would_be_exceeded",
  // Hard ceiling exceeded but context was already trimmed — let the API decide
  "request_over_stage_hard_ceiling"
]));

export const TOKEN_GOVERNANCE_STAGE_POLICIES = Object.freeze({
  [REASONING_STAGE.CONVERSATION_TURN]: {
    id: "stage.conversation_turn",
    priority: "core",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 3_200,
    hardStopTokenTarget: 9_000,
    stageBudgetTokens: 20_000,
    stageBudgetUsd: 0.18,
    maxOutputTokensTarget: 760,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 0,
      events: 3,
      observations: 3,
      guidelines: 4,
      variables: 6,
      policyConstraints: 4,
      maxContextChars: 7_500
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.CAPABILITY_DESCRIPTION]: {
    id: "stage.capability_description",
    priority: "core",
    mandatory: false,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 1_600,
    hardStopTokenTarget: 3_200,
    stageBudgetTokens: 4_000,
    stageBudgetUsd: 0.05,
    maxOutputTokensTarget: 650,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: true,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 0,
      events: 0,
      observations: 2,
      guidelines: 2,
      variables: 6,
      policyConstraints: 4,
      maxContextChars: 7_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.MISSION_UNDERSTANDING]: {
    id: "stage.mission_understanding",
    priority: "core",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 8_000,
    hardStopTokenTarget: 18_000,
    stageBudgetTokens: 20_000,
    stageBudgetUsd: 0.14,
    maxOutputTokensTarget: 900,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 0,
      events: 12,
      observations: 12,
      guidelines: 8,
      variables: 12,
      policyConstraints: 8,
      maxContextChars: 32_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.RUN_HANDOFF_DECISION]: {
    id: "stage.run_handoff_decision",
    priority: "core",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 3_000,
    hardStopTokenTarget: 8_000,
    stageBudgetTokens: 8_000,
    stageBudgetUsd: 0.035,
    maxOutputTokensTarget: 260,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 1,
      evidence: 1,
      events: 10,
      observations: 8,
      guidelines: 6,
      variables: 10,
      policyConstraints: 6,
      maxContextChars: 18_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.DESKTOP_PLAN]: {
    id: "stage.desktop_plan",
    priority: "core",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 6_000,
    hardStopTokenTarget: 16_000,
    stageBudgetTokens: 18_000,
    stageBudgetUsd: 0.045,
    maxOutputTokensTarget: 1_200,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 4,
      events: 12,
      observations: 12,
      guidelines: 8,
      variables: 12,
      policyConstraints: 8,
      maxContextChars: 28_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.BROWSER_PLAN]: {
    id: "stage.browser_plan",
    priority: "critical",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 12_000,
    hardStopTokenTarget: 48_000,
    stageBudgetTokens: 60_000,
    stageBudgetUsd: 0.35,
    maxOutputTokensTarget: 2_000,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 4,
      events: 12,
      observations: 12,
      guidelines: 8,
      variables: 12,
      policyConstraints: 8,
      maxContextChars: 80_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.BROWSER_REPLAN]: {
    id: "stage.browser_replan",
    priority: "critical",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 12_000,
    hardStopTokenTarget: 48_000,
    stageBudgetTokens: 60_000,
    stageBudgetUsd: 0.35,
    maxOutputTokensTarget: 2_000,
    cacheEligible: false,
    reuseEligible: false,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 4,
      events: 14,
      observations: 14,
      guidelines: 8,
      variables: 12,
      policyConstraints: 8,
      maxContextChars: 80_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.PLAN_GENERATION]: {
    id: "stage.plan_generation",
    priority: "critical",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING,
    downgradeModelAlias: null,
    requestTokenTarget: 8_000,
    hardStopTokenTarget: 18_000,
    stageBudgetTokens: 20_000,
    stageBudgetUsd: 0.11,
    maxOutputTokensTarget: 1_200,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 3,
      artifacts: 0,
      evidence: 0,
      events: 12,
      observations: 12,
      guidelines: 8,
      variables: 12,
      policyConstraints: 8,
      maxContextChars: 30_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.DECISION_NOTE_DRAFT]: {
    id: "stage.decision_note_draft",
    priority: "critical",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING,
    downgradeModelAlias: null,
    requestTokenTarget: 10_000,
    hardStopTokenTarget: 22_000,
    stageBudgetTokens: 24_000,
    stageBudgetUsd: 0.14,
    maxOutputTokensTarget: 1_600,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 8,
      artifacts: 4,
      evidence: 8,
      events: 14,
      observations: 14,
      guidelines: 8,
      variables: 12,
      policyConstraints: 8,
      maxContextChars: 40_000
    },
    inputLimits: {
      records: 10,
      sourceReferences: 10
    }
  },
  [REASONING_STAGE.EVALUATION_SUPPORT]: {
    id: "stage.evaluation_support",
    priority: "important_optional",
    mandatory: false,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 4_000,
    hardStopTokenTarget: 8_000,
    stageBudgetTokens: 8_000,
    stageBudgetUsd: 0.05,
    maxOutputTokensTarget: 500,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: true,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 4,
      artifacts: 2,
      evidence: 4,
      events: 6,
      observations: 8,
      guidelines: 6,
      variables: 8,
      policyConstraints: 4,
      maxContextChars: 18_000
    },
    inputLimits: {
      records: 4,
      sourceReferences: 4
    }
  },
  [REASONING_STAGE.WINDOW_DESCRIPTION]: {
    id: "stage.window_description",
    priority: "important_optional",
    mandatory: false,
    preferredModelAlias: LLM_MODEL_ALIAS.VISION_FALLBACK,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 1_200,
    hardStopTokenTarget: 2_000,
    stageBudgetTokens: 2_200,
    stageBudgetUsd: 0.015,
    maxOutputTokensTarget: 420,
    cacheEligible: false,
    reuseEligible: false,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 0,
      events: 2,
      observations: 4,
      guidelines: 2,
      variables: 4,
      policyConstraints: 2,
      maxContextChars: 6_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.WORKSPACE_TERMINAL_REASONING]: {
    id: "stage.workspace_terminal_reasoning",
    priority: "core",
    mandatory: true,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 1_400,
    hardStopTokenTarget: 2_800,
    stageBudgetTokens: 8_000,
    stageBudgetUsd: 0.12,
    maxOutputTokensTarget: 320,
    cacheEligible: false,
    reuseEligible: false,
    suppressUnderBudgetPressure: false,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 0,
      artifacts: 0,
      evidence: 0,
      events: 2,
      observations: 2,
      guidelines: 2,
      variables: 4,
      policyConstraints: 2,
      maxContextChars: 5_000
    },
    inputLimits: {
      records: 0,
      sourceReferences: 0
    }
  },
  [REASONING_STAGE.AMBIGUITY_NOTE]: {
    id: "stage.ambiguity_note",
    priority: "optional",
    mandatory: false,
    preferredModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    downgradeModelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
    requestTokenTarget: 3_000,
    hardStopTokenTarget: 6_000,
    stageBudgetTokens: 6_000,
    stageBudgetUsd: 0.03,
    maxOutputTokensTarget: 350,
    cacheEligible: true,
    reuseEligible: true,
    suppressUnderBudgetPressure: true,
    deterministicFallbackEligible: true,
    operatorDisclosureRequired: true,
    contextLimits: {
      sources: 3,
      artifacts: 1,
      evidence: 4,
      events: 4,
      observations: 8,
      guidelines: 5,
      variables: 7,
      policyConstraints: 4,
      maxContextChars: 14_000
    },
    inputLimits: {
      records: 4,
      sourceReferences: 4
    }
  }
});

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortKeys(value[key]);
        return accumulator;
      }, {});
  }
  return value;
}

function stableSerialize(value) {
  return JSON.stringify(sortKeys(value ?? null));
}

function summarizeRecord(record) {
  return {
    sourceId: record.sourceId ?? null,
    sourceTitle: compactText(record.sourceTitle ?? null, 80),
    fact: compactText(record.fact ?? record.tagline ?? null, 180),
    confidence: record.confidence ?? null,
    note: compactText(record.note ?? record.riskNote ?? null, 180),
    priceLevel: compactText(record.priceLevel ?? null, 48),
    deliverySpeed: compactText(record.deliverySpeed ?? null, 48),
    evidenceId: record.evidenceId ?? null
  };
}

function summarizeDraft(draft) {
  if (!draft || typeof draft !== "object") {
    return draft ?? null;
  }
  return {
    recommendation: compactText(draft.recommendation ?? null, 240),
    keyFindings: compactStringArray(draft.keyFindings, 4, 180),
    uncertainties: compactStringArray(draft.uncertainties, 4, 180),
    overallConfidence: compactText(draft.overallConfidence ?? null, 24),
    validationState: compactText(draft.validationState ?? null, 48)
  };
}

function summarizeEvaluationSupport(evaluationSupport) {
  if (!evaluationSupport || typeof evaluationSupport !== "object") {
    return evaluationSupport ?? null;
  }
  return {
    qualityVerdict: compactText(evaluationSupport.qualityVerdict ?? null, 120),
    recommendedValidationState: compactText(evaluationSupport.recommendedValidationState ?? null, 48),
    ambiguityDetected: Boolean(evaluationSupport.ambiguityDetected),
    ambiguitySummary: compactText(evaluationSupport.ambiguitySummary ?? null, 220),
    riskFlags: compactStringArray(evaluationSupport.riskFlags, 4, 160),
    missingProof: compactStringArray(evaluationSupport.missingProof, 4, 160)
  };
}

function compactText(value, maxLength = 160) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}\u2026`;
}

function compactStringArray(value, limit = 4, maxLength = 160) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const entry of value) {
    const compacted = compactText(entry, maxLength);
    if (!compacted || seen.has(compacted)) {
      continue;
    }
    seen.add(compacted);
    output.push(compacted);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function summarizeMissionUnderstanding(missionUnderstanding) {
  if (!missionUnderstanding || typeof missionUnderstanding !== "object") {
    return missionUnderstanding ?? null;
  }
  return {
    missionSummary: compactText(missionUnderstanding.missionSummary ?? null, 180),
    clarifiedObjective: compactText(missionUnderstanding.clarifiedObjective ?? null, 180),
    chosenExecutionFrame: compactText(missionUnderstanding.chosenExecutionFrame ?? null, 48),
    routingConfidence: compactText(missionUnderstanding.routingConfidence ?? null, 24),
    coverageStatus: compactText(missionUnderstanding.coverageStatus ?? null, 48),
    whyThisFrame: compactText(missionUnderstanding.whyThisFrame ?? null, 220),
    coveredNow: compactStringArray(missionUnderstanding.coveredNow ?? missionUnderstanding.requestedOutcomes, 3, 160),
    notCoveredNow: compactStringArray(missionUnderstanding.notCoveredNow, 3, 160),
    verificationGoals: compactStringArray(missionUnderstanding.verificationGoals, 4, 160),
    runNowPlan: compactStringArray(missionUnderstanding.runNowPlan, 4, 180),
    nextRunSuggestion: compactText(missionUnderstanding.nextRunSuggestion ?? null, 180),
    unsupportedRequests: compactStringArray(missionUnderstanding.unsupportedRequests, 3, 160),
    ambiguityNote: compactText(missionUnderstanding.ambiguityNote ?? null, 180),
    requiresClarification: Boolean(missionUnderstanding.requiresClarification),
    clarificationQuestion: missionUnderstanding.requiresClarification
      ? compactText(missionUnderstanding.clarificationQuestion ?? null, 160)
      : ""
  };
}

function summarizeHandoffRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") {
    return recommendation ?? null;
  }
  return {
    objective: compactText(recommendation.objective ?? null, 180),
    deliverable: compactText(recommendation.deliverable ?? null, 180),
    preferredMode: compactText(recommendation.preferredMode ?? null, 32),
    rationale: compactText(recommendation.rationale ?? null, 200),
    parameters: recommendation.parameters ?? null
  };
}

function summarizeOutcomeSummary(outcomeSummary) {
  if (!outcomeSummary || typeof outcomeSummary !== "object") {
    return outcomeSummary ?? null;
  }
  return {
    clarifiedObjective: compactText(outcomeSummary.clarifiedObjective ?? null, 180),
    coverageStatus: compactText(outcomeSummary.coverageStatus ?? null, 48),
    runStatus: compactText(outcomeSummary.runStatus ?? null, 32),
    verificationStatus: compactText(outcomeSummary.verificationStatus ?? null, 32),
    didNow: compactStringArray(outcomeSummary.didNow, 4, 160),
    verifiedNow: compactStringArray(outcomeSummary.verifiedNow, 4, 160),
    notDoneNow: compactStringArray(outcomeSummary.notDoneNow, 4, 160),
    recommendedNextStep: outcomeSummary.recommendedNextStep
      ? {
        summary: compactText(outcomeSummary.recommendedNextStep.summary ?? null, 180),
        canPrepare: Boolean(outcomeSummary.recommendedNextStep.canPrepare),
        recommendation: summarizeHandoffRecommendation(outcomeSummary.recommendedNextStep.recommendation)
      }
      : null,
    maybeLater: outcomeSummary.maybeLater
      ? {
        summary: compactText(outcomeSummary.maybeLater.summary ?? null, 180),
        canPrepare: Boolean(outcomeSummary.maybeLater.canPrepare),
        recommendation: summarizeHandoffRecommendation(outcomeSummary.maybeLater.recommendation)
      }
      : null,
    requiresClarification: Boolean(outcomeSummary.requiresClarification),
    clarificationQuestion: outcomeSummary.requiresClarification
      ? compactText(outcomeSummary.clarificationQuestion ?? null, 160)
      : ""
  };
}

function estimateTokenCount(value) {
  const serialized = typeof value === "string" ? value : stableSerialize(value);
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function estimateRequestUsd({
  runtimeConfig,
  modelAlias,
  estimatedInputTokens,
  estimatedOutputTokens
}) {
  const pricing = runtimeConfig?.providers?.openaiCompatible?.pricing?.[modelAlias] ?? null;
  if (!pricing || pricing.inputPer1k == null || pricing.outputPer1k == null) {
    return null;
  }
  const inputCost = (estimatedInputTokens / 1000) * pricing.inputPer1k;
  const outputCost = (estimatedOutputTokens / 1000) * pricing.outputPer1k;
  return Number((inputCost + outputCost).toFixed(6));
}

function hashFingerprint(value) {
  return crypto.createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function dedupeById(items) {
  const seen = new Set();
  const output = [];
  for (const item of items ?? []) {
    const id = item?.id ?? stableSerialize(item);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    output.push(item);
  }
  return output;
}

function compactArray(list, limit, label, reasons) {
  const deduped = dedupeById(list ?? []);
  if (deduped.length !== (list ?? []).length) {
    reasons.push(`${label} deduplicated.`);
  }
  if (limit <= 0) {
    if (deduped.length > 0) {
      reasons.push(`${label} removed for this stage.`);
    }
    return [];
  }
  if (deduped.length > limit) {
    reasons.push(`${label} trimmed from ${deduped.length} to ${limit}.`);
    return deduped.slice(0, limit);
  }
  return deduped;
}

function applyContextLimits(context, policy, reasons) {
  const compacted = deepClone(context ?? {});
  compacted.sources = compactArray(compacted.sources, policy.contextLimits.sources, "sources", reasons);
  compacted.artifacts = compactArray(compacted.artifacts, policy.contextLimits.artifacts, "artifacts", reasons);
  compacted.evidence = compactArray(compacted.evidence, policy.contextLimits.evidence, "evidence", reasons);
  compacted.events = compactArray(compacted.events, policy.contextLimits.events, "events", reasons);
  compacted.observations = compactArray(compacted.observations, policy.contextLimits.observations, "observations", reasons);
  compacted.guidelines = compactArray(compacted.guidelines, policy.contextLimits.guidelines, "guidelines", reasons);
  compacted.variables = compactArray(compacted.variables, policy.contextLimits.variables, "variables", reasons);
  compacted.policyConstraints = compactArray(compacted.policyConstraints, policy.contextLimits.policyConstraints, "policy constraints", reasons);

  while (JSON.stringify(compacted).length > policy.contextLimits.maxContextChars) {
    const fieldToReduce = DEFAULT_EVENT_REDUCTION_ORDER.find((field) => (compacted[field] ?? []).length > 1);
    if (!fieldToReduce) {
      break;
    }
    compacted[fieldToReduce] = compacted[fieldToReduce].slice(0, Math.max(1, compacted[fieldToReduce].length - 1));
    reasons.push(`${fieldToReduce} reduced to stay under the stage context target.`);
  }

  if (JSON.stringify(compacted).length > policy.contextLimits.maxContextChars) {
    compacted.events = compacted.events?.slice(0, 2) ?? [];
    reasons.push("events compacted to a minimal set to stay under the stage context target.");
  }

  return compacted;
}

export function normalizeReasoningStage(value) {
  switch (value) {
    case REASONING_STAGE.CONVERSATION_TURN:
    case REASONING_STAGE.CAPABILITY_DESCRIPTION:
    case REASONING_STAGE.MISSION_UNDERSTANDING:
    case REASONING_STAGE.RUN_HANDOFF_DECISION:
    case REASONING_STAGE.DESKTOP_PLAN:
    case REASONING_STAGE.BROWSER_PLAN:
    case REASONING_STAGE.BROWSER_REPLAN:
    case REASONING_STAGE.PLAN_GENERATION:
    case REASONING_STAGE.DECISION_NOTE_DRAFT:
    case REASONING_STAGE.EVALUATION_SUPPORT:
    case REASONING_STAGE.AMBIGUITY_NOTE:
    case REASONING_STAGE.WINDOW_DESCRIPTION:
    case REASONING_STAGE.WORKSPACE_TERMINAL_REASONING:
      return value;
    default:
      return REASONING_STAGE.PLAN_GENERATION;
  }
}

export function getTokenGovernancePolicy(stage) {
  const normalizedStage = normalizeReasoningStage(stage);
  return TOKEN_GOVERNANCE_STAGE_POLICIES[normalizedStage];
}

export function selectPreferredModelAlias(stage) {
  return getTokenGovernancePolicy(stage).preferredModelAlias;
}

export function prepareRuntimeReasoningPayload({
  reasoningStage,
  reasoningSnapshot,
  bindings = {},
  input = {}
}) {
  const policy = getTokenGovernancePolicy(reasoningStage);
  const reasons = [];
  const compactedReasoningContext = applyContextLimits(reasoningSnapshot.llmContext, policy, reasons);
  const compactedInput = deepClone(input);
  const recordLimit = policy.inputLimits.records ?? DEFAULT_RECORD_LIMIT;
  const sourceReferenceLimit = policy.inputLimits.sourceReferences ?? DEFAULT_RECORD_LIMIT;

  if (Array.isArray(compactedInput.records)) {
    const originalCount = compactedInput.records.length;
    compactedInput.records = compactedInput.records.slice(0, recordLimit).map(summarizeRecord);
    if (originalCount > compactedInput.records.length) {
      reasons.push(`records trimmed from ${originalCount} to ${compactedInput.records.length}.`);
    }
  }

  if (Array.isArray(compactedInput.sourceReferences)) {
    const originalCount = compactedInput.sourceReferences.length;
    compactedInput.sourceReferences = compactedInput.sourceReferences
      .slice(0, sourceReferenceLimit)
      .map((entry) => ({
        id: entry.id ?? null,
        title: entry.title ?? null,
        canonicalRef: entry.canonicalRef ?? null
      }));
    if (originalCount > compactedInput.sourceReferences.length) {
      reasons.push(`sourceReferences trimmed from ${originalCount} to ${compactedInput.sourceReferences.length}.`);
    }
  }

  if (compactedInput.draft) {
    compactedInput.draft = summarizeDraft(compactedInput.draft);
    reasons.push("draft compacted to stable summary fields.");
  }

  if (compactedInput.evaluationSupport) {
    compactedInput.evaluationSupport = summarizeEvaluationSupport(compactedInput.evaluationSupport);
    reasons.push("evaluationSupport compacted to stable summary fields.");
  }

  if (compactedInput.missionUnderstanding) {
    compactedInput.missionUnderstanding = summarizeMissionUnderstanding(compactedInput.missionUnderstanding);
    reasons.push("missionUnderstanding compacted to current-run planning fields.");
  }

  if (compactedInput.outcomeSummary) {
    compactedInput.outcomeSummary = summarizeOutcomeSummary(compactedInput.outcomeSummary);
    reasons.push("outcomeSummary compacted to handoff decision fields.");
  }

  compactedInput.reasoningContext = compactedReasoningContext;

  const compactedBindings = {
    ...bindings,
    reasoningContextJson: JSON.stringify(compactedReasoningContext)
  };

  if ("records" in compactedBindings && Array.isArray(compactedInput.records)) {
    compactedBindings.records = JSON.stringify(compactedInput.records);
  }
  if ("sourceReferences" in compactedBindings && Array.isArray(compactedInput.sourceReferences)) {
    compactedBindings.sourceReferences = JSON.stringify(compactedInput.sourceReferences);
  }
  if ("draft" in compactedBindings && compactedInput.draft) {
    compactedBindings.draft = JSON.stringify(compactedInput.draft);
  }
  if ("evaluationSupport" in compactedBindings && compactedInput.evaluationSupport) {
    compactedBindings.evaluationSupport = JSON.stringify(compactedInput.evaluationSupport);
  }
  if ("missionUnderstanding" in compactedBindings && compactedInput.missionUnderstanding) {
    compactedBindings.missionUnderstanding = JSON.stringify(compactedInput.missionUnderstanding);
  }
  if ("outcomeSummary" in compactedBindings && compactedInput.outcomeSummary) {
    compactedBindings.outcomeSummary = JSON.stringify(compactedInput.outcomeSummary);
  }

  const tokenEstimateBefore = estimateTokenCount({
    bindings,
    input
  });
  const tokenEstimateAfter = estimateTokenCount({
    bindings: compactedBindings,
    input: compactedInput
  });

  return {
    policy,
    preferredModelAlias: policy.preferredModelAlias,
    bindings: compactedBindings,
    input: compactedInput,
    compaction: {
      applied: reasons.length > 0,
      reasons,
      estimatedTokensBefore: tokenEstimateBefore,
      estimatedTokensAfter: tokenEstimateAfter,
      estimatedTokensSaved: Math.max(0, tokenEstimateBefore - tokenEstimateAfter)
    }
  };
}

function createStageUsageState() {
  return {
    totalTokens: 0,
    estimatedCost: 0,
    callCount: 0,
    reusedCount: 0,
    suppressedCount: 0,
    blockedCount: 0,
    compactedCount: 0
  };
}

function createStageMetricState() {
  return {
    providerCalls: 0,
    reusedCalls: 0,
    suppressedCalls: 0,
    blockedCalls: 0,
    downgradedCalls: 0,
    compactedCalls: 0,
    totalTokens: 0,
    estimatedCost: 0,
    estimatedTokensSaved: 0
  };
}

const BUDGET_REASON_LABELS = Object.freeze({
  request_over_stage_hard_ceiling: "Estimated request exceeds the stage hard ceiling.",
  run_tokens_remaining_insufficient: "Run token budget remaining is insufficient for this request.",
  session_tokens_remaining_insufficient: "Session token budget remaining is insufficient for this request.",
  run_usd_budget_exhausted: "Run USD budget is already exhausted.",
  session_usd_budget_exhausted: "Session USD budget is already exhausted.",
  run_usd_remaining_insufficient: "Run USD budget remaining is insufficient for this request.",
  session_usd_remaining_insufficient: "Session USD budget remaining is insufficient for this request.",
  stage_token_budget_would_be_exceeded: "Stage token budget would be exceeded by this request.",
  stage_usd_budget_would_be_exceeded: "Stage USD budget would be exceeded by this request."
});

function describeBudgetPressure(reasons, fallback = "Budget pressure detected.") {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return fallback;
  }
  return reasons.map((reason) => BUDGET_REASON_LABELS[reason] ?? reason).join(" ");
}

function mandatoryLiveBlockReasons(reasons = []) {
  return reasons.filter((reason) => !NON_BLOCKING_MANDATORY_BUDGET_REASONS.has(reason));
}

function cloneOutput(value) {
  return deepClone(value);
}

export class TokenGovernanceController {
  constructor({
    runtimeConfig
  }) {
    this.runtimeConfig = runtimeConfig ?? {
      budgets: DEFAULT_LLM_BUDGETS
    };
    this.cache = new Map();
    this.runStageUsage = new Map();
    this.sessionSummary = {
      reusedCalls: 0,
      suppressedCalls: 0,
      blockedCalls: 0,
      downgradedCalls: 0,
      compactedCalls: 0,
      estimatedTokensSaved: 0,
      stageStats: {}
    };
  }

  getStatus() {
    return {
      enabled: true,
      reusedCalls: this.sessionSummary.reusedCalls,
      suppressedCalls: this.sessionSummary.suppressedCalls,
      blockedCalls: this.sessionSummary.blockedCalls,
      downgradedCalls: this.sessionSummary.downgradedCalls,
      compactedCalls: this.sessionSummary.compactedCalls,
      estimatedTokensSaved: this.sessionSummary.estimatedTokensSaved,
      stageStats: this.sessionSummary.stageStats
    };
  }

  prepareRequest({
    runId,
    callType,
    modelAlias,
    promptRefs,
    input,
    metadata = {},
    sessionUsage,
    runUsage
  }) {
    const stage = normalizeReasoningStage(metadata.reasoningStage ?? callType);
    const policy = getTokenGovernancePolicy(stage);
    const stageUsage = this.#getRunStageUsage(runId, stage);
    const preparedPromptRefs = deepClone(promptRefs);
    const preparedInput = deepClone(input);
    const requestedModelAlias = modelAlias;
    let effectiveModelAlias = policy.preferredModelAlias ?? modelAlias;
    let downgraded = false;
    let downgradeReason = null;

    const estimatedInputTokens = estimateTokenCount({
      promptRefs: preparedPromptRefs,
      input: preparedInput
    });
    const estimatedOutputTokens = policy.maxOutputTokensTarget;
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
    const remainingRunTokens = Math.max(0, (this.runtimeConfig.budgets.perRunTokens ?? 0) - (runUsage?.totalTokens ?? 0));
    const remainingSessionTokens = Math.max(0, (this.runtimeConfig.budgets.perSessionTokens ?? 0) - (sessionUsage?.totalTokens ?? 0));
    const remainingRunUsd = Math.max(0, (this.runtimeConfig.budgets.perRunUsd ?? 0) - (runUsage?.estimatedCost ?? 0));
    const remainingSessionUsd = Math.max(0, (this.runtimeConfig.budgets.perSessionUsd ?? 0) - (sessionUsage?.estimatedCost ?? 0));
    const evaluateBudgetPressure = (candidateModelAlias) => {
      const estimatedRequestUsd = estimateRequestUsd({
        runtimeConfig: this.runtimeConfig,
        modelAlias: candidateModelAlias,
        estimatedInputTokens,
        estimatedOutputTokens
      });
      const reasons = [];
      if (estimatedTotalTokens > policy.hardStopTokenTarget) {
        reasons.push("request_over_stage_hard_ceiling");
      }
      if (remainingRunTokens < estimatedTotalTokens) {
        reasons.push("run_tokens_remaining_insufficient");
      }
      if (remainingSessionTokens < estimatedTotalTokens) {
        reasons.push("session_tokens_remaining_insufficient");
      }
      if (remainingRunUsd <= 0) {
        reasons.push("run_usd_budget_exhausted");
      } else if (estimatedRequestUsd != null && remainingRunUsd < estimatedRequestUsd) {
        reasons.push("run_usd_remaining_insufficient");
      }
      if (remainingSessionUsd <= 0) {
        reasons.push("session_usd_budget_exhausted");
      } else if (estimatedRequestUsd != null && remainingSessionUsd < estimatedRequestUsd) {
        reasons.push("session_usd_remaining_insufficient");
      }
      if ((stageUsage.totalTokens + estimatedTotalTokens) > policy.stageBudgetTokens) {
        reasons.push("stage_token_budget_would_be_exceeded");
      }
      if (estimatedRequestUsd != null && (stageUsage.estimatedCost + estimatedRequestUsd) > policy.stageBudgetUsd) {
        reasons.push("stage_usd_budget_would_be_exceeded");
      }
      return {
        estimatedRequestUsd,
        reasons,
        pressure: reasons.length > 0
      };
    };

    let budgetEvaluation = evaluateBudgetPressure(effectiveModelAlias);

    let fingerprint = hashFingerprint({
      stage,
      effectiveModelAlias,
      promptRefs: preparedPromptRefs,
      input: preparedInput
    });
    let cacheKey = `${runId}:${stage}:${fingerprint}`;

    if (policy.reuseEligible && this.cache.has(cacheKey)) {
      const cacheEntry = this.cache.get(cacheKey);
      this.sessionSummary.reusedCalls += 1;
      this.sessionSummary.estimatedTokensSaved += cacheEntry.savedTokensEstimate ?? estimatedTotalTokens;
      stageUsage.reusedCount += 1;
      this.#incrementStageMetric(stage, "reusedCalls");
      return {
        action: "reuse",
        stage,
        policy,
        fingerprint,
        cached: cacheEntry,
        governance: {
          stage,
          policyId: policy.id,
          requestedModelAlias,
          effectiveModelAlias: cacheEntry.callRecord.modelAlias ?? effectiveModelAlias,
          executionMode: "reused",
          reason: "Exact same stage fingerprint already succeeded in this run.",
          estimatedInputTokens,
          estimatedTotalTokens
        }
      };
    }

    if (policy.downgradeModelAlias && policy.downgradeModelAlias !== effectiveModelAlias && budgetEvaluation.pressure) {
      effectiveModelAlias = policy.downgradeModelAlias;
      downgraded = true;
      downgradeReason = "Budget pressure triggered the cheaper stage model alias.";
      budgetEvaluation = evaluateBudgetPressure(effectiveModelAlias);
      fingerprint = hashFingerprint({
        stage,
        effectiveModelAlias,
        promptRefs: preparedPromptRefs,
        input: preparedInput
      });
      cacheKey = `${runId}:${stage}:${fingerprint}`;
      this.sessionSummary.downgradedCalls += 1;
      this.#incrementStageMetric(stage, "downgradedCalls");
    }

    const blockingBudgetReasons = policy.mandatory ? mandatoryLiveBlockReasons(budgetEvaluation.reasons) : budgetEvaluation.reasons;
    const liveProviderBlocked = policy.mandatory && blockingBudgetReasons.length > 0;
    const liveProviderBlockReason = liveProviderBlocked
      ? describeBudgetPressure(blockingBudgetReasons, "Mandatory live provider call blocked under budget pressure.")
      : null;

    if (!policy.mandatory && policy.suppressUnderBudgetPressure && budgetEvaluation.pressure) {
      this.sessionSummary.suppressedCalls += 1;
      stageUsage.suppressedCount += 1;
      this.#incrementStageMetric(stage, "suppressedCalls");
      return {
        action: "suppress",
        stage,
        policy,
        fingerprint,
        effectiveModelAlias,
        governance: {
          stage,
          policyId: policy.id,
          requestedModelAlias,
          effectiveModelAlias,
          executionMode: "suppressed",
          reason: describeBudgetPressure(budgetEvaluation.reasons, "Optional stage suppressed under budget pressure."),
          estimatedInputTokens,
          estimatedTotalTokens,
          estimatedRequestUsd: budgetEvaluation.estimatedRequestUsd,
          budgetPressure: budgetEvaluation.pressure,
          budgetPressureReasons: budgetEvaluation.reasons,
          remainingRunTokens,
          remainingSessionTokens,
          remainingRunUsd,
          remainingSessionUsd,
          downgraded,
          downgradeReason,
          liveProviderBlocked: false,
          liveProviderBlockReason: null
        }
      };
    }

    return {
      action: "call",
      stage,
      policy,
      fingerprint,
      promptRefs: preparedPromptRefs,
      input: preparedInput,
      effectiveModelAlias,
      skipLiveProvider: liveProviderBlocked,
      governance: {
        stage,
        policyId: policy.id,
        requestedModelAlias,
        effectiveModelAlias,
        executionMode: "provider_call",
        reason: liveProviderBlockReason ?? (downgraded ? downgradeReason : null),
        estimatedInputTokens,
        estimatedTotalTokens,
        estimatedRequestUsd: budgetEvaluation.estimatedRequestUsd,
        budgetPressure: budgetEvaluation.pressure,
        budgetPressureReasons: budgetEvaluation.reasons,
        blockingBudgetPressureReasons: blockingBudgetReasons,
        remainingRunTokens,
        remainingSessionTokens,
        remainingRunUsd,
        remainingSessionUsd,
        downgraded,
        downgradeReason,
        liveProviderBlocked,
        liveProviderBlockReason
      }
    };
  }

  recordSuccess({
    runId,
    callRecord,
    output
  }) {
    const stage = normalizeReasoningStage(callRecord.metadata?.reasoningStage ?? callRecord.callType);
    const stageUsage = this.#getRunStageUsage(runId, stage);
    stageUsage.totalTokens += callRecord.tokenUsage?.totalTokens ?? 0;
    stageUsage.estimatedCost = Number((stageUsage.estimatedCost + (callRecord.estimatedCost ?? 0)).toFixed(6));
    stageUsage.callCount += 1;
    this.#incrementStageMetric(stage, "providerCalls");
    this.#addStageMetricValue(stage, "totalTokens", callRecord.tokenUsage?.totalTokens ?? 0);
    this.#addStageMetricValue(stage, "estimatedCost", callRecord.estimatedCost ?? 0);

    const fingerprint = callRecord.metadata?.tokenGovernance?.requestFingerprint;
    if (fingerprint && callRecord.metadata?.tokenGovernance?.cacheEligible) {
      const cacheKey = `${runId}:${stage}:${fingerprint}`;
      this.cache.set(cacheKey, {
        output: cloneOutput(output),
        callRecord: deepClone(callRecord),
        savedTokensEstimate: callRecord.metadata?.tokenGovernance?.estimatedTotalTokens ?? 0
      });
    }
  }

  noteCompaction(stage, estimatedTokensSaved) {
    if (estimatedTokensSaved <= 0) {
      return;
    }
    this.sessionSummary.compactedCalls += 1;
    this.sessionSummary.estimatedTokensSaved += estimatedTokensSaved;
    this.#incrementStageMetric(stage, "compactedCalls");
    this.#addStageMetricValue(stage, "estimatedTokensSaved", estimatedTokensSaved);
  }

  noteLiveProviderBlocked(stage) {
    this.sessionSummary.blockedCalls += 1;
    this.#incrementStageMetric(stage, "blockedCalls");
  }

  #getRunStageUsage(runId, stage) {
    if (!this.runStageUsage.has(runId)) {
      this.runStageUsage.set(runId, new Map());
    }
    const stageMap = this.runStageUsage.get(runId);
    if (!stageMap.has(stage)) {
      stageMap.set(stage, createStageUsageState());
    }
    return stageMap.get(stage);
  }

  #incrementStageMetric(stage, metricName) {
    const existing = this.sessionSummary.stageStats[stage] ?? createStageMetricState();
    existing[metricName] += 1;
    this.sessionSummary.stageStats[stage] = existing;
  }

  #addStageMetricValue(stage, metricName, value) {
    const existing = this.sessionSummary.stageStats[stage] ?? createStageMetricState();
    existing[metricName] = Number(((existing[metricName] ?? 0) + value).toFixed(6));
    this.sessionSummary.stageStats[stage] = existing;
  }
}
