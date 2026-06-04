// Structured, backend-first test logging — implements the logging standard from
// docs/jon-backend-first-testing.md:
//   [STEP] / [STATUS] / [REQUEST] / [INPUT] / [OUTPUT] / [ERROR] / [NEXT]
// with mandatory secret masking. Used by the JON CLI test campaign so every flow
// is observable, reproducible, and its failure point explicit — without the UI.

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|apikey|authorization|cookie|private[_-]?key|seed|mnemonic|credential)/i;

// Masks a single secret value: presence + first/last 4 + length only.
export function maskSecret(value) {
  if (value == null) return { present: false };
  const str = String(value);
  if (str.length === 0) return { present: false };
  return {
    present: true,
    preview: str.length <= 8 ? "****" : `${str.slice(0, 4)}…${str.slice(-4)}`,
    length: str.length
  };
}

// Recursively masks any object so secret-looking keys never print in full.
export function maskObject(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => maskObject(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = maskSecret(typeof val === "string" ? val : JSON.stringify(val));
      } else {
        out[key] = maskObject(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

// Builds a normalized, actionable error object (paradigm "Error Handling Standard").
export function structuredError({ step, code, message, raw = null, possibleCauses = [], nextActions = [] }) {
  return {
    success: false,
    step,
    error: {
      code: code ?? "UNKNOWN",
      message: message ?? "Unspecified error",
      rawProviderMessage: raw ? String(raw).slice(0, 600) : null,
      possibleCauses,
      nextActions
    }
  };
}

function fmt(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(maskObject(value));
  } catch {
    return String(value);
  }
}

const STATUS_ICON = { success: "✅", fail: "❌", skipped: "⏭️", warn: "⚠️" };

export class StepLogger {
  constructor({ flowId = null, json = false, sink = console } = {}) {
    this.flowId = flowId;
    this.json = json;
    this.sink = sink;
    this.steps = [];
  }

  // Emit one structured step. Returns the recorded entry.
  log({ step, status = "success", request = null, input = null, output = null, error = null, next = null }) {
    const entry = {
      flow: this.flowId,
      step,
      status,
      request,
      input: input == null ? null : maskObject(input),
      output: output == null ? null : maskObject(output),
      error: error == null ? null : (typeof error === "string" ? error : maskObject(error)),
      next,
      at: new Date().toISOString()
    };
    this.steps.push(entry);

    if (this.json) {
      this.sink.log(JSON.stringify(entry));
      return entry;
    }

    const icon = STATUS_ICON[status] ?? "";
    const prefix = this.flowId ? `(${this.flowId}) ` : "";
    this.sink.log(`  ${prefix}[STEP] ${step}  ${icon} ${status}`);
    if (request != null) this.sink.log(`        [REQUEST] ${fmt(request)}`);
    if (input != null) this.sink.log(`        [INPUT]   ${fmt(input)}`);
    if (output != null) this.sink.log(`        [OUTPUT]  ${fmt(output)}`);
    if (error != null) this.sink.log(`        [ERROR]   ${fmt(error)}`);
    if (next != null) this.sink.log(`        [NEXT]    ${next}`);
    return entry;
  }

  ok(step, fields = {}) {
    return this.log({ step, status: "success", ...fields });
  }

  fail(step, fields = {}) {
    return this.log({ step, status: "fail", ...fields });
  }

  skip(step, fields = {}) {
    return this.log({ step, status: "skipped", ...fields });
  }

  warn(step, fields = {}) {
    return this.log({ step, status: "warn", ...fields });
  }
}
