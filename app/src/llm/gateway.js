import {
  DEFAULT_LLM_PROVIDER_MODE,
  LLM_PROVIDER_ALIAS,
  LLM_RESULT_STATUS
} from "../config.js";
import { createId, nowIso } from "../utils/ids.js";
import { TokenGovernanceController } from "./token-governance.js";

function estimateSize(value) {
  return JSON.stringify(value ?? null).length;
}

function normalizeErrorCategory(error) {
  return error?.category ?? "provider_unavailable";
}

function sleep(delayMs) {
  if (!delayMs || delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function summarizeBudgetUsage(usage) {
  return {
    totalTokens: usage.totalTokens,
    estimatedCost: usage.estimatedCost,
    callCount: usage.callCount
  };
}

function createUsageState() {
  return {
    totalTokens: 0,
    estimatedCost: 0,
    callCount: 0
  };
}

function effectiveModeFromStatus({ providerMode, availableProviders, configIssues }) {
  if (providerMode === "disabled") {
    return "deterministic_only";
  }
  if (availableProviders.includes(LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE)) {
    return availableProviders.includes(LLM_PROVIDER_ALIAS.MOCK_OFFLINE)
      ? "live_with_mock_fallback"
      : "live_only";
  }
  if (availableProviders.includes(LLM_PROVIDER_ALIAS.MOCK_OFFLINE)) {
    return configIssues.length > 0 ? "degraded_mock_only" : "mock_only";
  }
  return "unavailable";
}

function isTransientCategory(category) {
  return ["timeout", "provider_unavailable", "rate_limit"].includes(category);
}

function shouldTriggerCircuit(category) {
  return ["timeout", "provider_unavailable", "rate_limit"].includes(category);
}

export class LlmGatewayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "LlmGatewayError";
    this.category = options.category ?? "provider_unavailable";
    this.callRecord = options.callRecord ?? null;
  }
}

export class InternalLlmGateway {
  constructor({
    promptRegistry,
    providers,
    providerMode = DEFAULT_LLM_PROVIDER_MODE,
    providerOrder = [],
    runtimeConfig = null,
    publicConfigStatus = null,
    runtimeLogger = null,
    tokenGovernance = new TokenGovernanceController({
      runtimeConfig
    })
  }) {
    this.promptRegistry = promptRegistry;
    this.providers = providers;
    this.providerMode = providerMode;
    this.providerOrder = providerOrder;
    this.runtimeConfig = runtimeConfig;
    this.publicConfigStatus = publicConfigStatus ?? {
      providerMode,
      configIssues: []
    };
    this.runtimeLogger = runtimeLogger;
    this.tokenGovernance = tokenGovernance;
    this.providerStates = new Map();
    this.sessionUsage = createUsageState();
    this.runUsage = new Map();
  }

  getStatus() {
    const availableProviders = this.providerOrder.filter((alias) => this.providers.get(alias)?.isEnabled());
    return {
      providerMode: this.providerMode,
      effectiveMode: effectiveModeFromStatus({
        providerMode: this.providerMode,
        availableProviders,
        configIssues: this.publicConfigStatus.configIssues ?? []
      }),
      providerOrder: this.providerOrder,
      availableProviders,
      promptEnvironment: this.promptRegistry.environment,
      configIssues: this.publicConfigStatus.configIssues ?? [],
      budgets: this.publicConfigStatus.budgets ?? null,
      sessionUsage: summarizeBudgetUsage(this.sessionUsage),
      tokenGovernance: this.tokenGovernance?.getStatus() ?? null,
      providerStates: this.providerOrder.map((alias) => ({
        providerAlias: alias,
        enabled: Boolean(this.providers.get(alias)?.isEnabled()),
        ...(this.#getProviderState(alias))
      })),
      deterministicFallback: this.publicConfigStatus.deterministicFallback ?? false,
      allowMockFallback: this.publicConfigStatus.allowMockFallback ?? false,
      providerDetails: this.publicConfigStatus.providers ?? {}
    };
  }

  async generateStructured({
    runId,
    projectId,
    callType,
    modelAlias,
    promptRefs,
    input,
    validateOutput,
    metadata = {}
  }) {
    const governanceDecision = this.tokenGovernance.prepareRequest({
      runId,
      projectId,
      callType,
      modelAlias,
      promptRefs,
      input,
      metadata,
      sessionUsage: this.sessionUsage,
      runUsage: this.#getRunUsage(runId)
    });
    const selectedModelAlias = governanceDecision.effectiveModelAlias ?? modelAlias;
    const resolvedPromptRefs = this.promptRegistry.resolvePromptRefs(governanceDecision.promptRefs ?? promptRefs);
    const messages = resolvedPromptRefs.flatMap((prompt) => prompt.messages);
    const requestId = createId("llmreq");
    const fallbackChain = [];
    let lastError = null;

    if (metadata.inputCompaction?.estimatedTokensSaved > 0) {
      this.tokenGovernance.noteCompaction(governanceDecision.stage, metadata.inputCompaction.estimatedTokensSaved);
    }

    await this.#log({
      type: "llm.gateway.request",
      requestId,
      runId,
      projectId,
      callType,
      modelAlias: selectedModelAlias,
      providerMode: this.providerMode,
      reasoningStage: metadata.reasoningStage ?? null,
      tokenGovernance: governanceDecision.governance
    });

    if (governanceDecision.action === "reuse") {
      const reusedCallRecord = this.#buildReusedCallRecord({
        runId,
        projectId,
        callType,
        selectedModelAlias,
        resolvedPromptRefs,
        preparedInput: governanceDecision.input ?? input,
        cached: governanceDecision.cached,
        metadata: {
          ...metadata,
          tokenGovernance: {
            ...governanceDecision.governance,
            requestFingerprint: governanceDecision.fingerprint,
            cacheEligible: governanceDecision.policy.cacheEligible,
            reusedFromCallId: governanceDecision.cached.callRecord.id
          }
        },
        requestId
      });
      await this.#log({
        type: "llm.gateway.request.reused",
        requestId,
        runId,
        projectId,
        callType,
        modelAlias: selectedModelAlias,
        reusedFromCallId: governanceDecision.cached.callRecord.id,
        reasoningStage: metadata.reasoningStage ?? null
      });
      return {
        output: governanceDecision.cached.output,
        callRecord: reusedCallRecord
      };
    }

    if (governanceDecision.action === "suppress") {
      const suppressedRecord = this.#buildSuppressedCallRecord({
        runId,
        projectId,
        callType,
        selectedModelAlias,
        resolvedPromptRefs,
        preparedInput: governanceDecision.input ?? input,
        metadata: {
          ...metadata,
          tokenGovernance: {
            ...governanceDecision.governance,
            requestFingerprint: governanceDecision.fingerprint,
            cacheEligible: governanceDecision.policy.cacheEligible
          }
        },
        requestId
      });
      await this.#log({
        type: "llm.gateway.request.suppressed",
        requestId,
        runId,
        projectId,
        callType,
        modelAlias: selectedModelAlias,
        reasoningStage: metadata.reasoningStage ?? null,
        tokenGovernance: governanceDecision.governance
      });
      throw new LlmGatewayError(governanceDecision.governance.reason, {
        category: "stage_suppressed",
        callRecord: suppressedRecord
      });
    }

    const candidates = this.providerOrder
      .map((alias) => ({
        alias,
        provider: this.providers.get(alias)
      }))
      .filter((entry) => entry.provider);

    for (const candidate of candidates) {
      const providerState = this.#getProviderState(candidate.alias);
      const now = Date.now();
      if (candidate.alias === LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE && governanceDecision.skipLiveProvider) {
        fallbackChain.push({
          providerAlias: candidate.alias,
          errorCategory: "budget_exhausted",
          message: governanceDecision.governance.liveProviderBlockReason ?? "Live provider blocked by token governance."
        });
        lastError = Object.assign(new Error(governanceDecision.governance.liveProviderBlockReason ?? "Live provider blocked by token governance."), {
          category: "budget_exhausted"
        });
        this.tokenGovernance.noteLiveProviderBlocked(governanceDecision.stage);
        await this.#log({
          type: "llm.gateway.provider.skipped",
          requestId,
          runId,
          providerAlias: candidate.alias,
          reason: "token_governance_live_block",
          reasoningStage: metadata.reasoningStage ?? null,
          tokenGovernance: governanceDecision.governance
        });
        continue;
      }

      if (!candidate.provider.isEnabled()) {
        fallbackChain.push({
          providerAlias: candidate.alias,
          errorCategory: "provider_unavailable",
          message: "Provider is not enabled."
        });
        continue;
      }

      if (providerState.circuitOpenUntil && providerState.circuitOpenUntil > now) {
        fallbackChain.push({
          providerAlias: candidate.alias,
          errorCategory: "circuit_open",
          message: `Provider circuit open until ${new Date(providerState.circuitOpenUntil).toISOString()}.`
        });
        await this.#log({
          type: "llm.gateway.provider.skipped",
          requestId,
          runId,
          providerAlias: candidate.alias,
          reason: "circuit_open",
          circuitOpenUntil: new Date(providerState.circuitOpenUntil).toISOString()
        });
        continue;
      }

      if (candidate.alias === LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE && this.#isBudgetExceeded(runId)) {
        fallbackChain.push({
          providerAlias: candidate.alias,
          errorCategory: "budget_exhausted",
          message: "Configured LLM budget exhausted before live provider call."
        });
        await this.#log({
          type: "llm.gateway.provider.skipped",
          requestId,
          runId,
          providerAlias: candidate.alias,
          reason: "budget_exhausted",
          sessionUsage: summarizeBudgetUsage(this.sessionUsage),
          runUsage: summarizeBudgetUsage(this.#getRunUsage(runId))
        });
        continue;
      }

      for (let attempt = 1; attempt <= this.runtimeConfig.retryPolicy.maxAttemptsPerProvider; attempt += 1) {
        const startedAt = Date.now();
        try {
          const response = await candidate.provider.generateStructured({
            callType,
            modelAlias: selectedModelAlias,
            messages,
            input: governanceDecision.input ?? input,
            metadata
          });
          const output = validateOutput ? validateOutput(response.output) : response.output;
          const tokenUsage = response.tokenUsage ?? null;
          const estimatedCost = response.estimatedCost ?? null;
          const usageSnapshotBefore = {
            session: summarizeBudgetUsage(this.sessionUsage),
            run: summarizeBudgetUsage(this.#getRunUsage(runId))
          };

          const callRecord = {
            id: createId("llm"),
            runId,
            projectId,
            callType,
            providerAlias: candidate.alias,
            modelAlias: selectedModelAlias,
            providerModel: response.providerModel ?? candidate.provider.resolveModel?.(selectedModelAlias) ?? null,
            promptRefs: resolvedPromptRefs.map((prompt) => ({
              promptId: prompt.promptId,
              version: prompt.version
            })),
            inputSizeEstimate: estimateSize(governanceDecision.input ?? input),
            outputSizeEstimate: estimateSize(output),
            latencyMs: Date.now() - startedAt,
            tokenUsage,
            estimatedCost,
            retryCount: Math.max(0, attempt - 1),
            fallbackChain: [...fallbackChain],
            resultStatus: LLM_RESULT_STATUS.SUCCESS,
            errorCategory: null,
            metadata: {
              ...metadata,
              requestId,
              schemaValidated: Boolean(validateOutput),
              promptEnvironment: this.promptRegistry.environment,
              fallbackUsed: fallbackChain.length > 0,
              degradedModeUsed: candidate.alias !== LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE,
              usageSnapshotBefore,
              providerAttempt: attempt,
              tokenGovernance: {
                ...governanceDecision.governance,
                requestFingerprint: governanceDecision.fingerprint,
                cacheEligible: governanceDecision.policy.cacheEligible,
                estimatedCostCeilingUsd: governanceDecision.policy.stageBudgetUsd
              }
            },
            createdAt: nowIso()
          };

          this.#recordUsage(runId, callRecord);
          this.tokenGovernance.recordSuccess({
            runId,
            callRecord,
            output
          });
          callRecord.metadata.usageSnapshotAfter = {
            session: summarizeBudgetUsage(this.sessionUsage),
            run: summarizeBudgetUsage(this.#getRunUsage(runId))
          };
          this.#resetProviderState(candidate.alias);

          await this.#log({
            type: "llm.gateway.request.succeeded",
            requestId,
            runId,
            projectId,
            callType,
            providerAlias: candidate.alias,
            modelAlias: selectedModelAlias,
            providerModel: callRecord.providerModel,
            latencyMs: callRecord.latencyMs,
            tokenUsage: callRecord.tokenUsage,
            estimatedCost: callRecord.estimatedCost,
            fallbackChain: callRecord.fallbackChain,
            degradedModeUsed: callRecord.metadata.degradedModeUsed
          });
          if (callRecord.metadata.fallbackUsed || callRecord.metadata.degradedModeUsed) {
            await this.#log({
              type: "llm.gateway.degraded_mode",
              requestId,
              runId,
              callType,
              selectedProvider: candidate.alias,
              fallbackChain: callRecord.fallbackChain
            });
          }

          return {
            output,
            callRecord
          };
        } catch (error) {
          lastError = error;
          const category = normalizeErrorCategory(error);
          const failureEntry = {
            providerAlias: candidate.alias,
            attempt,
            errorCategory: category,
            message: error.message,
            retryAfterMs: error.retryAfterMs ?? null
          };
          fallbackChain.push(failureEntry);
          this.#markProviderFailure(candidate.alias, category, error.retryAfterMs ?? null);

          await this.#log({
            type: "llm.gateway.request.failed_attempt",
            requestId,
            runId,
            projectId,
            callType,
            providerAlias: candidate.alias,
            modelAlias: selectedModelAlias,
            attempt,
            errorCategory: category,
            message: error.message,
            retryAfterMs: error.retryAfterMs ?? null
          });

          const shouldRetrySameProvider = isTransientCategory(category) && attempt < this.runtimeConfig.retryPolicy.maxAttemptsPerProvider;
          if (shouldRetrySameProvider) {
            const delayMs = category === "rate_limit"
              ? Math.min(error.retryAfterMs ?? this.runtimeConfig.circuitBreaker.rateLimitCooldownMs, this.runtimeConfig.circuitBreaker.rateLimitCooldownMs)
              : this.runtimeConfig.retryPolicy.backoffMs * attempt;
            await sleep(delayMs);
            continue;
          }
          break;
        }
      }
    }

    const failureRecord = {
      id: createId("llm"),
      runId,
      projectId,
      callType,
      providerAlias: fallbackChain.at(-1)?.providerAlias ?? "unavailable",
      modelAlias: selectedModelAlias,
      providerModel: null,
      promptRefs: resolvedPromptRefs.map((prompt) => ({
        promptId: prompt.promptId,
        version: prompt.version
      })),
      inputSizeEstimate: estimateSize(governanceDecision.input ?? input),
      outputSizeEstimate: null,
      latencyMs: null,
      tokenUsage: null,
      estimatedCost: null,
      retryCount: Math.max(0, fallbackChain.length - 1),
      fallbackChain,
      resultStatus: LLM_RESULT_STATUS.FAILED,
      errorCategory: normalizeErrorCategory(lastError),
      metadata: {
        ...metadata,
        requestId,
        schemaValidated: Boolean(validateOutput),
        promptEnvironment: this.promptRegistry.environment,
        fallbackUsed: fallbackChain.length > 0,
        degradedModeUsed: false,
        tokenGovernance: {
          ...governanceDecision.governance,
          requestFingerprint: governanceDecision.fingerprint,
          cacheEligible: governanceDecision.policy.cacheEligible
        },
        usageSnapshotBefore: {
          session: summarizeBudgetUsage(this.sessionUsage),
          run: summarizeBudgetUsage(this.#getRunUsage(runId))
        }
      },
      createdAt: nowIso()
    };

    await this.#log({
      type: "llm.gateway.request.exhausted",
      requestId,
      runId,
      projectId,
      callType,
      modelAlias: selectedModelAlias,
      errorCategory: failureRecord.errorCategory,
      fallbackChain
    });

    throw new LlmGatewayError(lastError?.message ?? "LLM gateway call failed.", {
      category: failureRecord.errorCategory,
      callRecord: failureRecord
    });
  }

  #buildReusedCallRecord({
    runId,
    projectId,
    callType,
    selectedModelAlias,
    resolvedPromptRefs,
    preparedInput,
    cached,
    metadata,
    requestId
  }) {
    return {
      id: createId("llm"),
      runId,
      projectId,
      callType,
      providerAlias: cached.callRecord.providerAlias,
      modelAlias: selectedModelAlias,
      providerModel: cached.callRecord.providerModel ?? null,
      promptRefs: resolvedPromptRefs.map((prompt) => ({
        promptId: prompt.promptId,
        version: prompt.version
      })),
      inputSizeEstimate: estimateSize(preparedInput),
      outputSizeEstimate: cached.callRecord.outputSizeEstimate ?? null,
      latencyMs: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      estimatedCost: 0,
      retryCount: 0,
      fallbackChain: [],
      resultStatus: LLM_RESULT_STATUS.SUCCESS,
      errorCategory: null,
      metadata: {
        ...metadata,
        requestId,
        schemaValidated: true,
        promptEnvironment: this.promptRegistry.environment,
        fallbackUsed: false,
        degradedModeUsed: false
      },
      createdAt: nowIso()
    };
  }

  #buildSuppressedCallRecord({
    runId,
    projectId,
    callType,
    selectedModelAlias,
    resolvedPromptRefs,
    preparedInput,
    metadata,
    requestId
  }) {
    return {
      id: createId("llm"),
      runId,
      projectId,
      callType,
      providerAlias: "governance",
      modelAlias: selectedModelAlias,
      providerModel: null,
      promptRefs: resolvedPromptRefs.map((prompt) => ({
        promptId: prompt.promptId,
        version: prompt.version
      })),
      inputSizeEstimate: estimateSize(preparedInput),
      outputSizeEstimate: null,
      latencyMs: 0,
      tokenUsage: null,
      estimatedCost: 0,
      retryCount: 0,
      fallbackChain: [],
      resultStatus: LLM_RESULT_STATUS.FAILED,
      errorCategory: "stage_suppressed",
      metadata: {
        ...metadata,
        requestId,
        schemaValidated: true,
        promptEnvironment: this.promptRegistry.environment,
        fallbackUsed: false,
        degradedModeUsed: false
      },
      createdAt: nowIso()
    };
  }

  #isBudgetExceeded(runId) {
    const runUsage = this.#getRunUsage(runId);
    const { budgets } = this.runtimeConfig;
    return (
      runUsage.totalTokens >= budgets.perRunTokens
      || this.sessionUsage.totalTokens >= budgets.perSessionTokens
      || runUsage.estimatedCost >= budgets.perRunUsd
      || this.sessionUsage.estimatedCost >= budgets.perSessionUsd
    );
  }

  #recordUsage(runId, callRecord) {
    const tokenTotal = callRecord.tokenUsage?.totalTokens ?? 0;
    const cost = callRecord.estimatedCost ?? 0;
    this.sessionUsage.totalTokens += tokenTotal;
    this.sessionUsage.estimatedCost = Number((this.sessionUsage.estimatedCost + cost).toFixed(6));
    this.sessionUsage.callCount += 1;
    const runUsage = this.#getRunUsage(runId);
    runUsage.totalTokens += tokenTotal;
    runUsage.estimatedCost = Number((runUsage.estimatedCost + cost).toFixed(6));
    runUsage.callCount += 1;
  }

  #getRunUsage(runId) {
    if (!this.runUsage.has(runId)) {
      this.runUsage.set(runId, createUsageState());
    }
    return this.runUsage.get(runId);
  }

  #getProviderState(alias) {
    if (!this.providerStates.has(alias)) {
      this.providerStates.set(alias, {
        failureCount: 0,
        circuitOpenUntil: null,
        lastErrorCategory: null,
        lastErrorAt: null
      });
    }
    return this.providerStates.get(alias);
  }

  #resetProviderState(alias) {
    this.providerStates.set(alias, {
      failureCount: 0,
      circuitOpenUntil: null,
      lastErrorCategory: null,
      lastErrorAt: null
    });
  }

  #markProviderFailure(alias, category, retryAfterMs = null) {
    const next = this.#getProviderState(alias);
    next.lastErrorCategory = category;
    next.lastErrorAt = nowIso();
    if (!shouldTriggerCircuit(category)) {
      return;
    }
    next.failureCount += 1;
    const now = Date.now();
    if (category === "rate_limit") {
      next.circuitOpenUntil = now + Math.max(retryAfterMs ?? this.runtimeConfig.circuitBreaker.rateLimitCooldownMs, 1);
      return;
    }
    if (next.failureCount >= this.runtimeConfig.circuitBreaker.failureThreshold) {
      next.circuitOpenUntil = now + this.runtimeConfig.circuitBreaker.cooldownMs;
    }
  }

  async #log(entry) {
    await this.runtimeLogger?.safeLog(entry);
  }
}
