import { inferMissionMode } from "../mission/mission-understanding.js";

const DEFAULT_FORM_VALUES = Object.freeze({
  name: "Jordan Labry",
  role: "operator",
  subscribe: false
});

const FORM_ROLE_OPTIONS = Object.freeze([
  { value: "analyst", label: "Analyst" },
  { value: "operator", label: "Operator" },
  { value: "lead", label: "Lead" }
]);

const DEFAULT_LIMITS = Object.freeze({
  objectiveMaxLength: 360,
  deliverableMaxLength: 180,
  lineItemMaxLength: 180,
  maxListItems: 6,
  formNameMaxLength: 120
});

const STARTER_MISSIONS = Object.freeze([
  {
    id: "research-compare-pages",
    mode: "research",
    label: "Compare two pages",
    description: "Review allowlisted pages, capture the important differences, and prepare a short decision note.",
    objective: "Compare the allowlisted pages, pull out the meaningful differences, and prepare a short decision note.",
    deliverable: "Decision note with the key differences and a recommendation",
    constraints: [
      "Use only the allowlisted pages for this project.",
      "Keep uncertainty explicit when information is missing."
    ],
    forbiddenActions: [
      "Do not leave the bounded browsing scope."
    ]
  },
  {
    id: "form-prepare-review",
    mode: "form",
    label: "Prepare a form",
    description: "Fill the controlled form with provided values, then stop before submission.",
    objective: "Prepare the controlled form with the provided values, verify the visible state, and stop before submission.",
    deliverable: "Confirmed form state ready for operator review",
    constraints: [
      "Stay on the controlled form only."
    ],
    forbiddenActions: [
      "Do not submit the form."
    ]
  },
  {
    id: "computer-observe-window",
    mode: "computer",
    label: "Check a local window",
    description: "Bring an allowlisted local window to the front after approval and verify what is visible.",
    objective: "After approval, bring the allowlisted local window to the front and verify what is visible on screen.",
    deliverable: "Observation summary with visible proof",
    constraints: [
      "Only use the allowlisted local window."
    ],
    forbiddenActions: [
      "Do not perform general desktop actuation."
    ]
  }
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeRequiredText(value, label, maxLength) {
  const normalized = normalizeLine(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeOptionalText(value, label, maxLength) {
  const normalized = normalizeLine(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function firstOptionalText(values, label, maxLength) {
  for (const value of values) {
    const normalized = normalizeOptionalText(value, label, maxLength);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeList(value, label, { maxItems, maxItemLength }) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  const items = rawItems
    .map((entry) => normalizeLine(entry))
    .filter(Boolean);
  if (items.length > maxItems) {
    throw new Error(`${label} supports at most ${maxItems} items.`);
  }
  for (const item of items) {
    if (item.length > maxItemLength) {
      throw new Error(`${label} items must be ${maxItemLength} characters or fewer.`);
    }
  }
  return items;
}

function normalizeBrowserIdHint(value) {
  const hint = normalizeLine(value).toLowerCase();
  if (!hint) {
    return "";
  }
  if (/\b(chrome|google chrome)\b/.test(hint)) {
    return "chrome";
  }
  if (/\b(edge|microsoft edge|msedge)\b/.test(hint)) {
    return "edge";
  }
  if (/\b(firefox|mozilla firefox)\b/.test(hint)) {
    return "firefox";
  }
  if (/\b(brave|brave browser)\b/.test(hint)) {
    return "brave";
  }
  return /^[a-z][a-z0-9_-]{1,39}$/.test(hint) && ["chrome", "edge", "firefox", "brave"].includes(hint)
    ? hint
    : "";
}

const RESULT_TYPE_HINTS = Object.freeze([
  { value: "jobs", patterns: [/\b(jobs?|postes?|offres?|emploi|missions?)\b/i] },
  { value: "profiles", patterns: [/\b(profiles?|profils?|contacts?|people|personnes?)\b/i] },
  { value: "products", patterns: [/\b(products?|produits?|articles a vendre|articles à vendre)\b/i] },
  { value: "articles", patterns: [/\b(articles?|posts?|billets?|publications?)\b/i] },
  { value: "documents", patterns: [/\b(documents?|docs?|pdfs?|fichiers?)\b/i] },
  { value: "tickets", patterns: [/\b(tickets?|issues?|bugs?|incidents?)\b/i] }
]);

function inferResultType(input, rawParameters = {}, rawBrowserLaunch = {}) {
  const explicit = firstOptionalText([
    rawBrowserLaunch.resultType,
    rawBrowserLaunch.itemType,
    rawParameters.resultType,
    rawParameters.itemType,
    rawParameters.resultKind
  ], "Browser result type", 60);
  if (explicit) {
    return explicit.toLowerCase();
  }
  const text = [
    input.objective,
    input.deliverable,
    ...(Array.isArray(input.constraints) ? input.constraints : typeof input.constraints === "string" ? input.constraints.split(/\r?\n/) : [])
  ].map((entry) => normalizeLine(entry)).join(" ");
  for (const hint of RESULT_TYPE_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(text))) {
      return hint.value;
    }
  }
  return "";
}

function normalizeSiteHint(value) {
  const raw = normalizeLine(value);
  if (!raw) {
    return {
      raw: "",
      url: "",
      host: "",
      targetSite: ""
    };
  }
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw) ? `https://${raw}` : "";
  if (candidate) {
    try {
      const parsed = new URL(candidate);
      return {
        raw,
        url: parsed.toString(),
        host: parsed.hostname,
        targetSite: parsed.hostname.replace(/^www\./i, "")
      };
    } catch {
      return {
        raw,
        url: candidate,
        host: "",
        targetSite: raw
      };
    }
  }
  return {
    raw,
    url: "",
    host: "",
    targetSite: raw
  };
}

function buildGenericSearchUrl({ siteHint = {}, searchQuery = "", resultType = "" } = {}) {
  const parts = [];
  if (siteHint.host) {
    parts.push(`site:${siteHint.host}`);
  } else if (siteHint.targetSite) {
    parts.push(siteHint.targetSite);
  }
  if (searchQuery) {
    parts.push(searchQuery);
  }
  if (resultType && !parts.some((part) => part.toLowerCase().includes(resultType.toLowerCase()))) {
    parts.push(resultType);
  }
  const query = parts.join(" ").trim();
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : "";
}

function looksLikeSearchUrl(value) {
  try {
    const parsed = new URL(String(value ?? ""));
    return /(^|\.)google\./i.test(parsed.hostname)
      || /(^|\.)bing\./i.test(parsed.hostname)
      || /duckduckgo\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizePositiveInteger(value, { min = 1, max = 50 } = {}) {
  const raw = normalizeLine(value);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return null;
  }
  return Math.min(parsed, max);
}

function normalizeCoreMissionParameters(input) {
  const browserLaunch = normalizeBrowserLaunchParameters(input);
  return {
    ...browserLaunch,
    ...normalizeComputerActionParameters(input, browserLaunch),
    ...normalizeApplicationLaunchParameters(input)
  };
}

function deliverableHintForMode(modeId) {
  switch (modeId) {
    case "research":
      return "Tableau de collecte navigateur + Note de decision";
    case "form":
      return "Controlled form state verification, then stop before submission";
    case "computer":
      return "Visible local-window evidence and verified observation";
    default:
      return "Bounded supervised run output";
  }
}

function scopeHintForMode(modeId) {
  switch (modeId) {
    case "research":
      return "Bounded browser reading on the configured allowlisted surfaces.";
    case "form":
      return "Controlled fixture form editing only, with explicit approvals and no submission.";
    case "computer":
      return "Observation, allowlisted focus, and visible verification only.";
    default:
      return "Bounded supervised run.";
  }
}

export function buildMissionEntryContract({ scenarios = [] } = {}) {
  const modes = scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
    writeBoundary: scenario.writeBoundary,
    evidenceFocus: scenario.evidenceFocus,
    deliverableHint: deliverableHintForMode(scenario.id),
    scopeHint: scopeHintForMode(scenario.id)
  }));
  return {
    defaultModeId: modes.find((mode) => mode.id === "research")?.id ?? modes[0]?.id ?? null,
    notices: [
      "You stay in control. Sensitive steps still pause for approval.",
      "This starts a bounded run, not an open-ended chat."
    ],
    limits: DEFAULT_LIMITS,
    modes,
    formDefaults: DEFAULT_FORM_VALUES,
    formRoleOptions: FORM_ROLE_OPTIONS,
    starterMissions: STARTER_MISSIONS
  };
}

function normalizeFormParameters(input, missionEntryContract, limits) {
  const rawFormValues = isObject(input.parameters?.formValues) ? input.parameters.formValues : {};
  const role = normalizeOptionalText(rawFormValues.role ?? missionEntryContract.formDefaults?.role, "Form role", 40)
    || missionEntryContract.formDefaults?.role
    || DEFAULT_FORM_VALUES.role;
  if (!FORM_ROLE_OPTIONS.some((option) => option.value === role)) {
    throw new Error(`Unsupported form role: ${role}.`);
  }
  return {
    formValues: {
      name: normalizeRequiredText(
        rawFormValues.name ?? missionEntryContract.formDefaults?.name ?? DEFAULT_FORM_VALUES.name,
        "Form candidate name",
        limits.formNameMaxLength
      ),
      role,
      subscribe: typeof rawFormValues.subscribe === "boolean"
        ? rawFormValues.subscribe
        : Boolean(missionEntryContract.formDefaults?.subscribe ?? DEFAULT_FORM_VALUES.subscribe)
    }
  };
}

function normalizeBrowserLaunchParameters(input) {
  const rawParameters = isObject(input.parameters) ? input.parameters : {};
  const rawBrowserLaunch = isObject(rawParameters.browserLaunch) ? rawParameters.browserLaunch : {};
  const searchQuery = firstOptionalText([
    rawBrowserLaunch.searchQuery,
    rawBrowserLaunch.query,
    rawParameters.searchQuery,
    rawParameters.query,
    rawParameters.keyword,
    rawParameters.keywords
  ], "Browser search query", 180);
  const resultType = inferResultType(input, rawParameters, rawBrowserLaunch);
  const browserId = normalizeBrowserIdHint(
    rawBrowserLaunch.browserId
      ?? rawBrowserLaunch.browserLabel
      ?? rawParameters.browserId
      ?? rawParameters.browser
      ?? rawParameters.application
      ?? rawParameters.applicationName
  ) || normalizeOptionalText(rawBrowserLaunch.browserId, "Preferred browser", 40);
  const explicitUrlHint = normalizeSiteHint(firstOptionalText([
    rawBrowserLaunch.url,
    rawBrowserLaunch.launchUrl,
    rawParameters.url,
    rawParameters.launchUrl,
    rawParameters.browserLaunchUrl,
    rawParameters.targetUrl
  ], "Browser launch URL", 300));
  const websiteHint = normalizeSiteHint(firstOptionalText([
    rawBrowserLaunch.targetSite,
    rawBrowserLaunch.website,
    rawParameters.targetSite,
    rawParameters.websiteUrl,
    rawParameters.website,
    rawParameters.site
  ], "Browser target site", 180));
  const explicitUrlIsSearch = looksLikeSearchUrl(explicitUrlHint.url);
  const siteHint = explicitUrlHint.raw && !explicitUrlIsSearch ? explicitUrlHint : websiteHint;
  const url = explicitUrlHint.url || (!searchQuery && !resultType ? websiteHint.url : "");
  const resultCount = normalizePositiveInteger(
    rawBrowserLaunch.resultCount
      ?? rawParameters.resultCount
      ?? rawParameters.count
      ?? rawParameters.limit
      ?? rawParameters.maxResults
  );
  const searchUrl = (explicitUrlIsSearch ? explicitUrlHint.url : "")
    || normalizeSiteHint(rawBrowserLaunch.searchUrl ?? rawParameters.searchUrl).url
    || (searchQuery || resultCount || (resultType && siteHint.targetSite) ? buildGenericSearchUrl({ siteHint, searchQuery, resultType }) : "");
  const includeResultType = Boolean(resultType && (searchQuery || resultCount || siteHint.targetSite));
  return browserId || searchQuery || url || searchUrl || resultCount || includeResultType || siteHint.targetSite
    ? {
      browserLaunch: {
        ...(browserId ? { browserId } : {}),
        ...(searchQuery ? { searchQuery } : {}),
        ...(url ? { url } : {}),
        ...(searchUrl ? { searchUrl } : {}),
        ...(siteHint.targetSite ? { targetSite: siteHint.targetSite } : {}),
        ...(includeResultType ? { resultType } : {}),
        ...(resultCount ? { resultCount } : {})
      }
    }
    : {};
}

function normalizeComputerActionParameters(input, normalizedBrowserLaunch = null) {
  const rawParameters = isObject(input.parameters) ? input.parameters : {};
  const rawComputerAction = isObject(rawParameters.computerAction) ? rawParameters.computerAction : {};
  const type = firstOptionalText([
    rawComputerAction.type,
    rawParameters.computerActionType,
    rawParameters.actionType
  ], "Computer action type", 60);
  const browserLaunch = normalizedBrowserLaunch?.browserLaunch ?? null;
  const inferredType = !type && browserLaunch
    ? browserLaunch.searchQuery || browserLaunch.searchUrl || browserLaunch.resultCount || browserLaunch.resultType
      ? "launch_browser_search"
      : browserLaunch.url
        ? "launch_browser"
        : ""
    : "";
  const normalizedType = type || inferredType;
  return normalizedType
    ? {
      computerAction: {
        type: normalizedType
      }
    }
    : {};
}

function normalizeApplicationLaunchParameters(input) {
  const applicationId = normalizeOptionalText(input.parameters?.applicationLaunch?.applicationId, "Application id", 120);
  const applicationLabel = normalizeOptionalText(input.parameters?.applicationLaunch?.applicationLabel, "Application label", 180);
  return applicationId || applicationLabel
    ? {
      applicationLaunch: {
        ...(applicationId ? { applicationId } : {}),
        ...(applicationLabel ? { applicationLabel } : {})
      }
    }
    : {};
}

export function normalizeMissionDraft(input, missionEntryContract = buildMissionEntryContract()) {
  if (!isObject(input)) {
    throw new Error("Mission request must be an object.");
  }

  const modeIds = missionEntryContract.modes.map((mode) => mode.id);
  const requestedMode = normalizeOptionalText(input.mode, "Mission mode", 40);
  if (requestedMode && requestedMode !== "auto" && !modeIds.includes(requestedMode)) {
    throw new Error(`Unsupported mission mode: ${requestedMode}.`);
  }

  const limits = missionEntryContract.limits ?? DEFAULT_LIMITS;
  const normalized = {
    mode: requestedMode && requestedMode !== "auto" ? requestedMode : "",
    objective: normalizeRequiredText(input.objective, "Mission objective", limits.objectiveMaxLength),
    deliverable: normalizeOptionalText(input.deliverable, "Mission deliverable", limits.deliverableMaxLength),
    constraints: normalizeList(input.constraints, "Mission constraints", {
      maxItems: limits.maxListItems,
      maxItemLength: limits.lineItemMaxLength
    }),
    forbiddenActions: normalizeList(input.forbiddenActions, "Actions to avoid", {
      maxItems: limits.maxListItems,
      maxItemLength: limits.lineItemMaxLength
    }),
    parameters: {}
  };

  normalized.parameters = {
    ...normalized.parameters,
    ...normalizeCoreMissionParameters(input)
  };

  const hasFormValues = isObject(input.parameters?.formValues);
  if (requestedMode === "form" || hasFormValues) {
    normalized.parameters = {
      ...normalized.parameters,
      ...normalizeFormParameters(input, missionEntryContract, limits)
    };
  }

  return normalized;
}

export function normalizeMissionSpec(input, missionEntryContract = buildMissionEntryContract()) {
  if (!isObject(input)) {
    throw new Error("Mission request must be an object.");
  }

  const modeIds = missionEntryContract.modes.map((mode) => mode.id);
  const normalizedBaseParameters = normalizeCoreMissionParameters(input);
  const rawParameters = isObject(input.parameters) ? input.parameters : {};
  const inferredMode = inferMissionMode({
    objective: input.objective,
    deliverable: input.deliverable,
    constraints: input.constraints,
    forbiddenActions: input.forbiddenActions,
    parameters: {
      ...rawParameters,
      ...normalizedBaseParameters
    }
  });
  const requestedMode = normalizeOptionalText(input.mode, "Mission mode", 40);
  const mode = requestedMode && requestedMode !== "auto"
    ? requestedMode
    : inferredMode.mode || missionEntryContract.defaultModeId;
  if (!modeIds.includes(mode)) {
    throw new Error(`Unsupported mission mode: ${mode}.`);
  }

  const limits = missionEntryContract.limits ?? DEFAULT_LIMITS;
  const objective = normalizeRequiredText(input.objective, "Mission objective", limits.objectiveMaxLength);
  const deliverable = normalizeOptionalText(input.deliverable, "Mission deliverable", limits.deliverableMaxLength);
  const constraints = normalizeList(input.constraints, "Mission constraints", {
    maxItems: limits.maxListItems,
    maxItemLength: limits.lineItemMaxLength
  });
  const forbiddenActions = normalizeList(input.forbiddenActions, "Actions to avoid", {
    maxItems: limits.maxListItems,
    maxItemLength: limits.lineItemMaxLength
  });

  const normalized = {
    mode,
    objective,
    deliverable,
    constraints,
    forbiddenActions,
    parameters: {},
    routing: {
      modeSource: requestedMode && requestedMode !== "auto" ? "provided" : "inferred",
      inferredMode: inferredMode.mode,
      inferenceConfidence: inferredMode.confidence,
      inferenceReason: inferredMode.reason,
      crossFrameNotice: inferredMode.crossFrameNotice ?? null
    }
  };

  normalized.parameters = {
    ...normalized.parameters,
    ...normalizedBaseParameters
  };

  if (mode === "form") {
    normalized.parameters = {
      ...normalized.parameters,
      ...normalizeFormParameters(input, missionEntryContract, limits)
    };
  }

  return normalized;
}

export function buildMissionStatement(spec, modeDescriptor = null, { includeExecutionFrame = false } = {}) {
  const lines = [`Objective: ${spec.objective}`];

  if (spec.deliverable) {
    lines.push(`Expected deliverable: ${spec.deliverable}`);
  }

  if (spec.constraints.length > 0) {
    lines.push("Constraints:");
    for (const constraint of spec.constraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (spec.forbiddenActions.length > 0) {
    lines.push("Actions to avoid:");
    for (const action of spec.forbiddenActions) {
      lines.push(`- ${action}`);
    }
  }

  if (spec.mode === "form" && spec.parameters?.formValues) {
    lines.push("Controlled form values:");
    lines.push(`- Candidate name: ${spec.parameters.formValues.name}`);
    lines.push(`- Role: ${spec.parameters.formValues.role}`);
    lines.push(`- Newsletter checkbox: ${spec.parameters.formValues.subscribe ? "checked" : "unchecked"}`);
  }

  if (spec.parameters?.browserLaunch?.browserId) {
    lines.push(`Preferred browser if needed: ${spec.parameters.browserLaunch.browserId}`);
  }
  if (spec.parameters?.browserLaunch?.searchQuery) {
    lines.push(`Browser search query if needed: ${spec.parameters.browserLaunch.searchQuery}`);
  }
  if (spec.parameters?.browserLaunch?.targetSite) {
    lines.push(`Browser target site if needed: ${spec.parameters.browserLaunch.targetSite}`);
  }
  if (spec.parameters?.browserLaunch?.url) {
    lines.push(`Browser launch URL if needed: ${spec.parameters.browserLaunch.url}`);
  }
  if (spec.parameters?.browserLaunch?.searchUrl) {
    lines.push(`Browser search URL if needed: ${spec.parameters.browserLaunch.searchUrl}`);
  }
  if (spec.parameters?.browserLaunch?.resultType) {
    lines.push(`Requested browser result type if needed: ${spec.parameters.browserLaunch.resultType}`);
  }
  if (spec.parameters?.browserLaunch?.resultCount) {
    lines.push(`Requested browser result count if needed: ${spec.parameters.browserLaunch.resultCount}`);
  }
  if (spec.parameters?.computerAction?.type) {
    lines.push(`Bounded desktop action if needed: ${spec.parameters.computerAction.type}`);
  }
  if (spec.parameters?.applicationLaunch?.applicationId) {
    lines.push(`Preferred application if needed: ${spec.parameters.applicationLaunch.applicationId}`);
  }
  if (spec.parameters?.applicationLaunch?.applicationLabel) {
    lines.push(`Preferred application label if needed: ${spec.parameters.applicationLaunch.applicationLabel}`);
  }

  if (includeExecutionFrame && modeDescriptor) {
    lines.push(`Execution frame: ${modeDescriptor.label}.`);
    lines.push(`Boundary: ${modeDescriptor.scopeHint ?? `stay within ${modeDescriptor.writeBoundary}`}.`);
  }

  return lines.join("\n");
}
