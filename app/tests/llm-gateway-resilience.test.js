import assert from "node:assert/strict";
import { PromptRegistry } from "../src/llm/prompt-registry.js";
import { InternalLlmGateway } from "../src/llm/gateway.js";
import { MockOfflineProvider } from "../src/llm/providers/mock-offline-provider.js";
import { LLM_CALL_TYPE, LLM_PROVIDER_ALIAS } from "../src/config.js";

class ScriptedProvider {
  constructor(script = []) {
    this.script = [...script];
    this.calls = [];
    this.providerAlias = LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE;
  }

  isEnabled() {
    return true;
  }

  resolveModel(modelAlias) {
    return `scripted/${modelAlias}`;
  }

  async generateStructured(request = {}) {
    this.calls.push(request);
    const next = this.script.shift();
    if (!next) {
      throw Object.assign(new Error("Script exhausted."), {
        category: "provider_unavailable"
      });
    }
    if (next.type === "throw") {
      throw Object.assign(new Error(next.message), {
        category: next.category,
        retryAfterMs: next.retryAfterMs ?? null
      });
    }
    return next.response;
  }
}

async function createGateway({ liveScript, providerOrder = ["openai_compatible", "mock_offline"], budgets, productionStrict = false } = {}) {
  const promptRegistry = await new PromptRegistry().load();
  const liveProvider = new ScriptedProvider(liveScript);
  return new InternalLlmGateway({
    promptRegistry,
    providers: new Map([
      [LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE, liveProvider],
      [LLM_PROVIDER_ALIAS.MOCK_OFFLINE, new MockOfflineProvider()]
    ]),
    providerMode: "openai_compatible",
    providerOrder,
    runtimeConfig: {
      retryPolicy: {
        maxAttemptsPerProvider: 2,
        backoffMs: 0
      },
      productionStrict,
      budgets: budgets ?? {
        perRunTokens: 12_000,
        perSessionTokens: 50_000,
        perRunUsd: 0.5,
        perSessionUsd: 2
      },
      circuitBreaker: {
        failureThreshold: 1,
        cooldownMs: 10_000,
        rateLimitCooldownMs: 10_000
      }
    },
    publicConfigStatus: {
      providerMode: "openai_compatible",
      configIssues: [],
      budgets: budgets ?? {
        perRunTokens: 12_000,
        perSessionTokens: 50_000,
        perRunUsd: 0.5,
        perSessionUsd: 2
      },
      providers: {},
      deterministicFallback: true,
      allowMockFallback: true,
      productionStrict
    }
  });
}

function validateOutput(output) {
  return output;
}

function promptRefs(mission = "Test mission") {
  return [
    { promptId: "system.primary_reasoning", version: "1.0.0" },
    { promptId: "task.plan_generation", version: "1.0.0", bindings: { mission, scenarioType: "research", allowlistedDomains: '["127.0.0.1"]' } }
  ];
}

export async function run() {
  const retryGateway = await createGateway({
    liveScript: [
      {
        type: "throw",
        category: "timeout",
        message: "first timeout"
      },
      {
        type: "return",
        response: {
          output: {
            steps: ["live plan step"],
            assumptions: ["live assumption"]
          },
          providerModel: "scripted/primary_reasoning",
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          estimatedCost: 0.01
        }
      }
    ]
  });
  const retryResult = await retryGateway.generateStructured({
    runId: "run_retry",
    projectId: "prj_retry",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs(),
    input: { mission: "Test mission" },
    validateOutput
  });
  assert.equal(retryResult.callRecord.providerAlias, "openai_compatible");
  assert.equal(retryResult.callRecord.retryCount, 1);
  assert.equal(retryResult.callRecord.fallbackChain.length, 1);

  const repairGateway = await createGateway({
    liveScript: [
      {
        type: "return",
        response: {
          output: {
            coveredNow: "not the expected shape"
          },
          providerModel: "scripted/primary_reasoning",
          tokenUsage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
          estimatedCost: 0.001
        }
      },
      {
        type: "return",
        response: {
          output: {
            steps: ["repaired live plan step"],
            assumptions: ["repaired assumption"]
          },
          providerModel: "scripted/primary_reasoning",
          tokenUsage: { inputTokens: 30, outputTokens: 25, totalTokens: 55 },
          estimatedCost: 0.002
        }
      }
    ]
  });
  const repairResult = await repairGateway.generateStructured({
    runId: "run_repair",
    projectId: "prj_repair",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs("Repair output mission"),
    input: { mission: "Repair output mission" },
    validateOutput: (output) => {
      if ("coveredNow" in output) {
        throw new Error("coveredNow must be an array.");
      }
      return output;
    }
  });
  assert.equal(repairResult.callRecord.providerAlias, "openai_compatible");
  assert.equal(repairResult.callRecord.retryCount, 1);
  assert.equal(repairResult.callRecord.metadata.schemaRepairAttempted, true);
  assert.ok(repairResult.callRecord.fallbackChain.some((entry) => entry.errorCategory === "malformed_output" && entry.repairRetry === true));
  const repairProviderCalls = repairGateway.providers.get(LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE).calls;
  assert.equal(repairProviderCalls.length, 2);
  assert.ok(repairProviderCalls[1].extraMessages.some((message) => message.content.includes("coveredNow must be an array.")));

  const transientGateway = await createGateway({
    liveScript: [
      {
        type: "throw",
        category: "timeout",
        message: "first timeout",
        retryAfterMs: 0
      },
      {
        type: "throw",
        category: "timeout",
        message: "second timeout",
        retryAfterMs: 0
      }
    ]
  });
  const degradedResult = await transientGateway.generateStructured({
    runId: "run_degraded",
    projectId: "prj_degraded",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs(),
    input: { mission: "Test mission" },
    validateOutput
  });
  assert.equal(degradedResult.callRecord.providerAlias, "mock_offline");
  assert.equal(degradedResult.callRecord.metadata.degradedModeUsed, true);
  assert.ok(degradedResult.callRecord.fallbackChain.some((entry) => entry.errorCategory === "timeout"));

  const secondDegraded = await transientGateway.generateStructured({
    runId: "run_degraded_again",
    projectId: "prj_degraded",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs(),
    input: { mission: "Test mission" },
    validateOutput
  });
  assert.equal(secondDegraded.callRecord.providerAlias, "mock_offline");
  assert.ok(secondDegraded.callRecord.fallbackChain.some((entry) => entry.errorCategory === "circuit_open"));

  const strictGateway = await createGateway({
    productionStrict: true,
    liveScript: [
      {
        type: "throw",
        category: "rate_limit",
        message: "rate limited",
        retryAfterMs: 0
      },
      {
        type: "throw",
        category: "rate_limit",
        message: "rate limited again",
        retryAfterMs: 0
      }
    ]
  });
  let strictError = null;
  try {
    await strictGateway.generateStructured({
      runId: "run_strict",
      projectId: "prj_strict",
      callType: LLM_CALL_TYPE.PLAN_GENERATION,
      promptRefs: promptRefs("Strict mission"),
      input: { mission: "Strict mission" },
      validateOutput
    });
  } catch (error) {
    strictError = error;
  }
  assert.ok(strictError, "Production strict mode should fail closed instead of using mock fallback.");
  assert.equal(strictError.category, "rate_limit");
  assert.ok(strictError.callRecord.fallbackChain.some((entry) => entry.errorCategory === "mock_forbidden"));

  const malformedGateway = await createGateway({
    liveScript: [
      {
        type: "return",
        response: {
          output: {
            coveredNow: "not the expected shape"
          },
          providerModel: "scripted/primary_reasoning",
          tokenUsage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
          estimatedCost: 0.001
        }
      }
    ]
  });
  const malformedFallback = await malformedGateway.generateStructured({
    runId: "run_malformed",
    projectId: "prj_malformed",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs("Malformed output mission"),
    input: { mission: "Malformed output mission" },
    validateOutput: (output) => {
      if ("coveredNow" in output) {
        throw new Error("coveredNow must be an array.");
      }
      return output;
    }
  });
  assert.equal(malformedFallback.callRecord.providerAlias, "mock_offline");
  assert.ok(malformedFallback.callRecord.fallbackChain.some((entry) => entry.errorCategory === "malformed_output"));

  const budgetGateway = await createGateway({
    liveScript: [
      {
        type: "return",
        response: {
          output: {
            steps: ["budgeted live step"],
            assumptions: []
          },
          providerModel: "scripted/primary_reasoning",
          tokenUsage: { inputTokens: 200, outputTokens: 200, totalTokens: 400 },
          estimatedCost: 0.05
        }
      }
    ],
    budgets: {
      perRunTokens: 10,
      perSessionTokens: 10,
      perRunUsd: 0.001,
      perSessionUsd: 0.001
    }
  });
  const budgetDegraded = await budgetGateway.generateStructured({
    runId: "run_budget",
    projectId: "prj_budget",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs("Test mission first"),
    input: { mission: "Test mission" },
    validateOutput
  });
  assert.equal(budgetDegraded.callRecord.providerAlias, "mock_offline");
  assert.equal(budgetDegraded.callRecord.metadata?.tokenGovernance?.liveProviderBlocked, true);
  assert.ok(budgetDegraded.callRecord.fallbackChain.some((entry) => entry.errorCategory === "budget_exhausted"));

  const budgetSkipped = await budgetGateway.generateStructured({
    runId: "run_budget",
    projectId: "prj_budget",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefs("Test mission second"),
    input: { mission: "Test mission second" },
    validateOutput
  });
  assert.equal(budgetSkipped.callRecord.providerAlias, "mock_offline");
  assert.ok(budgetSkipped.callRecord.fallbackChain.some((entry) => entry.errorCategory === "budget_exhausted"));
}
