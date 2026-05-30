export function normalizeSecretValue(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim().replace(/[\r\n\t]+/g, "");
}

const SECRET_KEY_PATTERN = /\b(api[_-]?key|token|secret|password|passwd|auth[_-]?key|bearer)\b/i;

// Redact secret values from plain objects before logging or serializing.
// Walks one level deep — sufficient for env-var objects and simple configs.
export function redactSecrets(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = typeof value === "string" && value.length > 0 ? "[REDACTED]" : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Redact known secret patterns from a string (e.g. error messages, stack traces).
export function redactStringSecrets(text) {
  if (typeof text !== "string") return text;
  // Redact sk-... style keys (OpenAI, Anthropic) and Bearer tokens
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/g, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)[=:\s]+["']?[A-Za-z0-9._\-/+=]{8,}["']?/gi, "$1=[REDACTED]");
}
