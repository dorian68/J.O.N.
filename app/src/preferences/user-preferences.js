import { nowIso } from "../utils/ids.js";

export const USER_PREFERENCES_SETTING_KEY = "user.preferences.v1";

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanId(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePreference(value = null) {
  if (!isObject(value)) {
    return null;
  }
  const id = cleanId(value.id);
  if (!id) {
    return null;
  }
  const confidence = Number.isFinite(Number(value.confidence))
    ? Math.min(1, Math.max(0, Number(value.confidence)))
    : 0.8;
  return {
    id,
    label: cleanText(value.label, 160) || id,
    source: cleanText(value.source, 80) || "user",
    confidence,
    updatedAt: cleanText(value.updatedAt, 80) || nowIso()
  };
}

export function defaultUserPreferences() {
  return {
    schemaVersion: "user_preferences_v1",
    preferredLanguage: "fr",
    preferredBrowser: null,
    preferredNotesApp: null,
    preferredTerminal: null,
    approvalMode: null,
    updatedAt: null
  };
}

export function normalizeUserPreferences(value = null) {
  const base = defaultUserPreferences();
  if (!isObject(value)) {
    return base;
  }
  const language = cleanText(value.preferredLanguage ?? value.language, 20).toLowerCase();
  return {
    ...base,
    ...value,
    schemaVersion: base.schemaVersion,
    preferredLanguage: ["fr", "en"].includes(language) ? language : base.preferredLanguage,
    preferredBrowser: normalizePreference(value.preferredBrowser ?? value.defaultBrowser),
    preferredNotesApp: normalizePreference(value.preferredNotesApp ?? value.defaultNotesApp),
    preferredTerminal: normalizePreference(value.preferredTerminal ?? value.defaultTerminal),
    approvalMode: cleanText(value.approvalMode, 80) || null,
    updatedAt: cleanText(value.updatedAt, 80) || null
  };
}

export function summarizeUserPreferences(value = null) {
  const preferences = normalizeUserPreferences(value);
  return {
    schemaVersion: preferences.schemaVersion,
    preferredLanguage: preferences.preferredLanguage,
    preferredBrowser: preferences.preferredBrowser
      ? {
        id: preferences.preferredBrowser.id,
        label: preferences.preferredBrowser.label,
        source: preferences.preferredBrowser.source,
        confidence: preferences.preferredBrowser.confidence
      }
      : null,
    preferredNotesApp: preferences.preferredNotesApp
      ? {
        id: preferences.preferredNotesApp.id,
        label: preferences.preferredNotesApp.label,
        source: preferences.preferredNotesApp.source,
        confidence: preferences.preferredNotesApp.confidence
      }
      : null,
    preferredTerminal: preferences.preferredTerminal
      ? {
        id: preferences.preferredTerminal.id,
        label: preferences.preferredTerminal.label,
        source: preferences.preferredTerminal.source,
        confidence: preferences.preferredTerminal.confidence
      }
      : null,
    approvalMode: preferences.approvalMode,
    updatedAt: preferences.updatedAt
  };
}

function browserIdFromText(text = "") {
  if (/\b(chrome|google chrome)\b/i.test(text)) return "chrome";
  if (/\b(edge|microsoft edge|msedge)\b/i.test(text)) return "edge";
  if (/\b(firefox|mozilla firefox)\b/i.test(text)) return "firefox";
  if (/\b(brave)\b/i.test(text)) return "brave";
  return "";
}

function browserPreferenceIsExplicit(message = "") {
  const text = cleanText(message, 1200);
  return Boolean(
    /\b(mon navigateur|navigateur par d[eé]faut|default browser)\b/i.test(text)
      || /\b(j['’]?utilise|j'utilise|i use)\b[\s\S]{0,80}\b(chrome|edge|firefox|brave)\b/i.test(text)
      || /\b(utilise toujours|toujours utiliser|use always|always use)\b[\s\S]{0,80}\b(chrome|edge|firefox|brave)\b/i.test(text)
      || /\b(pr[eé]f[eè]re|prefer)\b[\s\S]{0,80}\b(chrome|edge|firefox|brave)\b/i.test(text)
  );
}

export function inferUserPreferencePatchFromMessage(message = "", { availableBrowsers = [] } = {}) {
  const browserId = browserIdFromText(message);
  if (!browserId || !browserPreferenceIsExplicit(message)) {
    return null;
  }
  const matchedBrowser = availableBrowsers.find((browser) => cleanId(browser.id) === browserId)
    ?? availableBrowsers.find((browser) => cleanText(browser.label).toLowerCase().includes(browserId))
    ?? null;
  return {
    preferredBrowser: {
      id: matchedBrowser?.id ?? browserId,
      label: matchedBrowser?.label ?? browserId,
      source: "explicit_user_message",
      confidence: 0.95,
      updatedAt: nowIso()
    },
    updatedAt: nowIso()
  };
}

export function updateUserPreferences(current = null, patch = {}) {
  const existing = normalizeUserPreferences(current);
  const next = normalizeUserPreferences({
    ...existing,
    ...patch,
    preferredBrowser: patch.preferredBrowser === undefined
      ? existing.preferredBrowser
      : patch.preferredBrowser,
    preferredNotesApp: patch.preferredNotesApp === undefined
      ? existing.preferredNotesApp
      : patch.preferredNotesApp,
    preferredTerminal: patch.preferredTerminal === undefined
      ? existing.preferredTerminal
      : patch.preferredTerminal,
    updatedAt: nowIso()
  });
  return next;
}

export function selectPreferredBrowser(availableBrowsers = [], preferences = null) {
  const normalized = normalizeUserPreferences(preferences);
  const preferred = normalized.preferredBrowser;
  if (!preferred?.id) {
    return {
      browser: null,
      preference: null,
      unavailablePreference: null
    };
  }
  const matched = availableBrowsers.find((browser) => cleanId(browser.id) === preferred.id)
    ?? availableBrowsers.find((browser) => cleanText(browser.label).toLowerCase().includes(preferred.id))
    ?? null;
  return {
    browser: matched,
    preference: preferred,
    unavailablePreference: matched ? null : preferred
  };
}
