function collectMissingProof(records = []) {
  const missing = [];
  if (!records.length) {
    missing.push("No comparison records were available for evaluation.");
    return missing;
  }
  const missingEvidence = records.filter((record) => !record.evidenceId);
  if (missingEvidence.length > 0) {
    missing.push(`${missingEvidence.length} record(s) are missing direct evidence references.`);
  }
  return missing;
}

function collectRiskFlags({ records = [], variables = {}, observations = [] }) {
  const riskFlags = [];
  if ((variables.active_risk_posture?.value ?? "medium") === "high") {
    riskFlags.push("Active risk posture is high.");
  }
  if (observations.some((observation) => observation.id === "obs.sources.disagreement_detected")) {
    riskFlags.push("Sources disagree on at least one tracked dimension.");
  }
  if (observations.some((observation) => observation.id === "obs.evidence.confidence_low")) {
    riskFlags.push("Evidence confidence is low.");
  }
  if (records.length === 0) {
    riskFlags.push("No structured records were available.");
  }
  return riskFlags;
}

export function buildDeterministicEvaluationOutput({ draft, records = [], snapshot }) {
  const missingProof = collectMissingProof(records);
  const riskFlags = collectRiskFlags({
    records,
    variables: Object.fromEntries(snapshot.variables.map((variable) => [variable.key, variable])),
    observations: snapshot.observations
  });
  const ambiguityDetected = snapshot.observations.some((observation) => observation.id === "obs.sources.disagreement_detected")
    || snapshot.observations.some((observation) => observation.id === "obs.browser.dom_ambiguity_detected");

  return {
    qualityVerdict: missingProof.length > 0 || riskFlags.length > 0 ? "needs_revision" : "acceptable_for_operator_review",
    riskFlags,
    missingProof,
    recommendedValidationState: missingProof.length > 0 ? "needs_review" : (draft?.validationState ?? "draft"),
    ambiguityDetected,
    ambiguitySummary: ambiguityDetected
      ? "The draft contains unresolved ambiguity that should remain visible to the operator."
      : "No additional ambiguity note is required beyond the normal qualification."
  };
}

export function buildDeterministicAmbiguityOutput({ snapshot, records = [] }) {
  const ambiguityDrivers = [];
  if (snapshot.observations.some((observation) => observation.id === "obs.sources.disagreement_detected")) {
    ambiguityDrivers.push("Collected sources disagree on key comparison dimensions.");
  }
  if (snapshot.observations.some((observation) => observation.id === "obs.browser.dom_ambiguity_detected")) {
    ambiguityDrivers.push("The browser surface reported DOM ambiguity.");
  }
  if ((records?.length ?? 0) === 0) {
    ambiguityDrivers.push("No structured records were available.");
  }

  return {
    ambiguityNote: ambiguityDrivers.length > 0
      ? ambiguityDrivers.join(" ")
      : "No material ambiguity beyond the existing qualification was detected.",
    uncertaintyPoints: ambiguityDrivers
  };
}
