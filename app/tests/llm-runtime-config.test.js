import assert from "node:assert/strict";
import { buildLlmRuntimeConfig, buildPublicLlmConfigStatus, deriveProviderOrder } from "../src/llm/runtime-config.js";

export async function run() {
  const config = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "openai",
      COWORK_LLM_BUDGET_PER_RUN_TOKENS: "not-a-number",
      COWORK_LLM_BUDGET_PER_SESSION_USD: "-1",
      COWORK_OPENAI_BASE_URL: "not-a-url"
    }
  });

  assert.equal(config.providerMode, "openai_compatible");
  assert.equal(config.budgets.perRunTokens, 50_000);
  assert.equal(config.budgets.perSessionUsd, 2);
  assert.ok(config.issues.some((issue) => issue.includes("invalid")), "Expected invalid config issues.");
  assert.ok(config.issues.some((issue) => issue.includes("not configured")), "Expected missing key degradation issue.");

  const publicStatus = buildPublicLlmConfigStatus(config);
  assert.equal(publicStatus.runtimeProfile, "production_strict");
  assert.equal(publicStatus.productionStrict, true);
  assert.equal(publicStatus.allowMockFallback, false);
  assert.equal(publicStatus.deterministicFallback, false);
  assert.equal(publicStatus.logging.scope, "runtime");
  assert.equal(publicStatus.providers.openaiCompatible.configured, false);
  assert.equal("apiKey" in publicStatus.providers.openaiCompatible, false, "Public status must not expose secrets.");
  assert.equal("baseUrl" in publicStatus.providers.openaiCompatible, false, "Public status must stay metadata-only.");
  assert.equal("apiKeyHeader" in publicStatus.providers.openaiCompatible, false, "Public status must not expose header wiring.");
  assert.equal("localEnvFiles" in publicStatus.providers.openaiCompatible, false, "Public status must not expose local file paths.");
  assert.equal(publicStatus.providers.openaiCompatible.secretSource, "missing");
  assert.equal(publicStatus.providers.openaiCompatible.providerLabel, "OpenAI");
  assert.equal(publicStatus.requestedProviderMode, "openai");

  const degradedOrder = deriveProviderOrder(config);
  assert.deepEqual(degradedOrder, ["openai_compatible"]);

  const testProfileConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_RUNTIME_PROFILE: "test",
      COWORK_LLM_PROVIDER_MODE: "mock_offline",
      COWORK_LLM_ALLOW_MOCK_FALLBACK: "1",
      COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK: "1",
      COWORK_LLM_LOG_SCOPE: "test"
    }
  });
  assert.equal(testProfileConfig.productionStrict, false);
  assert.equal(testProfileConfig.allowMockFallback, true);
  assert.equal(testProfileConfig.deterministicFallback.allowForPrototype, true);
  assert.deepEqual(deriveProviderOrder(testProfileConfig), ["mock_offline"]);
  const testPublicStatus = buildPublicLlmConfigStatus(testProfileConfig);
  assert.equal(testPublicStatus.runtimeProfile, "test");
  assert.equal(testPublicStatus.productionStrict, false);
  assert.equal(testPublicStatus.logging.scope, "test");

  const autoConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "auto",
      COWORK_OPENAI_API_KEY: "runtime-only-secret"
    }
  });
  assert.deepEqual(deriveProviderOrder(autoConfig), ["openai_compatible"]);

  const defaultModelConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "openai_compatible",
      COWORK_OPENAI_API_KEY: "runtime-only-secret",
      COWORK_OPENAI_BASE_URL: "https://api.openai.com/v1",
      COWORK_OPENAI_MODEL: "gpt-4.1-mini"
    }
  });
  assert.equal(defaultModelConfig.providers.openaiCompatible.modelMap.primary_reasoning, "gpt-4.1-mini");
  assert.equal(defaultModelConfig.providers.openaiCompatible.modelMap.utility_structuring, "gpt-4.1-mini");
  assert.equal(defaultModelConfig.providers.openaiCompatible.modelMap.vision_fallback, "gpt-5-mini");
  assert.equal(defaultModelConfig.vision.maxFramesPerRun, 4);
  assert.equal(defaultModelConfig.vision.defaultDetail, "low");
  assert.equal(defaultModelConfig.vision.interactionDetail, "high");

  const correctedVisionModelConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "openai_compatible",
      COWORK_OPENAI_API_KEY: "runtime-only-secret",
      COWORK_OPENAI_VISION_MODEL: "gpt-5.1-mini",
      COWORK_BROWSER_VISION_MAX_FRAMES_PER_RUN: "3",
      COWORK_BROWSER_VISION_DEFAULT_DETAIL: "auto"
    }
  });
  assert.equal(correctedVisionModelConfig.providers.openaiCompatible.modelMap.vision_fallback, "gpt-5-mini");
  assert.equal(correctedVisionModelConfig.vision.maxFramesPerRun, 3);
  assert.equal(correctedVisionModelConfig.vision.defaultDetail, "auto");
  assert.ok(correctedVisionModelConfig.issues.some((issue) => issue.includes("normalized to gpt-5-mini")));

  const blankLiveConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "openai_compatible",
      COWORK_OPENAI_API_KEY: "runtime-only-secret",
      COWORK_OPENAI_BASE_URL: "",
      COWORK_OPENAI_MODEL: ""
    }
  });
  assert.ok(blankLiveConfig.issues.some((issue) => issue.includes("COWORK_OPENAI_BASE_URL must not be empty")));
  assert.ok(blankLiveConfig.issues.some((issue) => issue.includes("COWORK_OPENAI_PRIMARY_MODEL must not be empty")));
  assert.ok(blankLiveConfig.issues.some((issue) => issue.includes("primary reasoning model is missing")));
  const blankLivePublicStatus = buildPublicLlmConfigStatus(blankLiveConfig);
  assert.equal(blankLivePublicStatus.providers.openaiCompatible.configured, false);
  assert.equal(blankLivePublicStatus.providers.openaiCompatible.primaryModel, "");

  const secretStoreConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "openai_compatible",
      COWORK_OPENAI_API_KEY: "runtime-only-secret"
    },
    secretResolution: {
      requireOsSecretStore: true,
      providers: {
        openaiCompatible: {
          source: "env",
          status: {
            available: true,
            configured: false
          }
        }
      }
    }
  });
  assert.ok(secretStoreConfig.issues.some((issue) => issue.includes("OS-backed secret store is required")));
}
