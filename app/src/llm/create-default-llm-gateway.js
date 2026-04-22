import { LLM_PROVIDER_ALIAS } from "../config.js";
import { PromptRegistry } from "./prompt-registry.js";
import { InternalLlmGateway } from "./gateway.js";
import { MockOfflineProvider } from "./providers/mock-offline-provider.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible-provider.js";
import { buildLlmRuntimeConfig, buildPublicLlmConfigStatus, deriveProviderOrder } from "./runtime-config.js";
import { StructuredLogger } from "../observability/structured-logger.js";
import { resolveLlmRuntimeEnvironment } from "./resolve-runtime-env.js";

export async function createDefaultLlmGateway({
  providerMode = null,
  env = process.env,
  secretStore
} = {}) {
  const requestedEnv = providerMode
    ? {
      ...env,
      COWORK_LLM_PROVIDER_MODE: providerMode
    }
    : env;
  const { resolvedEnv, secretResolution } = await resolveLlmRuntimeEnvironment({
    env: requestedEnv,
    secretStore
  });
  const runtimeConfig = buildLlmRuntimeConfig({
    env: resolvedEnv,
    secretResolution
  });
  const promptRegistry = await new PromptRegistry().load();
  const logger = new StructuredLogger({
    filePath: runtimeConfig.logging.path,
    enabled: runtimeConfig.logging.enabled
  });
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
    runtimeLogger: logger
  });
}
