import assert from "node:assert/strict";
import { buildDeterministicAmbiguityOutput, buildDeterministicEvaluationOutput } from "../src/reasoning/evaluator.js";

export async function run() {
  const snapshot = {
    variables: [
      {
        id: "var_risk",
        key: "active_risk_posture",
        value: "high"
      }
    ],
    observations: [
      {
        id: "obs.sources.disagreement_detected"
      },
      {
        id: "obs.evidence.confidence_low"
      }
    ]
  };

  const evaluation = buildDeterministicEvaluationOutput({
    draft: {
      validationState: "draft"
    },
    records: [
      {
        sourceTitle: "Alpha Analytics",
        evidenceId: "ev_alpha"
      },
      {
        sourceTitle: "Beta Commerce"
      }
    ],
    snapshot
  });

  assert.equal(evaluation.qualityVerdict, "needs_revision");
  assert.equal(evaluation.recommendedValidationState, "needs_review");
  assert.equal(evaluation.ambiguityDetected, true);
  assert.ok(evaluation.riskFlags.length >= 2);
  assert.ok(evaluation.missingProof.length >= 1);

  const ambiguity = buildDeterministicAmbiguityOutput({
    snapshot: {
      observations: [
        {
          id: "obs.sources.disagreement_detected"
        },
        {
          id: "obs.browser.dom_ambiguity_detected"
        }
      ]
    },
    records: [{ sourceTitle: "Alpha Analytics" }]
  });

  assert.ok(ambiguity.ambiguityNote.includes("disagree"));
  assert.ok(ambiguity.uncertaintyPoints.length >= 2);
}
