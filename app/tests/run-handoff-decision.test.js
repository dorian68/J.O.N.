import assert from "node:assert/strict";
import {
  buildDeterministicRunHandoffDecision,
  reconcileRunHandoffDecision,
  validateRunHandoffDecisionOutput
} from "../src/mission/run-handoff-decision.js";

export async function run() {
  const continueDecision = buildDeterministicRunHandoffDecision({
    outcomeSummary: {
      recommendedNextStep: {
        recommendation: {
          objective: "Capture the visible browser result.",
          deliverable: "Screenshot evidence",
          preferredMode: "computer",
          rationale: "A second bounded desktop run is needed for the screenshot."
        }
      },
      maybeLater: {
        recommendation: null
      }
    },
    chainContext: {
      runIndex: 1,
      maxAutoRuns: 2
    }
  });
  assert.equal(continueDecision.decision, "continue_now");
  assert.equal(continueDecision.selectedRecommendationSlot, "next");
  assert.equal(continueDecision.selectedRecommendation?.preferredMode, "computer");

  const clarificationDecision = buildDeterministicRunHandoffDecision({
    outcomeSummary: {
      requiresClarification: true,
      clarificationQuestion: "Which browser should I use for the next bounded step?"
    },
    chainContext: {
      runIndex: 1,
      maxAutoRuns: 2
    }
  });
  assert.equal(clarificationDecision.decision, "needs_clarification");
  assert.equal(clarificationDecision.clarificationQuestion.length > 0, true);

  const stopDecision = buildDeterministicRunHandoffDecision({
    outcomeSummary: {
      recommendedNextStep: {
        recommendation: {
          objective: "Prepare the form with the captured information.",
          deliverable: "Review-ready form state",
          preferredMode: "form",
          rationale: "A later bounded form step would be helpful."
        }
      }
    },
    chainContext: {
      runIndex: 2,
      maxAutoRuns: 2
    }
  });
  assert.equal(stopDecision.decision, "stop_here");

  const validated = validateRunHandoffDecisionOutput({
    decision: "continue_now",
    decisionSummary: "Continue with the next bounded run now.",
    reason: "The first run completed the visible browser step and the screenshot step is ready.",
    selectedRecommendationSlot: "next",
    selectedRecommendation: {
      objective: "Capture the browser window.",
      deliverable: "Screenshot evidence",
      preferredMode: "computer",
      rationale: "The next bounded step is a browser-window capture."
    },
    clarificationQuestion: ""
  });
  assert.equal(validated.decision, "continue_now");
  assert.equal(validated.selectedRecommendation?.preferredMode, "computer");

  const reconciled = reconcileRunHandoffDecision({
    decision: "stop_here",
    decisionSummary: "Stop after the current run.",
    reason: "The current run already completed a bounded step.",
    selectedRecommendationSlot: "none",
    selectedRecommendation: null,
    clarificationQuestion: ""
  }, {
    outcomeSummary: {
      recommendedNextStep: {
        recommendation: {
          objective: "Capture the browser window.",
          deliverable: "Screenshot evidence",
          preferredMode: "computer",
          rationale: "The next bounded step is ready."
        }
      }
    },
    chainContext: {
      runIndex: 1,
      maxAutoRuns: 2
    }
  });
  assert.equal(reconciled.decision, "continue_now");
  assert.equal(reconciled.selectedRecommendationSlot, "next");
}
