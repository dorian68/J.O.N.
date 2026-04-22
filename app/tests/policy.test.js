import assert from "node:assert/strict";
import { PolicyEngine } from "../src/policy/policy-engine.js";
import { APPROVAL_CATEGORY, APPROVAL_DECISION } from "../src/config.js";

export async function run() {
  const policy = new PolicyEngine();
  const readResult = await policy.authorize({
    category: APPROVAL_CATEGORY.READ,
    riskLevel: "low",
    actionLabel: "Read page",
    targetLabel: "Fixture page",
    reason: "Read controlled content.",
    expectedEffect: "No state change.",
    consequenceOfRefusal: "The run cannot continue."
  });

  assert.equal(readResult.allowed, true);
  assert.equal(readResult.approvalRecord.decision, APPROVAL_DECISION.AUTO_APPROVED);

  const editPolicy = new PolicyEngine({
    approvalResolver: async () => ({
      decision: APPROVAL_DECISION.APPROVED_ONCE,
      rationale: "Allowed in controlled test."
    })
  });

  const editResult = await editPolicy.authorize({
    category: APPROVAL_CATEGORY.EDIT,
    riskLevel: "medium",
    actionLabel: "Edit field",
    targetLabel: "Fixture form",
    reason: "Controlled form update.",
    expectedEffect: "Field value changes.",
    consequenceOfRefusal: "Form remains incomplete."
  });

  assert.equal(editResult.allowed, true);
  assert.equal(editResult.approvalRecord.decision, APPROVAL_DECISION.APPROVED_ONCE);
}
