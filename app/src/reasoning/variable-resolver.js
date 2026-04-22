import { createResolvedVariable } from "./reasoning-types.js";

function extractProjectPreferences(project, run) {
  return project?.preferences
    ?? run.metadata?.projectPreferences
    ?? {
      decisionNoteStyle: "concise",
      citationStyle: "source_ref",
      discloseDegradedMode: true
    };
}

function computeEvidenceConfidenceBand({ sourceCount, evidenceCount, disagreementLevel }) {
  if (sourceCount === 0 || evidenceCount === 0) {
    return "low";
  }
  if (disagreementLevel === "high") {
    return "low";
  }
  if (sourceCount >= 3 && evidenceCount >= sourceCount) {
    return "high";
  }
  return "medium";
}

function computeDisagreementLevel(records = []) {
  const unique = (field) => new Set(records.map((record) => record[field]).filter(Boolean)).size;
  const score = (
    (unique("priceLevel") > 1 ? 1 : 0)
    + (unique("deliverySpeed") > 1 ? 1 : 0)
    + (unique("riskNote") > 1 ? 1 : 0)
  );
  if (score >= 2) {
    return "high";
  }
  if (score === 1) {
    return "medium";
  }
  return "low";
}

function computeRiskPosture({ stage, run, pendingApprovals, disagreementLevel, llmStatus }) {
  if (pendingApprovals.length > 0 || run.status === "paused") {
    return "high";
  }
  if ((llmStatus.effectiveMode ?? "unknown").includes("degraded")) {
    return "high";
  }
  if (stage === "evaluation_support" || stage === "ambiguity_note" || disagreementLevel === "high") {
    return "high";
  }
  if (run.metadata?.type === "form_preparation" || run.metadata?.type === "computer_observation") {
    return "high";
  }
  return "medium";
}

export class VariableResolver {
  resolve({ stage, run, project, bundle, llmStatus, pendingApprovals, inputs, selectedSources, selectedArtifacts, selectedEvidence }) {
    const projectPreferences = extractProjectPreferences(project, run);
    const disagreementLevel = computeDisagreementLevel(inputs.records ?? []);
    const evidenceConfidenceBand = computeEvidenceConfidenceBand({
      sourceCount: selectedSources.length,
      evidenceCount: selectedEvidence.length,
      disagreementLevel
    });
    const activeRiskPosture = computeRiskPosture({
      stage,
      run,
      pendingApprovals,
      disagreementLevel,
      llmStatus
    });
    const latestLifecycleEvent = [...(bundle.events ?? [])].reverse().find((event) => event.type.startsWith("run."));

    return {
      project_preferences: createResolvedVariable({
        key: "project_preferences",
        value: projectPreferences,
        reason: "Resolved from project/run defaults.",
        source: project?.id ?? "runtime_default"
      }),
      active_risk_posture: createResolvedVariable({
        key: "active_risk_posture",
        value: activeRiskPosture,
        reason: "Derived from run type, pending approvals, disagreement level and LLM operating mode."
      }),
      artifact_quality_target: createResolvedVariable({
        key: "artifact_quality_target",
        value: stage === "decision_note_draft" || stage === "evaluation_support"
          ? {
            requireTraceability: true,
            requireConfidence: true,
            requireValidationState: true
          }
          : {
            requireTraceability: false
          },
        reason: "Derived from the reasoning stage and artifact contract."
      }),
      current_browser_context: createResolvedVariable({
        key: "current_browser_context",
        value: {
          allowlistedDomains: run.metadata?.allowlistedDomains ?? project?.allowlistedDomains ?? [],
          sourceCount: selectedSources.length,
          evidenceCount: selectedEvidence.length
        },
        reason: "Derived from the current run scope and selected browser-backed evidence."
      }),
      current_run_summary: createResolvedVariable({
        key: "current_run_summary",
        value: {
          status: run.status,
          lifecycleStage: run.lifecycleStage,
          summary: run.summary,
          planStepCount: run.plan?.steps?.length ?? 0,
          latestLifecycleEvent: latestLifecycleEvent?.type ?? null
        },
        reason: "Derived from the current run state."
      }),
      llm_operating_mode: createResolvedVariable({
        key: "llm_operating_mode",
        value: {
          providerMode: llmStatus.providerMode,
          effectiveMode: llmStatus.effectiveMode,
          availableProviders: llmStatus.availableProviders ?? []
        },
        reason: "Derived from the LLM gateway runtime status."
      }),
      approval_state: createResolvedVariable({
        key: "approval_state",
        value: {
          pendingCount: pendingApprovals.length,
          runStatus: run.status,
          lifecycleStage: run.lifecycleStage
        },
        reason: "Derived from pending approvals and run state."
      }),
      evidence_confidence_band: createResolvedVariable({
        key: "evidence_confidence_band",
        value: evidenceConfidenceBand,
        reason: "Derived from selected source/evidence counts and disagreement level."
      }),
      source_disagreement_level: createResolvedVariable({
        key: "source_disagreement_level",
        value: disagreementLevel,
        reason: "Derived from record disagreement across key comparison dimensions."
      }),
      artifact_inventory: createResolvedVariable({
        key: "artifact_inventory",
        value: selectedArtifacts.map((artifact) => ({
          id: artifact.id,
          artifactType: artifact.artifactType,
          validationState: artifact.validationState ?? artifact.metadata?.validationState ?? null
        })),
        reason: "Derived from artifacts selected for the current reasoning stage."
      })
    };
  }
}

export function createDefaultVariableResolver() {
  return new VariableResolver();
}
