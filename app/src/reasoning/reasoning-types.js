import { REASONING_STAGE } from "../config.js";
import { createId, nowIso } from "../utils/ids.js";

export const SUPPORTED_REASONING_STAGES = Object.freeze([
  REASONING_STAGE.MISSION_UNDERSTANDING,
  REASONING_STAGE.PLAN_GENERATION,
  REASONING_STAGE.RUN_HANDOFF_DECISION,
  REASONING_STAGE.DESKTOP_PLAN,
  REASONING_STAGE.DECISION_NOTE_DRAFT,
  REASONING_STAGE.EVALUATION_SUPPORT,
  REASONING_STAGE.AMBIGUITY_NOTE
]);

export function assertReasoningStage(stage) {
  if (!SUPPORTED_REASONING_STAGES.includes(stage)) {
    throw new Error(`Unsupported reasoning stage: ${stage}`);
  }
  return stage;
}

export function createReasoningId(prefix) {
  return createId(prefix);
}

export function createResolvedVariable({ key, value, reason, source = "runtime_default" }) {
  return {
    id: createReasoningId("var"),
    key,
    value,
    reason,
    source
  };
}

export function createObservation({ id, label, severity = "info", details = {}, reason }) {
  return {
    id,
    label,
    severity,
    details,
    reason
  };
}

export function createGuideline({
  id,
  label,
  priority = 50,
  instructions = [],
  rationale,
  relationships = {},
  stage
}) {
  return {
    id,
    label,
    priority,
    instructions,
    rationale,
    relationships,
    stage
  };
}

export function createReasoningSnapshot({
  runId,
  projectId,
  stage,
  summary,
  llmContext,
  variables,
  observations,
  guidelines,
  relationshipEffects,
  policyConstraints,
  sources,
  artifacts,
  evidence,
  events,
  exclusions,
  injectionReasons,
  metadata = {}
}) {
  return {
    id: createReasoningId("ctx"),
    runId,
    projectId,
    stage,
    summary,
    llmContext,
    variables,
    observations,
    guidelines,
    relationshipEffects,
    policyConstraints,
    sources,
    artifacts,
    evidence,
    events,
    exclusions,
    injectionReasons,
    metadata,
    createdAt: nowIso()
  };
}
