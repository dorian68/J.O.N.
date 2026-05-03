import { createHash } from "node:crypto";
import { nowIso } from "../utils/ids.js";

export const PROJECT_MEMORY_SETTING_PREFIX = "project.memory.v1";

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"]);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStats(value = {}) {
  return {
    attempts: Math.max(0, Number.parseInt(String(value.attempts ?? 0), 10) || 0),
    successes: Math.max(0, Number.parseInt(String(value.successes ?? 0), 10) || 0),
    failures: Math.max(0, Number.parseInt(String(value.failures ?? 0), 10) || 0),
    lastStatus: value.lastStatus ?? null,
    lastUsedAt: value.lastUsedAt ?? null,
    label: value.label ? cleanText(value.label, 160) : null
  };
}

function keyFor(kind, id) {
  const cleanId = cleanText(id, 160).toLowerCase();
  return cleanId ? `${kind}:${cleanId}` : null;
}

function bumpStat(map, key, { status, label = null } = {}) {
  if (!key) {
    return;
  }
  const current = normalizeStats(map[key]);
  const succeeded = status === "completed";
  map[key] = {
    ...current,
    label: label ? cleanText(label, 160) : current.label,
    attempts: current.attempts + 1,
    successes: current.successes + (succeeded ? 1 : 0),
    failures: current.failures + (succeeded ? 0 : 1),
    lastStatus: status,
    lastUsedAt: nowIso()
  };
}

function extractHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function missionUnderstandingFromRun(run = {}) {
  return run.metadata?.missionUnderstanding
    ?? run.metadata?.plan?.missionUnderstanding
    ?? run.plan?.missionUnderstanding
    ?? null;
}

function selectedBrowserFromUnderstanding(understanding = null) {
  return understanding?.selectedBrowser?.id
    ? understanding.selectedBrowser
    : null;
}

function selectedApplicationFromRun(run = {}) {
  const app = run.metadata?.selectedApplication ?? run.metadata?.desktopSelectedApplication ?? null;
  if (app?.id) {
    return app;
  }
  const appId = run.metadata?.selectedApplicationId ?? run.metadata?.desktopSelectedApplicationId ?? null;
  return appId ? { id: appId, label: appId } : null;
}

function terminalOutcome(status) {
  const normalized = cleanText(status, 32).toLowerCase();
  return TERMINAL_STATUSES.has(normalized) ? normalized : null;
}

export function projectMemorySettingKey(projectId) {
  return `${PROJECT_MEMORY_SETTING_PREFIX}:${projectId}`;
}

export function defaultProjectMemory(projectId = null) {
  return {
    schemaVersion: "project_memory_v1",
    projectId,
    frames: {},
    browsers: {},
    desktopApplications: {},
    computerActions: {},
    hosts: {},
    recurringTerms: {},
    recentRuns: [],
    learnedPreferences: [],
    updatedAt: null
  };
}

export function normalizeProjectMemory(value = null, projectId = null) {
  const base = defaultProjectMemory(projectId);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return base;
  }
  const normalizeMap = (map = {}) => Object.fromEntries(
    Object.entries(map && typeof map === "object" && !Array.isArray(map) ? map : {})
      .map(([key, stats]) => [key, normalizeStats(stats)])
  );
  return {
    ...base,
    ...value,
    projectId: value.projectId ?? projectId,
    frames: normalizeMap(value.frames),
    browsers: normalizeMap(value.browsers),
    desktopApplications: normalizeMap(value.desktopApplications),
    computerActions: normalizeMap(value.computerActions),
    hosts: normalizeMap(value.hosts),
    recurringTerms: normalizeMap(value.recurringTerms),
    recentRuns: Array.isArray(value.recentRuns) ? value.recentRuns.slice(-40) : [],
    learnedPreferences: Array.isArray(value.learnedPreferences) ? value.learnedPreferences.slice(-30) : [],
    updatedAt: value.updatedAt ?? null
  };
}

function topStats(map = {}, limit = 6) {
  return Object.entries(map)
    .map(([key, stats]) => ({
      key,
      label: stats.label ?? (key.split(":").slice(1).join(":") || key),
      attempts: stats.attempts,
      successes: stats.successes,
      failures: stats.failures,
      successRate: stats.attempts > 0 ? Number((stats.successes / stats.attempts).toFixed(2)) : 0,
      lastStatus: stats.lastStatus,
      lastUsedAt: stats.lastUsedAt
    }))
    .sort((left, right) => right.successRate - left.successRate || right.successes - left.successes || right.attempts - left.attempts)
    .slice(0, limit);
}

function failedStats(map = {}, limit = 6) {
  return Object.entries(map)
    .map(([key, stats]) => ({
      key,
      label: stats.label ?? (key.split(":").slice(1).join(":") || key),
      attempts: stats.attempts,
      failures: stats.failures,
      lastStatus: stats.lastStatus,
      lastUsedAt: stats.lastUsedAt
    }))
    .filter((entry) => entry.failures > 0)
    .sort((left, right) => right.failures - left.failures || right.attempts - left.attempts)
    .slice(0, limit);
}

function extractPreference(memory, kind, stats) {
  const best = topStats(stats, 1)[0];
  if (!best || best.successes < 2) {
    return null;
  }
  return {
    kind,
    label: best.label,
    confidence: best.successRate,
    evidenceCount: best.successes,
    lastUsedAt: best.lastUsedAt
  };
}

export function updateProjectMemoryFromRun(memoryInput, runInput = {}) {
  const status = terminalOutcome(runInput.status);
  const memory = normalizeProjectMemory(memoryInput, runInput.projectId ?? memoryInput?.projectId ?? null);
  if (!status || !runInput?.id) {
    return memory;
  }
  const existingRun = memory.recentRuns.find((entry) => entry.runId === runInput.id);
  if (existingRun?.status === status) {
    return memory;
  }

  const understanding = missionUnderstandingFromRun(runInput);
  const frame = understanding?.chosenExecutionFrame ?? runInput.metadata?.scenarioType ?? null;
  const computerActionType = understanding?.computerActionType ?? runInput.metadata?.computerActionType ?? null;
  const selectedBrowser = selectedBrowserFromUnderstanding(understanding);
  const selectedApplication = selectedApplicationFromRun(runInput);
  const finalUrl = runInput.output?.finalUrl ?? runInput.metadata?.finalUrl ?? null;
  const host = extractHostname(finalUrl ?? understanding?.browserLaunchUrl ?? "");
  const verificationStatus = runInput.metadata?.verificationSummary?.overallStatus ?? null;

  bumpStat(memory.frames, keyFor("frame", frame), { status, label: frame });
  bumpStat(memory.computerActions, keyFor("computer_action", computerActionType), { status, label: computerActionType });
  bumpStat(memory.browsers, keyFor("browser", selectedBrowser?.id), { status, label: selectedBrowser?.label ?? selectedBrowser?.id });
  bumpStat(memory.desktopApplications, keyFor("desktop_app", selectedApplication?.id), { status, label: selectedApplication?.label ?? selectedApplication?.id });
  bumpStat(memory.hosts, keyFor("host", host), { status, label: host });

  for (const term of cleanText(runInput.mission, 400).toLowerCase().split(/[^a-z0-9._-]+/).filter((entry) => entry.length >= 4).slice(0, 12)) {
    bumpStat(memory.recurringTerms, keyFor("term", term), { status, label: term });
  }

  memory.recentRuns = [
    ...memory.recentRuns.filter((entry) => entry.runId !== runInput.id),
    {
      runId: runInput.id,
      mission: cleanText(runInput.mission, 240),
      status,
      summary: cleanText(runInput.summary, 240),
      frame: frame ?? null,
      computerActionType: computerActionType ?? null,
      selectedBrowserId: selectedBrowser?.id ?? null,
      selectedApplicationId: selectedApplication?.id ?? null,
      host: host || null,
      verificationStatus,
      completedAt: nowIso()
    }
  ].slice(-40);

  memory.learnedPreferences = [
    extractPreference(memory, "execution_frame", memory.frames),
    extractPreference(memory, "browser", memory.browsers),
    extractPreference(memory, "desktop_application", memory.desktopApplications),
    extractPreference(memory, "host", memory.hosts)
  ].filter(Boolean);
  memory.updatedAt = nowIso();
  return memory;
}

function memId(...parts) {
  return `mem_${createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 12)}`;
}

export function harvestProjectRunMemoryRecords(run = {}) {
  const status = terminalOutcome(run.status);
  if (!status || !run.id || !run.projectId) return [];
  const records = [];
  const confidence = status === "completed" ? 0.8 : status === "failed" ? 0.4 : 0.6;
  const understanding = missionUnderstandingFromRun(run);
  const frame = understanding?.chosenExecutionFrame ?? run.metadata?.scenarioType ?? null;
  const selectedBrowser = selectedBrowserFromUnderstanding(understanding);
  const selectedApplication = selectedApplicationFromRun(run);
  const now = nowIso();

  records.push({
    id: memId("run_outcome", run.projectId, run.id),
    scope: "project",
    projectId: run.projectId,
    category: "run_outcome",
    text: cleanText([
      `Run ${run.id}: ${status}.`,
      run.mission ? `Mission: ${run.mission}` : null,
      run.summary ? `Summary: ${run.summary}` : null,
      frame ? `Frame: ${frame}` : null
    ].filter(Boolean).join(" "), 500),
    confidence,
    sourceType: "run",
    sourceId: run.id,
    metadata: { runId: run.id, status, frame },
    createdAt: now,
    updatedAt: now
  });

  if (selectedBrowser?.id) {
    records.push({
      id: memId("surface_browser", run.projectId, run.id),
      scope: "project",
      projectId: run.projectId,
      category: "surface_preference",
      text: cleanText(`Browser ${selectedBrowser.label ?? selectedBrowser.id} used for ${frame ?? "mission"}: ${status}.`, 240),
      confidence,
      sourceType: "run",
      sourceId: run.id,
      metadata: { runId: run.id, browserId: selectedBrowser.id, status },
      createdAt: now,
      updatedAt: now
    });
  }

  if (selectedApplication?.id) {
    records.push({
      id: memId("surface_app", run.projectId, run.id),
      scope: "project",
      projectId: run.projectId,
      category: "surface_preference",
      text: cleanText(`Application ${selectedApplication.label ?? selectedApplication.id} used: ${status}.`, 240),
      confidence,
      sourceType: "run",
      sourceId: run.id,
      metadata: { runId: run.id, applicationId: selectedApplication.id, status },
      createdAt: now,
      updatedAt: now
    });
  }

  const capabilityId = run.metadata?.selectedCapabilityId ?? null;
  if (capabilityId) {
    records.push({
      id: memId("capability_usage", run.projectId, run.id, capabilityId),
      scope: "project",
      projectId: run.projectId,
      category: "capability_usage",
      text: cleanText(`Capability ${capabilityId} used for mission "${run.mission ?? ""}": ${status}.`, 300),
      confidence,
      sourceType: "run",
      sourceId: run.id,
      metadata: { runId: run.id, capabilityId, status },
      createdAt: now,
      updatedAt: now
    });
  }

  return records;
}

export function summarizeProjectMemory(memoryInput = null) {
  const memory = normalizeProjectMemory(memoryInput);
  return {
    schemaVersion: memory.schemaVersion,
    projectId: memory.projectId,
    updatedAt: memory.updatedAt,
    learnedPreferences: memory.learnedPreferences.slice(-8),
    topFrames: topStats(memory.frames, 5),
    topBrowsers: topStats(memory.browsers, 5),
    topDesktopApplications: topStats(memory.desktopApplications, 5),
    topComputerActions: topStats(memory.computerActions, 5),
    topHosts: topStats(memory.hosts, 5),
    recurringTerms: topStats(memory.recurringTerms, 8),
    failurePatterns: [
      ...failedStats(memory.frames, 3),
      ...failedStats(memory.browsers, 3),
      ...failedStats(memory.desktopApplications, 3),
      ...failedStats(memory.computerActions, 3)
    ].slice(0, 8),
    recentRuns: memory.recentRuns.slice(-8)
  };
}
