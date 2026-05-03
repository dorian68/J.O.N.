import path from "node:path";
import {
  DEFAULT_LLM_PROVIDER_MODE,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_LLM_BUDGETS,
  DEFAULT_PROMPT_ENVIRONMENT,
  LOGS_ROOT,
  LLM_PROVIDER_ALIAS
} from "../config.js";
import { normalizeSecretValue } from "../security/secret-normalization.js";

const VALID_PROVIDER_MODES = new Set([
  "auto",
  "disabled",
  LLM_PROVIDER_ALIAS.OPENAI,
  LLM_PROVIDER_ALIAS.MOCK_OFFLINE,
  LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE
]);

const PROVIDER_MODE_ALIASES = Object.freeze({
  [LLM_PROVIDER_ALIAS.OPENAI]: LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE
});
const DEFAULT_OPENAI_TEXT_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_VISION_MODEL = "gpt-5-mini";
const VISION_DETAIL_LEVELS = new Set(["auto", "low", "high"]);

function parsePositiveInt(value, fallback, issues, label) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    issues.push(`${label} must be a positive integer.`);
    return fallback;
  }
  return parsed;
}

function parseNonNegativeFloat(value, fallback, issues, label) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push(`${label} must be a non-negative number.`);
    return fallback;
  }
  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  return !["0", "false", "no"].includes(String(value).trim().toLowerCase());
}

function parseVisionDetail(value, fallback, issues, label) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (VISION_DETAIL_LEVELS.has(normalized)) {
    return normalized;
  }
  issues.push(`${label} must be one of: auto, low, high.`);
  return fallback;
}

function hasOwn(env, key) {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function normalizeVisionModelSetting(setting, issues) {
  const normalized = String(setting.value ?? "").trim();
  if (!normalized) {
    return setting;
  }
  const compact = normalized.toLowerCase().replace(/[\s_]+/g, "-");
  if (compact === "gpt-5.1-mini" || compact === "gpt-5-1-mini") {
    issues.push("COWORK_OPENAI_VISION_MODEL=gpt-5.1-mini was normalized to gpt-5-mini; the general low-cost vision model is gpt-5-mini.");
    return {
      ...setting,
      value: DEFAULT_OPENAI_VISION_MODEL
    };
  }
  return setting;
}

function resolveTrimmedSetting(env, key, defaultValue = "") {
  if (!hasOwn(env, key) || env[key] == null) {
    return {
      value: defaultValue,
      explicit: false,
      blank: false
    };
  }
  const normalized = String(env[key]).trim();
  return {
    value: normalized,
    explicit: true,
    blank: normalized === ""
  };
}

function resolveRawSetting(env, key, defaultValue = "") {
  if (!hasOwn(env, key) || env[key] == null) {
    return {
      value: defaultValue,
      explicit: false,
      blank: false
    };
  }
  const value = String(env[key]);
  return {
    value,
    explicit: true,
    blank: value.trim() === ""
  };
}

function parseProviderMode(value, issues) {
  const requested = value || DEFAULT_LLM_PROVIDER_MODE;
  if (VALID_PROVIDER_MODES.has(requested)) {
    return PROVIDER_MODE_ALIASES[requested] ?? requested;
  }
  issues.push(`Unknown LLM provider mode "${requested}". Falling back to ${DEFAULT_LLM_PROVIDER_MODE}.`);
  return PROVIDER_MODE_ALIASES[DEFAULT_LLM_PROVIDER_MODE] ?? DEFAULT_LLM_PROVIDER_MODE;
}

function runtimeProfileFromEnv(env = {}) {
  return String(env.COWORK_LLM_RUNTIME_PROFILE ?? env.COWORK_RUNTIME_PROFILE ?? "production_strict").trim() || "production_strict";
}

function parsePriceOverrides(env, issues) {
  return {
    primary_reasoning: {
      inputPer1k: parseNonNegativeFloat(env.COWORK_OPENAI_PRIMARY_INPUT_USD_PER_1K, null, issues, "COWORK_OPENAI_PRIMARY_INPUT_USD_PER_1K"),
      outputPer1k: parseNonNegativeFloat(env.COWORK_OPENAI_PRIMARY_OUTPUT_USD_PER_1K, null, issues, "COWORK_OPENAI_PRIMARY_OUTPUT_USD_PER_1K")
    },
    utility_structuring: {
      inputPer1k: parseNonNegativeFloat(env.COWORK_OPENAI_UTILITY_INPUT_USD_PER_1K, null, issues, "COWORK_OPENAI_UTILITY_INPUT_USD_PER_1K"),
      outputPer1k: parseNonNegativeFloat(env.COWORK_OPENAI_UTILITY_OUTPUT_USD_PER_1K, null, issues, "COWORK_OPENAI_UTILITY_OUTPUT_USD_PER_1K")
    },
    vision_fallback: {
      inputPer1k: parseNonNegativeFloat(env.COWORK_OPENAI_VISION_INPUT_USD_PER_1K, null, issues, "COWORK_OPENAI_VISION_INPUT_USD_PER_1K"),
      outputPer1k: parseNonNegativeFloat(env.COWORK_OPENAI_VISION_OUTPUT_USD_PER_1K, null, issues, "COWORK_OPENAI_VISION_OUTPUT_USD_PER_1K")
    }
  };
}

export function buildLlmRuntimeConfig({ env = process.env, secretResolution = null } = {}) {
  const issues = [];
  const runtimeProfile = runtimeProfileFromEnv(env);
  const productionStrict = parseBoolean(
    env.COWORK_LLM_PRODUCTION_STRICT,
    runtimeProfile === "production_strict"
  );
  const providerMode = parseProviderMode(env.COWORK_LLM_PROVIDER_MODE, issues);
  const requestedProviderMode = env.COWORK_LLM_PROVIDER_MODE || DEFAULT_LLM_PROVIDER_MODE;
  const liveModeRequested = providerMode === LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE || providerMode === "auto";
  const openAiBaseUrlSetting = resolveTrimmedSetting(env, "COWORK_OPENAI_BASE_URL", "https://api.openai.com/v1");
  let normalizedBaseUrl = openAiBaseUrlSetting.value;

  if (openAiBaseUrlSetting.blank) {
    issues.push("COWORK_OPENAI_BASE_URL must not be empty.");
    normalizedBaseUrl = "";
  } else {
    try {
      normalizedBaseUrl = new URL(openAiBaseUrlSetting.value).toString().replace(/\/$/, "");
    } catch {
      issues.push("COWORK_OPENAI_BASE_URL is invalid.");
    }
  }

  const openAiApiKey = normalizeSecretValue(resolveRawSetting(env, "COWORK_OPENAI_API_KEY", "").value);
  const openAiSecretSource = secretResolution?.providers?.openaiCompatible?.source ?? (openAiApiKey ? "env" : "missing");
  const requireOsSecretStore = secretResolution?.requireOsSecretStore ?? parseBoolean(env.COWORK_LLM_REQUIRE_OS_SECRET_STORE, false);
  const providerLabelSetting = resolveTrimmedSetting(env, "COWORK_OPENAI_PROVIDER_LABEL", "OpenAI");
  const openAiProviderLabel = providerLabelSetting.blank ? "OpenAI" : providerLabelSetting.value;
  const apiKeyHeaderSetting = resolveTrimmedSetting(env, "COWORK_OPENAI_API_KEY_HEADER", "");
  const prefixSetting = resolveRawSetting(env, "COWORK_OPENAI_API_KEY_PREFIX", "");
  const customApiKeyHeader = apiKeyHeaderSetting.value;
  const customApiKeyPrefix = prefixSetting.value;
  const apiKeyHeader = customApiKeyHeader || "authorization";
  const apiKeyPrefix = customApiKeyHeader
    ? customApiKeyPrefix
    : customApiKeyPrefix === "" ? "Bearer " : customApiKeyPrefix;

  if (providerLabelSetting.blank) {
    issues.push("COWORK_OPENAI_PROVIDER_LABEL must not be empty.");
  }
  if (customApiKeyHeader && !/^[a-zA-Z0-9-]+$/.test(customApiKeyHeader)) {
    issues.push("COWORK_OPENAI_API_KEY_HEADER must be a valid HTTP header name.");
  }
  if (customApiKeyPrefix.includes("\n") || customApiKeyPrefix.includes("\r")) {
    issues.push("COWORK_OPENAI_API_KEY_PREFIX must not contain new lines.");
  }

  const defaultModelSetting = resolveTrimmedSetting(env, "COWORK_OPENAI_MODEL", DEFAULT_OPENAI_TEXT_MODEL);
  const modelSettings = {
    primary_reasoning: resolveTrimmedSetting(env, "COWORK_OPENAI_PRIMARY_MODEL", defaultModelSetting.value),
    utility_structuring: resolveTrimmedSetting(env, "COWORK_OPENAI_UTILITY_MODEL", defaultModelSetting.value),
    vision_fallback: normalizeVisionModelSetting(
      resolveTrimmedSetting(env, "COWORK_OPENAI_VISION_MODEL", DEFAULT_OPENAI_VISION_MODEL),
      issues
    )
  };
  const modelMap = {
    primary_reasoning: modelSettings.primary_reasoning.value,
    utility_structuring: modelSettings.utility_structuring.value,
    vision_fallback: modelSettings.vision_fallback.value
  };

  if (!String(modelMap.primary_reasoning ?? "").trim()) {
    issues.push("COWORK_OPENAI_PRIMARY_MODEL must not be empty.");
  }
  if (!String(modelMap.utility_structuring ?? "").trim()) {
    issues.push("COWORK_OPENAI_UTILITY_MODEL must not be empty.");
  }
  if (!String(modelMap.vision_fallback ?? "").trim()) {
    issues.push("COWORK_OPENAI_VISION_MODEL must not be empty.");
  }

  const config = {
    providerMode,
    requestedProviderMode,
    runtimeProfile,
    productionStrict,
    requireOsSecretStore,
    promptEnvironment: env.COWORK_PROMPT_ENVIRONMENT || DEFAULT_PROMPT_ENVIRONMENT,
    allowMockFallback: productionStrict ? false : parseBoolean(env.COWORK_LLM_ALLOW_MOCK_FALLBACK, false),
    deterministicFallback: {
      allowForPrototype: productionStrict ? false : parseBoolean(env.COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK, false)
    },
    budgets: {
      perRunTokens: parsePositiveInt(env.COWORK_LLM_BUDGET_PER_RUN_TOKENS, DEFAULT_LLM_BUDGETS.perRunTokens, issues, "COWORK_LLM_BUDGET_PER_RUN_TOKENS"),
      perSessionTokens: parsePositiveInt(env.COWORK_LLM_BUDGET_PER_SESSION_TOKENS, DEFAULT_LLM_BUDGETS.perSessionTokens, issues, "COWORK_LLM_BUDGET_PER_SESSION_TOKENS"),
      perRunUsd: parseNonNegativeFloat(env.COWORK_LLM_BUDGET_PER_RUN_USD, DEFAULT_LLM_BUDGETS.perRunUsd, issues, "COWORK_LLM_BUDGET_PER_RUN_USD"),
      perSessionUsd: parseNonNegativeFloat(env.COWORK_LLM_BUDGET_PER_SESSION_USD, DEFAULT_LLM_BUDGETS.perSessionUsd, issues, "COWORK_LLM_BUDGET_PER_SESSION_USD")
    },
    vision: {
      enabled: parseBoolean(env.COWORK_BROWSER_VISION_ENABLED, true),
      modelAlias: "vision_fallback",
      defaultModel: DEFAULT_OPENAI_VISION_MODEL,
      maxFramesPerRun: parsePositiveInt(env.COWORK_BROWSER_VISION_MAX_FRAMES_PER_RUN, 4, issues, "COWORK_BROWSER_VISION_MAX_FRAMES_PER_RUN"),
      screenshotWidth: parsePositiveInt(env.COWORK_BROWSER_VISION_SCREENSHOT_WIDTH, 480, issues, "COWORK_BROWSER_VISION_SCREENSHOT_WIDTH"),
      defaultDetail: parseVisionDetail(env.COWORK_BROWSER_VISION_DEFAULT_DETAIL, "low", issues, "COWORK_BROWSER_VISION_DEFAULT_DETAIL"),
      interactionDetail: parseVisionDetail(env.COWORK_BROWSER_VISION_INTERACTION_DETAIL, "high", issues, "COWORK_BROWSER_VISION_INTERACTION_DETAIL"),
      blockerDetail: parseVisionDetail(env.COWORK_BROWSER_VISION_BLOCKER_DETAIL, "high", issues, "COWORK_BROWSER_VISION_BLOCKER_DETAIL")
    },
    retryPolicy: {
      maxAttemptsPerProvider: parsePositiveInt(env.COWORK_LLM_MAX_ATTEMPTS_PER_PROVIDER, 2, issues, "COWORK_LLM_MAX_ATTEMPTS_PER_PROVIDER"),
      backoffMs: parsePositiveInt(env.COWORK_LLM_RETRY_BACKOFF_MS, 150, issues, "COWORK_LLM_RETRY_BACKOFF_MS")
    },
    circuitBreaker: {
      failureThreshold: parsePositiveInt(env.COWORK_LLM_CIRCUIT_FAILURE_THRESHOLD, 2, issues, "COWORK_LLM_CIRCUIT_FAILURE_THRESHOLD"),
      cooldownMs: parsePositiveInt(env.COWORK_LLM_CIRCUIT_COOLDOWN_MS, 30_000, issues, "COWORK_LLM_CIRCUIT_COOLDOWN_MS"),
      rateLimitCooldownMs: parsePositiveInt(env.COWORK_LLM_RATE_LIMIT_COOLDOWN_MS, 60_000, issues, "COWORK_LLM_RATE_LIMIT_COOLDOWN_MS")
    },
    logging: {
      path: env.COWORK_LLM_LOG_PATH
        ? path.resolve(env.COWORK_LLM_LOG_PATH)
        : path.join(LOGS_ROOT, env.COWORK_LLM_LOG_SCOPE === "test" ? "llm-runtime.test.jsonl" : "llm-runtime.jsonl"),
      scope: env.COWORK_LLM_LOG_SCOPE === "test" ? "test" : "runtime",
      enabled: parseBoolean(env.COWORK_LLM_LOGGING_ENABLED, true)
    },
    providers: {
      openaiCompatible: {
        providerLabel: openAiProviderLabel,
        baseUrl: normalizedBaseUrl,
        apiKey: openAiApiKey,
        apiKeyHeader,
        apiKeyPrefix,
        secretSource: openAiSecretSource,
        secretStoreStatus: secretResolution?.providers?.openaiCompatible?.status ?? null,
        localEnvFiles: secretResolution?.localEnvFiles ?? [],
        localEnvFallbackConfigured: Boolean(secretResolution?.providers?.openaiCompatible?.localEnvFileConfigured),
        timeoutMs: parsePositiveInt(env.COWORK_OPENAI_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS, issues, "COWORK_OPENAI_TIMEOUT_MS"),
        modelMap,
        pricing: parsePriceOverrides(env, issues)
      }
    }
  };

  const configIssues = [...issues];
  if (!openAiApiKey && liveModeRequested) {
    configIssues.push(productionStrict
      ? "OpenAI-compatible provider is not configured; production strict mode will fail closed instead of using mock or deterministic fallback."
      : "OpenAI-compatible provider is not configured; live mode will degrade to mock or deterministic fallback.");
  }
  if (productionStrict && providerMode === LLM_PROVIDER_ALIAS.MOCK_OFFLINE) {
    configIssues.push("Production strict mode forbids mock_offline provider mode.");
  }
  if (productionStrict && parseBoolean(env.COWORK_LLM_ALLOW_MOCK_FALLBACK, false)) {
    configIssues.push("Production strict mode ignores COWORK_LLM_ALLOW_MOCK_FALLBACK; mock fallback remains disabled.");
  }
  if (productionStrict && parseBoolean(env.COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK, false)) {
    configIssues.push("Production strict mode ignores COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK; deterministic fallback remains disabled.");
  }
  if (requireOsSecretStore && openAiSecretSource !== "os_secret_store") {
    configIssues.push("OS-backed secret store is required but the OpenAI-compatible provider key did not resolve from the OS secret store.");
  }
  if (liveModeRequested && !normalizedBaseUrl) {
    configIssues.push("OpenAI-compatible provider base URL is missing.");
  }
  if (liveModeRequested && !modelMap.primary_reasoning) {
    configIssues.push("OpenAI-compatible provider primary reasoning model is missing.");
  }
  if (liveModeRequested && !modelMap.utility_structuring) {
    configIssues.push("OpenAI-compatible provider utility structuring model is missing.");
  }
  if (liveModeRequested && !modelMap.vision_fallback) {
    configIssues.push("OpenAI-compatible provider vision fallback model is missing.");
  }
  if (requireOsSecretStore && secretResolution?.providers?.openaiCompatible?.localEnvFileConfigured) {
    configIssues.push("OS-backed secret store is required; local env file key fallback should remain disabled unless the OS-backed secret path is unavailable.");
  }

  return {
    ...config,
    issues: configIssues
  };
}

export function deriveProviderOrder(config) {
  if (config.productionStrict && config.providerMode === LLM_PROVIDER_ALIAS.MOCK_OFFLINE) {
    return [];
  }
  switch (config.providerMode) {
    case "disabled":
      return [];
    case "auto":
      return config.providers.openaiCompatible.apiKey
        ? [LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE, ...(config.allowMockFallback ? [LLM_PROVIDER_ALIAS.MOCK_OFFLINE] : [])]
        : (config.allowMockFallback ? [LLM_PROVIDER_ALIAS.MOCK_OFFLINE] : []);
    case LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE:
      return [
        LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE,
        ...(config.allowMockFallback ? [LLM_PROVIDER_ALIAS.MOCK_OFFLINE] : [])
      ];
    case LLM_PROVIDER_ALIAS.MOCK_OFFLINE:
    default:
      return [LLM_PROVIDER_ALIAS.MOCK_OFFLINE];
  }
}

function buildPublicOpenAiCompatibleStatus(config) {
  const provider = config.providers.openaiCompatible;
  const issues = [];

  if (!provider.apiKey) {
    issues.push("Missing provider API key.");
  }
  if (!provider.baseUrl) {
    issues.push("Provider base URL is missing.");
  } else {
    try {
      new URL(provider.baseUrl);
    } catch {
      issues.push("Provider base URL is invalid.");
    }
  }
  if (!provider.apiKeyHeader || !/^[a-zA-Z0-9-]+$/.test(provider.apiKeyHeader)) {
    issues.push("Provider API key header is invalid.");
  }
  if (String(provider.apiKeyPrefix).includes("\n") || String(provider.apiKeyPrefix).includes("\r")) {
    issues.push("Provider API key prefix is invalid.");
  }
  for (const [alias, model] of Object.entries(provider.modelMap)) {
    if (!String(model ?? "").trim()) {
      issues.push(`Provider model alias ${alias} is missing.`);
    }
  }
  if (config.requireOsSecretStore && provider.secretSource !== "os_secret_store") {
    issues.push("OS-backed secret store is required for the live provider key.");
  }

  return {
    configured: issues.length === 0,
    issues,
    providerLabel: provider.providerLabel,
    primaryModel: provider.modelMap.primary_reasoning,
    modelMap: provider.modelMap,
    secretSource: provider.secretSource,
    secretStoreActive: provider.secretSource === "os_secret_store",
    envFallbackActive: ["env", "local_env_file"].includes(provider.secretSource),
    secretStoreRequired: config.requireOsSecretStore,
    localEnvFallbackConfigured: provider.localEnvFallbackConfigured,
    secretStoreStatus: provider.secretStoreStatus
  };
}

export function buildPublicLlmConfigStatus(config) {
  return {
    providerMode: config.providerMode,
    requestedProviderMode: config.requestedProviderMode,
    runtimeProfile: config.runtimeProfile,
    productionStrict: config.productionStrict,
    promptEnvironment: config.promptEnvironment,
    allowMockFallback: config.allowMockFallback,
    deterministicFallback: config.deterministicFallback.allowForPrototype,
    budgets: config.budgets,
    vision: config.vision,
    retryPolicy: config.retryPolicy,
    circuitBreaker: config.circuitBreaker,
    logging: {
      path: config.logging.path,
      scope: config.logging.scope,
      enabled: config.logging.enabled
    },
    configIssues: config.issues,
    providers: {
      openaiCompatible: buildPublicOpenAiCompatibleStatus(config)
    }
  };
}
