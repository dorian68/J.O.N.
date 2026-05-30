import { diagnoseFailure, FAILURE_CAUSE, FAILURE_SEVERITY } from "./failure-diagnoser.js";
import { generateAlternatives } from "./alternative-generator.js";
import { filterByPolicy } from "./policy-filter.js";
import { decideRecovery, RECOVERY_ACTION } from "./recovery-decision-engine.js";
import { createId } from "../utils/ids.js";
import { LLM_CALL_TYPE, LLM_MODEL_ALIAS } from "../config.js";

export { FAILURE_CAUSE, FAILURE_SEVERITY, RECOVERY_ACTION };

export async function runReflectiveRecovery({
  mission,
  runId,
  projectId,
  runStatus,
  runSummary,
  blockerInfo = null,
  verificationResult = null,
  runError = null,
  runMetadata = {},
  llmGateway = null
}) {
  const id = createId("rec");
  const createdAt = new Date().toISOString();

  const diagnosis = diagnoseFailure({
    runStatus,
    runSummary,
    blockerInfo,
    verificationResult,
    runError,
    runMetadata
  });

  if (!diagnosis.isRecoverable) {
    return {
      id,
      runId,
      projectId,
      diagnosis,
      alternatives: [],
      decision: {
        action: RECOVERY_ACTION.ESCALATE,
        selectedAlternative: null,
        allAlternatives: [],
        reason: "not_recoverable",
        confidence: 0.95
      },
      message: buildHeuristicEscalationMessage(diagnosis, null, mission),
      createdAt
    };
  }

  const rawAlternatives = await generateAlternatives({
    mission,
    diagnosis,
    llmGateway,
    projectId,
    runId
  });

  const alternatives = filterByPolicy(rawAlternatives);

  const decision = decideRecovery({ alternatives, diagnosis });

  const message = await buildEscalationMessage({
    mission,
    diagnosis,
    decision,
    llmGateway,
    projectId,
    runId
  });

  return {
    id,
    runId,
    projectId,
    diagnosis,
    alternatives,
    decision,
    message,
    createdAt
  };
}

async function buildEscalationMessage({ mission, diagnosis, decision, llmGateway, projectId, runId }) {
  if (!llmGateway || decision.action === RECOVERY_ACTION.AUTO_RETRY) {
    return buildHeuristicEscalationMessage(diagnosis, decision, mission);
  }

  const best = decision.selectedAlternative;
  try {
    const result = await llmGateway.generateStructured({
      runId,
      projectId,
      callType: LLM_CALL_TYPE.RECOVERY_ESCALATION_MESSAGE,
      modelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
      promptRefs: [{
        promptId: "recovery.escalation_message",
        version: "1.0.0",
        bindings: {
          mission: String(mission ?? "").slice(0, 1000),
          failureCause: diagnosis.cause,
          whatFailed: diagnosis.whatFailed ?? "",
          whyFailed: diagnosis.whyFailed ?? "",
          bestAlternativeDescription: best?.description ?? "No alternative available.",
          bestAlternativeApproach: best?.approach ?? "unknown",
          requiresUserInput: String(best?.requiresUserInput ?? true),
          allAlternativesCount: String(decision.allAlternatives.length)
        }
      }],
      input: {}
    });

    const raw = result?.output ?? result?.rawOutput;
    const parsed = typeof raw === "string" ? safeParse(raw) : raw;
    if (typeof parsed?.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // fall through to heuristic
  }

  return buildHeuristicEscalationMessage(diagnosis, decision, mission);
}

function buildHeuristicEscalationMessage(diagnosis, decision, mission) {
  const cause = diagnosis.cause;
  const best = decision?.selectedAlternative;

  const CAUSE_EXPLANATION = {
    [FAILURE_CAUSE.ANTI_BOT]: "The website blocked automated access (anti-bot / CAPTCHA challenge).",
    [FAILURE_CAUSE.AUTH_REQUIRED]: "Authentication is required to access this resource.",
    [FAILURE_CAUSE.PERMISSION_DENIED]: "Access to this resource was denied (403 Forbidden).",
    [FAILURE_CAUSE.NAVIGATION_DEAD_END]: "The target page could not be found (404 or broken URL).",
    [FAILURE_CAUSE.PROVIDER_TIMEOUT]: "The AI provider timed out while generating a plan.",
    [FAILURE_CAUSE.MALFORMED_LLM_OUTPUT]: "The AI returned an unprocessable response.",
    [FAILURE_CAUSE.SHALLOW_SUCCESS]: "The action ran but the actual objective was not completed.",
    [FAILURE_CAUSE.TOOL_LIMITATION]: "This task requires a capability that is not currently available.",
    [FAILURE_CAUSE.INSUFFICIENT_CONTEXT]: "There is not enough context to proceed automatically.",
    [FAILURE_CAUSE.UNKNOWN]: "An unexpected error occurred."
  };

  const explanation = CAUSE_EXPLANATION[cause] ?? "The run did not complete successfully.";

  if (!best) {
    return `${explanation} No automatic recovery path was found. Please let me know how you'd like to proceed.`;
  }

  if (best.requiresUserInput) {
    return `${explanation} To recover: ${best.description}`;
  }

  return `${explanation} I'll retry automatically: ${best.description}`;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
