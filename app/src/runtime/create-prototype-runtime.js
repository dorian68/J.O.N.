import { PrototypeDatabase } from "../storage/database.js";
import { BrowserController } from "../browser/browser-controller.js";
import { ComputerControlService } from "../computer/computer-control-service.js";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { createDefaultLlmGateway } from "../llm/create-default-llm-gateway.js";
import { PrototypeAgent } from "./prototype-agent.js";
import { APPROVAL_DECISION, EVENT_ACTOR, RUN_STATUS } from "../config.js";
import { createEvent } from "./events.js";
import { nowIso } from "../utils/ids.js";
import { createDefaultContextualReasoningEngine } from "../reasoning/contextual-reasoning-engine.js";

export async function createPrototypeRuntime({
  dbPath,
  browserOptions,
  computerProvider,
  llmGateway,
  reasoningEngine,
  approvalResolver,
  policyHooks
} = {}) {
  const database = new PrototypeDatabase(dbPath);
  await database.open();
  const resolvedLlmGateway = llmGateway ?? await createDefaultLlmGateway();
  const resolvedReasoningEngine = reasoningEngine ?? createDefaultContextualReasoningEngine();

  const defaultPolicyHooks = {
    onApprovalRequested: async (approvalRecord, action) => {
      if (action.runId) {
        database.insertApproval(action.runId, approvalRecord);
        database.updateRun(action.runId, {
          status: RUN_STATUS.PAUSED,
          lifecycleStage: "approval_pending",
          summary: `Awaiting approval: ${approvalRecord.actionLabel}`,
          updatedAt: nowIso()
        });
        database.insertEvent(action.runId, createEvent("approval.requested", EVENT_ACTOR.POLICY, `Approval requested: ${approvalRecord.actionLabel}.`, {
          approvalId: approvalRecord.id,
          category: approvalRecord.category,
          riskLevel: approvalRecord.riskLevel
        }));
        database.insertEvent(action.runId, createEvent("run.paused", EVENT_ACTOR.POLICY, "Run paused pending operator approval.", {
          approvalId: approvalRecord.id
        }));
      }
    },
    onApprovalResolved: async (approvalRecord, action) => {
      database.updateApproval(approvalRecord.id, {
        decision: approvalRecord.decision,
        metadata: approvalRecord.metadata
      });
      if (!action.runId) {
        return;
      }

      const decisionEventType = approvalRecord.decision === APPROVAL_DECISION.APPROVED_ONCE
        ? "approval.granted"
        : "approval.denied";

      database.insertEvent(action.runId, createEvent(decisionEventType, EVENT_ACTOR.OPERATOR, `Approval resolved: ${approvalRecord.actionLabel}.`, {
        approvalId: approvalRecord.id,
        decision: approvalRecord.decision
      }));

      if (approvalRecord.decision === APPROVAL_DECISION.APPROVED_ONCE) {
        database.updateRun(action.runId, {
          status: RUN_STATUS.RUNNING,
          lifecycleStage: "executing",
          summary: `Approval granted: ${approvalRecord.actionLabel}`,
          updatedAt: nowIso()
        });
        database.insertEvent(action.runId, createEvent("run.resumed", EVENT_ACTOR.OPERATOR, "Run resumed after operator approval.", {
          approvalId: approvalRecord.id
        }));
      } else if (approvalRecord.decision === APPROVAL_DECISION.STOP_RUN) {
        database.updateRun(action.runId, {
          status: RUN_STATUS.STOPPED,
          lifecycleStage: "stopped",
          summary: `Run stopped by operator during approval: ${approvalRecord.actionLabel}`,
          updatedAt: nowIso()
        });
      }
    }
  };

  const policyEngine = new PolicyEngine({
    approvalResolver: approvalResolver ?? defaultApprovalResolver,
    onApprovalRequested: policyHooks?.onApprovalRequested ?? defaultPolicyHooks.onApprovalRequested,
    onApprovalResolved: policyHooks?.onApprovalResolved ?? defaultPolicyHooks.onApprovalResolved
  });

  const runtime = new PrototypeAgent({
    database,
    browserController: new BrowserController(browserOptions),
    computerControlService: new ComputerControlService(computerProvider ?? new PowerShellWindowProvider()),
    policyEngine,
    llmGateway: resolvedLlmGateway,
    reasoningEngine: resolvedReasoningEngine
  });

  return {
    runtime,
    database,
    llmGateway: resolvedLlmGateway,
    reasoningEngine: resolvedReasoningEngine,
    async close() {
      database.close();
    }
  };
}

async function defaultApprovalResolver(request) {
  return {
    decision: APPROVAL_DECISION.DENIED,
    rationale: `No explicit operator approval resolver configured for ${request.actionLabel}.`
  };
}
