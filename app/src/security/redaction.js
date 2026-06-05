const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|apikey|authorization|secret|password|passwd|cookie|set-cookie|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|x-api-key|session[-_]?token|bearer)/i;
const SENSITIVE_TOKEN_KEY_PATTERN = /(^token$|[-_]token$|^code$|^state$)/i;
// Value patterns: known key shapes embedded in free-text (e.g. provider error
// strings). Covers OpenAI sk-/sk-proj-, generic bearer, AWS, Google, GitHub,
// Slack, and long opaque secrets following an auth-ish prefix. (audit T6)
const SENSITIVE_VALUE_PATTERNS = [
  // \r\n kept in the class so secrets split across log line-wraps are still caught.
  /sk-proj-[A-Za-z0-9._\r\n-]{10,}/gi,
  /sk-[A-Za-z0-9._\r\n-]{10,}/gi,
  /Bearer\s+[A-Za-z0-9._\r\n-]{10,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,                                  // AWS access key id
  /\bAIza[0-9A-Za-z._-]{20,}\b/g,                            // Google API key
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,                         // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi,                      // Slack tokens
  /\beyJ[A-Za-z0-9._-]{20,}\b/g,                             // JWT (eyJ...)
  // "<auth-ish header/word>: <secret>" or "=<secret>" — masks custom provider keys
  /((?:api[-_]?key|x-api-key|authorization|token|secret|password)\s*[:=]\s*)[^\s"'`,;]{8,}/gi
];

// When a value pattern includes a captured prefix group, keep the prefix and
// redact the rest. For simple patterns (no group) we replace the whole match.
function applyValuePattern(text, pattern) {
  return text.replace(pattern, (match, prefix) => (prefix ? `${prefix}${REDACTED}` : REDACTED));
}

function redactString(value) {
  if (!value) {
    return value;
  }
  let redacted = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    redacted = applyValuePattern(redacted, pattern);
  }
  return redacted;
}

function isSensitiveKey(key) {
  const normalizedKey = String(key ?? "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_TOKEN_KEY_PATTERN.test(normalizedKey);
}

export function sanitizeForLogging(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogging(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveKey(key) ? REDACTED : sanitizeForLogging(entry)
      ])
    );
  }

  return value;
}
