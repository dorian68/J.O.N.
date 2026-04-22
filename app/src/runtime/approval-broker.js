import { EventEmitter } from "node:events";
import { APPROVAL_DECISION } from "../config.js";

export class ApprovalBroker extends EventEmitter {
  constructor() {
    super();
    this.pending = new Map();
  }

  async requestApproval(request) {
    const pendingApproval = {
      ...request,
      requestedAt: new Date().toISOString(),
      status: "pending"
    };

    const resolution = await new Promise((resolve) => {
      this.pending.set(request.id, {
        request: pendingApproval,
        resolve
      });
      this.emit("requested", pendingApproval);
    });

    this.pending.delete(request.id);
    this.emit("resolved", {
      approvalId: request.id,
      resolution
    });
    return resolution;
  }

  listPending() {
    return Array.from(this.pending.values()).map((entry) => entry.request);
  }

  resolve(approvalId, decision, rationale = null) {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      throw new Error(`Pending approval not found: ${approvalId}`);
    }
    entry.resolve({
      decision,
      rationale
    });
  }

  approveOnce(approvalId, rationale = null) {
    this.resolve(approvalId, APPROVAL_DECISION.APPROVED_ONCE, rationale);
  }

  deny(approvalId, rationale = null) {
    this.resolve(approvalId, APPROVAL_DECISION.DENIED, rationale);
  }

  stopRun(approvalId, rationale = null) {
    this.resolve(approvalId, APPROVAL_DECISION.STOP_RUN, rationale);
  }
}
