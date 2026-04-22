import { REASONING_STAGE } from "../config.js";
import { createGuideline } from "./reasoning-types.js";

const DEFAULT_GUIDELINES = Object.freeze([
  {
    id: "guideline.plan.keep_conservative",
    stages: [REASONING_STAGE.MISSION_UNDERSTANDING, REASONING_STAGE.PLAN_GENERATION, REASONING_STAGE.RUN_HANDOFF_DECISION, REASONING_STAGE.DESKTOP_PLAN],
    priority: 80,
    when: () => true,
    build: ({ stage }) => createGuideline({
      id: "guideline.plan.keep_conservative",
      label: "Keep the plan conservative",
      priority: 80,
      stage,
      instructions: [
        "Keep the plan conservative, bounded, and aligned with the authorized slice.",
        "Prefer deterministic checks and traceable steps over speculative autonomy."
      ],
      rationale: "The run should stay inside the authorized prototype slice."
    })
  },
  {
    id: "guideline.desktop.use_approved_primitives",
    stages: [REASONING_STAGE.DESKTOP_PLAN],
    priority: 94,
    when: () => true,
    build: ({ stage }) => createGuideline({
      id: "guideline.desktop.use_approved_primitives",
      label: "Use approved desktop primitives only",
      priority: 94,
      stage,
      instructions: [
        "Use only the governed desktop primitives exposed by the runtime.",
        "Request approval before app launch, typing, clicking, hotkeys or scrolling.",
        "Do not plan submit, send, publish, delete, purchase, install or credential-sensitive actions."
      ],
      rationale: "General desktop autonomy must stay broad in intent but governed in action."
    })
  },
  {
    id: "guideline.handoff.keep_one_step_only",
    stages: [REASONING_STAGE.RUN_HANDOFF_DECISION],
    priority: 92,
    when: () => true,
    build: ({ stage }) => createGuideline({
      id: "guideline.handoff.keep_one_step_only",
      label: "Keep the handoff to one bounded next step",
      priority: 92,
      stage,
      instructions: [
        "Select at most one next bounded run and only when the current outcome already recommends it.",
        "Do not imply open-ended chaining or autonomous continuation beyond the configured chain limit."
      ],
      rationale: "Automatic multi-run continuation must remain bounded and explicit."
    })
  },
  {
    id: "guideline.handoff.ask_one_short_question",
    stages: [REASONING_STAGE.RUN_HANDOFF_DECISION],
    priority: 88,
    when: () => true,
    build: ({ stage }) => createGuideline({
      id: "guideline.handoff.ask_one_short_question",
      label: "Ask one short clarification when needed",
      priority: 88,
      stage,
      instructions: [
        "If the next bounded step is blocked by one missing detail, ask one short actionable question instead of guessing.",
        "Do not start another run when the current recommendation still needs a clarification."
      ],
      rationale: "The cowork should remain decisive without becoming opaque or guess-driven."
    })
  },
  {
    id: "guideline.plan.dom_first",
    stages: [REASONING_STAGE.PLAN_GENERATION],
    priority: 85,
    when: () => true,
    build: ({ stage }) => createGuideline({
      id: "guideline.plan.dom_first",
      label: "Preserve browser-first / DOM-first planning",
      priority: 85,
      stage,
      instructions: [
        "Prefer browser-first, DOM-first actions where structured browser surfaces exist.",
        "Do not route toward computer-control fallback unless DOM-first routes are exhausted and policy still allows it."
      ],
      rationale: "The product contract remains browser-first and DOM-first."
    })
  },
  {
    id: "guideline.decision.require_uncertainty_note",
    stages: [REASONING_STAGE.DECISION_NOTE_DRAFT, REASONING_STAGE.EVALUATION_SUPPORT, REASONING_STAGE.AMBIGUITY_NOTE],
    priority: 90,
    requiredObservationIds: ["obs.sources.disagreement_detected"],
    build: ({ stage }) => createGuideline({
      id: "guideline.decision.require_uncertainty_note",
      label: "Require an explicit uncertainty note",
      priority: 90,
      stage,
      instructions: [
        "Explicitly disclose where the sources disagree and what remains uncertain.",
        "Do not flatten disagreements into a falsely clean conclusion."
      ],
      rationale: "Source disagreement requires visible uncertainty handling.",
      relationships: {
        dependsOn: ["guideline.decision.require_traceable_citations"]
      }
    })
  },
  {
    id: "guideline.decision.require_traceable_citations",
    stages: [REASONING_STAGE.DECISION_NOTE_DRAFT, REASONING_STAGE.EVALUATION_SUPPORT],
    priority: 75,
    when: ({ stage, variables }) => stage === REASONING_STAGE.DECISION_NOTE_DRAFT || variables.active_risk_posture?.value !== "low",
    build: ({ stage }) => createGuideline({
      id: "guideline.decision.require_traceable_citations",
      label: "Require traceable citations",
      priority: 75,
      stage,
      instructions: [
        "Reference concrete sources and evidence IDs in support of the recommendation.",
        "Do not make unsupported claims that cannot be traced back to collected evidence."
      ],
      rationale: "Decision-note quality depends on evidence-backed traceability."
    })
  },
  {
    id: "guideline.decision.ban_assertive_language_when_evidence_weak",
    stages: [REASONING_STAGE.DECISION_NOTE_DRAFT, REASONING_STAGE.EVALUATION_SUPPORT, REASONING_STAGE.AMBIGUITY_NOTE],
    priority: 95,
    requiredObservationIds: ["obs.evidence.confidence_low"],
    build: ({ stage }) => createGuideline({
      id: "guideline.decision.ban_assertive_language_when_evidence_weak",
      label: "Ban assertive language when evidence is weak",
      priority: 95,
      stage,
      instructions: [
        "Use qualified language because evidence confidence is low.",
        "Avoid presenting the recommendation as final or certain."
      ],
      rationale: "Low evidence confidence should suppress assertive language.",
      relationships: {
        overrides: ["guideline.decision.recommend_strong_next_step"]
      }
    })
  },
  {
    id: "guideline.decision.disclose_degraded_mode",
    stages: [REASONING_STAGE.DECISION_NOTE_DRAFT, REASONING_STAGE.EVALUATION_SUPPORT],
    priority: 100,
    requiredObservationIds: ["obs.llm.provider_degraded"],
    build: ({ stage }) => createGuideline({
      id: "guideline.decision.disclose_degraded_mode",
      label: "Disclose degraded LLM mode",
      priority: 100,
      stage,
      instructions: [
        "Explicitly disclose that the LLM path is degraded or unavailable when drafting the artifact.",
        "Do not hide a fallback or degraded reasoning mode."
      ],
      rationale: "Degraded mode must remain explicit to the operator and in artifacts."
    })
  },
  {
    id: "guideline.decision.keep_concise",
    stages: [REASONING_STAGE.DECISION_NOTE_DRAFT],
    priority: 45,
    requiredObservationIds: ["obs.operator.prefers_concise_decision_notes"],
    build: ({ stage }) => createGuideline({
      id: "guideline.decision.keep_concise",
      label: "Keep the decision note concise",
      priority: 45,
      stage,
      instructions: [
        "Keep the note concise and operator-readable.",
        "Compress repetitive facts once traceability is preserved."
      ],
      rationale: "Resolved project preferences prefer concise decision notes.",
      relationships: {
        excludedBy: ["guideline.evaluation.expand_risk_explanation"]
      }
    })
  },
  {
    id: "guideline.approval.no_irreversible_next_steps",
    stages: [REASONING_STAGE.PLAN_GENERATION, REASONING_STAGE.DECISION_NOTE_DRAFT, REASONING_STAGE.EVALUATION_SUPPORT],
    priority: 92,
    requiredObservationIds: ["obs.approval.pending"],
    build: ({ stage }) => createGuideline({
      id: "guideline.approval.no_irreversible_next_steps",
      label: "Do not imply irreversible next steps while approval is pending",
      priority: 92,
      stage,
      instructions: [
        "Do not present irreversible next steps as already decided while approval remains pending.",
        "Keep the operator decision boundary explicit."
      ],
      rationale: "Pending approvals must remain visible and unresolved until the operator decides."
    })
  },
  {
    id: "guideline.evaluation.expand_risk_explanation",
    stages: [REASONING_STAGE.EVALUATION_SUPPORT, REASONING_STAGE.AMBIGUITY_NOTE],
    priority: 88,
    when: ({ variables }) => variables.active_risk_posture?.value === "high",
    build: ({ stage }) => createGuideline({
      id: "guideline.evaluation.expand_risk_explanation",
      label: "Expand risk explanation",
      priority: 88,
      stage,
      instructions: [
        "Expand the risk explanation and call out missing evidence explicitly.",
        "Prefer clarity about residual risk over brevity."
      ],
      rationale: "High active risk posture requires more explicit risk explanation."
    })
  },
  {
    id: "guideline.ambiguity.require_dom_note",
    stages: [REASONING_STAGE.AMBIGUITY_NOTE],
    priority: 86,
    requiredObservationIds: ["obs.browser.dom_ambiguity_detected"],
    build: ({ stage }) => createGuideline({
      id: "guideline.ambiguity.require_dom_note",
      label: "Explain DOM ambiguity explicitly",
      priority: 86,
      stage,
      instructions: [
        "Explain where the DOM was ambiguous and why deterministic targeting was not fully decisive.",
        "Do not convert ambiguity into a false binary success/failure."
      ],
      rationale: "DOM ambiguity should remain explicit in ambiguity support outputs."
    })
  }
]);

function hasRequiredObservations(observations, requiredIds = []) {
  if (requiredIds.length === 0) {
    return true;
  }
  const activeIds = new Set(observations.map((observation) => observation.id));
  return requiredIds.every((id) => activeIds.has(id));
}

export class GuidelineEngine {
  constructor({ definitions = DEFAULT_GUIDELINES } = {}) {
    this.definitions = definitions;
  }

  evaluate({ stage, observations, variables, inputs }) {
    return this.definitions
      .filter((definition) => definition.stages.includes(stage))
      .filter((definition) => hasRequiredObservations(observations, definition.requiredObservationIds ?? []))
      .filter((definition) => (definition.when ? definition.when({ stage, observations, variables, inputs }) : true))
      .map((definition) => definition.build({ stage, observations, variables, inputs }))
      .sort((left, right) => right.priority - left.priority);
  }
}

export function createDefaultGuidelineEngine() {
  return new GuidelineEngine();
}
