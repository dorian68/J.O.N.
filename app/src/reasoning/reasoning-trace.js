function summarizeItems(items = [], label) {
  if (items.length === 0) {
    return [`No ${label} included.`];
  }
  return items.map((item) => `${label} ${item.id} included: ${item.reason}`);
}

export function buildInjectionReasons(snapshot) {
  return [
    ...summarizeItems(snapshot.sources, "source"),
    ...summarizeItems(snapshot.artifacts, "artifact"),
    ...summarizeItems(snapshot.evidence, "evidence"),
    ...snapshot.observations.map((observation) => `Observation ${observation.id} matched: ${observation.reason}`),
    ...snapshot.guidelines.map((guideline) => `Guideline ${guideline.id} active: ${guideline.rationale}`),
    ...snapshot.relationshipEffects.map((effect) => `Relationship ${effect.type}: ${effect.reason}`)
  ];
}

export function buildInjectionReasonSummary(snapshot) {
  return {
    observationCount: snapshot.observations.length,
    guidelineCount: snapshot.guidelines.length,
    sourceCount: snapshot.sources.length,
    artifactCount: snapshot.artifacts.length,
    evidenceCount: snapshot.evidence.length,
    relationshipEffectCount: snapshot.relationshipEffects.length,
    excludedSourceCount: snapshot.exclusions.sources.length,
    excludedArtifactCount: snapshot.exclusions.artifacts.length,
    excludedEvidenceCount: snapshot.exclusions.evidence.length
  };
}

export function buildSnapshotPreview(snapshot) {
  return {
    id: snapshot.id,
    stage: snapshot.stage,
    summary: snapshot.summary,
    observationIds: snapshot.observations.map((observation) => observation.id),
    guidelineIds: snapshot.guidelines.map((guideline) => guideline.id),
    variableIds: snapshot.variables.map((variable) => variable.id),
    sourceIds: snapshot.sources.map((source) => source.id),
    artifactIds: snapshot.artifacts.map((artifact) => artifact.id),
    evidenceIds: snapshot.evidence.map((entry) => entry.id),
    policyConstraintIds: snapshot.policyConstraints.map((constraint) => constraint.id),
    injectionReasonSummary: buildInjectionReasonSummary(snapshot)
  };
}
