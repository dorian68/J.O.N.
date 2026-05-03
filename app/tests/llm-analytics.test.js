import assert from "node:assert/strict";
import { summarizeLlmCalls } from "../src/service/llm-analytics.js";

export async function run() {
  const runs = [
    {
      id: "run_1",
      mission: "Mission one",
      status: "completed",
      createdAt: "2026-04-19T10:00:00.000Z",
      metadata: {
        missionSpec: {
          objective: "Mission one objective"
        }
      }
    },
    {
      id: "run_2",
      mission: "Mission two",
      status: "completed",
      createdAt: "2026-04-19T11:00:00.000Z",
      metadata: {}
    }
  ];

  const calls = [
    {
      id: "llm_1",
      runId: "run_1",
      callType: "mission_understanding",
      providerAlias: "openai_compatible",
      resultStatus: "success",
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      },
      estimatedCost: 0.0021,
      metadata: {
        reasoningStage: "mission_understanding",
        tokenGovernance: {
          executionMode: "provider_call"
        }
      }
    },
    {
      id: "llm_2",
      runId: "run_1",
      callType: "decision_note_draft",
      providerAlias: "mock_offline",
      resultStatus: "success",
      tokenUsage: null,
      estimatedCost: null,
      metadata: {
        reasoningStage: "decision_note_draft",
        fallbackUsed: true,
        degradedModeUsed: true,
        inputCompaction: {
          applied: true
        },
        tokenGovernance: {
          executionMode: "provider_call",
          estimatedInputTokens: 200,
          estimatedTotalTokens: 320,
          estimatedRequestUsd: 0.0045,
          downgraded: true,
          liveProviderBlocked: true
        }
      }
    },
    {
      id: "llm_3",
      runId: "run_2",
      callType: "evaluation_support",
      providerAlias: "deterministic_fallback",
      resultStatus: "success",
      tokenUsage: {
        inputTokens: 60,
        outputTokens: 20,
        totalTokens: 80
      },
      estimatedCost: 0,
      metadata: {
        reasoningStage: "evaluation_support",
        tokenGovernance: {
          executionMode: "reused"
        }
      }
    },
    {
      id: "llm_4",
      runId: "run_2",
      callType: "ambiguity_note",
      providerAlias: "governance",
      resultStatus: "failed",
      tokenUsage: null,
      estimatedCost: 0,
      metadata: {
        reasoningStage: "ambiguity_note",
        tokenGovernance: {
          executionMode: "suppressed"
        }
      }
    }
  ];

  const summary = summarizeLlmCalls(calls, runs);

  assert.equal(summary.callCount, 4);
  assert.equal(summary.totalTokens, 550);
  assert.equal(summary.estimatedCost, 0.0066);
  assert.equal(summary.blockedCalls, 1);
  assert.equal(summary.downgradedCalls, 1);
  assert.equal(summary.fallbackCalls, 1);
  assert.equal(summary.degradedCalls, 1);
  assert.equal(summary.reusedCalls, 1);
  assert.equal(summary.suppressedCalls, 1);
  assert.equal(summary.liveCalls, 1);
  assert.equal(summary.mockCalls, 1);
  assert.equal(summary.deterministicCalls, 1);
  assert.equal(summary.suppressedProviderCalls, 1);
  assert.equal(summary.failedProviderCalls, 0);
  assert.deepEqual(summary.providerModeBreakdown, {
    live: 1,
    mock: 1,
    deterministic: 1,
    suppressed: 1,
    failed: 0,
    other: 0
  });
  assert.equal(summary.compactionCalls, 1);
  assert.equal(summary.stageBreakdown.length >= 2, true);
  assert.equal(summary.recentRuns.length, 2);
  assert.equal(summary.recentRuns[0].liveCalls, 1);
  assert.equal(summary.recentRuns[0].mockCalls, 1);
  assert.equal(summary.recentRuns[1].deterministicCalls, 1);
  assert.equal(summary.recentRuns[1].suppressedProviderCalls, 1);
  assert.equal(summary.topCostDrivers[0].estimatedCost >= summary.topCostDrivers.at(-1).estimatedCost, true);
}
