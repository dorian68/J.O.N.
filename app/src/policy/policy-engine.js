import {
  APPROVAL_CATEGORY,
  APPROVAL_DECISION
} from "../config.js";
import { createId, nowIso } from "../utils/ids.js";

export class PolicyViolationError extends Error {}

export class PolicyEngine {
  constructor({ approvalResolver, onApprovalRequested, onApprovalResolved } = {}) {
    this.approvalResolver = approvalResolver;
    this.onApprovalRequested = onApprovalRequested;
    this.onApprovalResolved = onApprovalResolved;
  }

  evaluate(action) {
    if (action.category === APPROVAL_CATEGORY.OUT_OF_SCOPE) {
      return {
        requiresApproval: false,
        blocked: true,
        decision: APPROVAL_DECISION.BLOCKED,
        reason: "Action is out of prototype scope."
      };
    }

    if (action.category === APPROVAL_CATEGORY.READ) {
      return {
        requiresApproval: false,
        blocked: false,
        decision: APPROVAL_DECISION.AUTO_APPROVED,
        reason: "Read-only action on allowlisted surface."
      };
    }

    return {
      requiresApproval: true,
      blocked: false,
      decision: null,
      reason: "Explicit approval required by prototype policy."
    };
  }

  async authorize(action) {
    const evaluation = this.evaluate(action);
    const approvalRecord = {
      id: createId("apr"),
      runId: action.runId ?? null,
      category: action.category,
      riskLevel: action.riskLevel,
      actionLabel: action.actionLabel,
      targetLabel: action.targetLabel,
      reason: action.reason,
      expectedEffect: action.expectedEffect,
      consequenceOfRefusal: action.consequenceOfRefusal,
      evidenceId: action.evidenceId ?? null,
      metadata: action.metadata ?? {},
      createdAt: nowIso()
    };

    if (evaluation.blocked) {
      approvalRecord.decision = APPROVAL_DECISION.BLOCKED;
      return {
        allowed: false,
        approvalRecord,
        evaluation
      };
    }

    if (!evaluation.requiresApproval) {
      approvalRecord.decision = evaluation.decision;
      return {
        allowed: true,
        approvalRecord,
        evaluation
      };
    }

    if (!this.approvalResolver) {
      throw new PolicyViolationError(`No approval resolver configured for ${action.actionLabel}`);
    }

    approvalRecord.decision = "pending";
    await this.onApprovalRequested?.(approvalRecord, action);

    const resolution = await this.approvalResolver({
      id: approvalRecord.id,
      runId: approvalRecord.runId,
      category: approvalRecord.category,
      riskLevel: approvalRecord.riskLevel,
      actionLabel: approvalRecord.actionLabel,
      targetLabel: approvalRecord.targetLabel,
      reason: approvalRecord.reason,
      expectedEffect: approvalRecord.expectedEffect,
      consequenceOfRefusal: approvalRecord.consequenceOfRefusal,
      evidenceId: approvalRecord.evidenceId,
      metadata: approvalRecord.metadata
    });

    approvalRecord.decision = resolution.decision;
    approvalRecord.metadata = {
      ...approvalRecord.metadata,
      decisionAt: nowIso(),
      operatorRationale: resolution.rationale ?? null
    };
    await this.onApprovalResolved?.(approvalRecord, action);

    return {
      allowed: resolution.decision === APPROVAL_DECISION.APPROVED_ONCE,
      approvalRecord,
      evaluation
    };
  }
}
