import { DEFAULT_LLM_TIMEOUT_MS, LLM_PROVIDER_ALIAS } from "../../config.js";
import { sanitizeForLogging } from "../../security/redaction.js";
import { normalizeSecretValue } from "../../security/secret-normalization.js";

function extractMessageContent(message) {
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message.map((part) => part?.text ?? "").join("\n");
  }
  return message?.content ?? "";
}

function messageContentContainsJson(content) {
  if (typeof content === "string") {
    return /\bjson\b/i.test(content);
  }
  if (Array.isArray(content)) {
    return content.some((part) => messageContentContainsJson(part?.text ?? ""));
  }
  return /\bjson\b/i.test(content?.content ?? "");
}

function ensureJsonResponseInstruction(messages) {
  if (messages.some((message) => messageContentContainsJson(message?.content ?? message))) {
    return messages;
  }
  return [
    {
      role: "system",
      content: "Return a valid JSON object only. Your final answer must be JSON."
    },
    ...messages
  ];
}

function shouldSendTemperature(providerModel) {
  return !String(providerModel ?? "").toLowerCase().startsWith("gpt-5");
}

function categorizeProviderError(responseStatus) {
  if (responseStatus === 401 || responseStatus === 403) {
    return "auth_error";
  }
  if (responseStatus === 408) {
    return "timeout";
  }
  if (responseStatus === 429) {
    return "rate_limit";
  }
  if (responseStatus >= 500) {
    return "provider_unavailable";
  }
  return "malformed_output";
}

function parseRetryAfterMs(headers) {
  const retryAfter = headers?.get?.("retry-after");
  if (!retryAfter) {
    return null;
  }
  const asSeconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(asSeconds)) {
    return Math.max(0, Math.round(asSeconds * 1000));
  }
  const asDate = Date.parse(retryAfter);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

function estimateCost(tokenUsage, pricing) {
  if (!tokenUsage || !pricing || pricing.inputPer1k == null || pricing.outputPer1k == null) {
    return null;
  }
  const inputCost = ((tokenUsage.inputTokens ?? 0) / 1000) * pricing.inputPer1k;
  const outputCost = ((tokenUsage.outputTokens ?? 0) / 1000) * pricing.outputPer1k;
  return Number((inputCost + outputCost).toFixed(6));
}

export class OpenAiCompatibleProvider {
  constructor({
    providerAlias = LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE,
    baseUrl = process.env.COWORK_OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey = process.env.COWORK_OPENAI_API_KEY || "",
    apiKeyHeader = process.env.COWORK_OPENAI_API_KEY_HEADER || "authorization",
    apiKeyPrefix = process.env.COWORK_OPENAI_API_KEY_PREFIX == null ? "Bearer " : process.env.COWORK_OPENAI_API_KEY_PREFIX,
    timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    modelMap = {
      primary_reasoning: process.env.COWORK_OPENAI_PRIMARY_MODEL || process.env.COWORK_OPENAI_MODEL || "gpt-4.1-mini",
      utility_structuring: process.env.COWORK_OPENAI_UTILITY_MODEL || process.env.COWORK_OPENAI_MODEL || "gpt-4.1-mini",
      vision_fallback: process.env.COWORK_OPENAI_VISION_MODEL || "gpt-5-mini"
    },
    pricing = {}
  } = {}) {
    this.providerAlias = providerAlias;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = normalizeSecretValue(apiKey);
    this.apiKeyHeader = String(apiKeyHeader || "authorization").trim().toLowerCase();
    this.apiKeyPrefix = apiKeyPrefix ?? "";
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.modelMap = modelMap;
    this.pricing = pricing;
  }

  isEnabled() {
    return Boolean(this.apiKey && this.fetchImpl);
  }

  resolveModel(modelAlias) {
    return this.modelMap[modelAlias] ?? null;
  }

  validateConfig() {
    const issues = [];
    if (!this.apiKey) {
      issues.push("Missing provider API key.");
    }
    try {
      new URL(this.baseUrl);
    } catch {
      issues.push("Provider base URL is invalid.");
    }
    if (!this.fetchImpl) {
      issues.push("No fetch implementation available for the provider.");
    }
    if (!this.apiKeyHeader || !/^[a-z0-9-]+$/i.test(this.apiKeyHeader)) {
      issues.push("Provider API key header is invalid.");
    }
    if (String(this.apiKeyPrefix).includes("\n") || String(this.apiKeyPrefix).includes("\r")) {
      issues.push("Provider API key prefix is invalid.");
    }
    for (const [alias, model] of Object.entries(this.modelMap)) {
      if (!String(model ?? "").trim()) {
        issues.push(`Provider model alias ${alias} is missing.`);
      }
    }
    return {
      valid: issues.length === 0,
      issues
    };
  }

  getPublicStatus() {
    const validation = this.validateConfig();
    return {
      configured: validation.valid,
      issues: validation.issues,
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      modelMap: this.modelMap
    };
  }

  async generateStructured({ modelAlias, messages, extraMessages = [] }) {
    const validation = this.validateConfig();
    if (!validation.valid) {
      throw Object.assign(new Error("OpenAI-compatible provider is not configured."), {
        category: "auth_error",
        issues: validation.issues
      });
    }

    const providerModel = this.resolveModel(modelAlias);
    if (!providerModel) {
      throw Object.assign(new Error(`No configured model for alias ${modelAlias}.`), {
        category: "malformed_output"
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const preparedMessages = ensureJsonResponseInstruction([...messages, ...(extraMessages ?? [])]);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          [this.apiKeyHeader]: `${this.apiKeyPrefix}${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: providerModel,
          ...(shouldSendTemperature(providerModel) ? { temperature: 0 } : {}),
          response_format: {
            type: "json_object"
          },
          messages: preparedMessages
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw Object.assign(new Error(sanitizeForLogging(payload?.error?.message ?? `Provider request failed with status ${response.status}.`)), {
          category: categorizeProviderError(response.status),
          retryAfterMs: parseRetryAfterMs(response.headers)
        });
      }

      const content = extractMessageContent(payload?.choices?.[0]?.message);
      let output;
      try {
        output = JSON.parse(content);
      } catch {
        throw Object.assign(new Error("Provider returned a non-JSON structured output."), {
          category: "malformed_output"
        });
      }

      const tokenUsage = payload?.usage
        ? {
          inputTokens: payload.usage.prompt_tokens ?? null,
          outputTokens: payload.usage.completion_tokens ?? null,
          totalTokens: payload.usage.total_tokens ?? null
        }
        : null;

      return {
        output,
        rawOutput: content,
        providerModel,
        tokenUsage,
        estimatedCost: estimateCost(tokenUsage, this.pricing[modelAlias] ?? null)
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw Object.assign(new Error("Provider request timed out."), {
          category: "timeout"
        });
      }
      if (!error.category) {
        throw Object.assign(new Error(sanitizeForLogging(error.message || "Provider request failed.")), {
          category: "provider_unavailable"
        });
      }
      error.message = sanitizeForLogging(error.message);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
