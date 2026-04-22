import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultLlmGateway } from "../llm/create-default-llm-gateway.js";
import { PromptRegistry } from "../llm/prompt-registry.js";
import { InternalLlmGateway, LlmGatewayError } from "../llm/gateway.js";
import { MockOfflineProvider } from "../llm/providers/mock-offline-provider.js";
import { OpenAiCompatibleProvider } from "../llm/providers/openai-compatible-provider.js";
import { buildLlmRuntimeConfig, buildPublicLlmConfigStatus, deriveProviderOrder } from "../llm/runtime-config.js";
import { resolveLlmRuntimeEnvironment } from "../llm/resolve-runtime-env.js";
import { PrototypeDatabase } from "../storage/database.js";
import { PrototypeAgent } from "../runtime/prototype-agent.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { StructuredLogger } from "../observability/structured-logger.js";
import { DATA_ROOT, LLM_CALL_TYPE, LLM_PROVIDER_ALIAS } from "../config.js";
import { normalizePlanOutput } from "../llm/structured-output-normalizers.js";
import { writeJson } from "../utils/files.js";

const scenario = process.argv[2] ?? "help";
const smokeRoot = path.join(DATA_ROOT, "smoke");
const __filename = fileURLToPath(import.meta.url);

function printUsage() {
  console.log([
    "Usage: node src/scripts/run-llm-smoke-validation.js <scenario>",
    "",
    "Scenarios:",
    "  live-success        Runs one real live provider request through the gateway.",
    "  invalid-config      Proves config validation failure without fallback.",
    "  timeout             Simulates a timeout then fallback through the gateway.",
    "  rate-limit          Simulates rate limit, cooldown, and degraded fallback.",
    "  budget-exhausted    Simulates budget exhaustion and fallback.",
    "  provider-unavailable Simulates an unavailable live provider without fallback.",
    "  runtime-degraded    Proves deterministic runtime fallback after LLM failure."
  ].join("\n"));
}

function promptRefsForPlan(mission = "Smoke validation mission") {
  return [
    { promptId: "system.primary_reasoning", version: "1.0.0" },
    {
      promptId: "task.plan_generation",
      version: "1.0.0",
      bindings: {
        mission,
        scenarioType: "research",
        allowlistedDomains: '["127.0.0.1"]'
      }
    }
  ];
}

function validatePlanOutput(output) {
  return normalizePlanOutput(output);
}

class ScriptedProvider {
  constructor(script = []) {
    this.script = [...script];
    this.providerAlias = LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE;
  }

  isEnabled() {
    return true;
  }

  resolveModel(modelAlias) {
    return `scripted/${modelAlias}`;
  }

  validateConfig() {
    return {
      valid: true,
      issues: []
    };
  }

  getPublicStatus() {
    return {
      configured: true,
      issues: [],
      baseUrl: "scripted://provider",
      timeoutMs: 1,
      modelMap: {}
    };
  }

  async generateStructured() {
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

class FakeBrowserController {
  constructor() {
    this.activeTargetId = "hub";
    this.targets = new Map([
      ["hub", { id: "hub", title: "Hub", url: "http://127.0.0.1/hub", data: null }],
      ["alpha", { id: "alpha", title: "Alpha Analytics", url: "http://127.0.0.1/alpha", data: {
        companyName: "Alpha Analytics",
        tagline: "Fast delivery for analytics buyers.",
        priceLevel: "Medium",
        deliverySpeed: "Fast",
        riskNote: "Capacity can fluctuate during month-end."
      } }],
      ["beta", { id: "beta", title: "Beta Commerce", url: "http://127.0.0.1/beta", data: {
        companyName: "Beta Commerce",
        tagline: "Lower cost but slower onboarding.",
        priceLevel: "Low",
        deliverySpeed: "Slow",
        riskNote: "Requires more operator follow-up."
      } }]
    ]);
  }

  async openBrowserSession() {}

  listTargets() {
    return Array.from(this.targets.values()).map(({ id, title, url }) => ({ id, title, url }));
  }

  focusTab(targetId) {
    this.activeTargetId = targetId;
    return targetId;
  }

  async navigate(targetId, url) {
    const target = this.targets.get(targetId);
    target.url = url;
  }

  async waitForPageState() {}

  async openLinkInNewTab(_hubTargetId, { testId }) {
    return {
      targetId: testId === "link-alpha" ? "alpha" : "beta"
    };
  }

  async getTargetMeta(targetId) {
    const target = this.targets.get(targetId);
    return {
      title: target.title,
      url: target.url
    };
  }

  async extractTextMap(targetId) {
    return this.targets.get(targetId).data;
  }

  async exportPageEvidence(targetId, evidenceRoot, safeName) {
    const target = this.targets.get(targetId);
    await fs.mkdir(evidenceRoot, { recursive: true });
    const summaryPath = path.join(evidenceRoot, `${safeName}.json`);
    const screenshotPath = path.join(evidenceRoot, `${safeName}.png`);
    await fs.writeFile(summaryPath, JSON.stringify({ title: target.title, url: target.url }, null, 2), "utf8");
    await fs.writeFile(screenshotPath, "fake-png", "utf8");
    return {
      evidenceId: `evidence_${targetId}`,
      summaryPath,
      screenshotPath,
      snapshot: {
        title: target.title
      }
    };
  }

  async close() {}
}

class AlwaysFailingGateway {
  constructor() {
    this.counter = 0;
  }

  getStatus() {
    return {
      providerMode: "openai_compatible",
      effectiveMode: "degraded_mock_only",
      availableProviders: [],
      promptEnvironment: "prototype",
      budgets: {
        perRunTokens: 12_000,
        perSessionTokens: 50_000,
        perRunUsd: 0.5,
        perSessionUsd: 2
      },
      configIssues: ["Live provider unavailable for smoke."],
      deterministicFallback: true
    };
  }

  async generateStructured({ runId, projectId, callType, promptRefs, metadata }) {
    this.counter += 1;
    throw new LlmGatewayError("Live provider unavailable.", {
      category: "provider_unavailable",
      callRecord: {
        id: `llm_fail_${this.counter}`,
        runId,
        projectId,
        callType,
        providerAlias: "openai_compatible",
        modelAlias: "primary_reasoning",
        providerModel: null,
        promptRefs: promptRefs.map((prompt) => ({ promptId: prompt.promptId, version: prompt.version })),
        inputSizeEstimate: 10,
        outputSizeEstimate: null,
        latencyMs: null,
        tokenUsage: null,
        estimatedCost: null,
        retryCount: 0,
        fallbackChain: [],
        resultStatus: "failed",
        errorCategory: "provider_unavailable",
        metadata: {
          requestId: `llmreq_fail_${this.counter}`,
          ...metadata
        },
        createdAt: new Date().toISOString()
      }
    });
  }
}

async function buildGatewayFromEnv(envOverrides = {}) {
  const requestedEnv = {
    ...process.env,
    ...envOverrides
  };
  const { resolvedEnv, secretResolution } = await resolveLlmRuntimeEnvironment({
    env: requestedEnv
  });
  const runtimeConfig = buildLlmRuntimeConfig({
    env: resolvedEnv,
    secretResolution
  });
  const promptRegistry = await new PromptRegistry().load();
  const providers = new Map([
    [LLM_PROVIDER_ALIAS.MOCK_OFFLINE, new MockOfflineProvider()],
    [LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE, new OpenAiCompatibleProvider({
      baseUrl: runtimeConfig.providers.openaiCompatible.baseUrl,
      apiKey: runtimeConfig.providers.openaiCompatible.apiKey,
      apiKeyHeader: runtimeConfig.providers.openaiCompatible.apiKeyHeader,
      apiKeyPrefix: runtimeConfig.providers.openaiCompatible.apiKeyPrefix,
      timeoutMs: runtimeConfig.providers.openaiCompatible.timeoutMs,
      modelMap: runtimeConfig.providers.openaiCompatible.modelMap,
      pricing: runtimeConfig.providers.openaiCompatible.pricing
    })]
  ]);
  return new InternalLlmGateway({
    promptRegistry,
    providers,
    providerMode: runtimeConfig.providerMode,
    providerOrder: deriveProviderOrder(runtimeConfig),
    runtimeConfig,
    publicConfigStatus: buildPublicLlmConfigStatus(runtimeConfig),
    runtimeLogger: new StructuredLogger({
      filePath: runtimeConfig.logging.path,
      enabled: runtimeConfig.logging.enabled
    })
  });
}

async function createScriptedGateway({ liveScript, providerOrder = ["openai_compatible", "mock_offline"], budgets } = {}) {
  const promptRegistry = await new PromptRegistry().load();
  const resolvedBudgets = budgets ?? {
    perRunTokens: 12_000,
    perSessionTokens: 50_000,
    perRunUsd: 0.5,
    perSessionUsd: 2
  };
  return new InternalLlmGateway({
    promptRegistry,
    providers: new Map([
      [LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE, new ScriptedProvider(liveScript)],
      [LLM_PROVIDER_ALIAS.MOCK_OFFLINE, new MockOfflineProvider()]
    ]),
    providerMode: "openai_compatible",
    providerOrder,
    runtimeConfig: {
      retryPolicy: {
        maxAttemptsPerProvider: 2,
        backoffMs: 0
      },
      budgets: resolvedBudgets,
      circuitBreaker: {
        failureThreshold: 1,
        cooldownMs: 10_000,
        rateLimitCooldownMs: 10_000
      }
    },
    publicConfigStatus: {
      providerMode: "openai_compatible",
      configIssues: [],
      budgets: resolvedBudgets,
      providers: {},
      deterministicFallback: true,
      allowMockFallback: true
    },
    runtimeLogger: new StructuredLogger({
      filePath: path.join(smokeRoot, "llm-smoke-gateway.jsonl"),
      enabled: true
    })
  });
}

async function persistSmokeResult(name, payload) {
  const outputPath = path.join(smokeRoot, `${name}.json`);
  await writeJson(outputPath, {
    scenario: name,
    createdAt: new Date().toISOString(),
    ...payload
  });
  return outputPath;
}

async function runLiveSuccess() {
  const gateway = await createDefaultLlmGateway({ providerMode: "openai_compatible" });
  const status = gateway.getStatus();
  if (!status.availableProviders.includes(LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE)) {
    throw new Error("Live provider is not available. Set COWORK_OPENAI_API_KEY and related env vars before running live-success.");
  }
  const result = await gateway.generateStructured({
    runId: "smoke_live_success",
    projectId: "smoke_project",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefsForPlan("Run one minimal live provider smoke request."),
    input: {
      mission: "Run one minimal live provider smoke request.",
      scenarioType: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    validateOutput: validatePlanOutput,
    metadata: {
      smokeScenario: "live-success"
    }
  });
  return {
    status: "pass",
    providerAlias: result.callRecord.providerAlias,
    providerLabel: status.providerDetails?.openaiCompatible?.providerLabel ?? null,
    providerModel: result.callRecord.providerModel,
    secretSource: status.providerDetails?.openaiCompatible?.secretSource ?? "missing",
    requestId: result.callRecord.metadata?.requestId ?? null,
    latencyMs: result.callRecord.latencyMs,
    tokenUsage: result.callRecord.tokenUsage,
    estimatedCost: result.callRecord.estimatedCost,
    fallbackChain: result.callRecord.fallbackChain,
    outputPreview: result.output.steps.slice(0, 2)
  };
}

async function runInvalidConfig() {
  const gateway = await buildGatewayFromEnv({
    COWORK_LLM_PROVIDER_MODE: "openai_compatible",
    COWORK_LLM_ALLOW_MOCK_FALLBACK: "0",
    COWORK_OPENAI_API_KEY: "",
    COWORK_OPENAI_BASE_URL: "not-a-url"
  });
  try {
    await gateway.generateStructured({
      runId: "smoke_invalid_config",
      projectId: "smoke_project",
      callType: LLM_CALL_TYPE.PLAN_GENERATION,
      promptRefs: promptRefsForPlan("Invalid config smoke"),
      input: {
        mission: "Invalid config smoke",
        scenarioType: "research",
        allowlistedDomains: ["127.0.0.1"]
      },
      validateOutput: validatePlanOutput,
      metadata: {
        smokeScenario: "invalid-config"
      }
    });
    throw new Error("Invalid config scenario unexpectedly succeeded.");
  } catch (error) {
    return {
      status: error instanceof LlmGatewayError ? "pass" : "fail",
      errorCategory: error.category ?? "unknown",
      message: error.message,
      fallbackChain: error.callRecord?.fallbackChain ?? [],
      configStatus: gateway.getStatus()
    };
  }
}

async function runTimeout() {
  const gateway = await createScriptedGateway({
    liveScript: [
      {
        type: "throw",
        category: "timeout",
        message: "scripted timeout"
      },
      {
        type: "return",
        response: {
          output: {
            steps: ["fallback succeeded after timeout"],
            assumptions: []
          },
          providerModel: "scripted/primary_reasoning",
          tokenUsage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
          estimatedCost: 0.001
        }
      }
    ]
  });
  const result = await gateway.generateStructured({
    runId: "smoke_timeout",
    projectId: "smoke_project",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefsForPlan("Timeout smoke"),
    input: {
      mission: "Timeout smoke",
      scenarioType: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    validateOutput: validatePlanOutput,
    metadata: {
      smokeScenario: "timeout"
    }
  });
  return {
    status: "pass",
    providerAlias: result.callRecord.providerAlias,
    retryCount: result.callRecord.retryCount,
    fallbackChain: result.callRecord.fallbackChain,
    outputPreview: result.output.steps
  };
}

async function runRateLimit() {
  const gateway = await createScriptedGateway({
    liveScript: [
      {
        type: "throw",
        category: "rate_limit",
        message: "scripted rate limit",
        retryAfterMs: 0
      }
    ]
  });
  const first = await gateway.generateStructured({
    runId: "smoke_rate_limit",
    projectId: "smoke_project",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefsForPlan("Rate limit smoke"),
    input: {
      mission: "Rate limit smoke",
      scenarioType: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    validateOutput: validatePlanOutput,
    metadata: {
      smokeScenario: "rate-limit-first"
    }
  });
  const second = await gateway.generateStructured({
    runId: "smoke_rate_limit_again",
    projectId: "smoke_project",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefsForPlan("Rate limit smoke again"),
    input: {
      mission: "Rate limit smoke again",
      scenarioType: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    validateOutput: validatePlanOutput,
    metadata: {
      smokeScenario: "rate-limit-second"
    }
  });
  return {
    status: "pass",
    firstProviderAlias: first.callRecord.providerAlias,
    secondProviderAlias: second.callRecord.providerAlias,
    firstFallbackChain: first.callRecord.fallbackChain,
    secondFallbackChain: second.callRecord.fallbackChain
  };
}

async function runBudgetExhausted() {
  const gateway = await createScriptedGateway({
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
  const first = await gateway.generateStructured({
    runId: "smoke_budget",
    projectId: "smoke_project",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefsForPlan("Budget smoke first"),
    input: {
      mission: "Budget smoke first",
      scenarioType: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    validateOutput: validatePlanOutput,
    metadata: {
      smokeScenario: "budget-first"
    }
  });
  const second = await gateway.generateStructured({
    runId: "smoke_budget",
    projectId: "smoke_project",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: promptRefsForPlan("Budget smoke second"),
    input: {
      mission: "Budget smoke second",
      scenarioType: "research",
      allowlistedDomains: ["127.0.0.1"]
    },
    validateOutput: validatePlanOutput,
    metadata: {
      smokeScenario: "budget-second"
    }
  });
  return {
    status: "pass",
    firstProviderAlias: first.callRecord.providerAlias,
    secondProviderAlias: second.callRecord.providerAlias,
    secondFallbackChain: second.callRecord.fallbackChain
  };
}

async function runProviderUnavailable() {
  const gateway = await buildGatewayFromEnv({
    COWORK_LLM_PROVIDER_MODE: "openai_compatible",
    COWORK_LLM_ALLOW_MOCK_FALLBACK: "0",
    COWORK_OPENAI_API_KEY: "smoke-invalid-key",
    COWORK_OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    COWORK_OPENAI_TIMEOUT_MS: "250"
  });
  try {
    await gateway.generateStructured({
      runId: "smoke_provider_unavailable",
      projectId: "smoke_project",
      callType: LLM_CALL_TYPE.PLAN_GENERATION,
      promptRefs: promptRefsForPlan("Provider unavailable smoke"),
      input: {
        mission: "Provider unavailable smoke",
        scenarioType: "research",
        allowlistedDomains: ["127.0.0.1"]
      },
      validateOutput: validatePlanOutput,
      metadata: {
        smokeScenario: "provider-unavailable"
      }
    });
    throw new Error("Provider unavailable scenario unexpectedly succeeded.");
  } catch (error) {
    return {
      status: error instanceof LlmGatewayError ? "pass" : "fail",
      errorCategory: error.category ?? "unknown",
      message: error.message,
      fallbackChain: error.callRecord?.fallbackChain ?? []
    };
  }
}

async function runRuntimeDegraded() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-llm-smoke-"));
  const database = new PrototypeDatabase(path.join(tempDir, "prototype.sqlite"));
  await database.open();
  try {
    const agent = new PrototypeAgent({
      database,
      browserController: new FakeBrowserController(),
      computerControlService: {},
      policyEngine: new PolicyEngine(),
      llmGateway: new AlwaysFailingGateway()
    });
    const project = agent.createProject({
      name: "LLM degraded smoke",
      description: "Validates deterministic fallback after live provider failure.",
      allowlistedDomains: ["127.0.0.1"]
    });
    const bundle = await agent.runResearchMission({
      projectId: project.id,
      mission: "Compare controlled pages and produce a decision note.",
      hubUrl: "http://127.0.0.1/hub",
      linkSpecs: [
        { testId: "link-alpha", title: "Alpha Analytics" },
        { testId: "link-beta", title: "Beta Commerce" }
      ],
      fieldMap: {
        companyName: { testId: "company-name" },
        tagline: { testId: "company-tagline" },
        priceLevel: { testId: "price-level" },
        deliverySpeed: { testId: "delivery-speed" },
        riskNote: { testId: "risk-note" }
      }
    });
    const degradedEvents = bundle.events.filter((event) => event.type === "llm.degraded_mode.activated");
    return {
      status: "pass",
      runStatus: bundle.run.status,
      planGenerationMode: bundle.run.plan?.generationMode ?? null,
      degradedEventCount: degradedEvents.length,
      failedLlmCallCount: bundle.llmCalls.filter((call) => call.resultStatus === "failed").length,
      llmFailureCategories: bundle.llmCalls.map((call) => call.errorCategory),
      artifactGenerationModes: bundle.artifacts.map((artifact) => ({
        artifactId: artifact.id,
        artifactType: artifact.artifactType,
        generationMode: artifact.metadata?.generationMode ?? null
      }))
    };
  } finally {
    database.close();
  }
}

const scenarioHandlers = {
  "live-success": runLiveSuccess,
  "invalid-config": runInvalidConfig,
  timeout: runTimeout,
  "rate-limit": runRateLimit,
  "budget-exhausted": runBudgetExhausted,
  "provider-unavailable": runProviderUnavailable,
  "runtime-degraded": runRuntimeDegraded
};

export async function runLlmSmokeScenario(name) {
  if (!(name in scenarioHandlers)) {
    throw new Error(`Unknown LLM smoke scenario: ${name}`);
  }

  try {
    const result = await scenarioHandlers[name]();
    const outputPath = await persistSmokeResult(name, result);
    return {
      scenario: name,
      outputPath,
      ...result
    };
  } catch (error) {
    const outputPath = await persistSmokeResult(name, {
      status: "fail",
      message: error.message,
      stack: error.stack
    });
    return {
      scenario: name,
      outputPath,
      status: "fail",
      message: error.message
    };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  if (scenario === "help" || !(scenario in scenarioHandlers)) {
    printUsage();
    process.exitCode = scenario === "help" ? 0 : 1;
  } else {
    const result = await runLlmSmokeScenario(scenario);
    if (result.status === "fail") {
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  }
}
