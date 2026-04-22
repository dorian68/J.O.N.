import assert from "node:assert/strict";
import { buildCollectionTable, buildDecisionNote } from "../src/artifacts/builders.js";

export async function run() {
  const collection = buildCollectionTable({
    mission: "Compare controlled pages",
    runId: "run_test",
    validationState: "draft",
    records: [
      {
        sourceId: "src_alpha",
        sourceTitle: "Alpha Analytics",
        sourceReference: "http://fixture/company-alpha.html",
        fact: "Fast delivery",
        confidence: "medium",
        note: "Controlled fixture",
        evidenceId: "ev_alpha",
        evidenceReference: "Alpha evidence (ev_alpha) :: alpha.json"
      }
    ]
  });

  assert.equal(collection.content.includes("Source ref"), true);
  assert.equal(collection.content.includes("Validation status: draft"), true);
  assert.equal(collection.content.includes("http://fixture/company-alpha.html"), true);
  assert.equal(collection.content.includes("Alpha evidence (ev_alpha)"), true);

  const decision = buildDecisionNote({
    mission: "Compare controlled pages",
    runId: "run_test",
    collectionArtifactId: "art_collection",
    validationState: "draft",
    overallConfidence: "medium",
    records: [
      {
        sourceTitle: "Alpha Analytics",
        sourceId: "src_alpha",
        sourceReference: "http://fixture/company-alpha.html",
        tagline: "Fast delivery",
        priceLevel: "Medium",
        deliverySpeed: "Fast",
        riskNote: "Limited support",
        evidenceId: "ev_alpha",
        evidenceReference: "Alpha evidence (ev_alpha) :: alpha.json"
      }
    ],
    sourceReferences: [
      {
        id: "src_alpha",
        title: "Alpha Analytics",
        canonicalRef: "http://fixture/company-alpha.html"
      }
    ]
  });

  assert.equal(decision.content.includes("# Confidence"), true);
  assert.equal(decision.content.includes("# Validation status"), true);
  assert.equal(decision.content.includes("draft"), true);
  assert.equal(decision.content.includes("Run id: run_test"), true);
  assert.equal(decision.content.includes("Intermediate artifact: art_collection"), true);
  assert.equal(decision.content.includes("Alpha Analytics [src_alpha]"), true);
}
