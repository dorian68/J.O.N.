import { LLM_CALL_TYPE, LLM_MODEL_ALIAS, REASONING_STAGE } from "../config.js";

export const BROWSER_PLAN_SCHEMA_VERSION = "browser_plan_v1";

export const BROWSER_PLAN_INTENTS = Object.freeze([
  "search",
  "site_navigation",
  "structured_extraction",
  "form_preparation",
  "page_review",
  "unknown"
]);

export const BROWSER_PLAN_ACTIONS = Object.freeze([
  "open_session",
  "navigate",
  "wait_state",
  "read_state",
  "read_dom",
  "query_interactive",
  "click",
  "type",
  "select",
  "extract_text",
  "detect_blockers",
  "verify_outcome",
  "capture_evidence",
  "stop_manual_handoff"
]);

const SAFE_PROTOCOLS = new Set(["http:", "https:", "about:"]);
const FORBIDDEN_WEB_TERMS = [
  /\benter\b.{0,40}\b(password|credential|token)\b/i,
  /\b(type|fill|submit)\b.{0,40}\b(password|credential|token)\b/i,
  /\b(payment|purchase|buy)\b/i,
  /\b(bypass|solve|evade|avoid)\b.{0,40}\b(captcha|anti[- ]?bot|bot detection|fingerprint)\b/i,
  /\bstealth\b/i,
  /\bfingerprint\b.{0,30}\bevasion\b/i,
  /\bspoof/i
];

function malformed(message) {
  return Object.assign(new Error(message), {
    category: "malformed_output"
  });
}

function cleanText(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stringArray(value, { maxItems = 12, maxLength = 260 } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const raw = item && typeof item === "object"
      ? item.goal ?? item.label ?? item.description ?? item.summary ?? item.expected ?? item.expectedText ?? item.id ?? JSON.stringify(item)
      : item;
    const text = cleanText(raw, maxLength);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function guardrailStep(action, patch = {}) {
  return {
    id: patch.id ?? `guardrail_${action}`,
    action,
    label: patch.label ?? action,
    target: patch.target ?? {},
    value: null,
    selector: null,
    expectation: null,
    fieldMap: null,
    riskLevel: patch.riskLevel ?? "low",
    requiresApproval: false,
    evidenceLabel: patch.evidenceLabel ?? null,
    stopOnFailure: true
  };
}

function ensureBrowserGuardrailSteps(steps, startUrl) {
  const output = [...steps];

  if (!output.some((step) => step.action === "open_session")) {
    output.unshift(guardrailStep("open_session", {
      id: "open_session",
      label: "Open controlled browser session"
    }));
  }
  if (startUrl && startUrl !== "about:blank" && !output.some((step) => step.action === "navigate" && step.target?.url === startUrl)) {
    const openIndex = Math.max(0, output.findIndex((step) => step.action === "open_session"));
    output.splice(openIndex + 1, 0, guardrailStep("navigate", {
      id: "navigate_start",
      label: "Navigate to authorized start page",
      target: { url: startUrl },
      riskLevel: "medium"
    }));
  }
  const beforeInteractiveSteps = [];
  if (!output.some((step) => step.action === "wait_state")) {
    beforeInteractiveSteps.push(guardrailStep("wait_state", {
      id: "wait_loaded",
      label: "Wait for page load",
      target: { waitState: "domcontentloaded" }
    }));
  }
  if (!output.some((step) => step.action === "read_state")) {
    beforeInteractiveSteps.push(guardrailStep("read_state", {
      id: "read_state",
      label: "Read browser state"
    }));
  }
  if (!output.some((step) => step.action === "read_dom")) {
    beforeInteractiveSteps.push(guardrailStep("read_dom", {
      id: "read_dom",
      label: "Inspect DOM"
    }));
  }
  if (!output.some((step) => step.action === "detect_blockers")) {
    beforeInteractiveSteps.push(guardrailStep("detect_blockers", {
      id: "detect_blockers",
      label: "Detect blocking dialogs"
    }));
  }
  if (beforeInteractiveSteps.length > 0) {
    const firstInteractiveIndex = output.findIndex((step) => ["click", "type", "select"].includes(step.action));
    output.splice(firstInteractiveIndex >= 0 ? firstInteractiveIndex : output.length, 0, ...beforeInteractiveSteps);
  }
  if (!output.some((step) => step.action === "capture_evidence")) {
    output.push(guardrailStep("capture_evidence", {
      id: "capture_evidence",
      label: "Capture browser proof",
      evidenceLabel: "browser-planner-proof"
    }));
  }
  return output;
}

function deriveHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function normalizeHosts(value) {
  return stringArray(value, { maxItems: 20, maxLength: 120 }).map((host) => {
    try {
      return new URL(host).hostname;
    } catch {
      return host.toLowerCase();
    }
  }).filter(Boolean);
}

function normalizeUrl(value, allowlistedHosts, label) {
  const text = cleanText(value, 2048);
  if (!text) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw malformed(`${label} must be a valid URL.`);
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    throw malformed(`${label} uses an unsupported protocol.`);
  }
  if (parsed.protocol === "about:") {
    if (parsed.href !== "about:blank") {
      throw malformed(`${label} only allows about:blank for about URLs.`);
    }
    return parsed.href;
  }
  if (allowlistedHosts.length > 0 && !allowlistedHosts.includes(parsed.hostname)) {
    throw malformed(`${label} is not allowlisted: ${parsed.hostname}.`);
  }
  return parsed.href;
}

function containsForbiddenWebTerm(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return FORBIDDEN_WEB_TERMS.some((pattern) => pattern.test(serialized));
}

function normalizeSelectorSpec(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const selector = {};
  for (const key of ["testId", "role", "name", "label", "text", "css", "tagName"]) {
    const text = cleanText(value[key], key === "css" ? 320 : 160);
    if (text) {
      selector[key] = text;
    }
  }
  if (value.exact != null) {
    selector.exact = Boolean(value.exact);
  }
  if (Object.keys(selector).length === 0) {
    throw malformed(`${label} selector must include testId, role/name, label, text, css, or tagName.`);
  }
  return selector;
}

function tryNormalizeSelectorSpec(value, label) {
  try {
    return normalizeSelectorSpec(value, label);
  } catch {
    return null;
  }
}

function normalizeExpectation(value, allowlistedHosts) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const type = cleanText(value.type, 80);
  if (!["text_visible", "field_value", "checkbox_checked", "url_includes"].includes(type)) {
    throw malformed(`Unsupported browser verification expectation type: ${type}.`);
  }
  const expectation = { type };
  if (value.selector) {
    expectation.selector = normalizeSelectorSpec(value.selector, "verification");
  }
  if (value.expectedText != null) {
    expectation.expectedText = cleanText(value.expectedText, 260);
  }
  if (value.expectedValue != null) {
    expectation.expectedValue = cleanText(value.expectedValue, 260);
  }
  if (value.expectedChecked != null) {
    expectation.expectedChecked = Boolean(value.expectedChecked);
  }
  if (value.expectedUrl != null) {
    const normalized = normalizeUrl(value.expectedUrl, allowlistedHosts, "verification expectedUrl");
    expectation.expectedValue = normalized;
  }
  if (value.expectedUrlIncludes != null) {
    expectation.expectedValue = cleanText(value.expectedUrlIncludes, 260);
  }
  if (value.urlIncludes != null) {
    expectation.expectedValue = cleanText(value.urlIncludes, 260);
  }
  if (value.contains != null) {
    expectation.expectedValue = cleanText(value.contains, 260);
  }
  if (value.value != null) {
    expectation.expectedValue = cleanText(value.value, 260);
  }
  if (type === "url_includes" && value.expectedText != null && !expectation.expectedValue) {
    expectation.expectedValue = cleanText(value.expectedText, 260);
  }
  if (type === "url_includes" && !expectation.expectedValue) {
    throw malformed("url_includes verification requires expectedValue or expectedUrlIncludes.");
  }
  if (type === "text_visible" && !expectation.selector && expectation.expectedText) {
    expectation.selector = {
      text: expectation.expectedText,
      exact: false
    };
  }
  if (["text_visible", "field_value", "checkbox_checked"].includes(type) && !expectation.selector) {
    throw malformed(`${type} verification requires a selector.`);
  }
  return expectation;
}

function normalizeStep(step, index, allowlistedHosts) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw malformed(`Browser plan step ${index + 1} must be an object.`);
  }
  const action = cleanText(step.action ?? step.primitive, 80);
  if (!BROWSER_PLAN_ACTIONS.includes(action)) {
    throw malformed(`Unsupported browser plan action: ${action}.`);
  }
  if (containsForbiddenWebTerm(step) && action !== "stop_manual_handoff") {
    throw malformed("Browser plan includes forbidden stealth, credential, payment, or bypass wording.");
  }
  const target = step.target && typeof step.target === "object" && !Array.isArray(step.target) ? step.target : {};
  const selector = tryNormalizeSelectorSpec(step.selector ?? target.selector ?? target, `step ${index + 1}`);
  const normalized = {
    id: cleanText(step.id, 80) || `browser_step_${index + 1}`,
    action,
    label: cleanText(step.label, 160) || action,
    target: {},
    value: step.value == null ? null : cleanText(step.value, 500),
    selector,
    expectation: normalizeExpectation(step.expectation ?? target.expectation, allowlistedHosts),
    fieldMap: null,
    riskLevel: cleanText(step.riskLevel, 40) || (["click", "type", "select", "navigate"].includes(action) ? "medium" : "low"),
    requiresApproval: step.requiresApproval === true,
    evidenceLabel: cleanText(step.evidenceLabel, 120) || null,
    stopOnFailure: step.stopOnFailure !== false
  };

  const url = step.url ?? target.url;
  if (url) {
    normalized.target.url = normalizeUrl(url, allowlistedHosts, `step ${index + 1} URL`);
  }
  const waitState = cleanText(step.waitState ?? target.waitState ?? step.state, 80);
  if (waitState) {
    normalized.target.waitState = waitState;
  }
  const fieldMap = step.fieldMap ?? target.fieldMap;
  if (fieldMap && typeof fieldMap === "object" && !Array.isArray(fieldMap)) {
    normalized.fieldMap = Object.fromEntries(Object.entries(fieldMap).map(([key, spec]) => [
      cleanText(key, 80),
      normalizeSelectorSpec(spec, `fieldMap.${key}`)
    ]));
  }

  if (["query_interactive", "click", "type", "select", "extract_text"].includes(action) && !normalized.selector && !normalized.fieldMap) {
    throw malformed(`Browser action ${action} requires a selector or fieldMap.`);
  }
  if (["type", "select"].includes(action) && normalized.value == null) {
    throw malformed(`Browser action ${action} requires a value.`);
  }
  if (action === "navigate" && !normalized.target.url) {
    throw malformed("Browser navigate step requires an allowlisted URL.");
  }
  if (action === "verify_outcome" && !normalized.expectation) {
    throw malformed("Browser verify_outcome step requires an expectation.");
  }

  return normalized;
}

export function validateBrowserPlanOutput(output, context = {}) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw malformed("Browser plan output must be an object.");
  }
  if (containsForbiddenWebTerm(output.steps)) {
    throw malformed("Browser plan must not include stealth, anti-bot bypass, credentials, payments, or evasion.");
  }

  const contextHosts = normalizeHosts(context.allowlistedHosts ?? context.allowlistedDomains ?? []);
  const plannedHosts = normalizeHosts(output.allowlistedHosts ?? []);
  const allowlistedHosts = contextHosts.length > 0
    ? Array.from(new Set(contextHosts))
    : Array.from(new Set(plannedHosts));
  const startUrl = normalizeUrl(output.startUrl ?? context.startUrl ?? context.url ?? null, allowlistedHosts, "startUrl");
  if (startUrl && allowlistedHosts.length === 0) {
    allowlistedHosts.push(deriveHost(startUrl));
  }

  const steps = ensureBrowserGuardrailSteps(
    (Array.isArray(output.steps) ? output.steps : []).map((step, index) => normalizeStep(step, index, allowlistedHosts)),
    startUrl
  );
  if (steps.length === 0) {
    throw malformed("Browser plan requires at least one step.");
  }

  return {
    schemaVersion: BROWSER_PLAN_SCHEMA_VERSION,
    missionSummary: cleanText(output.missionSummary ?? context.mission, 360) || "Browser mission",
    intentType: BROWSER_PLAN_INTENTS.includes(output.intentType) ? output.intentType : "unknown",
    coverageStatus: cleanText(output.coverageStatus, 80) || "bounded_first_run",
    startUrl,
    allowlistedHosts,
    requiresClarification: Boolean(output.requiresClarification),
    clarificationQuestion: Boolean(output.requiresClarification) ? cleanText(output.clarificationQuestion, 220) : "",
    steps,
    verificationGoals: stringArray(output.verificationGoals, { maxItems: 8 }),
    expectedEvidence: stringArray(output.expectedEvidence, { maxItems: 8 }),
    blockersToDetect: stringArray(output.blockersToDetect, { maxItems: 8 }),
    manualHandoffReasons: stringArray(output.manualHandoffReasons, { maxItems: 8 }),
    safetyNotes: stringArray(output.safetyNotes, { maxItems: 8 }),
    confidence: cleanText(output.confidence, 40) || "medium"
  };
}

function selectorFromInput(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function defaultStartUrl(input = {}) {
  return input.startUrl ?? input.url ?? input.allowedUrls?.[0] ?? input.allowlistedUrls?.[0] ?? "about:blank";
}

export function buildDeterministicBrowserPlan(input = {}) {
  const mission = cleanText(input.mission ?? "Browser mission", 360);
  const startUrl = defaultStartUrl(input);
  const allowlistedHosts = normalizeHosts(input.allowlistedHosts ?? input.allowlistedDomains ?? [
    deriveHost(startUrl)
  ]);
  const steps = [
    {
      id: "open_session",
      action: "open_session",
      label: "Open controlled browser session",
      requiresApproval: false,
      riskLevel: "low"
    }
  ];

  if (startUrl && startUrl !== "about:blank") {
    steps.push({
      id: "navigate_start",
      action: "navigate",
      label: "Navigate to authorized start page",
      target: { url: startUrl },
      requiresApproval: false,
      riskLevel: "medium",
      stopOnFailure: true
    });
  }

  steps.push(
    {
      id: "wait_loaded",
      action: "wait_state",
      label: "Wait for page load",
      target: { waitState: "domcontentloaded" },
      requiresApproval: false,
      riskLevel: "low"
    },
    {
      id: "read_state",
      action: "read_state",
      label: "Read browser state",
      requiresApproval: false,
      riskLevel: "low"
    },
    {
      id: "read_dom",
      action: "read_dom",
      label: "Inspect DOM",
      requiresApproval: false,
      riskLevel: "low"
    },
    {
      id: "detect_blockers",
      action: "detect_blockers",
      label: "Detect blocking dialogs",
      requiresApproval: false,
      riskLevel: "low",
      stopOnFailure: true
    }
  );

  for (const [index, hint] of (input.stepHints ?? []).entries()) {
    if (!hint || typeof hint !== "object") {
      continue;
    }
    steps.push({
      id: cleanText(hint.id, 80) || `hint_${index + 1}`,
      action: hint.action,
      label: cleanText(hint.label, 160) || hint.action,
      target: hint.target ?? {},
      selector: selectorFromInput(hint.selector),
      value: hint.value ?? null,
      expectation: hint.expectation ?? null,
      fieldMap: hint.fieldMap ?? null,
      requiresApproval: hint.requiresApproval === true,
      riskLevel: hint.riskLevel ?? (["click", "type", "select"].includes(hint.action) ? "medium" : "low"),
      stopOnFailure: hint.stopOnFailure !== false
    });
  }

  if (input.fieldMap && typeof input.fieldMap === "object") {
    steps.push({
      id: "extract_requested_fields",
      action: "extract_text",
      label: "Extract requested fields",
      fieldMap: input.fieldMap,
      requiresApproval: false,
      riskLevel: "low"
    });
  }

  steps.push({
    id: "capture_evidence",
    action: "capture_evidence",
    label: "Capture browser proof",
    evidenceLabel: "browser-planner-proof",
    requiresApproval: false,
    riskLevel: "low"
  });

  if (startUrl && startUrl !== "about:blank") {
    steps.push({
      id: "verify_url",
      action: "verify_outcome",
      label: "Verify current URL stayed on the authorized surface",
      expectation: {
        type: "url_includes",
        expectedUrlIncludes: deriveHost(startUrl)
      },
      requiresApproval: false,
      riskLevel: "low"
    });
  }

  return validateBrowserPlanOutput({
    schemaVersion: BROWSER_PLAN_SCHEMA_VERSION,
    missionSummary: mission,
    intentType: input.intentType ?? "site_navigation",
    coverageStatus: "bounded_first_run",
    startUrl,
    allowlistedHosts,
    steps,
    verificationGoals: [
      "Confirm the active tab URL stays allowlisted.",
      "Confirm DOM state was read before interaction.",
      "Capture screenshot evidence with browser state."
    ],
    expectedEvidence: ["browser_plan", "browser_session_state", "dom_snapshot", "page_screenshot"],
    blockersToDetect: ["modal_dialog", "auth_gate", "captcha_or_automation_block"],
    manualHandoffReasons: [
      "Authentication, CAPTCHA, payment, credential, or anti-bot blocker appears.",
      "The DOM target is ambiguous and cannot be resolved safely."
    ],
    safetyNotes: [
      "No stealth, anti-bot bypass, payment, credential entry, or hidden automation.",
      "Stop with manual handoff instead of guessing on blocked or ambiguous pages."
    ],
    confidence: "medium"
  }, { allowlistedHosts, startUrl });
}

export async function generateBrowserPlan({
  llmGateway = null,
  runId = "browser_plan_preview",
  projectId = "browser_operator",
  input = {}
} = {}) {
  if (!llmGateway) {
    return {
      output: buildDeterministicBrowserPlan(input),
      callRecord: null,
      generationMode: "deterministic_fallback"
    };
  }

  try {
    const result = await llmGateway.generateStructured({
      runId,
      projectId,
      callType: LLM_CALL_TYPE.BROWSER_PLAN,
      modelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING,
      promptRefs: [
        {
          promptId: "system.primary_reasoning",
          version: "1.0.0"
        },
        {
          promptId: "task.browser_plan",
          version: "1.0.0",
          bindings: {
            mission: input.mission ?? "",
            startUrl: input.startUrl ?? input.url ?? "",
            allowlistedHosts: JSON.stringify(input.allowlistedHosts ?? input.allowlistedDomains ?? []),
            currentBrowserState: JSON.stringify(input.currentBrowserState ?? null),
            currentDomSnapshot: JSON.stringify(input.currentDomSnapshot ?? null),
            capabilityGraph: JSON.stringify(input.capabilityGraph ?? null),
            stepHints: JSON.stringify(input.stepHints ?? []),
            fieldMap: JSON.stringify(input.fieldMap ?? null),
            expectedOutcome: input.expectedOutcome ?? ""
          }
        }
      ],
      input,
      metadata: {
        reasoningStage: REASONING_STAGE.BROWSER_PLAN,
        browserPlannerVersion: BROWSER_PLAN_SCHEMA_VERSION,
        requestedModelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING
      },
      validateOutput: (output) => validateBrowserPlanOutput(output, input)
    });
    return {
      output: result.output,
      callRecord: result.callRecord,
      generationMode: "llm"
    };
  } catch (error) {
    return {
      output: buildDeterministicBrowserPlan(input),
      callRecord: error.callRecord ?? null,
      generationMode: "deterministic_fallback",
      fallbackReason: error.category ?? "provider_unavailable"
    };
  }
}
