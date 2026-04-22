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
  assert.equal(config.budgets.perRunTokens, 12_000);
  assert.equal(config.budgets.perSessionUsd, 2);
  assert.ok(config.issues.some((issue) => issue.includes("invalid")), "Expected invalid config issues.");
  assert.ok(config.issues.some((issue) => issue.includes("not configured")), "Expected missing key degradation issue.");

  const publicStatus = buildPublicLlmConfigStatus(config);
  assert.equal(publicStatus.providers.openaiCompatible.configured, false);
  assert.equal("apiKey" in publicStatus.providers.openaiCompatible, false, "Public status must not expose secrets.");
  assert.equal("baseUrl" in publicStatus.providers.openaiCompatible, false, "Public status must stay metadata-only.");
  assert.equal("apiKeyHeader" in publicStatus.providers.openaiCompatible, false, "Public status must not expose header wiring.");
  assert.equal("localEnvFiles" in publicStatus.providers.openaiCompatible, false, "Public status must not expose local file paths.");
  assert.equal(publicStatus.providers.openaiCompatible.secretSource, "missing");
  assert.equal(publicStatus.providers.openaiCompatible.providerLabel, "OpenAI");
  assert.equal(publicStatus.requestedProviderMode, "openai");

  const degradedOrder = deriveProviderOrder(config);
  assert.deepEqual(degradedOrder, ["openai_compatible", "mock_offline"]);

  const autoConfig = buildLlmRuntimeConfig({
    env: {
      COWORK_LLM_PROVIDER_MODE: "auto",
      COWORK_OPENAI_API_KEY: "runtime-only-secret"
    }
  });
  assert.deepEqual(deriveProviderOrder(autoConfig), ["openai_compatible", "mock_offline"]);

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
  assert.equal(defaultModelConfig.providers.openaiCompatible.modelMap.vision_fallback, "gpt-4.1-mini");

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
