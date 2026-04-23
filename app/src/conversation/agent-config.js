export const AGENT_CONFIG_SETTING_KEY = "agent.configuration.v1";

export const DESKTOP_AUTONOMY_LEVELS = Object.freeze([
  "supervised",
  "expanded",
  "operator_trusted",
  "maximum_governed"
]);

export const DEFAULT_DESKTOP_AUTONOMY = Object.freeze({
  level: "supervised",
  maxPlanSteps: 8,
  autoApproveLowRisk: false,
  autoApproveMediumRisk: false,
  requireApprovalForHighRisk: true,
  allowSkillOverride: false,
  allowCoordinateClicks: true,
  allowTextInput: true,
  allowHotkeys: true,
  allowClicks: true,
  allowScroll: true,
  allowCapture: true,
  allowSystemHotkeys: false,
  sensitiveActionMode: "block",
  destructiveActionMode: "block"
});

export const DEFAULT_VISIBLE_ASSISTANT_SYSTEM_PROMPT = `Tu es Cowork, un assistant desktop conversationnel.

Style visible:
- parle naturellement, comme un assistant utile;
- sois bref, direct et calme;
- réponds, clarifie ou annonce l'action simplement;
- cache la mécanique interne: pas de pipeline, pas de lane, pas de run-plan, pas de checklist de sécurité;
- ne mentionne une contrainte que si elle bloque directement l'utilisateur;
- préfère l'action ou une question courte à une explication longue.
- si une confirmation est requise, formule-la comme une action simple à confirmer, pas comme une règle interne.

Patterns interdits dans une réponse normale:
- "Before acting";
- "I will qualify this request";
- "What I will do";
- "What I will not do";
- "Forbidden actions";
- "Limitations";
- "This run will not";
- "No stronger bounded signal was detected";
- "Avant d'agir";
- "Je vais qualifier";
- "Ce que je vais faire";
- "Ce que je ne ferai pas";
- "Actions interdites";
- "Limites";
- "Ce run ne";
- toute variante équivalente.

Exemples de ton:
- "Oui. J'ouvre ton éditeur de notes."
- "Confirme et je lance l'application."
- "Tu préfères Bloc-notes, Obsidian ou Notion ?"
- "Tu préfères Microsoft Edge ou Google Chrome ?"
- "C'est fait."
- "Je n'ai pas réussi à l'ouvrir. J'ai trouvé l'application, mais elle ne s'est pas lancée correctement."`;

export const DEFAULT_AGENT_GUARDRAILS = Object.freeze({
  safetyPreset: "balanced",
  assistantVerbosity: "concise",
  conversationMode: "natural_agent",
  debugMode: false,
  showInternalPlansInChat: false,
  showTraceLinksInChat: false,
  approvalModeByAction: {
    local_app_launch: "confirm",
    browser_navigation: "confirm_when_external_or_sensitive",
    file_read: "confirm_outside_project",
    file_write: "confirm",
    destructive_action: "always_confirm",
    form_submit_or_publish: "always_confirm"
  },
  desktopAutonomy: {
    ...DEFAULT_DESKTOP_AUTONOMY
  },
  desktopScope: "bounded_approved_actions",
  browserScope: "bounded_approved_navigation",
  fileScope: "read_only_when_requested_or_project_artifacts",
  nonBypassableFloor: [
    "destructive actions require explicit confirmation",
    "credential, login, publish, submit and payment actions remain guarded",
    "internal traces remain available in admin even when hidden from chat"
  ]
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, maxLength = 10_000) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function cleanBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function cleanInteger(value, fallback, { min = 1, max = 20 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function desktopAutonomyDefaultsForLevel(level) {
  switch (level) {
    case "expanded":
      return {
        ...DEFAULT_DESKTOP_AUTONOMY,
        level,
        maxPlanSteps: 10,
        autoApproveLowRisk: true,
        sensitiveActionMode: "confirm"
      };
    case "operator_trusted":
      return {
        ...DEFAULT_DESKTOP_AUTONOMY,
        level,
        maxPlanSteps: 12,
        autoApproveLowRisk: true,
        autoApproveMediumRisk: true,
        allowSkillOverride: true,
        sensitiveActionMode: "confirm",
        destructiveActionMode: "confirm"
      };
    case "maximum_governed":
      return {
        ...DEFAULT_DESKTOP_AUTONOMY,
        level,
        maxPlanSteps: 14,
        autoApproveLowRisk: true,
        autoApproveMediumRisk: true,
        allowSkillOverride: true,
        allowCoordinateClicks: true,
        sensitiveActionMode: "confirm",
        destructiveActionMode: "confirm"
      };
    case "supervised":
    default:
      return {
        ...DEFAULT_DESKTOP_AUTONOMY,
        level: "supervised"
      };
  }
}

export function normalizeDesktopAutonomySettings(value = {}) {
  const candidate = isObject(value) ? value : {};
  const requestedLevel = cleanText(candidate.level, 60);
  const level = DESKTOP_AUTONOMY_LEVELS.includes(requestedLevel) ? requestedLevel : DEFAULT_DESKTOP_AUTONOMY.level;
  const levelDefaults = desktopAutonomyDefaultsForLevel(level);
  const sensitiveActionMode = cleanText(candidate.sensitiveActionMode, 40) || levelDefaults.sensitiveActionMode;
  const destructiveActionMode = cleanText(candidate.destructiveActionMode, 40) || levelDefaults.destructiveActionMode;
  return {
    ...levelDefaults,
    ...candidate,
    level,
    maxPlanSteps: cleanInteger(candidate.maxPlanSteps, levelDefaults.maxPlanSteps, { min: 1, max: 20 }),
    autoApproveLowRisk: cleanBoolean(candidate.autoApproveLowRisk, levelDefaults.autoApproveLowRisk),
    autoApproveMediumRisk: cleanBoolean(candidate.autoApproveMediumRisk, levelDefaults.autoApproveMediumRisk),
    requireApprovalForHighRisk: cleanBoolean(candidate.requireApprovalForHighRisk, levelDefaults.requireApprovalForHighRisk),
    allowSkillOverride: cleanBoolean(candidate.allowSkillOverride, levelDefaults.allowSkillOverride),
    allowCoordinateClicks: cleanBoolean(candidate.allowCoordinateClicks, levelDefaults.allowCoordinateClicks),
    allowTextInput: cleanBoolean(candidate.allowTextInput, levelDefaults.allowTextInput),
    allowHotkeys: cleanBoolean(candidate.allowHotkeys, levelDefaults.allowHotkeys),
    allowClicks: cleanBoolean(candidate.allowClicks, levelDefaults.allowClicks),
    allowScroll: cleanBoolean(candidate.allowScroll, levelDefaults.allowScroll),
    allowCapture: cleanBoolean(candidate.allowCapture, levelDefaults.allowCapture),
    allowSystemHotkeys: cleanBoolean(candidate.allowSystemHotkeys, levelDefaults.allowSystemHotkeys),
    sensitiveActionMode: ["block", "confirm"].includes(sensitiveActionMode) ? sensitiveActionMode : levelDefaults.sensitiveActionMode,
    destructiveActionMode: ["block", "confirm"].includes(destructiveActionMode) ? destructiveActionMode : levelDefaults.destructiveActionMode
  };
}

export function defaultAgentConfiguration() {
  return {
    version: "1.0.0",
    updatedAt: null,
    conversationalSystemPrompt: DEFAULT_VISIBLE_ASSISTANT_SYSTEM_PROMPT,
    orchestrationInstructionsSummary: "Internal planner selects bounded capabilities, mission preflight, approvals and verification. These details are hidden from normal chat and exposed in admin traces.",
    policyRulesSummary: "Runtime safety policies remain non-bypassable. Configurable guardrails tune UX and approval posture but cannot weaken hard safety floors.",
    guardrails: {
      ...DEFAULT_AGENT_GUARDRAILS,
      approvalModeByAction: { ...DEFAULT_AGENT_GUARDRAILS.approvalModeByAction },
      nonBypassableFloor: [...DEFAULT_AGENT_GUARDRAILS.nonBypassableFloor]
    }
  };
}

export function normalizeAgentConfiguration(value = {}) {
  const defaults = defaultAgentConfiguration();
  const candidate = isObject(value) ? value : {};
  const guardrails = isObject(candidate.guardrails) ? candidate.guardrails : {};
  const approvalModeByAction = isObject(guardrails.approvalModeByAction)
    ? guardrails.approvalModeByAction
    : {};
  return {
    ...defaults,
    version: cleanText(candidate.version, 40) || defaults.version,
    updatedAt: cleanText(candidate.updatedAt, 80) || defaults.updatedAt,
    conversationalSystemPrompt: cleanText(candidate.conversationalSystemPrompt, 12_000) || defaults.conversationalSystemPrompt,
    orchestrationInstructionsSummary: cleanText(candidate.orchestrationInstructionsSummary, 1200) || defaults.orchestrationInstructionsSummary,
    policyRulesSummary: cleanText(candidate.policyRulesSummary, 1200) || defaults.policyRulesSummary,
    guardrails: {
      ...defaults.guardrails,
      ...guardrails,
      safetyPreset: cleanText(guardrails.safetyPreset, 40) || defaults.guardrails.safetyPreset,
      assistantVerbosity: cleanText(guardrails.assistantVerbosity, 40) || defaults.guardrails.assistantVerbosity,
      conversationMode: cleanText(guardrails.conversationMode, 40) || defaults.guardrails.conversationMode,
      desktopScope: cleanText(guardrails.desktopScope, 80) || defaults.guardrails.desktopScope,
      browserScope: cleanText(guardrails.browserScope, 80) || defaults.guardrails.browserScope,
      fileScope: cleanText(guardrails.fileScope, 120) || defaults.guardrails.fileScope,
      debugMode: Boolean(guardrails.debugMode),
      showInternalPlansInChat: Boolean(guardrails.showInternalPlansInChat),
      showTraceLinksInChat: Boolean(guardrails.showTraceLinksInChat),
      approvalModeByAction: {
        ...defaults.guardrails.approvalModeByAction,
        ...Object.fromEntries(
          Object.entries(approvalModeByAction).map(([key, mode]) => [
            cleanText(key, 80),
            cleanText(mode, 80)
          ]).filter(([key, mode]) => key && mode)
        )
      },
      desktopAutonomy: normalizeDesktopAutonomySettings(guardrails.desktopAutonomy),
      nonBypassableFloor: defaults.guardrails.nonBypassableFloor
    }
  };
}

export function summarizeAgentConfiguration(config) {
  const normalized = normalizeAgentConfiguration(config);
  return {
    version: normalized.version,
    updatedAt: normalized.updatedAt,
    conversationalSystemPrompt: normalized.conversationalSystemPrompt,
    orchestrationInstructionsSummary: normalized.orchestrationInstructionsSummary,
    policyRulesSummary: normalized.policyRulesSummary,
    guardrails: normalized.guardrails
  };
}
