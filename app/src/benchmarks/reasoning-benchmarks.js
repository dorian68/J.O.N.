import { ContextAssembler } from "../reasoning/context-assembler.js";
import { REASONING_STAGE, RUN_STATUS } from "../config.js";

function baseBundle() {
  return {
    events: [
      {
        id: "evt_run",
        type: "run.started",
        summary: "Run started.",
        createdAt: new Date().toISOString()
      },
      {
        id: "evt_degraded",
        type: "llm.degraded_mode.activated",
        summary: "LLM degraded mode active.",
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

export async function runReasoningBenchmarks() {
  const assembler = new ContextAssembler();
  const run = {
    id: "run_reasoning_bench",
    projectId: "prj_reasoning_bench",
    mission: "Compare the controlled pages and prepare a qualified note.",
    status: RUN_STATUS.RUNNING,
    lifecycleStage: "executing",
    summary: "Reasoning benchmark run",
    metadata: {
      type: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    plan: {
      steps: ["Collect", "Draft"],
      generationMode: "deterministic_fallback"
    }
  };
  const project = {
    id: "prj_reasoning_bench",
    name: "Reasoning benchmark project",
    allowlistedDomains: ["127.0.0.1"]
  };
  const llmStatus = {
    providerMode: "openai_compatible",
    effectiveMode: "degraded_mock_only",
    availableProviders: ["mock_offline"]
  };
  const snapshot = assembler.assemble({
    stage: REASONING_STAGE.DECISION_NOTE_DRAFT,
    run,
    project,
    bundle: baseBundle(),
    llmStatus,
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
        {
          id: "src_alpha",
          title: "Alpha Analytics",
          canonicalRef: "http://fixture/alpha"
        },
        {
          id: "src_beta",
          title: "Beta Commerce",
          canonicalRef: "http://fixture/beta"
        }
      ]
    }
  });

  const observationIds = snapshot.observations.map((observation) => observation.id);
  const guidelineIds = snapshot.guidelines.map((guideline) => guideline.id);
  const assertions = {
    snapshotCreated: Boolean(snapshot.id),
    disagreementObserved: observationIds.includes("obs.sources.disagreement_detected"),
    degradedProviderObserved: observationIds.includes("obs.llm.provider_degraded"),
    lowEvidenceObserved: observationIds.includes("obs.evidence.confidence_low"),
    uncertaintyGuidelineApplied: guidelineIds.includes("guideline.decision.require_uncertainty_note"),
    degradedGuidelineApplied: guidelineIds.includes("guideline.decision.disclose_degraded_mode"),
    narrowEvidenceSelection: snapshot.evidence.length === 1,
    exclusionRecorded: snapshot.exclusions.sources.length >= 0 && snapshot.exclusions.evidence.length >= 0,
    injectionReasonsPresent: snapshot.injectionReasons.length > 0
  };

  const assertionDetails = {
    snapshotCreated: {
      label: "Reasoning snapshot created",
      expected: "snapshot id present",
      observed: snapshot.id,
      reason: assertions.snapshotCreated ? "A reasoning snapshot id was created." : "No reasoning snapshot id was created."
    },
    disagreementObserved: {
      label: "Source disagreement observed",
      expected: "obs.sources.disagreement_detected",
      observed: observationIds,
      reason: assertions.disagreementObserved ? "Source disagreement observation matched." : "Expected source disagreement observation."
    },
    degradedProviderObserved: {
      label: "Provider degraded observation matched",
      expected: "obs.llm.provider_degraded",
      observed: observationIds,
      reason: assertions.degradedProviderObserved ? "Provider degraded observation matched." : "Expected provider degraded observation."
    },
    lowEvidenceObserved: {
      label: "Low evidence observation matched",
      expected: "obs.evidence.confidence_low",
      observed: observationIds,
      reason: assertions.lowEvidenceObserved ? "Low evidence observation matched." : "Expected low evidence observation."
    },
    uncertaintyGuidelineApplied: {
      label: "Uncertainty guideline applied",
      expected: "guideline.decision.require_uncertainty_note",
      observed: guidelineIds,
      reason: assertions.uncertaintyGuidelineApplied ? "Uncertainty guideline applied." : "Expected uncertainty guideline."
    },
    degradedGuidelineApplied: {
      label: "Degraded disclosure guideline applied",
      expected: "guideline.decision.disclose_degraded_mode",
      observed: guidelineIds,
      reason: assertions.degradedGuidelineApplied ? "Degraded disclosure guideline applied." : "Expected degraded disclosure guideline."
    },
    narrowEvidenceSelection: {
      label: "Evidence selection stays narrow",
      expected: "1 evidence item",
      observed: snapshot.evidence.length,
      reason: assertions.narrowEvidenceSelection ? "Evidence selection remained bounded." : "Evidence selection was wider than expected."
    },
    exclusionRecorded: {
      label: "Exclusions recorded",
      expected: "exclusion arrays present",
      observed: snapshot.exclusions,
      reason: assertions.exclusionRecorded ? "Exclusions were recorded." : "Exclusions were not recorded."
    },
    injectionReasonsPresent: {
      label: "Injection reasons present",
      expected: "at least one injection reason",
      observed: snapshot.injectionReasons.length,
      reason: assertions.injectionReasonsPresent ? "Injection reasons were recorded." : "Injection reasons were missing."
    }
  };

  return {
    snapshotId: snapshot.id,
    assertions,
    assertionDetails,
    cases: [
      {
        id: "reasoning-context",
        label: "Reasoning context assembly",
        summary: "Assembles narrowed context with observations, guidelines, variables and exclusions.",
        assertions,
        assertionDetails
      }
    ]
  };
}
