export const SKILL_IMPLEMENTATION_STATUS = Object.freeze({
  OPERATIONAL_BASIC: "operational_basic",
  OPERATIONAL_DEEP: "operational_deep",
  DECLARED_FOUNDATION: "declared_foundation"
});

export const SKILL_DEPTH = Object.freeze({
  DESCRIPTIVE: "descriptive",
  OPERATIONAL_BASIC: "operational_basic",
  OPERATIONAL_DEEP: "operational_deep"
});

export const SKILL_MANIFEST_VERSION = "1.0.0";
export const USER_SKILL_MANIFESTS_SETTING_KEY = "capability.user_skill_manifests.v1";

const BUILTIN_SKILL_MANIFEST_BASE = [
  {
    id: "skill.explorer",
    version: SKILL_MANIFEST_VERSION,
    label: "Explorer",
    category: "file_system",
    surfaceKind: "file_manager",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Work with local folders and files through governed file primitives.",
    appMatchers: [/explorer/i, /file explorer/i, /explorateur/i, /fichiers?/i, /dossiers?/i],
    affordances: ["list folders", "inspect files", "copy", "rename", "move", "delete with approval", "create text files"],
    primitives: ["list_directory", "read_text_file", "create_text_file", "write_text_file", "copy_path", "rename_path", "move_path", "delete_path"],
    inputs: ["path", "destinationPath", "textContent"],
    outputs: ["directory_listing", "text_preview", "rollback_manifest", "action_log"],
    policyHooks: ["file_read", "file_write", "destructive_action"],
    evidenceHooks: ["directory_listing", "text_preview", "rollback_manifest"],
    rollbackSupport: "file_mutations",
    missionRelevance: { file_management: 1, safe_inspection: 0.85, local_question: 0.7, desktop_action: 0.45 }
  },
  {
    id: "skill.notepad",
    version: SKILL_MANIFEST_VERSION,
    label: "Notepad",
    category: "text_editing",
    surfaceKind: "text_editor",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Open a simple text editor, type or draft text, and verify with screenshot evidence.",
    appMatchers: [/notepad/i, /bloc.?notes/i, /notes?/i],
    affordances: ["open editor", "draft text", "type text", "capture proof", "basic save flow through approved primitives"],
    primitives: ["observe_windows", "launch_application", "focus_window", "type_text", "send_hotkey", "capture_window", "create_text_file", "write_text_file", "read_text_file"],
    inputs: ["targetApplication", "textContent", "path"],
    outputs: ["visible_window_after_launch", "post_type_capture", "written_file"],
    policyHooks: ["local_app_launch", "desktop_text_input", "file_write"],
    evidenceHooks: ["before_capture", "post_type_capture", "written_file"],
    rollbackSupport: "file_mutations_only",
    missionRelevance: { note_drafting: 1, text_editing: 0.9, desktop_action: 0.65, file_management: 0.35 }
  },
  {
    id: "skill.browser",
    version: SKILL_MANIFEST_VERSION,
    label: "Browser",
    category: "browser_navigation",
    surfaceKind: "browser",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Operate an allowlisted controlled browser with DOM-first navigation, page state awareness, structured extraction, bounded interaction, and screenshot proof.",
    appMatchers: [/browser/i, /edge/i, /chrome/i, /firefox/i, /brave/i, /navigateur/i],
    affordances: ["plan a governed web run", "open controlled browser", "navigate allowlisted URL", "read current page state", "list links/buttons/forms", "click DOM target", "type into field", "wait for page change", "extract structured page data", "capture page proof"],
    primitives: [
      "launch_application",
      "focus_window",
      "type_text",
      "send_hotkey",
      "click_point",
      "scroll_window",
      "capture_window",
      "browser.plan_mission",
      "browser.open_session",
      "browser.navigate",
      "browser.read_state",
      "browser.read_dom",
      "browser.query_interactive",
      "browser.click",
      "browser.type",
      "browser.select",
      "browser.wait_state",
      "browser.extract_text",
      "browser.detect_blockers",
      "browser.verify_outcome",
      "browser.capture_evidence"
    ],
    inputs: ["targetBrowser", "url", "query", "semanticTarget", "fieldMap", "expectedOutcome"],
    outputs: ["browser_session_state", "page_state", "dom_snapshot", "structured_extraction", "page_screenshot", "action_log"],
    policyHooks: ["local_app_launch", "browser_navigation", "browser_read", "browser_click", "browser_text_input", "browser_submit_or_publish"],
    evidenceHooks: ["page_state", "dom_snapshot", "page_screenshot", "browser_action_log"],
    rollbackSupport: "none",
    missionRelevance: { web_research: 1, browser_action: 0.95, safe_inspection: 0.45, desktop_action: 0.6 }
  },
  {
    id: "skill.app_launch",
    version: SKILL_MANIFEST_VERSION,
    label: "App Launch & Switch",
    category: "app_control",
    surfaceKind: "application",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Detect, launch, focus and verify local applications through governed desktop primitives.",
    appMatchers: [/./],
    affordances: ["detect installed app", "launch app", "focus window", "verify visible window"],
    primitives: ["observe_windows", "launch_application", "focus_window", "capture_window"],
    inputs: ["applicationName", "windowTitle"],
    outputs: ["visible_window_snapshot", "visible_window_after_launch"],
    policyHooks: ["local_app_launch", "local_focus"],
    evidenceHooks: ["visible_window_snapshot", "visible_window_after_launch"],
    rollbackSupport: "none",
    missionRelevance: { desktop_action: 0.8, safe_inspection: 0.45 }
  },
  {
    id: "skill.review_capture",
    version: SKILL_MANIFEST_VERSION,
    label: "Review, Verify & Capture",
    category: "verification",
    surfaceKind: "desktop",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Capture visible proof, compare before/after state and summarize verification outcomes.",
    appMatchers: [/capture/i, /screenshot/i, /preuve/i, /verify/i],
    affordances: ["capture proof", "record before/after", "summarize visible result"],
    primitives: ["observe_windows", "capture_window"],
    inputs: ["targetWindow"],
    outputs: ["window_capture", "verification_summary"],
    policyHooks: ["desktop_capture"],
    evidenceHooks: ["window_capture", "action_summary"],
    rollbackSupport: "none",
    missionRelevance: { proof_capture: 1, safe_inspection: 0.65, desktop_action: 0.55 }
  },
  {
    id: "skill.clipboard_transfer",
    version: SKILL_MANIFEST_VERSION,
    label: "Clipboard & Transfer",
    category: "clipboard",
    surfaceKind: "desktop",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Move small user-approved text between local surfaces through governed typing/hotkeys with explicit provenance and verification.",
    appMatchers: [/clipboard/i, /copy/i, /paste/i, /presse-papiers/i],
    affordances: ["copy approved text when supported by UI", "paste or type approved text", "transfer between apps"],
    primitives: ["focus_window", "type_text", "send_hotkey", "capture_window"],
    inputs: ["textContent", "sourceSurface", "targetSurface"],
    outputs: ["post_transfer_capture"],
    policyHooks: ["desktop_text_input", "desktop_hotkey"],
    evidenceHooks: ["before_capture", "after_capture"],
    rollbackSupport: "manual_app_undo_only",
    knownLimits: ["No arbitrary clipboard read primitive exists yet; this skill uses governed UI actions only."],
    missionRelevance: { text_editing: 0.6, desktop_action: 0.55 }
  },
  {
    id: "skill.terminal_guarded",
    version: SKILL_MANIFEST_VERSION,
    label: "Terminal Guarded",
    category: "shell",
    surfaceKind: "terminal",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Prepare and run visible terminal work through governed UI primitives with strict approval and capture evidence.",
    appMatchers: [/terminal/i, /powershell/i, /cmd/i, /shell/i],
    affordances: ["open terminal after approval", "type approved command", "execute only after approval", "capture output"],
    primitives: ["launch_application", "focus_window", "type_text", "send_hotkey", "capture_window"],
    inputs: ["commandDraft", "workingDirectory"],
    outputs: ["command_preview", "captured_output"],
    policyHooks: ["local_app_launch", "shell_command"],
    evidenceHooks: ["command_preview", "post_command_capture"],
    rollbackSupport: "command_dependent",
    knownLimits: ["No hidden shell execution; commands are typed into a visible approved terminal surface."],
    missionRelevance: { desktop_action: 0.45, safe_inspection: 0.35 }
  },
  {
    id: "skill.forms_basic",
    version: SKILL_MANIFEST_VERSION,
    label: "Forms Basic",
    category: "structured_entry",
    surfaceKind: "form",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_BASIC,
    description: "Fill structured fields only after approval and stop before submit/publish unless separately authorized.",
    appMatchers: [/form/i, /field/i, /input/i, /champ/i, /formulaire/i],
    affordances: ["identify fields", "type approved values", "verify field state", "stop before submit"],
    primitives: ["focus_window", "click_point", "type_text", "capture_window"],
    inputs: ["fieldValues", "targetSurface"],
    outputs: ["post_field_capture", "field_state_summary"],
    policyHooks: ["desktop_click", "desktop_text_input", "form_submit_or_publish"],
    evidenceHooks: ["before_capture", "post_field_capture"],
    rollbackSupport: "field_level_when_app_supports_undo",
    missionRelevance: { desktop_action: 0.55, text_editing: 0.4 }
  }
];

const DEEP_SKILL_PROFILES = Object.freeze({
  "skill.explorer": {
    supportedWorkflows: [
      {
        id: "explorer.inspect_directory",
        label: "Inspect a governed directory",
        requiredPrimitives: ["list_directory"],
        successCriteria: ["directory_listing evidence exists", "path is preserved in action log"]
      },
      {
        id: "explorer.write_text_with_rollback",
        label: "Create or update a text artifact with rollback evidence",
        requiredPrimitives: ["create_text_file", "write_text_file"],
        successCriteria: ["written_file evidence exists", "rollback manifest exists when overwriting"]
      },
      {
        id: "explorer.governed_path_mutation",
        label: "Copy, rename, move or delete a path after policy/approval",
        requiredPrimitives: ["copy_path", "rename_path", "move_path", "delete_path"],
        successCriteria: ["mutation action log exists", "rollback manifest exists"]
      }
    ],
    stateDetectors: ["path_exists", "directory_listing_available", "target_collision_detected", "rollback_manifest_available"],
    semanticTargets: ["source_path", "destination_path", "file_entry", "folder_entry", "desktop_folder"],
    verifiers: ["verify_directory_listing", "verify_text_content_written", "verify_path_mutation_result", "verify_rollback_manifest"],
    recoveryStrategies: ["abort_on_path_outside_allowed_scope", "create_backup_before_overwrite", "restore_from_rollback_manifest", "retry_read_after_short_delay"],
    knownFailureModes: ["path_not_found", "access_denied", "target_exists", "rollback_unavailable_for_external_mutation"],
    evidenceRequirements: ["directory_listing", "text_preview_or_written_file", "action_log", "rollback_manifest_for_mutations"]
  },
  "skill.notepad": {
    supportedWorkflows: [
      {
        id: "notepad.open_type_capture",
        label: "Open Notepad, type approved text, capture proof",
        requiredPrimitives: ["launch_application", "focus_window", "type_text", "capture_window"],
        successCriteria: ["visible Notepad window evidence exists", "post_type_capture evidence exists"]
      },
      {
        id: "notepad.draft_file_artifact",
        label: "Draft simple text and persist through governed file primitive",
        requiredPrimitives: ["create_text_file", "write_text_file", "read_text_file"],
        successCriteria: ["written_file evidence exists", "read-back text preview matches requested content"]
      },
      {
        id: "notepad.focus_recover",
        label: "Recover focus before typing or capture",
        requiredPrimitives: ["observe_windows", "focus_window", "capture_window"],
        successCriteria: ["active window after focus matches selected editor"]
      }
    ],
    stateDetectors: ["notepad_window_visible", "active_window_matches_editor", "text_area_focus_likely", "draft_file_exists"],
    semanticTargets: ["editor_window", "text_area", "draft_file_path", "save_prompt"],
    verifiers: ["verify_editor_visible", "verify_text_capture_after_typing", "verify_file_content_readback"],
    recoveryStrategies: ["refocus_editor_window", "reobserve_windows", "capture_failure_proof", "fallback_to_file_primitive_for_artifact"],
    knownFailureModes: ["multiple_notepad_windows", "text_area_not_focused", "save_dialog_requires_manual_resolution"],
    evidenceRequirements: ["before_capture", "post_type_capture", "written_file_or_text_preview"]
  },
  "skill.browser": {
    supportedWorkflows: [
      {
        id: "browser.controlled_navigation_state",
        label: "Open a controlled browser, navigate allowlisted URLs, and maintain current tab state",
        requiredPrimitives: ["browser.plan_mission", "browser.open_session", "browser.navigate", "browser.wait_state", "browser.read_state"],
        successCriteria: ["active target id exists", "current URL remains allowlisted", "navigation history records attempted pages"]
      },
      {
        id: "browser.dom_first_extract",
        label: "Read DOM state and extract structured page data",
        requiredPrimitives: ["browser.read_dom", "browser.query_interactive", "browser.extract_text"],
        successCriteria: ["DOM snapshot exists", "interactive elements are enumerated", "requested values are linked to selectors"]
      },
      {
        id: "browser.governed_interaction_verify",
        label: "Perform bounded DOM interaction and verify the outcome",
        requiredPrimitives: ["browser.click", "browser.type", "browser.wait_state", "browser.verify_outcome", "browser.capture_evidence"],
        successCriteria: ["interaction action is recorded", "outcome verification passes or records a blocker", "page evidence contains browser state"]
      }
    ],
    stateDetectors: ["browser_session_active", "active_target_known", "current_url_known", "page_load_state_known", "dom_snapshot_available", "blocker_state_known"],
    semanticTargets: ["url", "link", "button", "search_box", "input_field", "select_field", "result_region", "blocking_dialog"],
    verifiers: ["verify_allowlisted_url", "verify_page_loaded", "verify_dom_target_not_ambiguous", "verify_field_value", "verify_text_visible", "verify_screenshot_saved"],
    recoveryStrategies: ["wait_for_page_state", "retry_dom_snapshot_once", "detect_blocker_and_stop", "ask_manual_takeover_on_auth_or_captcha", "capture_failure_proof"],
    knownFailureModes: ["cookie_banner_blocks_target", "captcha_or_login_gate", "network_unavailable", "page_load_timeout", "ambiguous_dom_target", "site_requires_manual_auth"],
    evidenceRequirements: ["page_screenshot", "browser_session_state", "dom_snapshot_summary", "action_log", "verification_summary"]
  },
  "skill.app_launch": {
    supportedWorkflows: [
      {
        id: "app_launch.detect_launch_verify",
        label: "Detect an installed app, launch it and verify window visibility",
        requiredPrimitives: ["observe_windows", "launch_application", "capture_window"],
        successCriteria: ["app launch target recorded", "visible_window_after_launch evidence exists"]
      },
      {
        id: "app_launch.focus_existing_window",
        label: "Focus an existing application window",
        requiredPrimitives: ["observe_windows", "focus_window", "capture_window"],
        successCriteria: ["active window after focus is captured"]
      }
    ],
    stateDetectors: ["installed_application_detected", "window_visible", "active_window_matches_target", "launch_failed_with_evidence"],
    semanticTargets: ["application_name", "process_name", "window_title", "launch_target"],
    verifiers: ["verify_application_detected", "verify_window_visible_after_launch", "verify_focus_target_active"],
    recoveryStrategies: ["prefer_existing_window_before_launch", "reobserve_after_launch", "active_window_fallback", "capture_failure_proof"],
    knownFailureModes: ["application_not_installed", "ambiguous_application_name", "launch_blocked_by_os", "window_started_minimized"],
    evidenceRequirements: ["visible_window_snapshot", "visible_window_after_launch", "action_log"]
  },
  "skill.review_capture": {
    supportedWorkflows: [
      {
        id: "review_capture.capture_active_window",
        label: "Capture active or selected window as proof",
        requiredPrimitives: ["observe_windows", "capture_window"],
        successCriteria: ["window_capture evidence exists"]
      },
      {
        id: "review_capture.before_after_compare",
        label: "Record before/after proof for a governed action",
        requiredPrimitives: ["observe_windows", "capture_window"],
        successCriteria: ["before and after captures are linked to the action log"]
      }
    ],
    stateDetectors: ["active_window_known", "capture_asset_saved", "before_after_pair_available"],
    semanticTargets: ["active_window", "target_window", "proof_artifact", "evidence_gallery"],
    verifiers: ["verify_capture_file_exists", "verify_capture_manifest", "verify_before_after_pair"],
    recoveryStrategies: ["reobserve_windows", "capture_active_window_fallback", "record_failure_manifest"],
    knownFailureModes: ["window_not_visible", "capture_backend_unavailable", "target_window_changed"],
    evidenceRequirements: ["window_capture", "capture_manifest", "action_summary"]
  },
  "skill.clipboard_transfer": {
    supportedWorkflows: [
      {
        id: "clipboard_transfer.type_or_paste_approved_text",
        label: "Transfer approved text into a visible target",
        requiredPrimitives: ["focus_window", "type_text", "capture_window"],
        successCriteria: ["post_transfer_capture evidence exists"]
      },
      {
        id: "clipboard_transfer.hotkey_assisted_transfer",
        label: "Use approved hotkeys for visible copy/paste style transfer",
        requiredPrimitives: ["send_hotkey", "capture_window"],
        successCriteria: ["before/after capture documents visible state"]
      }
    ],
    stateDetectors: ["source_surface_known", "target_surface_known", "approved_text_available", "post_transfer_capture_available"],
    semanticTargets: ["source_surface", "target_surface", "text_target", "visible_selection"],
    verifiers: ["verify_target_surface_visible", "verify_post_transfer_capture", "verify_no_secret_capture_requested"],
    recoveryStrategies: ["refocus_target_window", "retry_type_text_once", "capture_failure_proof", "ask_for_clarification_on_ambiguous_target"],
    knownFailureModes: ["clipboard_read_not_available", "target_not_editable", "secret_like_text_detected", "focus_lost_during_transfer"],
    evidenceRequirements: ["before_capture", "post_transfer_capture", "action_log"]
  },
  "skill.terminal_guarded": {
    supportedWorkflows: [
      {
        id: "terminal_guarded.open_preview_command",
        label: "Open terminal and stage an approved command visibly",
        requiredPrimitives: ["launch_application", "focus_window", "type_text", "capture_window"],
        successCriteria: ["command preview capture exists before execution"]
      },
      {
        id: "terminal_guarded.execute_capture_output",
        label: "Execute an approved visible command and capture output",
        requiredPrimitives: ["send_hotkey", "capture_window"],
        successCriteria: ["post_command_capture evidence exists"]
      }
    ],
    stateDetectors: ["terminal_window_visible", "command_preview_visible", "post_command_output_visible", "execution_requires_approval"],
    semanticTargets: ["terminal_window", "command_prompt", "command_text", "output_region"],
    verifiers: ["verify_terminal_visible", "verify_command_preview_before_enter", "verify_output_capture_after_enter"],
    recoveryStrategies: ["refocus_terminal", "abort_on_destructive_or_secret_command", "capture_failure_proof", "ask_for_approval_before_enter"],
    knownFailureModes: ["command_blocked_by_policy", "terminal_not_installed_or_detected", "command_hangs", "output_not_visible"],
    evidenceRequirements: ["command_preview", "post_command_capture", "approval_record"]
  },
  "skill.forms_basic": {
    supportedWorkflows: [
      {
        id: "forms_basic.identify_fill_verify",
        label: "Identify visible fields, fill approved values and verify state",
        requiredPrimitives: ["focus_window", "click_point", "type_text", "capture_window"],
        successCriteria: ["field state capture exists", "no submit/send action executed unless separately authorized"]
      },
      {
        id: "forms_basic.stop_before_submit",
        label: "Prepare a form and stop before submit/publish",
        requiredPrimitives: ["capture_window"],
        successCriteria: ["pre-submit evidence exists", "approval requirement is explicit for submit/publish"]
      }
    ],
    stateDetectors: ["visible_field_candidates", "field_value_present_after_type", "submit_or_publish_target_detected", "pre_submit_state_captured"],
    semanticTargets: ["field_label", "input_control", "submit_button", "validation_message"],
    verifiers: ["verify_field_visible_before_type", "verify_field_state_after_type", "verify_submit_not_performed_without_approval"],
    recoveryStrategies: ["reobserve_fields", "semantic_target_retry", "capture_failure_proof", "ask_for_clarification_on_field_mismatch"],
    knownFailureModes: ["field_not_detected", "validation_rejects_value", "submit_button_too_risky", "credential_field_detected"],
    evidenceRequirements: ["before_capture", "post_field_capture", "approval_record_for_submit"]
  }
});

function withDeepProfile(skill) {
  const profile = DEEP_SKILL_PROFILES[skill.id];
  if (!profile) {
    return skill;
  }
  return {
    ...skill,
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_DEEP,
    capabilityDepth: SKILL_DEPTH.OPERATIONAL_DEEP,
    ...profile,
    knownLimits: [
      ...(skill.knownLimits ?? []),
      ...(profile.knownFailureModes ?? []).map((mode) => `Known failure mode: ${mode}`)
    ]
  };
}

export const BUILTIN_SKILL_MANIFESTS = Object.freeze(BUILTIN_SKILL_MANIFEST_BASE.map(withDeepProfile));

export function isOperationalSkill(skill = {}) {
  return [
    SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
    SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_DEEP
  ].includes(skill.implementationStatus);
}

export const CAPABILITY_SKILLS = Object.freeze(
  BUILTIN_SKILL_MANIFESTS.filter(isOperationalSkill)
);

export function validateSkillManifest(manifest = {}) {
  const errors = [];
  if (!manifest.id || !/^skill\.[a-z0-9_.-]+$/i.test(String(manifest.id))) {
    errors.push("id must be a skill.* identifier");
  }
  if (!manifest.label) {
    errors.push("label is required");
  }
  if (!Array.isArray(manifest.primitives) || manifest.primitives.length === 0) {
    errors.push("primitives must be a non-empty array");
  }
  if (!Array.isArray(manifest.policyHooks) || manifest.policyHooks.length === 0) {
    errors.push("policyHooks must be a non-empty array");
  }
  if (!Array.isArray(manifest.evidenceHooks) || manifest.evidenceHooks.length === 0) {
    errors.push("evidenceHooks must be a non-empty array");
  }
  if (manifest.capabilityDepth === SKILL_DEPTH.OPERATIONAL_DEEP || manifest.implementationStatus === SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_DEEP) {
    for (const [field, label] of [
      ["supportedWorkflows", "supportedWorkflows"],
      ["stateDetectors", "stateDetectors"],
      ["semanticTargets", "semanticTargets"],
      ["verifiers", "verifiers"],
      ["recoveryStrategies", "recoveryStrategies"],
      ["evidenceRequirements", "evidenceRequirements"]
    ]) {
      if (!Array.isArray(manifest[field]) || manifest[field].length === 0) {
        errors.push(`${label} must be a non-empty array for operational_deep skills`);
      }
    }
    for (const workflow of manifest.supportedWorkflows ?? []) {
      if (!workflow.id || !workflow.label) {
        errors.push("each supported workflow must include id and label");
      }
      if (!Array.isArray(workflow.requiredPrimitives) || workflow.requiredPrimitives.length === 0) {
        errors.push(`workflow ${workflow.id ?? "unknown"} must include requiredPrimitives`);
      }
      const missing = (workflow.requiredPrimitives ?? []).filter((primitive) => !(manifest.primitives ?? []).includes(primitive));
      if (missing.length > 0) {
        errors.push(`workflow ${workflow.id ?? "unknown"} references primitives not owned by skill: ${missing.join(", ")}`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanStringList(value, { maxItems = 24, maxLength = 180 } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => cleanText(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function normalizeUserDefinedSkillManifest(manifest = {}) {
  const appMatcherPatterns = cleanStringList(manifest.appMatchers);
  const normalized = {
    id: cleanText(manifest.id, 120),
    version: cleanText(manifest.version, 40) || SKILL_MANIFEST_VERSION,
    label: cleanText(manifest.label, 180),
    category: cleanText(manifest.category, 80) || "user_defined",
    surfaceKind: cleanText(manifest.surfaceKind, 80) || "application",
    implementationStatus: SKILL_IMPLEMENTATION_STATUS.DECLARED_FOUNDATION,
    capabilityDepth: SKILL_DEPTH.DESCRIPTIVE,
    description: cleanText(manifest.description, 1200),
    appMatchers: appMatcherPatterns.map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    }).filter(Boolean),
    appMatcherPatterns,
    affordances: cleanStringList(manifest.affordances),
    primitives: cleanStringList(manifest.primitives, { maxItems: 32, maxLength: 120 }),
    inputs: cleanStringList(manifest.inputs),
    outputs: cleanStringList(manifest.outputs),
    policyHooks: cleanStringList(manifest.policyHooks),
    evidenceHooks: cleanStringList(manifest.evidenceHooks),
    rollbackSupport: cleanText(manifest.rollbackSupport, 120) || "none",
    missionRelevance: typeof manifest.missionRelevance === "object" && manifest.missionRelevance ? manifest.missionRelevance : {},
    knownLimits: [
      ...cleanStringList(manifest.knownLimits),
      "User-defined skills remain non-executable until validated by a skill harness."
    ],
    activationStatus: "draft"
  };
  return normalized;
}

export function serializeSkillManifest(manifest = {}) {
  return {
    ...compactSkillManifest(manifest),
    description: manifest.description ?? "",
    appMatchers: manifest.appMatcherPatterns ?? [],
    inputs: manifest.inputs ?? [],
    outputs: manifest.outputs ?? [],
    supportedWorkflows: manifest.supportedWorkflows ?? [],
    stateDetectors: manifest.stateDetectors ?? [],
    semanticTargets: manifest.semanticTargets ?? [],
    verifiers: manifest.verifiers ?? [],
    recoveryStrategies: manifest.recoveryStrategies ?? [],
    evidenceRequirements: manifest.evidenceRequirements ?? [],
    knownLimits: manifest.knownLimits ?? [],
    activationStatus: manifest.activationStatus ?? "draft"
  };
}

export function compactSkillManifest(manifest = {}) {
  return {
    id: manifest.id,
    version: manifest.version,
    label: manifest.label,
    category: manifest.category,
    surfaceKind: manifest.surfaceKind,
    implementationStatus: manifest.implementationStatus,
    capabilityDepth: manifest.capabilityDepth,
    affordances: manifest.affordances ?? [],
    primitives: manifest.primitives ?? [],
    policyHooks: manifest.policyHooks ?? [],
    evidenceHooks: manifest.evidenceHooks ?? [],
    rollbackSupport: manifest.rollbackSupport ?? "none",
    supportedWorkflowCount: manifest.supportedWorkflows?.length ?? 0,
    verifierCount: manifest.verifiers?.length ?? 0,
    recoveryStrategyCount: manifest.recoveryStrategies?.length ?? 0,
    knownLimits: manifest.knownLimits ?? []
  };
}
