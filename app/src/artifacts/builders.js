import { ARTIFACT_TYPE } from "../config.js";

function safeText(value, fallback = "n/a") {
  if (value == null || value === "") {
    return fallback;
  }
  return String(value).replace(/\r?\n/g, " ").trim();
}

export function buildCollectionTable({ mission, runId, validationState = "draft", records }) {
  const header = [
    "| Source | Source ref | Fact | Confidence | Note | Evidence |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  const rows = records.map((record) => {
    const evidence = record.evidenceReference
      ?? record.evidenceLabel
      ?? record.evidenceId
      ?? "n/a";
    return [
      "|",
      safeText(record.sourceTitle),
      "|",
      safeText(record.sourceReference ?? record.sourceId),
      "|",
      safeText(record.fact),
      "|",
      safeText(record.confidence),
      "|",
      safeText(record.note),
      "|",
      safeText(evidence),
      "|"
    ].join(" ");
  });
  return {
    artifactType: ARTIFACT_TYPE.COLLECTION_TABLE,
    title: "Tableau de collecte navigateur",
    content: [
      "# Tableau de collecte navigateur",
      "",
      `- Run id: ${safeText(runId)}`,
      `- Mission: ${safeText(mission)}`,
      `- Validation status: ${safeText(validationState)}`,
      "",
      ...header,
      ...rows
    ].join("\n")
  };
}

function summarizeRecommendation(records) {
  const scoreWeights = {
    High: 1,
    Medium: 2,
    Low: 3,
    Fast: 3,
    Slow: 1
  };

  const scored = [];
  for (const record of records) {
    const grouped = scored.find((item) => item.sourceTitle === record.sourceTitle);
    if (!grouped) {
      scored.push({
        sourceTitle: record.sourceTitle,
        points: scoreWeights[record.priceLevel] ?? 0,
        speedPoints: scoreWeights[record.deliverySpeed] ?? 0,
        risk: record.riskNote,
        tagline: record.tagline
      });
      continue;
    }
  }

  const chosen = [...scored].sort((left, right) => {
    const leftTotal = left.points + left.speedPoints;
    const rightTotal = right.points + right.speedPoints;
    return rightTotal - leftTotal;
  })[0];

  if (!chosen) {
    return {
      recommendation: "Insufficient evidence to produce a decision.",
      uncertainties: ["No scored candidate was available from collected records."]
    };
  }

  return {
    recommendation: `${chosen.sourceTitle} is the best fit on the current controlled comparison because it balances delivery speed and price better than the alternatives reviewed.`,
    uncertainties: [chosen.risk]
  };
}

export function buildDecisionNote({
  mission,
  runId,
  records,
  sourceReferences,
  collectionArtifactId,
  draft = null,
  validationState = "draft",
  overallConfidence = "medium",
  evaluationSupport = null,
  ambiguityNote = null
}) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.sourceTitle)) {
      grouped.set(record.sourceTitle, []);
    }
    grouped.get(record.sourceTitle).push(record);
  }

  const deterministicFindings = Array.from(grouped.entries()).map(([sourceTitle, items]) => {
    const first = items[0];
    return `- ${sourceTitle}: ${first.tagline}; price level ${first.priceLevel}; delivery speed ${first.deliverySpeed}; risk note: ${first.riskNote}; source ref: ${safeText(first.sourceReference ?? first.sourceId)}; evidence: ${safeText(first.evidenceReference ?? first.evidenceId)}`;
  });

  const { recommendation, uncertainties } = summarizeRecommendation(records);
  const keyFindings = Array.isArray(draft?.keyFindings) && draft.keyFindings.length > 0
    ? draft.keyFindings.map((finding) => `- ${safeText(finding)}`)
    : deterministicFindings;
  const finalRecommendation = draft?.recommendation ? safeText(draft.recommendation) : recommendation;
  const finalUncertainties = Array.isArray(draft?.uncertainties) && draft.uncertainties.length > 0
    ? draft.uncertainties.map((uncertainty) => safeText(uncertainty))
    : uncertainties;
  const qualityVerdict = evaluationSupport?.qualityVerdict ? safeText(evaluationSupport.qualityVerdict) : null;
  const riskFlags = Array.isArray(evaluationSupport?.riskFlags)
    ? evaluationSupport.riskFlags.map((item) => safeText(item))
    : [];
  const missingProof = Array.isArray(evaluationSupport?.missingProof)
    ? evaluationSupport.missingProof.map((item) => safeText(item))
    : [];
  const ambiguityLines = Array.isArray(ambiguityNote?.uncertaintyPoints)
    ? ambiguityNote.uncertaintyPoints.map((item) => safeText(item))
    : [];

  const sourceLines = sourceReferences.map((source) => `- ${source.title} [${source.id}]: ${source.canonicalRef}`);

  return {
    artifactType: ARTIFACT_TYPE.DECISION_NOTE,
    title: "Note de decision",
    content: [
      "# Objective",
      mission,
      "",
      "# Key findings",
      ...keyFindings,
      "",
      "# Recommendation",
      finalRecommendation,
      "",
      "# Uncertainties and limits",
      ...finalUncertainties.map((uncertainty) => `- ${uncertainty}`),
      "",
      "# Confidence",
      overallConfidence,
      "",
      "# Validation status",
      validationState,
      "",
      "# Traceability",
      `- Run id: ${safeText(runId)}`,
      `- Intermediate artifact: ${safeText(collectionArtifactId)}`,
      ...(qualityVerdict ? [
        "",
        "# Evaluation support",
        `- Quality verdict: ${qualityVerdict}`,
        `- Missing proof: ${missingProof.length > 0 ? missingProof.join("; ") : "none"}`,
        `- Risk flags: ${riskFlags.length > 0 ? riskFlags.join("; ") : "none"}`
      ] : []),
      ...(ambiguityNote?.ambiguityNote ? [
        "",
        "# Ambiguity note",
        safeText(ambiguityNote.ambiguityNote),
        ...ambiguityLines.map((line) => `- ${line}`)
      ] : []),
      "",
      "# Sources consulted",
      ...sourceLines
    ].join("\n")
  };
}
