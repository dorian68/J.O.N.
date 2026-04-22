import { REASONING_STAGE, RUN_STATUS } from "../config.js";
import { createObservation } from "./reasoning-types.js";

function latestEvent(bundle, predicate) {
  return [...(bundle.events ?? [])].reverse().find(predicate) ?? null;
}

function uniqueCount(values = []) {
  return new Set(values.filter((value) => value != null && value !== "")).size;
}

function disagreementMetrics(records = []) {
  return {
    priceLevels: uniqueCount(records.map((record) => record.priceLevel)),
    deliverySpeeds: uniqueCount(records.map((record) => record.deliverySpeed)),
    riskNotes: uniqueCount(records.map((record) => record.riskNote))
  };
}

const DEFAULT_OBSERVATIONS = Object.freeze([
  {
    id: "obs.mission.research",
    stagePredicate: ({ run }) => run.metadata?.type === "research",
    build: ({ run }) => createObservation({
      id: "obs.mission.research",
      label: "Mission type is research",
      severity: "info",
      details: {
        missionType: run.metadata?.type
      },
      reason: "The run metadata marks the mission as a research flow."
    })
  },
  {
    id: "obs.mission.form_preparation",
    stagePredicate: ({ run }) => run.metadata?.type === "form_preparation",
    build: ({ run }) => createObservation({
      id: "obs.mission.form_preparation",
      label: "Mission type is form preparation",
      severity: "info",
      details: {
        missionType: run.metadata?.type
      },
      reason: "The run metadata marks the mission as a bounded form-preparation flow."
    })
  },
  {
    id: "obs.approval.pending",
    stagePredicate: ({ pendingApprovals, run }) => pendingApprovals.length > 0 || run.status === RUN_STATUS.PAUSED,
    build: ({ pendingApprovals, run }) => createObservation({
      id: "obs.approval.pending",
      label: "Approval is pending",
      severity: "warn",
      details: {
        pendingApprovalCount: pendingApprovals.length,
        runStatus: run.status
      },
      reason: "The run is paused or has unresolved approvals."
    })
  },
  {
    id: "obs.llm.provider_degraded",
    stagePredicate: ({ llmStatus }) => !["live_only", "live_with_mock_fallback"].includes(llmStatus.effectiveMode ?? "unavailable"),
    build: ({ llmStatus }) => createObservation({
      id: "obs.llm.provider_degraded",
      label: "LLM provider path is degraded",
      severity: "warn",
      details: {
        providerMode: llmStatus.providerMode,
        effectiveMode: llmStatus.effectiveMode
      },
      reason: "The gateway is not in a fully live operating mode."
    })
  },
  {
    id: "obs.llm.live_unavailable",
    stagePredicate: ({ llmStatus }) => !(llmStatus.availableProviders ?? []).includes("openai_compatible"),
    build: ({ llmStatus }) => createObservation({
      id: "obs.llm.live_unavailable",
      label: "Live LLM provider unavailable",
      severity: "warn",
      details: {
        availableProviders: llmStatus.availableProviders ?? []
      },
      reason: "The gateway does not expose a currently available live provider."
    })
  },
  {
    id: "obs.sources.disagreement_detected",
    stagePredicate: ({ inputs, stage }) => [REASONING_STAGE.DECISION_NOTE_DRAFT, REASONING_STAGE.EVALUATION_SUPPORT, REASONING_STAGE.AMBIGUITY_NOTE].includes(stage) && (inputs.records?.length ?? 0) > 1,
    build: ({ inputs }) => {
      const metrics = disagreementMetrics(inputs.records ?? []);
      return createObservation({
        id: "obs.sources.disagreement_detected",
        label: "Source disagreement detected",
        severity: "warn",
        details: metrics,
        reason: "Collected records disagree on at least one tracked comparison dimension."
      });
    },
    when: ({ inputs }) => {
      const metrics = disagreementMetrics(inputs.records ?? []);
      return metrics.priceLevels > 1 || metrics.deliverySpeeds > 1 || metrics.riskNotes > 1;
    }
  },
  {
    id: "obs.evidence.confidence_low",
    stagePredicate: ({ variables }) => (variables.evidence_confidence_band?.value ?? "low") === "low",
    build: ({ variables }) => createObservation({
      id: "obs.evidence.confidence_low",
      label: "Evidence confidence is low",
      severity: "warn",
      details: {
        evidenceConfidenceBand: variables.evidence_confidence_band?.value ?? "low"
      },
      reason: "The current evidence confidence band is low."
    })
  },
  {
    id: "obs.artifact.validation_low",
    stagePredicate: ({ selectedArtifacts }) => selectedArtifacts.some((artifact) => ["draft", "low", "needs_review"].includes(artifact.validationState ?? artifact.metadata?.validationState ?? "draft")),
    build: ({ selectedArtifacts }) => createObservation({
      id: "obs.artifact.validation_low",
      label: "Artifact validation is still low",
      severity: "warn",
      details: {
        artifactIds: selectedArtifacts.map((artifact) => artifact.id)
      },
      reason: "Selected artifacts are still draft or low-validation artifacts."
    })
  },
  {
    id: "obs.operator.prefers_concise_decision_notes",
    stagePredicate: ({ variables }) => variables.project_preferences?.value?.decisionNoteStyle === "concise",
    build: ({ variables }) => createObservation({
      id: "obs.operator.prefers_concise_decision_notes",
      label: "Operator prefers concise decision notes",
      severity: "info",
      details: variables.project_preferences?.value ?? {},
      reason: "The resolved project preferences prefer concise decision notes."
    })
  },
  {
    id: "obs.runtime.deterministic_fallback_active",
    stagePredicate: ({ run, bundle }) => {
      const degradedEvent = latestEvent(bundle, (event) => event.type === "llm.degraded_mode.activated");
      return Boolean(degradedEvent || run.plan?.generationMode === "deterministic_fallback");
    },
    build: ({ run, bundle }) => {
      const degradedEvent = latestEvent(bundle, (event) => event.type === "llm.degraded_mode.activated");
      return createObservation({
        id: "obs.runtime.deterministic_fallback_active",
        label: "Deterministic fallback is active",
        severity: "warn",
        details: {
          planGenerationMode: run.plan?.generationMode ?? null,
          degradedEventId: degradedEvent?.id ?? null
        },
        reason: "The run already used or is currently using a deterministic degraded path."
      });
    }
  },
  {
    id: "obs.browser.dom_ambiguity_detected",
    stagePredicate: ({ inputs, bundle }) => Boolean(inputs.domAmbiguityDetected) || Boolean(latestEvent(bundle, (event) => event.type === "run.ambiguity_detected")),
    build: ({ inputs, bundle }) => {
      const relatedEvent = latestEvent(bundle, (event) => event.type === "run.ambiguity_detected");
      return createObservation({
        id: "obs.browser.dom_ambiguity_detected",
        label: "DOM ambiguity detected",
        severity: "warn",
        details: {
          inputFlag: Boolean(inputs.domAmbiguityDetected),
          eventId: relatedEvent?.id ?? null
        },
        reason: "The current reasoning input reports DOM ambiguity or an ambiguity event was recorded."
      });
    }
  }
]);

export class ObservationEngine {
  constructor({ definitions = DEFAULT_OBSERVATIONS } = {}) {
    this.definitions = definitions;
  }

  evaluate(context) {
    const matched = [];
    for (const definition of this.definitions) {
      if (!definition.stagePredicate(context)) {
        continue;
      }
      if (definition.when && !definition.when(context)) {
        continue;
      }
      matched.push(definition.build(context));
    }
    return matched;
  }
}

export function createDefaultObservationEngine() {
  return new ObservationEngine();
}
