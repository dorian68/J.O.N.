import assert from "node:assert/strict";
import { sanitizeForLogging } from "../src/security/redaction.js";

export async function run() {
  const sanitized = sanitizeForLogging({
    apiKey: "sk-secret-value",
    nested: {
      authorization: "Bearer abcdefghijklmnop",
      message: "safe",
      list: [
        "sk-another-secret-value",
        {
          token: "opaque-token"
        }
      ]
    }
  });

  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.nested.authorization, "[REDACTED]");
  assert.equal(sanitized.nested.message, "safe");
  assert.equal(sanitized.nested.list[0], "[REDACTED]");
  assert.equal(sanitized.nested.list[1].token, "[REDACTED]");

  const multiline = sanitizeForLogging("Headers.append: \"Bearer sk-proj-\nABCDE12345\nFGHIJ67890\" is an invalid header value.");
  assert.equal(multiline.includes("sk-proj-"), false);
  assert.equal(multiline.includes("[REDACTED]"), true);
}
