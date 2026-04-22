import { normalizeAgentConfiguration, normalizeDesktopAutonomySettings } from "../conversation/agent-config.js";

const HARD_BLOCKED_TEXT_PATTERNS = Object.freeze([
  { id: "credential", pattern: /\b(password|passcode|api key|secret|token|mot de passe|clé api|cle api)\b/i },
  { id: "payment", pattern: /\b(buy|purchase|pay|checkout|acheter|payer|paiement|commander)\b/i },
  { id: "security_bypass", pattern: /\b(disable antivirus|bypass|elevate|admin password|uac|désactive l'antivirus|desactive l'antivirus)\b/i }
]);

const CONTROLLED_TEXT_PATTERNS = Object.freeze([
  { id: "delete", modeKey: "destructiveActionMode", pattern: /\b(delete|remove|erase|rm |del |supprimer|effacer|format disk)\b/i },
  { id: "submit", modeKey: "sensitiveActionMode", pattern: /\b(submit|send|publish|post|soumettre|envoyer|publier)\b/i },
  { id: "install", modeKey: "sensitiveActionMode", pattern: /\b(install|uninstall|installer|désinstaller|desinstaller)\b/i }
]);

const BLOCKED_HOTKEYS = Object.freeze([
  "alt+f4",
  "ctrl+w",
  "ctrl+q",
  "ctrl+shift+esc",
  "ctrl+alt+delete"
]);

const HIGH_RISK_HOTKEYS = Object.freeze([
  "enter",
  "ctrl+s",
  "ctrl+v",
  "delete",
  "backspace"
]);

function normalizeHotkey(value) {
  return String(value ?? "")
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+");
}

function combinedStepText(step) {
  return [
    step?.label,
    step?.expectedOutcome,
    step?.verification,
    step?.target?.label,
    step?.target?.semanticTarget,
    step?.input?.text,
    step?.input?.keys,
    step?.input?.semanticTarget
  ]
    .map((entry) => String(entry ?? ""))
    .join("\n");
}

function prohibitedMatch(text) {
  return HARD_BLOCKED_TEXT_PATTERNS.find((entry) => entry.pattern.test(text)) ?? null;
}

function controlledMatch(text) {
  return CONTROLLED_TEXT_PATTERNS.find((entry) => entry.pattern.test(text)) ?? null;
}

function skillBlockedIntentMatch(text, blockedIntents = []) {
  return blockedIntents.find((intent) => {
    const normalized = String(intent ?? "").replace(/_/g, " ");
    const pattern = new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) {
      return true;
    }
    if (intent === "credential_entry") {
      return /\b(password|passcode|credential|login|mot de passe|identifiant)\b/i.test(text);
    }
    if (intent === "secret_exfiltration") {
      return /\b(secret|token|api key|exfiltrate|exfiltre)\b/i.test(text);
    }
    if (intent === "security_bypass") {
      return /\b(bypass|elevate|uac|admin|antivirus)\b/i.test(text);
    }
    return false;
  }) ?? null;
}

function autonomySettingsFromContext(context = {}) {
  if (context.desktopAutonomy) {
    return normalizeDesktopAutonomySettings(context.desktopAutonomy);
  }
  if (context.agentConfiguration) {
    const config = normalizeAgentConfiguration(context.agentConfiguration);
    return normalizeDesktopAutonomySettings(config.guardrails.desktopAutonomy);
  }
  return normalizeDesktopAutonomySettings();
}

function primitiveAllowedByAutonomy(primitive, autonomy) {
  switch (primitive) {
    case "list_directory":
    case "read_text_file":
      return true;
    case "create_text_file":
    case "write_text_file":
    case "copy_path":
    case "rename_path":
    case "move_path":
    case "delete_path":
      return true;
    case "type_text":
      return autonomy.allowTextInput;
    case "send_hotkey":
      return autonomy.allowHotkeys;
    case "click_point":
      return autonomy.allowClicks;
    case "scroll_window":
      return autonomy.allowScroll;
    case "capture_window":
      return autonomy.allowCapture;
    default:
      return true;
  }
}

function approvalModeForPrimitive(primitive, context = {}) {
  const modes = context.agentConfiguration?.guardrails?.approvalModeByAction ?? {};
  if (primitive === "launch_application") {
    return modes.local_app_launch ?? "confirm";
  }
  if (primitive === "list_directory" || primitive === "read_text_file") {
    return modes.file_read ?? "confirm_outside_project";
  }
  if (["create_text_file", "write_text_file", "copy_path", "rename_path", "move_path", "delete_path"].includes(primitive)) {
    return primitive === "delete_path"
      ? modes.destructive_action ?? "always_confirm"
      : modes.file_write ?? "confirm";
  }
  return modes.local_desktop_actuation ?? "confirm";
}

function approvalRequiredFor({ primitive, riskLevel, declaredRequiresApproval, autonomy, context }) {
  if (primitive === "observe_windows") {
    return false;
  }
  if (primitive === "list_directory") {
    return false;
  }
  if (primitive === "capture_window" && riskLevel === "low") {
    return false;
  }
  if (riskLevel === "high" && autonomy.requireApprovalForHighRisk) {
    return true;
  }
  const approvalMode = approvalModeForPrimitive(primitive, context);
  if (approvalMode === "always_confirm" || approvalMode === "confirm") {
    return true;
  }
  if (approvalMode === "quiet_when_auto_allowed") {
    if (riskLevel === "low" && autonomy.autoApproveLowRisk) {
      return false;
    }
    if (riskLevel === "medium" && autonomy.autoApproveMediumRisk) {
      return false;
    }
  }
  if (riskLevel === "low" && autonomy.autoApproveLowRisk) {
    return false;
  }
  if (riskLevel === "medium" && autonomy.autoApproveMediumRisk) {
    return false;
  }
  return declaredRequiresApproval;
}

export function assessDesktopStep(step, context = {}) {
  const autonomy = autonomySettingsFromContext(context);
  const primitive = String(step?.primitive ?? "").trim();
  const text = combinedStepText(step);
  const matchedProhibitedIntent = prohibitedMatch(text);
  if (matchedProhibitedIntent) {
    return {
      allowed: false,
      blocked: true,
      reason: `Blocked desktop primitive because it matched prohibited intent: ${matchedProhibitedIntent.id}.`,
      riskLevel: "blocked",
      requiresApproval: false,
      checkpointRequired: true
    };
  }

  if (!primitiveAllowedByAutonomy(primitive, autonomy)) {
    return {
      allowed: false,
      blocked: true,
      reason: `Primitive ${primitive} is disabled by desktop autonomy settings.`,
      riskLevel: "blocked",
      requiresApproval: false,
      checkpointRequired: true,
      autonomy
    };
  }

  const matchedControlledIntent = controlledMatch(text);
  const controlledFileDelete = primitive === "delete_path"
    ? { id: "delete", modeKey: "destructiveActionMode" }
    : null;
  const controlledFileWrite = ["create_text_file", "write_text_file", "copy_path", "rename_path", "move_path"].includes(primitive)
    ? { id: "file_write", modeKey: "sensitiveActionMode" }
    : null;
  const controlledOperation = matchedControlledIntent ?? controlledFileDelete ?? controlledFileWrite;
  if (controlledOperation) {
    const actionMode = autonomy[controlledOperation.modeKey] ?? "block";
    if (actionMode !== "confirm") {
      return {
        allowed: false,
        blocked: true,
        reason: `Blocked desktop primitive because ${controlledOperation.id} actions are disabled at autonomy level ${autonomy.level}.`,
        riskLevel: "blocked",
        requiresApproval: false,
        checkpointRequired: true
      };
    }
    return {
      allowed: true,
      blocked: false,
      reason: `${controlledOperation.id} action is allowed only with explicit approval at autonomy level ${autonomy.level}.`,
      riskLevel: "high",
      requiresApproval: true,
      checkpointRequired: true,
      autonomy
    };
  }

  if (primitive === "send_hotkey") {
    const hotkey = normalizeHotkey(step?.input?.keys);
    if (BLOCKED_HOTKEYS.includes(hotkey) && !autonomy.allowSystemHotkeys) {
      return {
        allowed: false,
        blocked: true,
        reason: `Blocked unsafe hotkey: ${hotkey}.`,
        riskLevel: "blocked",
        requiresApproval: false,
        checkpointRequired: true
      };
    }
    if (HIGH_RISK_HOTKEYS.includes(hotkey)) {
      return {
        allowed: true,
        blocked: false,
        reason: `High-risk hotkey ${hotkey} requires explicit approval and verification.`,
        riskLevel: "high",
        requiresApproval: true,
        checkpointRequired: true
      };
    }
  }

  if (primitive === "click_point" && !autonomy.allowCoordinateClicks && !step?.target?.semanticTarget && !step?.input?.semanticTarget) {
    return {
      allowed: false,
      blocked: true,
      reason: "Coordinate click is disabled unless a semantic target is available.",
      riskLevel: "blocked",
      requiresApproval: false,
      checkpointRequired: true,
      autonomy
    };
  }

  if (primitive === "click_point" && !step?.target?.semanticTarget && !step?.input?.semanticTarget && !step?.input?.point && step?.target?.point !== "window_center") {
    return {
      allowed: true,
      blocked: false,
      reason: "Coordinate click has no semantic target; require approval and screenshot evidence.",
      riskLevel: "high",
      requiresApproval: true,
      checkpointRequired: true
    };
  }

  const skill = context.skill ?? null;
  const skillBlockedIntent = skill ? skillBlockedIntentMatch(text, skill.blockedIntents ?? []) : null;
  if (skillBlockedIntent) {
    return {
      allowed: false,
      blocked: true,
      reason: `Primitive ${primitive} is blocked by the selected skill ${skill.id} because it matched blocked intent: ${skillBlockedIntent}.`,
      riskLevel: "blocked",
      requiresApproval: false,
      checkpointRequired: true
    };
  }
  if (skill && skill.primitiveAllowed === false && !autonomy.allowSkillOverride) {
    return {
      allowed: false,
      blocked: true,
      reason: `Primitive ${primitive} is not allowed by the selected app skill ${skill.id}.`,
      riskLevel: "blocked",
      requiresApproval: false,
      checkpointRequired: true
    };
  }

  const declaredRisk = String(step?.riskLevel ?? "medium").trim().toLowerCase();
  const riskLevel = ["low", "medium", "high"].includes(declaredRisk) ? declaredRisk : "medium";
  return {
    allowed: true,
    blocked: false,
    reason: `Desktop primitive is allowed by the ${autonomy.level} governed autonomy profile.`,
    riskLevel,
    requiresApproval: approvalRequiredFor({
      primitive,
      riskLevel,
      declaredRequiresApproval: step?.requiresApproval !== false,
      autonomy,
      context
    }),
    checkpointRequired: primitive !== "observe_windows"
  };
}

export function desktopSandboxSummary(agentConfiguration = null) {
  const autonomy = autonomySettingsFromContext({ agentConfiguration });
  return {
    posture: "governed_desktop_autonomy",
    arbitraryControl: autonomy.level === "maximum_governed",
    autonomyLevel: autonomy.level,
    maxPlanSteps: autonomy.maxPlanSteps,
    supportedPrimitives: [
      "observe_windows",
      "launch_application",
      "focus_window",
      "type_text",
      "send_hotkey",
      "click_point",
      "scroll_window",
      "capture_window",
      "list_directory",
      "read_text_file",
      "create_text_file",
      "write_text_file",
      "copy_path",
      "rename_path",
      "move_path",
      "delete_path",
      "stop"
    ],
    autoApprovedRiskLevels: [
      autonomy.autoApproveLowRisk ? "low" : null,
      autonomy.autoApproveMediumRisk ? "medium" : null
    ].filter(Boolean),
    approvalsRequiredFor: [
      autonomy.requireApprovalForHighRisk ? "high_risk_actions" : null,
      !autonomy.autoApproveMediumRisk ? "medium_risk_actions" : null,
      !autonomy.autoApproveLowRisk ? "low_risk_actuation" : null
    ].filter(Boolean),
    controlledSensitiveActions: {
      submitSendPublishInstall: autonomy.sensitiveActionMode,
      destructiveActions: autonomy.destructiveActionMode
    },
    hardBlockedIntents: HARD_BLOCKED_TEXT_PATTERNS.map((entry) => entry.id),
    controlledIntents: CONTROLLED_TEXT_PATTERNS.map((entry) => entry.id),
    blockedHotkeys: autonomy.allowSystemHotkeys ? [] : BLOCKED_HOTKEYS,
    evidenceRequired: ["before_state", "after_state", "action_log", "failure_proof_when_recovered"]
  };
}
