const GENERIC_SKILL = Object.freeze({
  id: "generic_desktop",
  label: "Generic desktop app",
  appKinds: ["application", "utility"],
  safePrimitives: ["observe_windows", "focus_window", "click_point", "type_text", "send_hotkey", "scroll_window", "capture_window"],
  blockedIntents: ["submit", "delete", "purchase", "install", "credential_entry"],
  verificationStrategy: "Capture before/after state and compare visible accessibility evidence.",
  recoveryStrategies: ["reobserve_windows", "active_window_fallback", "capture_failure_proof"]
});

const SKILLS = Object.freeze([
  {
    id: "skill.app_launch",
    label: "App Launch & Switch",
    appKinds: ["application", "utility", "text_editor", "browser", "file_manager", "terminal"],
    appIdPatterns: [/./],
    stepPatterns: [/\b(open|launch|focus|switch|ouvrir|ouvre|lance|démarre|demarre)\b/i],
    safePrimitives: ["observe_windows", "launch_application", "focus_window", "capture_window"],
    blockedIntents: ["credential_entry", "payment", "security_bypass", "stealth"],
    verificationStrategy: "Verify that the requested app/window becomes visible and capture proof.",
    recoveryStrategies: ["reobserve_windows", "focus_new_window", "active_window_fallback", "capture_failure_proof"]
  },
  {
    id: "skill.review_capture",
    label: "Review, Verify & Capture",
    appKinds: ["application", "utility", "text_editor", "browser", "file_manager", "terminal"],
    appIdPatterns: [/capture/i, /screenshot/i, /preuve/i, /proof/i, /verify/i],
    stepPatterns: [/\b(capture|screenshot|proof|preuve|verify|vérifie|verifie)\b/i],
    safePrimitives: ["observe_windows", "capture_window"],
    blockedIntents: ["credential_capture", "secret_exfiltration"],
    verificationStrategy: "Capture visible proof and attach it to the action log.",
    recoveryStrategies: ["reobserve_windows", "active_window_fallback", "capture_failure_proof"]
  },
  {
    id: "skill.clipboard_transfer",
    label: "Clipboard & Transfer",
    appKinds: ["application", "utility", "text_editor", "browser", "file_manager", "terminal"],
    appIdPatterns: [/clipboard/i, /copy/i, /paste/i, /presse-papiers/i],
    stepPatterns: [/\b(copy|paste|clipboard|presse-papiers|copie|colle|transfer)\b/i],
    safePrimitives: ["focus_window", "type_text", "send_hotkey", "capture_window"],
    blockedIntents: ["credential_entry", "secret_exfiltration", "payment"],
    verificationStrategy: "Use visible UI actions only; verify with a post-transfer capture.",
    recoveryStrategies: ["refocus_prior_window", "active_window_fallback", "capture_failure_proof"]
  },
  {
    id: "skill.terminal_guarded",
    label: "Terminal Guarded",
    appKinds: ["terminal"],
    appIdPatterns: [/terminal/i, /powershell/i, /\bcmd\b/i, /shell/i, /console/i],
    stepPatterns: [/\b(terminal|powershell|cmd|shell|console|commande|command)\b/i],
    safePrimitives: ["observe_windows", "launch_application", "focus_window", "type_text", "send_hotkey", "capture_window"],
    blockedIntents: ["credential_entry", "payment", "security_bypass", "secret_exfiltration", "stealth"],
    verificationStrategy: "Type and execute only visible approved commands, then capture output.",
    recoveryStrategies: ["refocus_prior_window", "active_window_fallback", "capture_failure_proof"]
  },
  {
    id: "skill.forms_basic",
    label: "Forms Basic",
    appKinds: ["browser", "application"],
    appIdPatterns: [/form/i, /field/i, /input/i, /champ/i, /formulaire/i],
    stepPatterns: [/\b(form|field|input|champ|formulaire|fill|remplis|saisis)\b/i],
    safePrimitives: ["focus_window", "click_point", "type_text", "capture_window"],
    blockedIntents: ["submit", "send", "publish", "payment", "credential_entry"],
    verificationStrategy: "Fill visible fields after approval and verify field state before any submit/send.",
    recoveryStrategies: ["reobserve_windows", "semantic_target_retry", "active_window_fallback", "capture_failure_proof"]
  },
  {
    id: "browser_basic",
    label: "Browser basic navigation",
    appKinds: ["browser"],
    appIdPatterns: [/^browser_/, /chrome/i, /edge/i, /firefox/i, /brave/i],
    safePrimitives: ["observe_windows", "launch_application", "focus_window", "type_text", "send_hotkey", "click_point", "scroll_window", "capture_window"],
    blockedIntents: ["login", "payment", "download", "upload", "submit_personal_data"],
    verificationStrategy: "Verify that a browser window is visible and persist screenshot/accessibility proof.",
    recoveryStrategies: ["focus_new_browser_window", "active_window_fallback", "reobserve_windows", "capture_failure_proof"]
  },
  {
    id: "text_editor_basic",
    label: "Text editor drafting",
    appKinds: ["text_editor"],
    appIdPatterns: [/notepad/i, /bloc/i, /notes/i],
    safePrimitives: ["observe_windows", "launch_application", "focus_window", "type_text", "send_hotkey", "capture_window"],
    blockedIntents: ["save_over_existing_file", "delete_file", "macro_execution"],
    verificationStrategy: "Verify text entry by capturing the active editor window after typing.",
    recoveryStrategies: ["refocus_prior_window", "active_window_fallback", "capture_failure_proof"]
  },
  {
    id: "file_manager_readonly",
    label: "File manager read-only observation",
    appKinds: ["file_manager"],
    appIdPatterns: [/explorer/i, /file/i, /dossier/i],
    safePrimitives: ["observe_windows", "launch_application", "focus_window", "click_point", "capture_window"],
    blockedIntents: ["delete_file", "move_file", "rename_file", "upload", "exfiltrate"],
    verificationStrategy: "Verify only visible navigation or capture proof; do not mutate files.",
    recoveryStrategies: ["refocus_prior_window", "reobserve_windows", "capture_failure_proof"]
  },
  {
    id: "calculator_basic",
    label: "Calculator utility",
    appKinds: ["utility"],
    appIdPatterns: [/calculator/i, /calculatrice/i, /calc/i],
    safePrimitives: ["observe_windows", "launch_application", "focus_window", "click_point", "type_text", "capture_window"],
    blockedIntents: ["network", "file_write"],
    verificationStrategy: "Verify visible result through accessibility text or screenshot proof.",
    recoveryStrategies: ["refocus_prior_window", "active_window_fallback", "capture_failure_proof"]
  },
  GENERIC_SKILL
]);

function matchesPattern(value, patterns = []) {
  return patterns.some((pattern) => pattern.test(String(value ?? "")));
}

function stepText(step = {}) {
  return [
    step.label,
    step.primitive,
    step.target?.label,
    step.target?.semanticTarget,
    step.input?.text,
    step.input?.keys
  ].map((entry) => String(entry ?? "")).join("\n");
}

function matchesStepIntent(step, skill) {
  return matchesPattern(stepText(step), skill.stepPatterns ?? []);
}

function appMatchAllowedByKind(skill) {
  return !["skill.review_capture", "skill.clipboard_transfer", "skill.forms_basic"].includes(skill.id);
}

export function selectDesktopSkillForApplication(application = null) {
  if (!application) {
    return GENERIC_SKILL;
  }
  const kind = String(application.kind ?? "application").trim().toLowerCase();
  const id = String(application.id ?? "").trim();
  const label = String(application.label ?? "").trim();
  const processName = String(application.processName ?? "").trim();
  return SKILLS.find((skill) => {
    if (skill.id === GENERIC_SKILL.id) {
      return false;
    }
    if (skill.id === "skill.app_launch") {
      return false;
    }
    return (appMatchAllowedByKind(skill) && skill.appKinds?.includes(kind))
      || matchesPattern(id, skill.appIdPatterns)
      || matchesPattern(label, skill.appIdPatterns)
      || matchesPattern(processName, skill.appIdPatterns);
  }) ?? SKILLS.find((skill) => skill.id === "skill.app_launch" && (
    skill.appKinds?.includes(kind)
    || matchesPattern(id, skill.appIdPatterns)
    || matchesPattern(label, skill.appIdPatterns)
    || matchesPattern(processName, skill.appIdPatterns)
  )) ?? GENERIC_SKILL;
}

export function buildDesktopSkillCatalog(applications = []) {
  const selectedSkills = new Map();
  for (const application of applications) {
    const skill = selectDesktopSkillForApplication(application);
    selectedSkills.set(skill.id, {
      ...skill,
      matchedApplications: [
        ...(selectedSkills.get(skill.id)?.matchedApplications ?? []),
        {
          id: application.id,
          label: application.label,
          kind: application.kind ?? "application"
        }
      ]
    });
  }
  if (!selectedSkills.has(GENERIC_SKILL.id)) {
    selectedSkills.set(GENERIC_SKILL.id, {
      ...GENERIC_SKILL,
      matchedApplications: []
    });
  }
  for (const foundational of SKILLS.filter((skill) => skill.id.startsWith("skill."))) {
    if (!selectedSkills.has(foundational.id)) {
      selectedSkills.set(foundational.id, {
        ...foundational,
        matchedApplications: []
      });
    }
  }
  return Array.from(selectedSkills.values()).map((skill) => ({
    id: skill.id,
    label: skill.label,
    safePrimitives: skill.safePrimitives,
    blockedIntents: skill.blockedIntents,
    verificationStrategy: skill.verificationStrategy,
    recoveryStrategies: skill.recoveryStrategies,
    matchedApplications: skill.matchedApplications ?? []
  }));
}

export function skillForStep(step, selectedApplication = null) {
  const taskSkill = SKILLS.find((candidate) =>
    candidate.id.startsWith("skill.") &&
    candidate.id !== "skill.app_launch" &&
    candidate.safePrimitives.includes(step?.primitive) &&
    matchesStepIntent(step, candidate)
  );
  const appSkill = selectDesktopSkillForApplication(selectedApplication);
  const skill = taskSkill ?? appSkill;
  return {
    ...skill,
    primitiveAllowed: skill.safePrimitives.includes(step?.primitive)
  };
}

export function graphSkillIdForDesktopSkill(skillId) {
  if (!skillId) {
    return null;
  }
  if (String(skillId).startsWith("skill.")) {
    return skillId;
  }
  if (skillId === "browser_basic") {
    return "skill.browser";
  }
  if (skillId === "text_editor_basic") {
    return "skill.notepad";
  }
  if (skillId === "file_manager_readonly") {
    return "skill.explorer";
  }
  return null;
}
