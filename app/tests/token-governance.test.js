import assert from "node:assert/strict";
import {
  prepareRuntimeReasoningPayload,
  selectPreferredModelAlias,
  TokenGovernanceController
} from "../src/llm/token-governance.js";
import { REASONING_STAGE } from "../src/config.js";

function createReasoningSnapshot() {
  return {
    llmContext: {
      stage: REASONING_STAGE.EVALUATION_SUPPORT,
      sources: Array.from({ length: 6 }, (_, index) => ({
        id: `src_${index}`,
        title: `Source ${index}`
      })),
      artifacts: Array.from({ length: 4 }, (_, index) => ({
        id: `art_${index}`,
        title: `Artifact ${index}`
      })),
      evidence: Array.from({ length: 6 }, (_, index) => ({
        id: `ev_${index}`,
        label: `Evidence ${index}`
      })),
      events: Array.from({ length: 10 }, (_, index) => ({
        id: `evt_${index}`,
        type: "run.updated",
        summary: `Event ${index}`
      })),
      observations: Array.from({ length: 8 }, (_, index) => ({
        id: `obs_${index}`,
        label: `Observation ${index}`
      })),
      guidelines: Array.from({ length: 7 }, (_, index) => ({
        id: `gl_${index}`,
        label: `Guideline ${index}`
      })),
      variables: Array.from({ length: 8 }, (_, index) => ({
        id: `var_${index}`,
        key: `variable_${index}`,
        value: `value_${index}`
      })),
      policyConstraints: Array.from({ length: 5 }, (_, index) => ({
        id: `pc_${index}`,
        label: `Constraint ${index}`
      }))
    }
  };
}

export async function run() {
  const rawSnapshot = createReasoningSnapshot();
  const rawRecords = Array.from({ length: 8 }, (_, index) => ({
    sourceId: `src_${index}`,
    sourceTitle: `Source ${index}`,
    fact: `Fact ${index}`,
    confidence: "medium",
    note: `Note ${index}`,
    evidenceId: `ev_${index}`,
    fullExcerpt: "x".repeat(240),
    rawDomSummary: "y".repeat(180)
  }));
  const prepared = prepareRuntimeReasoningPayload({
    reasoningStage: REASONING_STAGE.EVALUATION_SUPPORT,
    reasoningSnapshot: rawSnapshot,
    bindings: {
      reasoningContextJson: JSON.stringify(rawSnapshot.llmContext),
      records: JSON.stringify(rawRecords)
    },
    input: {
      mission: "Token governance smoke",
      records: rawRecords
    }
  });
  assert.equal(selectPreferredModelAlias(REASONING_STAGE.EVALUATION_SUPPORT), "utility_structuring");
  assert.equal(prepared.input.records.length, 4);
  assert.ok(prepared.compaction.applied);
  assert.ok(prepared.compaction.estimatedTokensAfter < prepared.compaction.estimatedTokensBefore);

  const verboseMissionUnderstanding = {
    missionSummary: "Compare the controlled pages, then capture a screenshot of the visible result and explain the next bounded step.".repeat(4),
    clarifiedObjective: "Find the relevant information now, then propose the next bounded step instead of silently widening the run.".repeat(3),
    chosenExecutionFrame: "research",
    routingConfidence: "medium",
    coverageStatus: "partial",
    whyThisFrame: "The mission mixes research and screenshot work, so the current run should stay inside bounded research first.".repeat(4),
    coveredNow: Array.from({ length: 6 }, (_, index) => `Covered now item ${index} `.repeat(12)),
    notCoveredNow: Array.from({ length: 5 }, (_, index) => `Not covered now item ${index} `.repeat(10)),
    verificationGoals: Array.from({ length: 6 }, (_, index) => `Verification goal ${index} `.repeat(12)),
    runNowPlan: Array.from({ length: 7 }, (_, index) => `Run now step ${index} `.repeat(12)),
    nextRunSuggestion: "After the research run, capture visible proof in a separate bounded computer-observation run.".repeat(3),
    unsupportedRequests: Array.from({ length: 5 }, (_, index) => `Unsupported request ${index} `.repeat(10)),
    ambiguityNote: "The request spans more than one bounded lane and should not be executed as a single run.".repeat(3),
    requiresClarification: false,
    clarificationQuestion: ""
  };
  const planPrepared = prepareRuntimeReasoningPayload({
    reasoningStage: REASONING_STAGE.PLAN_GENERATION,
    reasoningSnapshot: rawSnapshot,
    bindings: {
      reasoningContextJson: JSON.stringify(rawSnapshot.llmContext),
      missionUnderstanding: JSON.stringify(verboseMissionUnderstanding)
    },
    input: {
      mission: "Token governance plan compaction smoke",
      missionUnderstanding: verboseMissionUnderstanding
    }
  });
  assert.ok(planPrepared.compaction.applied);
  assert.ok(planPrepared.compaction.reasons.some((reason) => reason.includes("missionUnderstanding compacted")));
  assert.ok(planPrepared.input.missionUnderstanding.runNowPlan.length <= 4);
  assert.ok(planPrepared.input.missionUnderstanding.coveredNow.length <= 3);
  assert.ok(planPrepared.bindings.missionUnderstanding.includes("\"chosenExecutionFrame\":\"research\""));
  assert.ok(planPrepared.compaction.estimatedTokensAfter < planPrepared.compaction.estimatedTokensBefore);

  const controller = new TokenGovernanceController({
    runtimeConfig: {
      budgets: {
        perRunTokens: 20_000,
        perSessionTokens: 20_000,
        perRunUsd: 1,
        perSessionUsd: 1
      }
    }
  });

  const initialDecision = controller.prepareRequest({
    runId: "run_cache",
    callType: "evaluation_support",
    modelAlias: "utility_structuring",
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" }
    ],
    input: prepared.input,
    metadata: {
      reasoningStage: REASONING_STAGE.EVALUATION_SUPPORT
    },
    sessionUsage: {
      totalTokens: 0,
      estimatedCost: 0
    },
    runUsage: {
      totalTokens: 0,
      estimatedCost: 0
    }
  });
  assert.equal(initialDecision.action, "call");

  controller.recordSuccess({
    runId: "run_cache",
    callRecord: {
      callType: "evaluation_support",
      tokenUsage: {
        totalTokens: 150
      },
      estimatedCost: 0.01,
      metadata: {
        reasoningStage: REASONING_STAGE.EVALUATION_SUPPORT,
        tokenGovernance: {
          requestFingerprint: initialDecision.fingerprint,
          cacheEligible: true
        }
      }
    },
    output: {
      qualityVerdict: "sufficient"
    }
  });

  const reusedDecision = controller.prepareRequest({
    runId: "run_cache",
    callType: "evaluation_support",
    modelAlias: "utility_structuring",
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" }
    ],
    input: prepared.input,
    metadata: {
      reasoningStage: REASONING_STAGE.EVALUATION_SUPPORT
    },
    sessionUsage: {
      totalTokens: 150,
      estimatedCost: 0.01
    },
    runUsage: {
      totalTokens: 150,
      estimatedCost: 0.01
    }
  });
  assert.equal(reusedDecision.action, "reuse");
  const controllerStatus = controller.getStatus();
  assert.equal(controllerStatus.stageStats.evaluation_support.totalTokens, 150);
  assert.equal(controllerStatus.stageStats.evaluation_support.estimatedCost, 0.01);

  const conversationBudgetController = new TokenGovernanceController({
    runtimeConfig: {
      budgets: {
        perRunTokens: 50_000,
        perSessionTokens: 100_000,
        perRunUsd: 10,
        perSessionUsd: 20
      }
    }
  });
  const firstConversationDecision = conversationBudgetController.prepareRequest({
    runId: "run_conversation_stage_pressure",
    callType: "conversation_turn",
    modelAlias: "utility_structuring",
    promptRefs: [
      { promptId: "system.visible_conversation", version: "1.0.0" }
    ],
    input: {
      message: "Bonjour"
    },
    metadata: {
      reasoningStage: REASONING_STAGE.CONVERSATION_TURN
    },
    sessionUsage: {
      totalTokens: 0,
      estimatedCost: 0
    },
    runUsage: {
      totalTokens: 0,
      estimatedCost: 0
    }
  });
  conversationBudgetController.recordSuccess({
    runId: "run_conversation_stage_pressure",
    callRecord: {
      callType: "conversation_turn",
      tokenUsage: {
        totalTokens: 19_900
      },
      estimatedCost: 0.001,
      metadata: {
        reasoningStage: REASONING_STAGE.CONVERSATION_TURN,
        tokenGovernance: {
          requestFingerprint: firstConversationDecision.fingerprint,
          cacheEligible: true
        }
      }
    },
    output: {
      reply: "Bonjour."
    }
  });
  const stagePressureConversationDecision = conversationBudgetController.prepareRequest({
    runId: "run_conversation_stage_pressure",
    callType: "conversation_turn",
    modelAlias: "utility_structuring",
    promptRefs: [
      { promptId: "system.visible_conversation", version: "1.0.0" }
    ],
    input: {
      message: "Liste mes applications disponibles."
    },
    metadata: {
      reasoningStage: REASONING_STAGE.CONVERSATION_TURN
    },
    sessionUsage: {
      totalTokens: 19_900,
      estimatedCost: 0.001
    },
    runUsage: {
      totalTokens: 19_900,
      estimatedCost: 0.001
    }
  });
  assert.equal(stagePressureConversationDecision.action, "call");
  assert.equal(stagePressureConversationDecision.skipLiveProvider, false);
  assert.equal(stagePressureConversationDecision.governance.liveProviderBlocked, false);
  assert.ok(stagePressureConversationDecision.governance.budgetPressureReasons.includes("stage_token_budget_would_be_exceeded"));
  assert.equal(stagePressureConversationDecision.governance.blockingBudgetPressureReasons.length, 0);

  const constrainedController = new TokenGovernanceController({
    runtimeConfig: {
      budgets: {
        perRunTokens: 10,
        perSessionTokens: 10,
        perRunUsd: 0.001,
        perSessionUsd: 0.001
      }
    }
  });
  const suppressedDecision = constrainedController.prepareRequest({
    runId: "run_suppressed",
    callType: "evaluation_support",
    modelAlias: "utility_structuring",
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" }
    ],
    input: prepared.input,
    metadata: {
      reasoningStage: REASONING_STAGE.EVALUATION_SUPPORT
    },
    sessionUsage: {
      totalTokens: 9,
      estimatedCost: 0.0009
    },
    runUsage: {
      totalTokens: 9,
      estimatedCost: 0.0009
    }
  });
  assert.equal(suppressedDecision.action, "suppress");

  const missionBudgetDecision = constrainedController.prepareRequest({
    runId: "run_mission_blocked",
    callType: "mission_understanding",
    modelAlias: "utility_structuring",
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" }
    ],
    input: {
      mission: "Need a bounded mission interpretation now.",
      narrative: "x".repeat(4_000)
    },
    metadata: {
      reasoningStage: REASONING_STAGE.MISSION_UNDERSTANDING
    },
    sessionUsage: {
      totalTokens: 9,
      estimatedCost: 0.0009
    },
    runUsage: {
      totalTokens: 9,
      estimatedCost: 0.0009
    }
  });
  assert.equal(missionBudgetDecision.action, "call");
  assert.equal(missionBudgetDecision.skipLiveProvider, true);
  assert.equal(missionBudgetDecision.governance.liveProviderBlocked, true);
  assert.ok(missionBudgetDecision.governance.budgetPressureReasons.length > 0);

  const mandatoryBudgetController = new TokenGovernanceController({
    runtimeConfig: {
      budgets: {
        perRunTokens: 50,
        perSessionTokens: 50,
        perRunUsd: 1,
        perSessionUsd: 1
      }
    }
  });
  const blockedLiveDecision = mandatoryBudgetController.prepareRequest({
    runId: "run_blocked",
    callType: "plan_generation",
    modelAlias: "primary_reasoning",
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" }
    ],
    input: {
      mission: "This request is intentionally large.",
      context: "x".repeat(5000)
    },
    metadata: {
      reasoningStage: REASONING_STAGE.PLAN_GENERATION
    },
    sessionUsage: {
      totalTokens: 0,
      estimatedCost: 0
    },
    runUsage: {
      totalTokens: 0,
      estimatedCost: 0
    }
  });
  assert.equal(blockedLiveDecision.action, "call");
  assert.equal(blockedLiveDecision.skipLiveProvider, true);
  assert.equal(blockedLiveDecision.governance.liveProviderBlocked, true);
  assert.ok(blockedLiveDecision.governance.budgetPressureReasons.length > 0);

  const browserPlanDecision = new TokenGovernanceController({}).prepareRequest({
    runId: "run_browser_plan",
    callType: "browser_plan",
    modelAlias: "primary_reasoning",
    promptRefs: [
      { promptId: "task.browser_plan", version: "1.0.0" }
    ],
    input: {
      mission: "Navigate an allowlisted browser page and capture proof.",
      startUrl: "http://127.0.0.1:41731/index.html"
    },
    metadata: {
      reasoningStage: REASONING_STAGE.BROWSER_PLAN
    },
    sessionUsage: {
      totalTokens: 0,
      estimatedCost: 0
    },
    runUsage: {
      totalTokens: 0,
      estimatedCost: 0
    }
  });
  assert.equal(browserPlanDecision.action, "call");
  assert.equal(browserPlanDecision.governance.stage, REASONING_STAGE.BROWSER_PLAN);
}
