import { LLM_CALL_TYPE } from "../config.js";
import { buildDeterministicMissionUnderstanding } from "../mission/mission-understanding.js";
import { buildDeterministicRunHandoffDecision } from "../mission/run-handoff-decision.js";
import { buildDeterministicDesktopPlan } from "../mission/desktop-plan.js";
import { buildDeterministicAmbiguityOutput, buildDeterministicEvaluationOutput } from "../reasoning/evaluator.js";
import { buildDeterministicConversationTurn } from "../conversation/conversation-turn.js";
import { buildDeterministicBrowserPlan } from "../browser/browser-planner.js";

const SCORE_WEIGHTS = {
  High: 1,
  Medium: 2,
  Low: 3,
  Fast: 3,
  Slow: 1
};

function scoreRecords(records = []) {
  return records
    .map((record) => ({
      ...record,
      score: (SCORE_WEIGHTS[record.priceLevel] ?? 0) + (SCORE_WEIGHTS[record.deliverySpeed] ?? 0)
    }))
    .sort((left, right) => right.score - left.score);
}

export function buildDeterministicPlanOutput(input = {}) {
  switch (input.scenarioType) {
    case "form_preparation":
      return {
        steps: [
          "Open controlled browser session",
          "Navigate to the controlled form surface",
          "Read current field state and capture approval context evidence",
          "Request explicit approvals for bounded field changes",
          "Apply approved edits and verify field outcomes",
          "Stop before submission"
        ],
        assumptions: [
          "The form stays on an allowlisted controlled surface.",
          "Submission remains out of scope."
        ]
      };
    case "computer_observation":
      return {
        steps: [
          "Detect the active local window",
          "Capture the current local context for audit",
          "Request approval before focusing an allowlisted local surface when needed",
          "Capture visible evidence before and after the expected state change",
          "Verify the visible outcome without generalized desktop actuation"
        ],
        assumptions: [
          "Computer control remains observation-first.",
          "No local actuation beyond allowlisted focus is required."
        ]
      };
    case "research":
    default:
      return {
        steps: [
          "Open a controlled browser session",
          "Navigate to the controlled hub and open comparison pages in bounded tabs",
          "Collect structured facts and persist source-linked evidence",
          "Assemble the collection artifact with explicit traceability",
          "Draft a decision note with bounded confidence and validation state"
        ],
        assumptions: [
          "The mission remains on allowlisted controlled surfaces.",
          "The final note stays evidence-backed and explicitly qualified."
        ]
      };
  }
}

export function buildDeterministicDecisionDraftOutput(input = {}) {
  const scored = scoreRecords(input.records ?? []);
  const best = scored[0];
  if (!best) {
    return {
      recommendation: "Insufficient controlled evidence to produce a recommendation.",
      keyFindings: [],
      uncertainties: ["No structured comparison record was available."],
      overallConfidence: "low",
      validationState: "draft"
    };
  }

  return {
    recommendation: `${best.sourceTitle} is the best fit for the current controlled comparison because it offers the strongest combined score across delivery speed and price level.`,
    keyFindings: scored.map((record) => `${record.sourceTitle}: ${record.tagline}; price ${record.priceLevel}; delivery ${record.deliverySpeed}; risk ${record.riskNote}.`),
    uncertainties: Array.from(new Set(scored.map((record) => record.riskNote))).slice(0, 3),
    overallConfidence: "medium",
    validationState: "draft"
  };
}

export function buildDeterministicMissionUnderstandingOutput(input = {}) {
  return buildDeterministicMissionUnderstanding(input);
}

export function buildDeterministicCapabilityDescriptionOutput(input = {}) {
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  return {
    descriptions: capabilities.slice(0, 12).map((capability) => {
      const label = String(capability.label ?? capability.id ?? "Capability").trim();
      const affordances = Array.isArray(capability.affordances) && capability.affordances.length > 0
        ? capability.affordances
        : capability.payload?.affordances ?? [];
      const knownLimits = Array.isArray(capability.knownLimits) && capability.knownLimits.length > 0
        ? capability.knownLimits
        : capability.payload?.knownLimits ?? [];
      return {
        nodeId: capability.id,
        label,
        description: String(capability.description ?? capability.payload?.description ?? `${label} is available as a governed local capability.`).trim(),
        affordances: affordances.slice(0, 8),
        knownLimits: knownLimits.slice(0, 6)
      };
    })
  };
}

export function buildDeterministicFallbackOutput(callType, input = {}) {
  switch (callType) {
    case LLM_CALL_TYPE.CONVERSATION_TURN:
      return buildDeterministicConversationTurn(input);
    case LLM_CALL_TYPE.CAPABILITY_DESCRIPTION:
      return buildDeterministicCapabilityDescriptionOutput(input);
    case LLM_CALL_TYPE.MISSION_UNDERSTANDING:
      return buildDeterministicMissionUnderstandingOutput(input);
    case LLM_CALL_TYPE.RUN_HANDOFF_DECISION:
      return buildDeterministicRunHandoffDecision(input);
    case LLM_CALL_TYPE.DESKTOP_PLAN:
      return buildDeterministicDesktopPlan(input);
    case LLM_CALL_TYPE.BROWSER_PLAN:
      return buildDeterministicBrowserPlan(input);
    case LLM_CALL_TYPE.PLAN_GENERATION:
      return buildDeterministicPlanOutput(input);
    case LLM_CALL_TYPE.DECISION_NOTE_DRAFT:
      return buildDeterministicDecisionDraftOutput(input);
    case LLM_CALL_TYPE.EVALUATION_SUPPORT:
      return buildDeterministicEvaluationOutput(input);
    case LLM_CALL_TYPE.AMBIGUITY_NOTE:
      return buildDeterministicAmbiguityOutput(input);
    default:
      throw new Error(`Unsupported deterministic fallback for call type: ${callType}`);
  }
}
