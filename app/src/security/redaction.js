const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|cookie|set-cookie)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9._\r\n-]{10,}/gi,
  /Bearer\s+[A-Za-z0-9._\r\n-]{10,}/gi
];

function redactString(value) {
  if (!value) {
    return value;
  }
  let redacted = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
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
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeForLogging(entry)
      ])
    );
  }

  return value;
}
