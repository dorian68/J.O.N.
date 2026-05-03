import { nowIso } from "../utils/ids.js";

export const USER_MEMORY_SETTING_KEY = "user.memory.v1";

const TOOL_CATALOG = Object.freeze([
  { id: "codex", label: "Codex", patterns: [/\bcodex\b/i] },
  { id: "claude", label: "Claude", patterns: [/\bclaude\b/i] },
  { id: "powershell", label: "PowerShell", patterns: [/\bpowershell\b|\bpwsh\b/i] },
  { id: "excel", label: "Excel", patterns: [/\bexcel\b/i] },
  { id: "browser", label: "Browser", patterns: [/\bbrowser\b|\bnavigateur\b|\bchrome\b|\bedge\b|\bfirefox\b/i] },
  { id: "desktop", label: "Desktop", patterns: [/\bdesktop\b|\bbureau\b/i] },
  { id: "terminal", label: "Terminal", patterns: [/\bterminal\b|\bshell\b|\bconsole\b/i] }
]);

const WORKFLOW_CATALOG = Object.freeze([
  { id: "codebase_work", label: "Codebase work", patterns: [/\bcode\b|\brepo\b|\btests?\b|\bbuild\b|\bvalidation\b/i] },
  { id: "browser_research", label: "Browser research", patterns: [/\brecherche\b|\bresearch\b|\bweb\b|\bsite\b|\bsource\b/i] },
  { id: "desktop_control", label: "Desktop control", patterns: [/\bouvre\b|\blance\b|\bopen\b|\blaunch\b|\bdesktop\b|\bbureau\b/i] },
  { id: "reporting", label: "Reporting", patterns: [/\brapport\b|\breport\b|\bsynth[eè]se\b|\bdashboard\b|\btableau\b/i] },
  { id: "forms", label: "Forms", patterns: [/\bformulaire\b|\bform\b|\bchamp\b|\bselect\b|\bdropdown\b/i] },
  { id: "spreadsheet", label: "Spreadsheet", patterns: [/\bexcel\b|\bspreadsheet\b|\btableur\b|\bfeuille\b/i] }
]);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeKey(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeStats(value = {}) {
  return {
    count: Math.max(0, Number.parseInt(String(value.count ?? 0), 10) || 0),
    label: cleanText(value.label, 160) || null,
    lastSeenAt: value.lastSeenAt ?? null,
    evidence: Array.isArray(value.evidence) ? value.evidence.map((entry) => cleanText(entry, 220)).filter(Boolean).slice(-6) : []
  };
}

function normalizeStatsMap(map = {}) {
  return Object.fromEntries(
    Object.entries(map && typeof map === "object" && !Array.isArray(map) ? map : {})
      .map(([key, stats]) => [key, normalizeStats(stats)])
  );
}

function bumpStats(map, id, { label = id, evidence = null } = {}) {
  const key = normalizeKey(id);
  if (!key) {
    return;
  }
  const current = normalizeStats(map[key]);
  map[key] = {
    count: current.count + 1,
    label: cleanText(label, 160) || current.label || key,
    lastSeenAt: nowIso(),
    evidence: [
      ...current.evidence,
      cleanText(evidence, 220)
    ].filter(Boolean).slice(-6)
  };
}

function topStats(map = {}, limit = 8) {
  return Object.entries(map)
    .map(([key, stats]) => ({
      key,
      label: stats.label ?? key,
      count: stats.count,
      lastSeenAt: stats.lastSeenAt,
      evidence: stats.evidence.slice(-3)
    }))
    .sort((left, right) => right.count - left.count || String(right.lastSeenAt ?? "").localeCompare(String(left.lastSeenAt ?? "")))
    .slice(0, limit);
}

function appendUnique(list = [], entry, { maxItems = 30, identity = (value) => JSON.stringify(value) } = {}) {
  if (!entry) {
    return list.slice(-maxItems);
  }
  const key = identity(entry);
  return [
    ...list.filter((candidate) => identity(candidate) !== key),
    entry
  ].slice(-maxItems);
}

function extractSentences(text) {
  return cleanText(text, 1600)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => cleanText(entry, 280))
    .filter(Boolean);
}

function extractProfileFacts(message) {
  const facts = [];
  const patterns = [
    /\bje suis\s+([^.!?]{3,140})/i,
    /\bmon r[oô]le est\s+([^.!?]{3,140})/i,
    /\bje travaille (?:sur|avec|dans)\s+([^.!?]{3,140})/i,
    /\bj'utilise\s+([^.!?]{3,140})/i,
    /\bj['’]utilise\s+([^.!?]{3,140})/i
  ];
  for (const pattern of patterns) {
    const match = cleanText(message, 1200).match(pattern);
    if (match?.[1]) {
      facts.push(cleanText(match[0], 220));
    }
  }
  return facts;
}

function extractPreferences(message) {
  return extractSentences(message).filter((sentence) => (
    /\bje pr[eé]f[eè]re\b/i.test(sentence)
    || /\butilise toujours\b/i.test(sentence)
    || /\bplut[oô]t\b/i.test(sentence)
    || /\b[eé]vite\b/i.test(sentence)
    || /\bne .* pas\b/i.test(sentence)
  )).slice(0, 4);
}

function extractBlockers(message) {
  return extractSentences(message).filter((sentence) => (
    /\bbloqu[eé]\b|\bblocker\b|\berreur\b|\bfail\b|\bfailed\b|\bmarche pas\b|\bindisponible\b|\btimeout\b/i.test(sentence)
  )).slice(0, 4);
}

function observeCatalog(memory, catalog, message, target) {
  for (const item of catalog) {
    if (item.patterns.some((pattern) => pattern.test(message))) {
      bumpStats(target, item.id, {
        label: item.label,
        evidence: message
      });
    }
  }
}

function catalogMatches(catalog, message) {
  return catalog.filter((item) => item.patterns.some((pattern) => pattern.test(message)));
}

function memoryRecord({ category, text, confidence = 0.7, sourceType, sourceId = null, projectId = null, metadata = {} }) {
  const cleaned = cleanText(text, 700);
  if (!cleaned) {
    return null;
  }
  return {
    scope: "user",
    projectId,
    category,
    text: cleaned,
    confidence,
    sourceType,
    sourceId,
    metadata
  };
}

export function defaultUserMemory() {
  return {
    schemaVersion: "user_memory_v1",
    profileFacts: [],
    tools: {},
    workflows: {},
    blockers: {},
    statedPreferences: [],
    recentConversationSummaries: [],
    recentMissionSummaries: [],
    updatedAt: null
  };
}

export function normalizeUserMemory(value = null) {
  const base = defaultUserMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return base;
  }
  return {
    ...base,
    ...value,
    profileFacts: Array.isArray(value.profileFacts) ? value.profileFacts.map((entry) => cleanText(entry, 220)).filter(Boolean).slice(-30) : [],
    tools: normalizeStatsMap(value.tools),
    workflows: normalizeStatsMap(value.workflows),
    blockers: normalizeStatsMap(value.blockers),
    statedPreferences: Array.isArray(value.statedPreferences) ? value.statedPreferences.slice(-40) : [],
    recentConversationSummaries: Array.isArray(value.recentConversationSummaries) ? value.recentConversationSummaries.slice(-40) : [],
    recentMissionSummaries: Array.isArray(value.recentMissionSummaries) ? value.recentMissionSummaries.slice(-40) : [],
    updatedAt: value.updatedAt ?? null
  };
}

export function updateUserMemoryFromConversationTurn(memoryInput, turn = {}) {
  const memory = normalizeUserMemory(memoryInput);
  const userMessage = cleanText(turn.userMessage ?? turn.message ?? "", 1200);
  if (!userMessage) {
    return memory;
  }
  const assistantReply = cleanText(turn.assistantReply ?? turn.reply ?? "", 500);
  observeCatalog(memory, TOOL_CATALOG, userMessage, memory.tools);
  observeCatalog(memory, WORKFLOW_CATALOG, userMessage, memory.workflows);

  for (const fact of extractProfileFacts(userMessage)) {
    memory.profileFacts = appendUnique(memory.profileFacts, fact, {
      maxItems: 30,
      identity: (value) => normalizeKey(value)
    });
  }
  for (const preference of extractPreferences(userMessage)) {
    memory.statedPreferences = appendUnique(memory.statedPreferences, {
      text: preference,
      source: "conversation",
      projectId: turn.projectId ?? null,
      conversationId: turn.conversationId ?? null,
      observedAt: nowIso()
    }, {
      maxItems: 40,
      identity: (value) => normalizeKey(value.text)
    });
  }
  for (const blocker of extractBlockers(userMessage)) {
    bumpStats(memory.blockers, blocker, {
      label: blocker,
      evidence: userMessage
    });
  }

  memory.recentConversationSummaries = appendUnique(memory.recentConversationSummaries, {
    projectId: turn.projectId ?? null,
    conversationId: turn.conversationId ?? null,
    userMessage: cleanText(userMessage, 220),
    assistantReply: cleanText(assistantReply, 220),
    intentType: cleanText(turn.intentType, 60) || null,
    action: cleanText(turn.action, 80) || null,
    summarizedAt: nowIso()
  }, {
    maxItems: 40,
    identity: (value) => `${value.conversationId ?? ""}:${value.userMessage}:${value.action ?? ""}`
  });
  memory.updatedAt = nowIso();
  return memory;
}

export function extractUserMemoryRecordsFromConversationTurn(turn = {}) {
  const userMessage = cleanText(turn.userMessage ?? turn.message ?? "", 1200);
  if (!userMessage) {
    return [];
  }
  const projectId = turn.projectId ?? null;
  const sourceId = turn.conversationId ?? turn.turnId ?? null;
  const commonMetadata = {
    conversationId: turn.conversationId ?? null,
    intentType: cleanText(turn.intentType, 60) || null,
    action: cleanText(turn.action, 80) || null,
    observedAt: nowIso()
  };
  const records = [
    ...extractProfileFacts(userMessage).map((fact) => memoryRecord({
      category: "profile_fact",
      text: fact,
      confidence: 0.82,
      sourceType: "conversation",
      sourceId,
      projectId,
      metadata: commonMetadata
    })),
    ...extractPreferences(userMessage).map((preference) => memoryRecord({
      category: "preference",
      text: preference,
      confidence: 0.78,
      sourceType: "conversation",
      sourceId,
      projectId,
      metadata: commonMetadata
    })),
    ...extractBlockers(userMessage).map((blocker) => memoryRecord({
      category: "blocker",
      text: blocker,
      confidence: 0.72,
      sourceType: "conversation",
      sourceId,
      projectId,
      metadata: commonMetadata
    })),
    ...catalogMatches(TOOL_CATALOG, userMessage).map((tool) => memoryRecord({
      category: "tool",
      text: `${tool.label}: ${userMessage}`,
      confidence: 0.64,
      sourceType: "conversation",
      sourceId,
      projectId,
      metadata: {
        ...commonMetadata,
        toolId: tool.id,
        label: tool.label
      }
    })),
    ...catalogMatches(WORKFLOW_CATALOG, userMessage).map((workflow) => memoryRecord({
      category: "workflow",
      text: `${workflow.label}: ${userMessage}`,
      confidence: 0.64,
      sourceType: "conversation",
      sourceId,
      projectId,
      metadata: {
        ...commonMetadata,
        workflowId: workflow.id,
        label: workflow.label
      }
    }))
  ].filter(Boolean);

  const summary = memoryRecord({
    category: "session_summary",
    text: [
      cleanText(turn.intentType, 60) ? `intent=${cleanText(turn.intentType, 60)}` : null,
      cleanText(turn.action, 80) ? `action=${cleanText(turn.action, 80)}` : null,
      cleanText(userMessage, 260),
      cleanText(turn.assistantReply ?? turn.reply ?? "", 260)
    ].filter(Boolean).join(" "),
    confidence: 0.58,
    sourceType: "conversation",
    sourceId,
    projectId,
    metadata: commonMetadata
  });
  if (summary) {
    records.push(summary);
  }
  return records;
}

export function updateUserMemoryFromRun(memoryInput, run = {}) {
  const memory = normalizeUserMemory(memoryInput);
  if (!run?.id || !["completed", "failed", "stopped"].includes(String(run.status ?? "").toLowerCase())) {
    return memory;
  }
  const mission = cleanText(run.metadata?.missionSpec?.objective ?? run.mission ?? "", 300);
  const frame = cleanText(run.metadata?.missionUnderstanding?.chosenExecutionFrame ?? run.metadata?.type ?? "", 80);
  const computerActionType = cleanText(run.metadata?.computerActionType ?? run.metadata?.missionUnderstanding?.computerActionType ?? "", 80);
  const browser = run.metadata?.selectedBrowser ?? run.metadata?.missionUnderstanding?.selectedBrowser ?? null;
  const application = run.metadata?.selectedApplication ?? null;
  if (frame) {
    bumpStats(memory.workflows, frame, { label: frame, evidence: mission });
  }
  if (computerActionType) {
    bumpStats(memory.workflows, computerActionType, { label: computerActionType, evidence: mission });
  }
  if (browser?.id) {
    bumpStats(memory.tools, browser.id, { label: browser.label ?? browser.id, evidence: mission });
  }
  if (application?.id) {
    bumpStats(memory.tools, application.id, { label: application.label ?? application.id, evidence: mission });
  }
  if (String(run.status).toLowerCase() !== "completed") {
    bumpStats(memory.blockers, run.summary ?? run.status, {
      label: run.summary ?? run.status,
      evidence: mission
    });
  }
  memory.recentMissionSummaries = appendUnique(memory.recentMissionSummaries, {
    runId: run.id,
    projectId: run.projectId ?? null,
    mission,
    status: run.status,
    summary: cleanText(run.summary, 240),
    frame: frame || null,
    completedAt: nowIso()
  }, {
    maxItems: 40,
    identity: (value) => value.runId
  });
  memory.updatedAt = nowIso();
  return memory;
}

export function extractUserMemoryRecordsFromRun(run = {}) {
  if (!run?.id || !["completed", "failed", "stopped"].includes(String(run.status ?? "").toLowerCase())) {
    return [];
  }
  const projectId = run.projectId ?? null;
  const mission = cleanText(run.metadata?.missionSpec?.objective ?? run.mission ?? "", 320);
  const frame = cleanText(run.metadata?.missionUnderstanding?.chosenExecutionFrame ?? run.metadata?.type ?? "", 80);
  const computerActionType = cleanText(run.metadata?.computerActionType ?? run.metadata?.missionUnderstanding?.computerActionType ?? "", 80);
  const browser = run.metadata?.selectedBrowser ?? run.metadata?.missionUnderstanding?.selectedBrowser ?? null;
  const application = run.metadata?.selectedApplication ?? null;
  const commonMetadata = {
    status: run.status,
    runId: run.id,
    frame: frame || null,
    computerActionType: computerActionType || null,
    observedAt: nowIso()
  };
  return [
    memoryRecord({
      category: "mission_summary",
      text: `${run.status}: ${mission}${run.summary ? ` -> ${cleanText(run.summary, 220)}` : ""}`,
      confidence: 0.68,
      sourceType: "run",
      sourceId: run.id,
      projectId,
      metadata: commonMetadata
    }),
    frame ? memoryRecord({
      category: "workflow",
      text: `${frame}: ${mission}`,
      confidence: 0.64,
      sourceType: "run",
      sourceId: run.id,
      projectId,
      metadata: commonMetadata
    }) : null,
    computerActionType ? memoryRecord({
      category: "workflow",
      text: `${computerActionType}: ${mission}`,
      confidence: 0.64,
      sourceType: "run",
      sourceId: run.id,
      projectId,
      metadata: commonMetadata
    }) : null,
    browser?.id ? memoryRecord({
      category: "tool",
      text: `${browser.label ?? browser.id}: ${mission}`,
      confidence: 0.62,
      sourceType: "run",
      sourceId: run.id,
      projectId,
      metadata: {
        ...commonMetadata,
        toolId: browser.id,
        label: browser.label ?? browser.id
      }
    }) : null,
    application?.id ? memoryRecord({
      category: "tool",
      text: `${application.label ?? application.id}: ${mission}`,
      confidence: 0.62,
      sourceType: "run",
      sourceId: run.id,
      projectId,
      metadata: {
        ...commonMetadata,
        toolId: application.id,
        label: application.label ?? application.id
      }
    }) : null,
    String(run.status).toLowerCase() === "completed" ? null : memoryRecord({
      category: "blocker",
      text: `${run.status}: ${cleanText(run.summary ?? mission, 320)}`,
      confidence: 0.72,
      sourceType: "run",
      sourceId: run.id,
      projectId,
      metadata: commonMetadata
    })
  ].filter(Boolean);
}

export function summarizeUserMemory(memoryInput = null) {
  const memory = normalizeUserMemory(memoryInput);
  return {
    schemaVersion: memory.schemaVersion,
    updatedAt: memory.updatedAt,
    profileFacts: memory.profileFacts.slice(-10),
    preferredTools: topStats(memory.tools, 8),
    commonWorkflows: topStats(memory.workflows, 8),
    recurringBlockers: topStats(memory.blockers, 8),
    statedPreferences: memory.statedPreferences.slice(-10),
    recentConversationSummaries: memory.recentConversationSummaries.slice(-8),
    recentMissionSummaries: memory.recentMissionSummaries.slice(-8)
  };
}
