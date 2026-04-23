const PRIMITIVES = Object.freeze([
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
]);

const APPLICATION_HINTS = Object.freeze({
  notepad: ["notepad", "bloc-notes", "bloc notes", "notes"],
  calculator: ["calculator", "calculatrice", "calc"],
  paint: ["paint", "mspaint"],
  file_explorer: ["file explorer", "explorer", "explorateur", "fichiers", "dossier"],
  powershell: ["powershell", "terminal", "console"]
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedText(value) {
  return String(value ?? "").toLowerCase();
}

function stringArray(value, label) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an array.`), { category: "malformed_output" });
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function normalizeApplication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const label = String(value.label ?? value.id ?? "").trim();
  if (!id || !label) {
    return null;
  }
  return {
    id,
    label,
    kind: String(value.kind ?? "application").trim(),
    processName: value.processName ? String(value.processName).trim() : null,
    executablePath: value.executablePath ? String(value.executablePath).trim() : null,
    launchType: value.launchType ? String(value.launchType).trim() : null,
    source: value.source ? String(value.source).trim() : null
  };
}

function normalizeWindow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const title = String(value.title ?? "").trim();
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    processName: value.processName ? String(value.processName).trim() : null,
    executablePath: value.executablePath ? String(value.executablePath).trim() : null,
    bounds: value.bounds ?? null
  };
}

function selectApplication(mission, applications = [], preferredApplicationId = "") {
  const preferred = String(preferredApplicationId ?? "").trim().toLowerCase();
  if (preferred) {
    const explicit = applications.find((application) => String(application.id ?? "").toLowerCase() === preferred);
    if (explicit) {
      return explicit;
    }
  }
  const text = normalizedText(mission);
  for (const application of applications) {
    const label = normalizedText(application.label);
    const id = normalizedText(application.id);
    if ((label && text.includes(label)) || (id && text.includes(id))) {
      return application;
    }
  }
  for (const [appId, hints] of Object.entries(APPLICATION_HINTS)) {
    if (!hints.some((hint) => text.includes(hint))) {
      continue;
    }
    const direct = applications.find((application) => application.id === appId);
    if (direct) {
      return direct;
    }
    const bySuffix = applications.find((application) => application.id === `shortcut_${appId}` || application.id.endsWith(`_${appId}`));
    if (bySuffix) {
      return bySuffix;
    }
  }
  return null;
}

function extractTextToType(mission) {
  const text = String(mission ?? "");
  const patterns = [
    /\b(?:write|type|enter)\b\s+["“]?(.+?)["”]?(?:\s+(?:in|into|dans|sur)\b|[.?!]|$)/i,
    /\b(?:écris|ecris|tape|saisis)\b\s+["“]?(.+?)["”]?(?:\s+(?:dans|sur|in|into)\b|[.?!]|$)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = String(match?.[1] ?? "").trim();
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function wantsCapture(mission) {
  return /\b(screenshot|capture|capture d'?ecran|capture d'?écran|screen ?shot)\b/i.test(String(mission ?? ""));
}

function wantsClick(mission) {
  return /\b(click|clique)\b/i.test(String(mission ?? ""));
}

function extractClickTarget(mission) {
  const text = String(mission ?? "");
  const patterns = [
    /\b(?:click|clique)\b\s+(?:on|sur)?\s*["“]?(.+?)["”]?(?:\s+(?:button|bouton|menu|field|champ)\b|[.?!]|$)/i,
    /\b(?:click|clique)\b\s+(?:the|le|la|l')?\s*(.+?)(?:\s+(?:button|bouton|menu|field|champ)\b|[.?!]|$)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = String(match?.[1] ?? "").trim();
    if (candidate && !/\b(center|centre|middle|milieu)\b/i.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function wantsScroll(mission) {
  return /\b(scroll|défile|defile)\b/i.test(String(mission ?? ""));
}

function desktopPathHint(mission) {
  const text = String(mission ?? "");
  if (/\b(desktop|bureau)\b/i.test(text)) {
    return "Desktop";
  }
  if (/\b(downloads|téléchargements|telechargements)\b/i.test(text)) {
    return "Downloads";
  }
  if (/\b(documents)\b/i.test(text)) {
    return "Documents";
  }
  return "";
}

function wantsDirectoryList(mission) {
  return /\b(list|show|inspect|what files|what folders|liste|affiche|montre|inspecte|quels fichiers|quels dossiers)\b/i.test(String(mission ?? ""));
}

function extractCreateFile(mission) {
  const text = String(mission ?? "");
  const patterns = [
    /\b(?:create|crée|cree)\b.*\b(?:file|fichier)\b\s+["“]?([^"”]+?\.(?:txt|md|csv|json))["”]?/i,
    /\b(?:file|fichier)\b\s+["“]?([^"”]+?\.(?:txt|md|csv|json))["”]?/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const filename = String(match?.[1] ?? "").trim();
    if (filename) {
      return filename;
    }
  }
  return "";
}

export function validateDesktopPlanOutput(output, { maxSteps = 14 } = {}) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw Object.assign(new Error("Desktop plan output must be an object."), { category: "malformed_output" });
  }
  const missionSummary = String(output.missionSummary ?? "").trim();
  const planSummary = String(output.planSummary ?? "").trim();
  const requiresClarification = Boolean(output.requiresClarification);
  const clarificationQuestion = String(output.clarificationQuestion ?? "").trim();
  const selectedApplication = normalizeApplication(output.selectedApplication ?? null);
  if (!missionSummary || !planSummary) {
    throw Object.assign(new Error("Desktop plan output is missing required summary fields."), { category: "malformed_output" });
  }
  if (requiresClarification && !clarificationQuestion) {
    throw Object.assign(new Error("Desktop plan needs clarificationQuestion when requiresClarification is true."), { category: "malformed_output" });
  }

  const steps = asArray(output.steps).slice(0, maxSteps).map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw Object.assign(new Error(`Desktop plan step ${index} must be an object.`), { category: "malformed_output" });
    }
    const primitive = String(step.primitive ?? "").trim();
    if (!PRIMITIVES.includes(primitive)) {
      throw Object.assign(new Error(`Unsupported desktop primitive: ${primitive}`), { category: "malformed_output" });
    }
    return {
      id: String(step.id ?? `step_${index + 1}`).trim(),
      primitive,
      label: String(step.label ?? primitive).trim(),
      target: step.target && typeof step.target === "object" && !Array.isArray(step.target) ? step.target : {},
      input: step.input && typeof step.input === "object" && !Array.isArray(step.input) ? step.input : {},
      riskLevel: String(step.riskLevel ?? "medium").trim(),
      requiresApproval: step.requiresApproval !== false,
      expectedOutcome: String(step.expectedOutcome ?? "").trim(),
      verification: String(step.verification ?? "").trim()
    };
  });

  if (!requiresClarification && steps.length === 0) {
    throw Object.assign(new Error("Desktop plan needs at least one step unless clarification is required."), { category: "malformed_output" });
  }

  return {
    missionSummary,
    planSummary,
    selectedApplication,
    requiresClarification,
    clarificationQuestion: requiresClarification ? clarificationQuestion : "",
    steps,
    verificationGoals: stringArray(output.verificationGoals ?? [], "verificationGoals"),
    unsupportedRequests: stringArray(output.unsupportedRequests ?? [], "unsupportedRequests"),
    safetyNotes: stringArray(output.safetyNotes ?? [], "safetyNotes")
  };
}

export function buildDeterministicDesktopPlan(input = {}) {
  const mission = String(input.mission ?? input.originalMission ?? "").trim();
  const applications = asArray(input.installedApplications).map(normalizeApplication).filter(Boolean);
  const preferredApplicationId = input.missionSpec?.parameters?.applicationLaunch?.applicationId
    ?? input.missionUnderstanding?.applicationLaunch?.applicationId
    ?? "";
  const selectedApplication = selectApplication(mission, applications, preferredApplicationId);
  const textToType = extractTextToType(mission);
  const steps = [
    {
      id: "observe_windows",
      primitive: "observe_windows",
      label: "Inspect visible windows before acting",
      target: {},
      input: {},
      riskLevel: "low",
      requiresApproval: false,
      expectedOutcome: "The cowork has a current view of visible windows.",
      verification: "Visible windows were listed."
    }
  ];

  if (!selectedApplication && /\b(open|launch|ouvrir|ouvre|lance|démarre|demarre)\b/i.test(mission)) {
    return {
      missionSummary: mission || "Desktop mission",
      planSummary: "The cowork needs one app choice before it can safely continue.",
      selectedApplication: null,
      requiresClarification: true,
      clarificationQuestion: "Which local application should I open for this mission?",
      steps,
      verificationGoals: ["Do not act until the target application is clear."],
      unsupportedRequests: [],
      safetyNotes: ["Desktop app launch requires an explicit, launchable application target."]
    };
  }

  if (selectedApplication) {
    steps.push({
      id: "launch_application",
      primitive: "launch_application",
      label: `Open ${selectedApplication.label}`,
      target: { appId: selectedApplication.id, label: selectedApplication.label },
      input: {},
      riskLevel: "medium",
      requiresApproval: true,
      expectedOutcome: `${selectedApplication.label} opens visibly on this machine.`,
      verification: "A visible window for the launched app appears or becomes active."
    });
  }

  if (textToType) {
    steps.push({
      id: "type_text",
      primitive: "type_text",
      label: "Type requested text",
      target: { useActiveWindow: true },
      input: { text: textToType },
      riskLevel: "medium",
      requiresApproval: true,
      expectedOutcome: "The requested text is entered into the active target window.",
      verification: "The action log records the text-input primitive and the active window is captured after typing."
    });
  }

  if (wantsClick(mission)) {
    const semanticTarget = extractClickTarget(mission);
    steps.push({
      id: "click_point",
      primitive: "click_point",
      label: semanticTarget ? `Click ${semanticTarget}` : "Click the center of the active window",
      target: semanticTarget
        ? { useActiveWindow: true, semanticTarget }
        : { useActiveWindow: true, point: "window_center" },
      input: {},
      riskLevel: "high",
      requiresApproval: true,
      expectedOutcome: semanticTarget
        ? `A single click is performed on the visible target matching "${semanticTarget}".`
        : "A single click is performed in the active window.",
      verification: "The active window is inspected and captured after the click."
    });
  }

  if (wantsScroll(mission)) {
    steps.push({
      id: "scroll_window",
      primitive: "scroll_window",
      label: "Scroll the active window",
      target: { useActiveWindow: true },
      input: { delta: -360 },
      riskLevel: "medium",
      requiresApproval: true,
      expectedOutcome: "The active window scrolls once.",
      verification: "The active window is captured after scrolling."
    });
  }

  if (wantsCapture(mission)) {
    steps.push({
      id: "capture_window",
      primitive: "capture_window",
      label: "Capture the active window",
      target: { useActiveWindow: true },
      input: {},
      riskLevel: "low",
      requiresApproval: false,
      expectedOutcome: "A screenshot proof file is persisted.",
      verification: "The capture output path exists in run evidence."
    });
  }

  const pathHint = desktopPathHint(mission);
  if (pathHint && wantsDirectoryList(mission)) {
    steps.push({
      id: "list_directory",
      primitive: "list_directory",
      label: `List ${pathHint}`,
      target: { path: pathHint },
      input: { maxEntries: 80 },
      riskLevel: "low",
      requiresApproval: false,
      expectedOutcome: `Top-level entries from ${pathHint} are listed.`,
      verification: "The file primitive returns directory entries and records them in the action log."
    });
  }

  const createFileName = extractCreateFile(mission);
  if (createFileName) {
    const base = pathHint || ".";
    steps.push({
      id: "create_text_file",
      primitive: "create_text_file",
      label: `Create ${createFileName}`,
      target: { path: `${base}/${createFileName}` },
      input: { content: "", overwrite: false },
      riskLevel: "medium",
      requiresApproval: true,
      expectedOutcome: `${createFileName} is created with rollback metadata.`,
      verification: "The file exists and a rollback manifest was persisted."
    });
  }

  return {
    missionSummary: mission || "Desktop mission",
    planSummary: selectedApplication
      ? `Use governed desktop primitives to work with ${selectedApplication.label}.`
      : "Use governed desktop observation and capture primitives only.",
    selectedApplication,
    requiresClarification: false,
    clarificationQuestion: "",
    steps,
    verificationGoals: [
      "Verify every primitive against visible desktop state or persisted evidence.",
      "Stop rather than guessing if the target window becomes ambiguous.",
      "Persist an action log and before/after proof."
    ],
    unsupportedRequests: [],
    safetyNotes: [
      "No submit/send/publish/delete/payment action is allowed without a future explicit policy expansion.",
      "The executor uses one primitive at a time with approval gates for app launch and actuation."
    ]
  };
}
