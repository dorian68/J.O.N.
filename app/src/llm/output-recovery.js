function balancedJsonSlice(text) {
  const raw = String(text ?? "");
  const start = raw.search(/[{[]/);
  if (start < 0) return "";
  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) depth -= 1;
    if (depth === 0) {
      return raw.slice(start, i + 1);
    }
  }
  return "";
}

export function parseJsonLoose(value) {
  if (value && typeof value === "object") {
    return { ok: true, value, repaired: false, strategy: "already_object" };
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { ok: false, value: null, repaired: false, strategy: "empty", error: "No output text." };
  }
  try {
    return { ok: true, value: JSON.parse(raw), repaired: false, strategy: "json_parse" };
  } catch (error) {
    const candidate = balancedJsonSlice(raw);
    if (!candidate) {
      return { ok: false, value: null, repaired: false, strategy: "no_json_object", error: error.message };
    }
    try {
      return { ok: true, value: JSON.parse(candidate), repaired: true, strategy: "balanced_json_extract" };
    } catch (repairError) {
      return { ok: false, value: null, repaired: false, strategy: "balanced_json_extract_failed", error: repairError.message };
    }
  }
}

export function recoverStructuredOutput({
  output,
  validateOutput = null,
  fallbackOutput = null
} = {}) {
  const parsed = parseJsonLoose(output);
  if (parsed.ok) {
    try {
      const validated = validateOutput ? validateOutput(parsed.value) : parsed.value;
      return {
        status: parsed.repaired ? "repaired" : "valid",
        output: validated,
        repaired: parsed.repaired,
        strategy: parsed.strategy,
        error: null
      };
    } catch (error) {
      if (fallbackOutput != null) {
        return {
          status: "fallback",
          output: fallbackOutput,
          repaired: parsed.repaired,
          strategy: "validator_failed_fallback",
          error: error.message
        };
      }
      return {
        status: "blocked",
        output: null,
        repaired: parsed.repaired,
        strategy: "validator_failed",
        error: error.message
      };
    }
  }
  if (fallbackOutput != null) {
    return {
      status: "fallback",
      output: fallbackOutput,
      repaired: false,
      strategy: "parse_failed_fallback",
      error: parsed.error
    };
  }
  return {
    status: "blocked",
    output: null,
    repaired: false,
    strategy: parsed.strategy,
    error: parsed.error
  };
}
