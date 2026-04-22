import assert from "node:assert/strict";
import { ContextAssembler } from "../src/reasoning/context-assembler.js";
import { RelationshipResolver } from "../src/reasoning/relationship-resolver.js";
import { REASONING_STAGE, RUN_STATUS } from "../src/config.js";

function createRun() {
  return {
    id: "run_reasoning",
    projectId: "prj_reasoning",
    mission: "Compare the controlled candidate pages and produce a qualified decision note.",
    status: RUN_STATUS.RUNNING,
    lifecycleStage: "executing",
    summary: "Reasoning test run.",
    metadata: {
      type: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    plan: {
      steps: ["collect", "draft"],
      generationMode: "llm"
    }
  };
}

function createBundle() {
  return {
    events: [
      {
        id: "evt_run",
        type: "run.started",
        summary: "Run started.",
        createdAt: new Date().toISOString()
      }
    ],
    approvals: [],
    sources: [
      {
        id: "src_alpha",
        title: "Alpha Analytics",
        canonicalRef: "http://fixture/alpha",
        trustClassification: "controlled_fixture",
        createdAt: new Date().toISOString()
      },
      {
        id: "src_beta",
        title: "Beta Commerce",
        canonicalRef: "http://fixture/beta",
        trustClassification: "controlled_fixture",
        createdAt: new Date().toISOString()
      }
    ],
    evidence: [
      {
        id: "ev_alpha",
        label: "Alpha evidence",
        evidenceType: "page_screenshot",
        linkedSourceId: "src_alpha",
        linkedSurface: "http://fixture/alpha",
        createdAt: new Date().toISOString()
      }
    ],
    artifacts: [
      {
        id: "art_collection",
        title: "Tableau de collecte navigateur",
        artifactType: "tableau_collecte_navigateur",
        metadata: {
          validationState: "draft"
        },
        createdAt: new Date().toISOString()
      }
    ],
    llmCalls: [],
    reasoningSnapshots: []
  };
}

export async function run() {
  const assembler = new ContextAssembler();
  const run = createRun();
  const project = {
    id: "prj_reasoning",
    name: "Reasoning test project",
    allowlistedDomains: ["127.0.0.1"]
  };
  const snapshot = assembler.assemble({
    stage: REASONING_STAGE.DECISION_NOTE_DRAFT,
    run,
    project,
    bundle: createBundle(),
    llmStatus: {
      providerMode: "openai_compatible",
      effectiveMode: "degraded_mock_only",
      availableProviders: ["mock_offline"]
    },
    pendingApprovals: [],
    inputs: {
      mission: run.mission,
      records: [
        {
          sourceTitle: "Alpha Analytics",
          priceLevel: "Medium",
          deliverySpeed: "Fast",
          riskNote: "Capacity can fluctuate",
          evidenceId: "ev_alpha"
        },
        {
          sourceTitle: "Beta Commerce",
          priceLevel: "Low",
          deliverySpeed: "Slow",
          riskNote: "Requires more follow-up"
        }
      ],
      sourceReferences: [
        { id: "src_alpha", title: "Alpha Analytics", canonicalRef: "http://fixture/alpha" },
        { id: "src_beta", title: "Beta Commerce", canonicalRef: "http://fixture/beta" }
      ]
    }
  });

  assert.equal(snapshot.stage, REASONING_STAGE.DECISION_NOTE_DRAFT);
  assert.ok(snapshot.id);
  assert.ok(snapshot.variables.length >= 5, "Expected multiple resolved variables.");
  assert.ok(snapshot.observations.some((observation) => observation.id === "obs.sources.disagreement_detected"));
  assert.ok(snapshot.observations.some((observation) => observation.id === "obs.evidence.confidence_low"));
  assert.ok(snapshot.guidelines.some((guideline) => guideline.id === "guideline.decision.require_uncertainty_note"));
  assert.ok(snapshot.guidelines.some((guideline) => guideline.id === "guideline.decision.disclose_degraded_mode"));
  assert.equal(snapshot.sources.length <= 5, true);
  assert.equal(snapshot.artifacts.length <= 2, true);
  assert.equal(snapshot.evidence.length <= 5, true);
  assert.ok(snapshot.injectionReasons.length > 0);
  assert.ok(snapshot.preview);
  assert.ok(snapshot.preview.injectionReasonSummary);

  const relationshipResolver = new RelationshipResolver();
  const resolution = relationshipResolver.resolve([
    {
      id: "guideline.low_evidence",
      priority: 90,
      relationships: {
        overrides: ["guideline.strong_action"]
      }
    },
    {
      id: "guideline.strong_action",
      priority: 30,
      relationships: {}
    }
  ]);
  assert.ok(resolution.guidelines.some((guideline) => guideline.id === "guideline.low_evidence"));
  assert.ok(!resolution.guidelines.some((guideline) => guideline.id === "guideline.strong_action"));
  assert.ok(resolution.effects.some((effect) => effect.type === "override_applied"));
}
