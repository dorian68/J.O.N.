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
  const browserId = normalizeOptionalText(input.parameters?.browserLaunch?.browserId, "Preferred browser", 40);
  const searchQuery = normalizeOptionalText(input.parameters?.browserLaunch?.searchQuery, "Browser search query", 180);
  const url = normalizeOptionalText(input.parameters?.browserLaunch?.url, "Browser launch URL", 300);
  return browserId || searchQuery || url
    ? {
      browserLaunch: {
        ...(browserId ? { browserId } : {}),
        ...(searchQuery ? { searchQuery } : {}),
        ...(url ? { url } : {})
      }
    }
    : {};
}

function normalizeComputerActionParameters(input) {
  const type = normalizeOptionalText(input.parameters?.computerAction?.type, "Computer action type", 60);
  return type
    ? {
      computerAction: {
        type
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
    ...normalizeBrowserLaunchParameters(input),
    ...normalizeComputerActionParameters(input)
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
  const inferredMode = inferMissionMode({
    objective: input.objective,
    deliverable: input.deliverable,
    constraints: input.constraints,
    forbiddenActions: input.forbiddenActions,
    parameters: input.parameters
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
    ...normalizeBrowserLaunchParameters(input),
    ...normalizeComputerActionParameters(input)
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
  if (spec.parameters?.browserLaunch?.url) {
    lines.push(`Browser launch URL if needed: ${spec.parameters.browserLaunch.url}`);
  }
  if (spec.parameters?.computerAction?.type) {
    lines.push(`Bounded desktop action if needed: ${spec.parameters.computerAction.type}`);
  }

  if (includeExecutionFrame && modeDescriptor) {
    lines.push(`Execution frame: ${modeDescriptor.label}.`);
    lines.push(`Boundary: ${modeDescriptor.scopeHint ?? `stay within ${modeDescriptor.writeBoundary}`}.`);
  }

  return lines.join("\n");
}
