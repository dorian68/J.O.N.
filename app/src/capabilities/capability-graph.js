import { FILE_PRIMITIVES } from "../computer/file-primitives.js";
import { normalizeMcpServerTools } from "./external-tool-providers.js";
import {
  BUILTIN_SKILL_MANIFESTS,
  CAPABILITY_SKILLS,
  SKILL_IMPLEMENTATION_STATUS
} from "./skill-manifest.js";
import {
  validateOperationalDeepSkill,
  validateOperationalDeepSkills
} from "./skill-validation-harness.js";

export { CAPABILITY_SKILLS } from "./skill-manifest.js";

const DESKTOP_PRIMITIVE_METADATA = Object.freeze({
  observe_windows: {
    description: "List visible windows and active desktop context.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["visible_window_snapshot"],
    affordances: ["observe desktop", "inspect active window"],
    relevance: { safe_inspection: 0.85, desktop_action: 0.6 }
  },
  launch_application: {
    description: "Launch a detected local application.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["visible_window_after_launch"],
    affordances: ["open app", "launch tool"],
    relevance: { desktop_action: 0.9, note_drafting: 0.65, web_research: 0.55 }
  },
  focus_window: {
    description: "Bring a known visible window to foreground.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["active_window_after_focus"],
    affordances: ["focus app", "switch window"],
    relevance: { desktop_action: 0.75 }
  },
  type_text: {
    description: "Type text into the active governed target.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["post_type_capture"],
    affordances: ["type", "write into app", "draft text"],
    relevance: { text_editing: 0.9, note_drafting: 0.95, desktop_action: 0.7 }
  },
  send_hotkey: {
    description: "Send a governed keyboard shortcut.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["post_hotkey_capture"],
    affordances: ["shortcut", "save when approved", "navigate app"],
    relevance: { desktop_action: 0.65, text_editing: 0.45 }
  },
  click_point: {
    description: "Click a semantic target or approved coordinate.",
    riskLevel: "high",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["before_after_capture"],
    affordances: ["click button", "select control"],
    relevance: { desktop_action: 0.85, browser_action: 0.7 }
  },
  scroll_window: {
    description: "Scroll the active window.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["post_scroll_capture"],
    affordances: ["scroll", "continue reading"],
    relevance: { web_research: 0.65, desktop_action: 0.55 }
  },
  capture_window: {
    description: "Capture the active or target window as proof.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["window_capture"],
    affordances: ["screenshot", "proof", "capture result"],
    relevance: { proof_capture: 1, desktop_action: 0.55, web_research: 0.5 }
  }
});

const FILE_PRIMITIVE_METADATA = Object.freeze({
  list_directory: {
    description: "List entries in a local directory.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["directory_listing"],
    affordances: ["list folders", "inspect directory"],
    relevance: { file_management: 0.95, safe_inspection: 1, local_question: 0.9 }
  },
  read_text_file: {
    description: "Read a text file preview.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["text_preview"],
    affordances: ["read file", "summarize text"],
    relevance: { file_management: 0.75, safe_inspection: 0.85, local_question: 0.75 }
  },
  create_text_file: {
    description: "Create a text file with rollback metadata.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: true,
    evidenceExpected: ["created_file", "rollback_manifest"],
    affordances: ["create file", "draft artifact"],
    relevance: { file_management: 0.85, note_drafting: 0.6 }
  },
  write_text_file: {
    description: "Write text file content with backup and rollback manifest.",
    riskLevel: "high",
    approvalRequired: true,
    rollbackPossible: true,
    evidenceExpected: ["backup", "rollback_manifest", "written_file"],
    affordances: ["write file", "edit file"],
    relevance: { file_management: 0.85, text_editing: 0.7 }
  },
  copy_path: {
    description: "Copy a file or folder with rollback manifest for destination.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: true,
    evidenceExpected: ["destination_snapshot", "rollback_manifest"],
    affordances: ["copy file", "copy folder"],
    relevance: { file_management: 0.9 }
  },
  rename_path: {
    description: "Rename a file or folder with backup metadata.",
    riskLevel: "high",
    approvalRequired: true,
    rollbackPossible: true,
    evidenceExpected: ["rollback_manifest"],
    affordances: ["rename file", "rename folder"],
    relevance: { file_management: 0.9 }
  },
  move_path: {
    description: "Move a file or folder with rollback metadata.",
    riskLevel: "high",
    approvalRequired: true,
    rollbackPossible: true,
    evidenceExpected: ["rollback_manifest"],
    affordances: ["move file", "move folder"],
    relevance: { file_management: 0.9 }
  },
  delete_path: {
    description: "Delete a file or folder only when policy and approval allow it; backup is captured first.",
    riskLevel: "high",
    approvalRequired: true,
    rollbackPossible: true,
    evidenceExpected: ["backup", "rollback_manifest"],
    affordances: ["delete file", "delete folder"],
    relevance: { file_management: 0.55 }
  }
});

const BROWSER_PRIMITIVE_METADATA = Object.freeze({
  "browser.plan_mission": {
    description: "Generate a governed DOM-first browser run plan from a natural web mission and current browser/page state.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["browser_plan", "verification_goals"],
    affordances: ["plan web mission", "choose browser steps", "identify blockers", "prepare evidence strategy"],
    relevance: { web_research: 1, browser_action: 1, safe_inspection: 0.7 }
  },
  "browser.open_session": {
    description: "Open a controlled browser session with explicit allowlisted hosts.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["browser_session_state"],
    affordances: ["open controlled browser", "create browser session", "initialize active tab"],
    relevance: { web_research: 0.95, browser_action: 0.95, desktop_action: 0.45 }
  },
  "browser.navigate": {
    description: "Navigate the active controlled tab to an allowlisted URL.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["navigation_history", "current_url"],
    affordances: ["open URL", "navigate site", "visit allowlisted page"],
    relevance: { web_research: 1, browser_action: 0.95 }
  },
  "browser.read_state": {
    description: "Read current controlled browser session state: active tab, URL, title, loading state, recent actions and blockers.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["browser_session_state"],
    affordances: ["know current tab", "inspect current URL", "summarize browser state"],
    relevance: { web_research: 0.9, browser_action: 0.9, safe_inspection: 0.75, local_question: 0.45 }
  },
  "browser.read_dom": {
    description: "Capture a DOM-first page snapshot with text and interactive elements.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["dom_snapshot"],
    affordances: ["read page", "inspect links", "inspect buttons", "inspect forms"],
    relevance: { web_research: 1, safe_inspection: 0.8, browser_action: 0.75 }
  },
  "browser.query_interactive": {
    description: "Rank visible DOM targets such as links, buttons, inputs and selects against a semantic selector.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["target_ranking"],
    affordances: ["find link", "find button", "find field", "detect ambiguity"],
    relevance: { web_research: 0.85, browser_action: 0.9, safe_inspection: 0.6 }
  },
  "browser.click": {
    description: "Click a bounded DOM target in the controlled browser.",
    riskLevel: "high",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["before_after_page_state"],
    affordances: ["click link", "click button", "select page action"],
    relevance: { browser_action: 0.95, web_research: 0.7 }
  },
  "browser.type": {
    description: "Type or fill approved text into a DOM field in the controlled browser.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["field_value_verification"],
    affordances: ["type in search box", "fill field", "enter text"],
    relevance: { browser_action: 0.9, web_research: 0.7, text_editing: 0.45 }
  },
  "browser.select": {
    description: "Select an approved option in a DOM select field.",
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: false,
    evidenceExpected: ["field_value_verification"],
    affordances: ["select option", "choose filter", "set form field"],
    relevance: { browser_action: 0.8, web_research: 0.5 }
  },
  "browser.wait_state": {
    description: "Wait for browser load state or a visible selector after navigation or interaction.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["page_load_state"],
    affordances: ["wait for page", "detect change", "wait for selector"],
    relevance: { web_research: 0.85, browser_action: 0.85 }
  },
  "browser.extract_text": {
    description: "Extract text content from selected DOM targets for structured evidence.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["structured_extraction"],
    affordances: ["extract text", "read result", "build table"],
    relevance: { web_research: 1, safe_inspection: 0.75 }
  },
  "browser.detect_blockers": {
    description: "Detect visible blocking UI such as modals or dialogs; anti-bot and auth gates are reported, not bypassed.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["blocker_state"],
    affordances: ["detect modal", "detect blocker", "stop on captcha or login"],
    relevance: { web_research: 0.75, browser_action: 0.75, safe_inspection: 0.55 }
  },
  "browser.verify_outcome": {
    description: "Verify URL, text visibility, field value or checkbox state after a browser action.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["verification_summary"],
    affordances: ["verify result", "check field", "confirm navigation"],
    relevance: { web_research: 0.9, browser_action: 0.9, proof_capture: 0.55 }
  },
  "browser.capture_evidence": {
    description: "Capture page screenshot evidence with DOM snapshot and current browser state.",
    riskLevel: "low",
    approvalRequired: false,
    rollbackPossible: false,
    evidenceExpected: ["page_screenshot", "browser_session_state"],
    affordances: ["screenshot page", "capture proof", "record current state"],
    relevance: { proof_capture: 1, web_research: 0.85, browser_action: 0.7 }
  }
});

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function capabilityNodeId(kind, id) {
  return `${kind}.${cleanText(id, 160).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_")}`;
}

function matchesSkill(application, skill) {
  const haystack = [
    application.id,
    application.label,
    application.kind,
    application.processName,
    application.source
  ].map((entry) => String(entry ?? "")).join(" ");
  return skill.appMatchers.some((pattern) => pattern.test(haystack));
}

export function skillForApplication(application = {}) {
  return CAPABILITY_SKILLS.find((skill) => skill.id !== "skill.app_launch" && matchesSkill(application, skill))
    ?? CAPABILITY_SKILLS.find((skill) => skill.id === "skill.app_launch" && matchesSkill(application, skill))
    ?? null;
}

function capabilityNode({
  kind,
  id,
  label,
  sourceKind,
  sourceId,
  skillId = null,
  riskLevel = "medium",
  approvalRequired = true,
  rollbackPossible = false,
  relevance = {},
    payload = {}
}) {
  return {
    id: capabilityNodeId(kind, id),
    kind,
    label: cleanText(label, 180),
    sourceKind,
    sourceId: cleanText(sourceId, 240),
    skillId,
    riskLevel,
    approvalRequired,
    rollbackPossible,
    relevance,
    payload
  };
}

function cleanList(value, { maxItems = 12, maxLength = 180 } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => cleanText(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildSkillNodes() {
  return CAPABILITY_SKILLS.map((skill) => capabilityNode({
    kind: "skill",
    id: skill.id,
    label: skill.label,
    sourceKind: "builtin_skill",
    sourceId: skill.id,
    skillId: skill.id,
    riskLevel: "medium",
    approvalRequired: true,
    rollbackPossible: skill.primitives.some((primitive) => FILE_PRIMITIVE_METADATA[primitive]?.rollbackPossible),
    relevance: skill.missionRelevance,
    payload: {
      description: skill.description,
      category: skill.category,
      surfaceKind: skill.surfaceKind,
      implementationStatus: skill.implementationStatus,
      capabilityDepth: skill.capabilityDepth,
      affordances: skill.affordances,
      primitives: skill.primitives,
      inputs: skill.inputs ?? [],
      outputs: skill.outputs ?? [],
      supportedWorkflows: skill.supportedWorkflows ?? [],
      stateDetectors: skill.stateDetectors ?? [],
      semanticTargets: skill.semanticTargets ?? [],
      verifiers: skill.verifiers ?? [],
      recoveryStrategies: skill.recoveryStrategies ?? [],
      policyHooks: skill.policyHooks ?? [],
      evidenceExpected: skill.evidenceHooks ?? [],
      evidenceRequirements: skill.evidenceRequirements ?? [],
      rollbackSupport: skill.rollbackSupport ?? "none",
      deepValidation: validateOperationalDeepSkill(skill),
      knownLimits: [
        "Policy remains authoritative before execution.",
        "Skills compose atomic tools and do not execute independently.",
        ...(skill.knownLimits ?? [])
      ]
    }
  }));
}

function buildAppNodes(applications = []) {
  return applications.map((application) => {
    const skill = skillForApplication(application);
    return capabilityNode({
      kind: "surface",
      id: application.id,
      label: application.label ?? application.id,
      sourceKind: "local_application_provider",
      sourceId: application.id,
      skillId: skill?.id ?? null,
      riskLevel: "medium",
      approvalRequired: true,
      rollbackPossible: false,
      relevance: skill?.missionRelevance ?? { desktop_action: 0.45 },
      payload: {
        surfaceType: application.kind ?? "application",
        processName: application.processName ?? null,
        executablePath: application.executablePath ?? null,
        launchType: application.launchType ?? null,
        providerSource: application.source ?? null,
        description: skill
          ? `${application.label ?? application.id} can be used through ${skill.label}.`
          : `${application.label ?? application.id} is a detected local application.`,
        affordances: skill?.affordances ?? ["open app", "observe window", "capture proof"],
        knownLimits: skill
          ? ["Uses the matched skill affordances; policy still gates actions."]
          : ["No dedicated skill; use generic governed desktop primitives only."]
      }
    });
  });
}

function buildToolNodes() {
  const desktopNodes = Object.entries(DESKTOP_PRIMITIVE_METADATA).map(([primitive, meta]) => capabilityNode({
    kind: "tool",
    id: primitive,
    label: primitive,
    sourceKind: "desktop_primitive_provider",
    sourceId: primitive,
    skillId: null,
    riskLevel: meta.riskLevel,
    approvalRequired: meta.approvalRequired,
    rollbackPossible: meta.rollbackPossible,
    relevance: meta.relevance,
    payload: {
      primitive,
      description: meta.description,
      evidenceExpected: meta.evidenceExpected,
      affordances: meta.affordances,
      knownLimits: ["Primitive is atomic; planner must compose it through a governed skill or run."]
    }
  }));
  const fileNodes = FILE_PRIMITIVES.map((primitive) => {
    const meta = FILE_PRIMITIVE_METADATA[primitive];
    return capabilityNode({
      kind: "tool",
      id: primitive,
      label: primitive,
      sourceKind: "file_primitive_provider",
      sourceId: primitive,
      skillId: "skill.explorer",
      riskLevel: meta.riskLevel,
      approvalRequired: meta.approvalRequired,
      rollbackPossible: meta.rollbackPossible,
      relevance: meta.relevance,
      payload: {
        primitive,
        description: meta.description,
        evidenceExpected: meta.evidenceExpected,
        affordances: meta.affordances,
        knownLimits: [
          "File mutations require policy review.",
          "Rollback manifests are produced for mutations."
        ]
      }
    });
  });
  const browserNodes = Object.entries(BROWSER_PRIMITIVE_METADATA).map(([primitive, meta]) => capabilityNode({
    kind: "tool",
    id: primitive,
    label: primitive,
    sourceKind: "browser_primitive_provider",
    sourceId: primitive,
    skillId: "skill.browser",
    riskLevel: meta.riskLevel,
    approvalRequired: meta.approvalRequired,
    rollbackPossible: meta.rollbackPossible,
    relevance: meta.relevance,
    payload: {
      primitive,
      description: meta.description,
      evidenceExpected: meta.evidenceExpected,
      affordances: meta.affordances,
      knownLimits: [
        "Browser tools only operate on governed controlled sessions and allowlisted surfaces.",
        "Anti-bot, CAPTCHA, credential, and authentication blockers are reported or handed off manually; they are not bypassed."
      ]
    }
  }));
  return [...desktopNodes, ...fileNodes, ...browserNodes];
}

function buildExternalToolNodes(externalToolProviders = []) {
  return externalToolProviders.flatMap((provider) => normalizeMcpServerTools({
    server: provider,
    tools: provider.tools ?? []
  }).map((tool) => capabilityNode({
    kind: "tool",
    id: `mcp.${tool.id}`,
    label: tool.label,
    sourceKind: tool.sourceKind,
    sourceId: tool.sourceId,
    skillId: null,
    riskLevel: tool.riskLevel,
    approvalRequired: tool.approvalRequired,
    rollbackPossible: tool.rollbackPossible,
    relevance: tool.relevance,
    payload: tool.payload
  })));
}

export function buildCapabilityGraph({ applications = [], browsers = [], agentConfiguration = null, externalToolProviders = [] } = {}) {
  const browserApps = browsers.map((browser) => ({
    id: `browser_${browser.id}`,
    label: browser.label,
    kind: "browser",
    processName: browser.processName,
    executablePath: browser.executablePath,
    launchType: "executable",
    source: "known_browser"
  }));
  const byId = new Map();
  for (const app of [...applications, ...browserApps]) {
    if (app?.id && !byId.has(app.id)) {
      byId.set(app.id, app);
    }
  }
  const nodes = [
    ...buildSkillNodes(),
    ...buildToolNodes(),
    ...buildExternalToolNodes(externalToolProviders),
    ...buildAppNodes(Array.from(byId.values()))
  ];
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: "local_tool_provider_adapters",
    autonomyLevel: agentConfiguration?.guardrails?.desktopAutonomy?.level ?? "supervised",
    nodes
  };
}

export function applyCapabilityOverrides(nodes = [], overrides = []) {
  const byNodeId = new Map(overrides.map((override) => [override.nodeId, override]));
  return nodes.map((node) => {
    const override = byNodeId.get(node.id);
    if (!override) {
      return node;
    }
    const payload = { ...(node.payload ?? {}) };
    if (cleanText(override.description, 1200)) {
      payload.description = cleanText(override.description, 1200);
    }
    const affordances = cleanList(override.affordances);
    if (affordances.length > 0) {
      payload.affordances = affordances;
    }
    const knownLimits = cleanList(override.knownLimits);
    if (knownLimits.length > 0) {
      payload.knownLimits = knownLimits;
    }
    payload.capabilityOverride = {
      updatedAt: override.updatedAt ?? null,
      source: override.metadata?.source ?? "operator_override",
      generatedBy: override.metadata?.generatedBy ?? null
    };
    return {
      ...node,
      label: cleanText(override.label, 180) || node.label,
      payload,
      overrideUpdatedAt: override.updatedAt ?? null
    };
  });
}

export function buildCapabilityFeedbackStats(feedbackRecords = []) {
  const stats = new Map();
  for (const record of feedbackRecords) {
    const key = record.nodeId;
    if (!key) {
      continue;
    }
    const current = stats.get(key) ?? {
      nodeId: key,
      skillId: record.skillId ?? null,
      total: 0,
      successes: 0,
      failures: 0,
      selections: 0,
      approvals: 0,
      evidence: 0,
      rollbacks: 0,
      operatorPositive: 0,
      operatorNegative: 0,
      expectedSelections: 0,
      lastUsedAt: null
    };
    current.total += 1;
    if (["success", "pass", "completed"].includes(record.outcomeStatus)) {
      current.successes += 1;
    }
    if (["failed", "fail", "blocked"].includes(record.outcomeStatus)) {
      current.failures += 1;
    }
    if (["selected", "candidate"].includes(record.outcomeStatus)) {
      current.selections += 1;
    }
    if (["operator_positive", "useful", "preferred"].includes(record.outcomeStatus)) {
      current.operatorPositive += 1;
    }
    if (["operator_negative", "not_useful", "wrong_choice"].includes(record.outcomeStatus)) {
      current.operatorNegative += 1;
    }
    if (["expected", "expected_selection"].includes(record.outcomeStatus)) {
      current.expectedSelections += 1;
    }
    current.approvals += Number(record.approvalCount ?? 0);
    current.evidence += Number(record.evidenceCount ?? 0);
    current.rollbacks += Number(record.rollbackCount ?? 0);
    current.lastUsedAt = [current.lastUsedAt, record.createdAt].filter(Boolean).sort().at(-1) ?? null;
    stats.set(key, current);
  }
  return stats;
}

const RANKING_POLICY_V2 = Object.freeze({
  id: "capability-ranking-v2",
  maxKeywordBoost: 0.28,
  kindBoosts: {
    skill: 0.1,
    surface: 0.05,
    tool: 0
  },
  riskPenalties: {
    low: 0,
    medium: 0.015,
    high: 0.04
  },
  approvalPenalty: 0.015,
  rollbackBoost: 0.015
});

function feedbackAdjustment(feedback) {
  if (!feedback) {
    return 0;
  }
  const successBoost = Math.min(0.14, feedback.successes * 0.035);
  const selectionBoost = Math.min(0.05, feedback.selections * 0.01);
  const evidenceBoost = Math.min(0.04, feedback.evidence * 0.008);
  const operatorPositiveBoost = Math.min(0.12, feedback.operatorPositive * 0.045 + feedback.expectedSelections * 0.03);
  const failurePenalty = Math.min(0.18, feedback.failures * 0.055);
  const rollbackPenalty = Math.min(0.08, feedback.rollbacks * 0.035);
  const operatorNegativePenalty = Math.min(0.16, feedback.operatorNegative * 0.065);
  return successBoost + selectionBoost + evidenceBoost + operatorPositiveBoost - failurePenalty - rollbackPenalty - operatorNegativePenalty;
}

function missionTypesForText(text) {
  const normalized = cleanText(text, 2000).toLowerCase();
  const types = new Set();
  if (/\b(browser|navigateur|web|site|cherche|search|google|edge|chrome|firefox)\b/i.test(normalized)) {
    types.add("web_research");
    types.add("browser_action");
  }
  if (/\b(file|folder|dossier|fichier|desktop|bureau|documents|downloads|copie|copy|renomme|rename|move|déplace|deplace|supprime|delete|liste|list)\b/i.test(normalized)) {
    types.add("file_management");
  }
  if (/\b(note|notepad|bloc-notes|écris|ecris|write|type|draft|texte|text)\b/i.test(normalized)) {
    types.add("note_drafting");
    types.add("text_editing");
  }
  if (/\b(capture|screenshot|preuve|proof)\b/i.test(normalized)) {
    types.add("proof_capture");
  }
  if (/\b(quels|what|liste|list|inspect|observe|montre|show)\b/i.test(normalized)) {
    types.add("safe_inspection");
    types.add("local_question");
  }
  if (types.size === 0) {
    types.add("desktop_action");
  }
  return Array.from(types);
}

function keywordBoost(node, text) {
  const haystack = [
    node.label,
    node.payload?.description,
    ...(node.payload?.affordances ?? []),
    node.payload?.surfaceType,
    node.payload?.processName
  ].join(" ").toLowerCase();
  const words = cleanText(text, 2000).toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  const uniqueWords = Array.from(new Set(words));
  const hits = uniqueWords.filter((word) => haystack.includes(word)).length;
  return {
    score: Math.min(RANKING_POLICY_V2.maxKeywordBoost, hits * 0.055),
    matchedWords: uniqueWords.filter((word) => haystack.includes(word)).slice(0, 8)
  };
}

function nodeRiskAdjustment(node) {
  const riskPenalty = RANKING_POLICY_V2.riskPenalties[node.riskLevel] ?? 0.02;
  const approvalPenalty = node.approvalRequired ? RANKING_POLICY_V2.approvalPenalty : 0;
  const rollbackBoost = node.rollbackPossible ? RANKING_POLICY_V2.rollbackBoost : 0;
  return rollbackBoost - riskPenalty - approvalPenalty;
}

function rankingExplanation({ node, missionTypes, relevanceScore, keyword, kindBoost, feedback, feedbackScore, riskAdjustment, score }) {
  return {
    policyId: RANKING_POLICY_V2.id,
    score: Number(score.toFixed(3)),
    components: {
      relevance: Number(relevanceScore.toFixed(3)),
      keyword: Number(keyword.score.toFixed(3)),
      kindBoost: Number(kindBoost.toFixed(3)),
      feedback: Number(feedbackScore.toFixed(3)),
      riskAndApproval: Number(riskAdjustment.toFixed(3))
    },
    matchedMissionTypes: missionTypes.filter((type) => Number(node.relevance?.[type] ?? 0) > 0),
    matchedWords: keyword.matchedWords,
    feedback: feedback ? {
      total: feedback.total,
      successes: feedback.successes,
      failures: feedback.failures,
      operatorPositive: feedback.operatorPositive,
      operatorNegative: feedback.operatorNegative,
      expectedSelections: feedback.expectedSelections,
      lastUsedAt: feedback.lastUsedAt
    } : null,
    policyHints: {
      riskLevel: node.riskLevel,
      approvalRequired: node.approvalRequired,
      rollbackPossible: node.rollbackPossible,
      sourceKind: node.sourceKind
    }
  };
}

export function scoreCapabilityNodesForMission(nodes = [], mission = "", { limit = 16, feedbackRecords = [] } = {}) {
  const missionTypes = missionTypesForText(mission);
  const feedbackStats = buildCapabilityFeedbackStats(feedbackRecords);
  return nodes.map((node) => {
    const relevanceScore = missionTypes.reduce((score, type) => Math.max(score, Number(node.relevance?.[type] ?? 0)), 0);
    const kindBoost = RANKING_POLICY_V2.kindBoosts[node.kind] ?? 0;
    const feedback = feedbackStats.get(node.id) ?? null;
    const keyword = keywordBoost(node, mission);
    const feedbackScore = feedbackAdjustment(feedback);
    const riskAdjustment = nodeRiskAdjustment(node);
    const score = Math.max(0, Math.min(1, relevanceScore + keyword.score + kindBoost + feedbackScore + riskAdjustment));
    return {
      ...node,
      score,
      feedback,
      matchedMissionTypes: missionTypes.filter((type) => Number(node.relevance?.[type] ?? 0) > 0),
      rankingExplanation: rankingExplanation({
        node,
        missionTypes,
        relevanceScore,
        keyword,
        kindBoost,
        feedback,
        feedbackScore,
        riskAdjustment,
        score
      })
    };
  })
    .filter((node) => node.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function compactCapabilityGraphForPrompt(nodes = [], { mission = "", limit = 18, feedbackRecords = [] } = {}) {
  const feedbackStats = buildCapabilityFeedbackStats(feedbackRecords);
  const ranked = mission
    ? scoreCapabilityNodesForMission(nodes, mission, { limit, feedbackRecords })
    : nodes.slice(0, limit).map((node) => ({ ...node, score: 0, feedback: feedbackStats.get(node.id) ?? null }));
  return {
    nodeCount: nodes.length,
    topCapabilities: ranked.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      skillId: node.skillId,
      riskLevel: node.riskLevel,
      approvalRequired: node.approvalRequired,
      rollbackPossible: node.rollbackPossible,
      score: Number(node.score?.toFixed?.(2) ?? node.score ?? 0),
      rankingExplanation: node.rankingExplanation ?? null,
      description: node.payload?.description ?? "",
      affordances: (node.payload?.affordances ?? []).slice(0, 6),
      expectedEvidence: (node.payload?.evidenceExpected ?? []).slice(0, 4),
      supportedWorkflows: (node.payload?.supportedWorkflows ?? []).slice(0, 4).map((workflow) => ({
        id: workflow.id,
        label: workflow.label,
        requiredPrimitives: (workflow.requiredPrimitives ?? []).slice(0, 6)
      })),
      verifiers: (node.payload?.verifiers ?? []).slice(0, 5),
      recoveryStrategies: (node.payload?.recoveryStrategies ?? []).slice(0, 5),
      knownLimits: (node.payload?.knownLimits ?? []).slice(0, 3),
      feedback: node.feedback ? {
        total: node.feedback.total,
        successes: node.feedback.successes,
        failures: node.feedback.failures,
        selections: node.feedback.selections,
        operatorPositive: node.feedback.operatorPositive,
        operatorNegative: node.feedback.operatorNegative,
        expectedSelections: node.feedback.expectedSelections,
        lastUsedAt: node.feedback.lastUsedAt
      } : null
    }))
  };
}

export function explainCapabilityRankingForMission(nodes = [], mission = "", { limit = 12, feedbackRecords = [] } = {}) {
  const ranked = scoreCapabilityNodesForMission(nodes, mission, { limit, feedbackRecords });
  return {
    mission: cleanText(mission, 1200),
    policyId: RANKING_POLICY_V2.id,
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    results: ranked.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      skillId: node.skillId,
      score: Number(node.score.toFixed(3)),
      description: node.payload?.description ?? "",
      affordances: node.payload?.affordances ?? [],
      riskLevel: node.riskLevel,
      approvalRequired: node.approvalRequired,
      rollbackPossible: node.rollbackPossible,
      explanation: node.rankingExplanation
    }))
  };
}

export function summarizeCapabilityGraph(nodes = [], feedbackRecords = []) {
  const counts = nodes.reduce((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});
  const feedback = Array.from(buildCapabilityFeedbackStats(feedbackRecords).values());
  const deepValidation = validateOperationalDeepSkills(BUILTIN_SKILL_MANIFESTS);
  return {
    nodeCount: nodes.length,
    counts,
    feedback: {
      recordCount: feedback.reduce((sum, item) => sum + item.total, 0),
      nodesWithFeedback: feedback.length,
      successes: feedback.reduce((sum, item) => sum + item.successes, 0),
      failures: feedback.reduce((sum, item) => sum + item.failures, 0),
      selections: feedback.reduce((sum, item) => sum + item.selections, 0),
      operatorPositive: feedback.reduce((sum, item) => sum + item.operatorPositive, 0),
      operatorNegative: feedback.reduce((sum, item) => sum + item.operatorNegative, 0),
      expectedSelections: feedback.reduce((sum, item) => sum + item.expectedSelections, 0)
    },
    skills: nodes.filter((node) => node.kind === "skill").map((node) => ({
      id: node.skillId ?? node.id,
      nodeId: node.id,
      label: node.label,
      affordances: node.payload?.affordances ?? [],
      implementationStatus: node.payload?.implementationStatus ?? SKILL_IMPLEMENTATION_STATUS.OPERATIONAL_BASIC,
      capabilityDepth: node.payload?.capabilityDepth ?? "operational_basic"
    })),
    skillManifests: BUILTIN_SKILL_MANIFESTS.map((skill) => ({
      id: skill.id,
      label: skill.label,
      category: skill.category,
      surfaceKind: skill.surfaceKind,
      implementationStatus: skill.implementationStatus,
      capabilityDepth: skill.capabilityDepth,
      primitiveCount: skill.primitives?.length ?? 0,
      supportedWorkflowCount: skill.supportedWorkflows?.length ?? 0,
      verifierCount: skill.verifiers?.length ?? 0,
      recoveryStrategyCount: skill.recoveryStrategies?.length ?? 0,
      policyHooks: skill.policyHooks ?? [],
      evidenceHooks: skill.evidenceHooks ?? [],
      deepValidation: validateOperationalDeepSkill(skill)
    })),
    deepValidation,
    updatedAt: nodes.map((node) => node.updatedAt).filter(Boolean).sort().at(-1) ?? null
  };
}

export function refreshCapabilityGraph(database, input = {}) {
  const graph = buildCapabilityGraph(input);
  const nodes = database.replaceCapabilityGraphNodes(graph.nodes);
  return {
    ...graph,
    nodes
  };
}
