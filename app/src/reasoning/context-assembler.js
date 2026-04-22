import { REASONING_STAGE } from "../config.js";
import { buildInjectionReasons, buildSnapshotPreview } from "./reasoning-trace.js";
import { createReasoningSnapshot } from "./reasoning-types.js";
import { getStageDefinition } from "./stage-definitions.js";
import { createDefaultObservationEngine } from "./observation-engine.js";
import { createDefaultGuidelineEngine } from "./guideline-engine.js";
import { createDefaultRelationshipResolver } from "./relationship-resolver.js";
import { createDefaultVariableResolver } from "./variable-resolver.js";

function selectRankedItems(items = [], limit = 0, ranker = () => 0) {
  if (limit <= 0) {
    return {
      included: [],
      excluded: items.map((item) => ({
        id: item.id,
        reason: "Stage definition excludes this item type."
      }))
    };
  }

  const ranked = [...items]
    .map((item) => ({
      item,
      rank: ranker(item)
    }))
    .sort((left, right) => right.rank - left.rank);

  const included = ranked.slice(0, limit).map(({ item }) => item);
  const includedIds = new Set(included.map((item) => item.id));
  const excluded = ranked
    .filter(({ item }) => !includedIds.has(item.id))
    .map(({ item }) => ({
      id: item.id,
      reason: "Excluded to keep stage context narrow."
    }));

  return {
    included,
    excluded
  };
}

function rankSource(source, inputs = {}) {
  const explicitSourceIds = new Set((inputs.sourceReferences ?? []).map((entry) => entry.id));
  let score = 0;
  if (explicitSourceIds.has(source.id)) {
    score += 20;
  }
  if (source.trustClassification === "controlled_fixture") {
    score += 10;
  }
  if (source.trustClassification === "allowlisted_real_web") {
    score += 12;
  }
  return score;
}

function rankArtifact(artifact, stage) {
  let score = 0;
  if (artifact.artifactType === "tableau_collecte_navigateur") {
    score += 15;
  }
  if (artifact.artifactType === "note_de_decision") {
    score += stage === REASONING_STAGE.EVALUATION_SUPPORT ? 20 : 5;
  }
  if (artifact.metadata?.validationState === "draft") {
    score += 5;
  }
  return score;
}

function rankEvidence(evidence, inputs = {}) {
  let score = 0;
  const explicitEvidenceIds = new Set((inputs.records ?? []).map((record) => record.evidenceId).filter(Boolean));
  if (explicitEvidenceIds.has(evidence.id)) {
    score += 20;
  }
  if (evidence.linkedSourceId) {
    score += 5;
  }
  return score;
}

function rankEvent(event) {
  let score = 0;
  if (event.type.startsWith("run.")) {
    score += 10;
  }
  if (event.type.startsWith("approval.")) {
    score += 8;
  }
  if (event.type.startsWith("llm.")) {
    score += 6;
  }
  return score;
}

function normalizeSource(source, reason) {
  return {
    id: source.id,
    title: source.title,
    canonicalRef: source.canonicalRef,
    trustClassification: source.trustClassification,
    reason
  };
}

function normalizeArtifact(artifact, reason) {
  return {
    id: artifact.id,
    title: artifact.title,
    artifactType: artifact.artifactType,
    validationState: artifact.metadata?.validationState ?? null,
    overallConfidence: artifact.metadata?.overallConfidence ?? null,
    reason
  };
}

function normalizeEvidence(evidence, reason) {
  return {
    id: evidence.id,
    label: evidence.label,
    evidenceType: evidence.evidenceType,
    linkedSourceId: evidence.linkedSourceId ?? null,
    linkedSurface: evidence.linkedSurface ?? null,
    reason
  };
}

function normalizeEvent(event, reason) {
  return {
    id: event.id,
    type: event.type,
    summary: event.summary,
    reason
  };
}

function buildLlmContext({
  stageDefinition,
  run,
  project,
  inputs,
  variables,
  observations,
  guidelines,
  policyConstraints,
  sources,
  artifacts,
  evidence,
  events,
  priorSnapshots
}) {
  return {
    stage: stageDefinition.stage,
    stageLabel: stageDefinition.label,
    mission: run.mission,
    project: project ? {
      id: project.id,
      name: project.name
    } : null,
    scenarioType: run.metadata?.type ?? inputs.scenarioType ?? null,
    run: {
      status: run.status,
      lifecycleStage: run.lifecycleStage,
      summary: run.summary,
      plan: run.plan ?? null
    },
    inputs: {
      mission: inputs.mission ?? run.mission,
      scenarioType: inputs.scenarioType ?? run.metadata?.type ?? null,
      allowlistedDomains: inputs.allowlistedDomains ?? project?.allowlistedDomains ?? run.metadata?.allowlistedDomains ?? [],
      recordCount: inputs.records?.length ?? null,
      sourceReferenceCount: inputs.sourceReferences?.length ?? null
    },
    priorSnapshots: priorSnapshots.map((snapshot) => ({
      id: snapshot.id,
      stage: snapshot.stage,
      summary: snapshot.summary
    })),
    variables: Object.values(variables).map((variable) => ({
      key: variable.key,
      value: variable.value,
      reason: variable.reason
    })),
    observations: observations.map((observation) => ({
      id: observation.id,
      label: observation.label,
      severity: observation.severity,
      reason: observation.reason,
      details: observation.details
    })),
    guidelines: guidelines.map((guideline) => ({
      id: guideline.id,
      label: guideline.label,
      instructions: guideline.instructions,
      rationale: guideline.rationale
    })),
    policyConstraints,
    sources,
    artifacts,
    evidence,
    events
  };
}

export class ContextAssembler {
  constructor({
    observationEngine = createDefaultObservationEngine(),
    guidelineEngine = createDefaultGuidelineEngine(),
    relationshipResolver = createDefaultRelationshipResolver(),
    variableResolver = createDefaultVariableResolver()
  } = {}) {
    this.observationEngine = observationEngine;
    this.guidelineEngine = guidelineEngine;
    this.relationshipResolver = relationshipResolver;
    this.variableResolver = variableResolver;
  }

  assemble({
    stage,
    run,
    project,
    bundle,
    llmStatus,
    pendingApprovals = [],
    inputs = {},
    priorSnapshots = []
  }) {
    const stageDefinition = getStageDefinition(stage);
    const selectedSources = selectRankedItems(bundle.sources ?? [], stageDefinition.include.sources, (source) => rankSource(source, inputs));
    const selectedArtifacts = selectRankedItems(bundle.artifacts ?? [], stageDefinition.include.artifacts, (artifact) => rankArtifact(artifact, stage));
    const selectedEvidence = selectRankedItems(bundle.evidence ?? [], stageDefinition.include.evidence, (evidence) => rankEvidence(evidence, inputs));
    const selectedEvents = selectRankedItems(bundle.events ?? [], stageDefinition.include.events, rankEvent);

    const variables = this.variableResolver.resolve({
      stage,
      run,
      project,
      bundle,
      llmStatus,
      pendingApprovals,
      inputs,
      selectedSources: selectedSources.included,
      selectedArtifacts: selectedArtifacts.included,
      selectedEvidence: selectedEvidence.included
    });

    const observations = this.observationEngine.evaluate({
      stage,
      run,
      project,
      bundle,
      llmStatus,
      pendingApprovals,
      inputs,
      variables,
      selectedSources: selectedSources.included,
      selectedArtifacts: selectedArtifacts.included,
      selectedEvidence: selectedEvidence.included
    });

    const guidelineCandidates = this.guidelineEngine.evaluate({
      stage,
      observations,
      variables,
      inputs
    });
    const resolvedGuidelines = this.relationshipResolver.resolve(guidelineCandidates);

    const sources = selectedSources.included.map((source) => normalizeSource(source, "Selected as one of the most relevant sources for this stage."));
    const artifacts = selectedArtifacts.included.map((artifact) => normalizeArtifact(artifact, "Selected as one of the most relevant artifacts for this stage."));
    const evidence = selectedEvidence.included.map((entry) => normalizeEvidence(entry, "Selected as one of the most relevant evidence items for this stage."));
    const events = selectedEvents.included.map((event) => normalizeEvent(event, "Selected as one of the most relevant recent events for this stage."));
    const policyConstraints = stageDefinition.policyConstraints;

    const snapshot = createReasoningSnapshot({
      runId: run.id,
      projectId: run.projectId,
      stage,
      summary: stageDefinition.summaryTemplate,
      llmContext: buildLlmContext({
        stageDefinition,
        run,
        project,
        inputs,
        variables,
        observations,
        guidelines: resolvedGuidelines.guidelines,
        policyConstraints,
        sources,
        artifacts,
        evidence,
        events,
        priorSnapshots
      }),
      variables: Object.values(variables),
      observations,
      guidelines: resolvedGuidelines.guidelines,
      relationshipEffects: resolvedGuidelines.effects,
      policyConstraints,
      sources,
      artifacts,
      evidence,
      events,
      exclusions: {
        sources: selectedSources.excluded,
        artifacts: selectedArtifacts.excluded,
        evidence: selectedEvidence.excluded,
        events: selectedEvents.excluded
      },
      injectionReasons: [],
      metadata: {
        stageLabel: stageDefinition.label,
        priorSnapshotIds: priorSnapshots.map((entry) => entry.id),
        sourceIdsUsed: sources.map((source) => source.id),
        artifactIdsUsed: artifacts.map((artifact) => artifact.id),
        evidenceIdsUsed: evidence.map((entry) => entry.id),
        policyConstraintIds: policyConstraints.map((constraint) => constraint.id)
      }
    });

    snapshot.injectionReasons = buildInjectionReasons(snapshot);
    snapshot.preview = buildSnapshotPreview(snapshot);
    return snapshot;
  }
}

export function createDefaultContextAssembler() {
  return new ContextAssembler();
}
