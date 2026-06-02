import { createElement as h, useState, useEffect, useRef, useReducer, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

// ─── Utilities ───────────────────────────────────────────────────────────────

function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "")
    .replace(/\x1b[^[\]()\\]/g, "")
    .replace(/\[[\d;?]{1,12}[A-Za-z]/g, "");
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = ["dashboard", "control", "tabs", "terminal", "tasks"];
const TAB_LABELS = { dashboard: "Accueil", control: "Contrôle", tabs: "Onglets", terminal: "Terminal", tasks: "Tâches" };

const IC = (d, extra = {}) =>
  h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", ...extra }, ...d);

const TAB_ICONS = {
  dashboard: IC([h("path", { d: "M3 12l9-9 9 9" }), h("path", { d: "M5 10v10h14V10" }), h("path", { d: "M9 20v-6h6v6" })]),
  control: IC([h("rect", { x: 3, y: 4, width: 18, height: 14, rx: 2 }), h("circle", { cx: 8, cy: 18, r: 1 }), h("circle", { cx: 16, cy: 18, r: 1 }), h("path", { d: "M12 14v4" })]),
  tabs: IC([h("rect", { x: 4, y: 5, width: 16, height: 12, rx: 2 }), h("path", { d: "M8 5V3h8v2" }), h("path", { d: "M8 21h8" })]),
  terminal: IC([h("polyline", { points: "4 17 10 11 4 5" }), h("line", { x1: 12, y1: 19, x2: 20, y2: 19 })]),
  tasks: IC([h("path", { d: "M9 11l3 3L22 4" }), h("path", { d: "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" })])
};

const SVG = {
  send: IC([h("line", { x1: 22, y1: 2, x2: 11, y2: 13 }), h("polygon", { points: "22 2 15 22 11 13 2 9 22 2" })], { width: 18, height: 18 }),
  rocket: IC([h("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })], { width: 18, height: 18 }),
  alert: IC([h("path", { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }), h("line", { x1: 12, y1: 9, x2: 12, y2: 13 }), h("line", { x1: 12, y1: 17, x2: 12.01, y2: 17 })], { width: 16, height: 16 }),
  terminal: IC([h("polyline", { points: "4 17 10 11 4 5" }), h("line", { x1: 12, y1: 19, x2: 20, y2: 19 })], { width: 15, height: 15 }),
  back: IC([h("polyline", { points: "15 18 9 12 15 6" })], { width: 17, height: 17 }),
  forward: IC([h("polyline", { points: "9 18 15 12 9 6" })], { width: 17, height: 17 }),
  reload: IC([h("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }), h("polyline", { points: "21 3 21 9 15 9" })], { width: 17, height: 17 }),
  arrowUp: IC([h("polyline", { points: "18 15 12 9 6 15" })], { width: 17, height: 17 }),
  arrowDown: IC([h("polyline", { points: "6 9 12 15 18 9" })], { width: 17, height: 17 }),
  settings: IC([h("circle", { cx: 12, cy: 12, r: 3 }), h("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.3.37.56.66.72.29.18.63.28.94.28h.09a2 2 0 1 1 0 4H21a1.65 1.65 0 0 0-1.6 1z" })], { width: 18, height: 18 }),
  x: IC([h("line", { x1: 18, y1: 6, x2: 6, y2: 18 }), h("line", { x1: 6, y1: 6, x2: 18, y2: 18 })], { width: 16, height: 16 })
};

const BASE = "";
const MOBILE_CLIENT_LOG_ENDPOINT = "/api/mobile/client/logs";

const POLLING_INTERVAL_KEY = "jon_ctrl_poll_ms";
const POLLING_INTERVAL_OPTIONS = [
  { label: "1 s live (défaut)", value: 1000 },
  { label: "2 s", value: 2000 },
  { label: "4 s", value: 4000 },
  { label: "8 s", value: 8000 },
  { label: "15 s", value: 15000 },
  { label: "30 s", value: 30000 }
];
function getStoredPollingInterval() {
  try {
    const v = Number(localStorage.getItem(POLLING_INTERVAL_KEY));
    return POLLING_INTERVAL_OPTIONS.some((o) => o.value === v) ? v : 1000;
  } catch { return 1000; }
}
function savePollingInterval(ms) {
  try { localStorage.setItem(POLLING_INTERVAL_KEY, String(ms)); } catch {}
}
const MOBILE_CLIENT_LOG_MAX_QUEUE = 200;

let mobileLogToken = null;
let mobileLogDeviceId = null;
let mobileLogTimer = null;
let mobileLogInFlight = false;
let mobileLogCaptureInstalled = false;
const mobileLogQueue = [];

function serializeLogArg(arg) {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack?.slice(0, 1200) ?? null };
  }
  if (typeof arg === "string") return arg.length > 900 ? `${arg.slice(0, 900)}...[${arg.length}]` : arg;
  if (arg == null || typeof arg === "number" || typeof arg === "boolean") return arg;
  try {
    return JSON.parse(JSON.stringify(arg, (key, value) => (
      /password|secret|token|authorization|cookie|credential/i.test(key) ? "[redacted]" : value
    )));
  } catch {
    return String(arg).slice(0, 900);
  }
}

function setMobileLogSession(session) {
  mobileLogToken = session?.sessionToken ?? null;
  mobileLogDeviceId = session?.deviceId ?? null;
}

function queueMobileLog(level, event, message = "", details = null) {
  const normalizedDetails = details ? serializeLogArg(details) : null;
  mobileLogQueue.push({
    level,
    event,
    message: String(message ?? "").slice(0, 900),
    timestamp: new Date().toISOString(),
    details: {
      deviceId: mobileLogDeviceId,
      path: window.location.pathname,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      data: normalizedDetails
    }
  });
  while (mobileLogQueue.length > MOBILE_CLIENT_LOG_MAX_QUEUE) mobileLogQueue.shift();
  scheduleMobileLogFlush();
}

function scheduleMobileLogFlush(delayMs = 600) {
  if (mobileLogTimer) return;
  mobileLogTimer = setTimeout(() => {
    mobileLogTimer = null;
    flushMobileLogs();
  }, delayMs);
}

async function flushMobileLogs({ keepalive = false } = {}) {
  if (mobileLogInFlight || mobileLogQueue.length === 0) return;
  mobileLogInFlight = true;
  const entries = mobileLogQueue.splice(0, 50);
  try {
    await fetch(`${BASE}${MOBILE_CLIENT_LOG_ENDPOINT}`, {
      method: "POST",
      headers: apiHeaders(mobileLogToken),
      body: JSON.stringify({ entries }),
      keepalive
    });
  } catch {
    mobileLogQueue.unshift(...entries.slice(-25));
  } finally {
    mobileLogInFlight = false;
    if (mobileLogQueue.length > 0) scheduleMobileLogFlush(1200);
  }
}

function installMobileClientLogCapture() {
  if (mobileLogCaptureInstalled) return;
  mobileLogCaptureInstalled = true;
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args) => {
    originalWarn(...args);
    queueMobileLog("warn", "console.warn", args.map((arg) => String(arg?.message ?? arg)).join(" ").slice(0, 900), { args: args.map(serializeLogArg) });
  };
  console.error = (...args) => {
    originalError(...args);
    queueMobileLog("error", "console.error", args.map((arg) => String(arg?.message ?? arg)).join(" ").slice(0, 900), { args: args.map(serializeLogArg) });
  };
  window.addEventListener("error", (event) => {
    queueMobileLog("error", "window.error", event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: serializeLogArg(event.error)
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    queueMobileLog("error", "window.unhandledrejection", event.reason?.message ?? String(event.reason), {
      reason: serializeLogArg(event.reason)
    });
  });
  window.addEventListener("online", () => queueMobileLog("info", "network.online", "Mobile browser is online"));
  window.addEventListener("offline", () => queueMobileLog("warn", "network.offline", "Mobile browser is offline"));
  window.addEventListener("pagehide", () => { flushMobileLogs({ keepalive: true }); });
  queueMobileLog("info", "app.boot", "JON mobile booted", {
    href: window.location.href,
    hasStoredSession: Boolean(getStoredSession())
  });
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

function getCodeFromUrl() {
  try { return new URLSearchParams(window.location.search).get("code") ?? null; } catch { return null; }
}
function cleanUrl() {
  try { const u = new URL(window.location.href); u.searchParams.delete("code"); window.history.replaceState({}, "", u.toString()); } catch {}
}

// ─── Session storage (localStorage + TTL) ────────────────────────────────────

const SESSION_KEY = "jon.mobile.session.v2";

function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // A session without a token is unusable — would leave authState="checking" forever
    if (!s?.sessionToken) { localStorage.removeItem(SESSION_KEY); return null; }
    if (s?.expiresAt && new Date(s.expiresAt) < new Date()) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}
function storeSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

function normalizeApproval(raw) {
  if (!raw) return null;
  const id = raw.id ?? raw.approvalId;
  if (!id) return null;
  return {
    id,
    runId: raw.runId ?? null,
    projectId: raw.projectId ?? null,
    category: raw.category ?? null,
    actionLabel: raw.actionLabel ?? raw.label ?? raw.category ?? "Action",
    reason: raw.reason ?? raw.summary ?? "",
    riskLevel: raw.riskLevel ?? "medium",
    createdAt: raw.createdAt ?? raw.timestamp ?? null
  };
}

function normalizeApprovalList(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeApproval)
    .filter(Boolean);
}

function mergeApprovalLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const approval of normalizeApprovalList(list)) {
      byId.set(approval.id, { ...(byId.get(approval.id) ?? {}), ...approval });
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

function approvalsFromRuns(runs) {
  return (Array.isArray(runs) ? runs : [])
    .flatMap((run) => Array.isArray(run?.pendingApprovalItems) ? run.pendingApprovalItems : []);
}

installMobileClientLogCapture();

// ─── API ──────────────────────────────────────────────────────────────────────

function apiHeaders(token) {
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}
const DEFAULT_FETCH_TIMEOUT_MS = 10000;
const DESKTOP_FETCH_TIMEOUT_MS = 25000;
const BROWSER_ACTION_FETCH_TIMEOUT_MS = 25000;
const LLM_INLINE_FETCH_TIMEOUT_MS = 60000;

function getFetchTimeoutMs(path) {
  if (path.includes("/desktop/state") || path.includes("/desktop/action")) {
    return DESKTOP_FETCH_TIMEOUT_MS;
  }
  if (path.includes("/browser/tabs/action")) {
    return BROWSER_ACTION_FETCH_TIMEOUT_MS;
  }
  if (path.includes("/llm-inline-resolve")) {
    return LLM_INLINE_FETCH_TIMEOUT_MS;
  }
  return DEFAULT_FETCH_TIMEOUT_MS;
}

function makeApiError(message, { status = 0, code = "API_ERROR", details = null, cause = null } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  err.isApiError = true;
  if (cause) err.cause = cause;
  return err;
}

function apiErrorMessage(data, status) {
  return data?.error?.message ?? data?.error ?? data?.message ?? `HTTP ${status}`;
}

function emitAuthInvalid(err) {
  try {
    window.dispatchEvent(new CustomEvent("jon-mobile-auth-invalid", { detail: { message: err.message } }));
  } catch {}
}

function isAuthError(err) {
  return err?.status === 401;
}

async function apiPost(path, body, token) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), getFetchTimeoutMs(path));
  try {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: apiHeaders(token), body: JSON.stringify(body), signal: ac.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = makeApiError(apiErrorMessage(data, res.status), {
        status: res.status,
        code: data?.error?.code ?? data?.code ?? "HTTP_ERROR",
        details: data
      });
      queueMobileLog(isAuthError(err) ? "warn" : "error", "api.error", err.message, {
        method: "POST",
        path,
        status: res.status,
        code: err.code
      });
      if (token && isAuthError(err)) emitAuthInvalid(err);
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const timeout = makeApiError("Délai dépassé — vérifiez que vous êtes sur le même réseau Wi-Fi que le desktop", { code: "TIMEOUT" });
      queueMobileLog("error", "api.timeout", timeout.message, { method: "POST", path });
      throw timeout;
    }
    if (err?.isApiError) throw err;
    if (err instanceof TypeError) {
      const network = makeApiError("Connexion impossible — JON desktop ne répond pas depuis ce mobile", { code: "NETWORK_ERROR", cause: err });
      queueMobileLog("error", "api.network_error", network.message, { method: "POST", path, error: serializeLogArg(err) });
      throw network;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
async function apiGet(path, token) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), getFetchTimeoutMs(path));
  try {
    const res = await fetch(`${BASE}${path}`, { headers: apiHeaders(token), signal: ac.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = makeApiError(apiErrorMessage(data, res.status), {
        status: res.status,
        code: data?.error?.code ?? data?.code ?? "HTTP_ERROR",
        details: data
      });
      queueMobileLog(isAuthError(err) ? "warn" : "error", "api.error", err.message, {
        method: "GET",
        path,
        status: res.status,
        code: err.code
      });
      if (token && isAuthError(err)) emitAuthInvalid(err);
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const timeout = makeApiError("Délai dépassé — JON desktop ne répond pas", { code: "TIMEOUT" });
      queueMobileLog("error", "api.timeout", timeout.message, { method: "GET", path });
      throw timeout;
    }
    if (err?.isApiError) throw err;
    if (err instanceof TypeError) {
      const network = makeApiError("Connexion impossible — JON desktop ne répond pas depuis ce mobile", { code: "NETWORK_ERROR", cause: err });
      queueMobileLog("error", "api.network_error", network.message, { method: "GET", path, error: serializeLogArg(err) });
      throw network;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function validateMobileSession(token) {
  return apiGet("/api/mobile/session/status", token);
}

// ─── Slash command autocomplete ───────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: "/llm{", label: "/llm{…}", description: "Générer du contenu avec l'IA" }
];

function getSlashSuggestion(text) {
  if (typeof text !== "string" || !text) return [];
  const m = text.match(/\/([a-z]*)$/i);
  if (!m) return [];
  const typed = m[0].toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(typed));
}

function applySlashCommand(text, cmd) {
  return text.replace(/\/([a-z]*)$/i, cmd);
}

function SlashSuggestion({ suggestions, onSelect }) {
  if (!suggestions || suggestions.length === 0) return null;
  return h("div", { className: "slash-suggestion-menu" },
    suggestions.map((s) =>
      h("button", {
        key: s.cmd,
        className: "slash-suggestion-item",
        onMouseDown: (e) => { e.preventDefault(); onSelect(s.cmd); },
        onTouchEnd: (e) => { e.preventDefault(); onSelect(s.cmd); }
      },
        h("span", { className: "slash-suggestion-cmd" }, s.label),
        h("span", { className: "slash-suggestion-desc" }, s.description)
      )
    )
  );
}

// ─── Built-in app icons (fallback when OS icon unavailable) ──────────────────

function _appIconSvg(text, bg, fg = "#fff") {
  const fs = text.length > 2 ? 9 : text.length > 1 ? 11 : 15;
  const y = text.length > 1 ? 18 : 19;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="${bg}"/><text x="14" y="${y}" font-family="ui-monospace,system-ui,sans-serif" font-size="${fs}" font-weight="bold" fill="${fg}" text-anchor="middle">${text}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const BUILTIN_APP_ICONS = [
  { re: /chrome/i,                  icon: _appIconSvg("G",  "#4285F4") },
  { re: /msedge|edge/i,             icon: _appIconSvg("e",  "#0067B8") },
  { re: /firefox/i,                  icon: _appIconSvg("F",  "#FF7139") },
  { re: /notepad\+\+/i,             icon: _appIconSvg("N+", "#3C9940") },
  { re: /notepad/i,                  icon: _appIconSvg("N",  "#3C5A99") },
  { re: /code|vscode/i,              icon: _appIconSvg("VS", "#007ACC") },
  { re: /explorer/i,                 icon: _appIconSvg("E",  "#FABB00", "#333") },
  { re: /powershell/i,               icon: _appIconSvg("PS", "#012456") },
  { re: /windowsterminal|wt\.exe/i,  icon: _appIconSvg(">_", "#111") },
  { re: /cmd|conhost/i,              icon: _appIconSvg(">_", "#222") },
  { re: /winword/i,                  icon: _appIconSvg("W",  "#185ABD") },
  { re: /excel/i,                    icon: _appIconSvg("X",  "#217346") },
  { re: /powerpnt/i,                 icon: _appIconSvg("P",  "#B7472A") },
  { re: /outlook/i,                  icon: _appIconSvg("O",  "#0078D4") },
  { re: /teams/i,                    icon: _appIconSvg("T",  "#6264A7") },
  { re: /slack/i,                    icon: _appIconSvg("#",  "#4A154B") },
  { re: /discord/i,                  icon: _appIconSvg("D",  "#5865F2") },
  { re: /spotify/i,                  icon: _appIconSvg("♪",  "#1DB954") },
  { re: /vlc/i,                      icon: _appIconSvg("▶",  "#FF8800") },
  { re: /zoom/i,                     icon: _appIconSvg("Z",  "#2D8CFF") },
  { re: /obsidian/i,                 icon: _appIconSvg("O",  "#7C3AED") },
  { re: /cursor/i,                   icon: _appIconSvg("Cs", "#000") },
  { re: /brave/i,                    icon: _appIconSvg("B",  "#FB542B") },
  { re: /opera/i,                    icon: _appIconSvg("O",  "#FF1B2D") },
];

function getBuiltinIcon(processName, title) {
  const key = `${processName ?? ""} ${title ?? ""}`;
  for (const { re, icon } of BUILTIN_APP_ICONS) {
    if (re.test(key)) return icon;
  }
  return null;
}

// ─── Inline LLM directive resolver ────────────────────────────────────────────

function hasLlmDirective(text) {
  return typeof text === "string" && text.includes("/llm{");
}

async function resolveLlmInlineInput(rawText, projectId, token, contextType = "type_text") {
  if (!hasLlmDirective(rawText)) return { text: rawText, hadInlineLlm: false, generations: [] };
  const result = await apiPost(
    `/api/mobile/projects/${projectId}/llm-inline-resolve`,
    { text: rawText, contextType },
    token
  );
  return result;
}

function firstLlmGeneration(result) {
  return Array.isArray(result?.generations) ? result.generations[0] ?? null : null;
}

function llmProviderLabel(generation) {
  const provider = generation?.provider || "LLM provider";
  const model = generation?.model ? ` · ${generation.model}` : "";
  return `${provider}${model}`;
}

function normalizeBrowserUrlInput(input, { allowBlank = false } = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) return allowBlank ? "about:blank" : "";
  if (allowBlank && raw.toLowerCase() === "about:blank") return "about:blank";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (/^(localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#].*)?$/i.test(raw)) {
    return `http://${raw}`;
  }
  if (/^[^\s/]+\.[^\s]+(?:[/?#].*)?$/i.test(raw)) {
    return `https://${raw}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatTime(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 30) return "";
  if (diff < 90) return "à l'instant";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// ─── Pairing Screen ───────────────────────────────────────────────────────────

function PairingScreen({ onPaired, notice = null }) {
  const urlCode = getCodeFromUrl();
  const [code, setCode] = useState(urlCode ?? "");
  const [deviceName] = useState(() => {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android";
    return "Mobile";
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(urlCode ? "qr-connecting" : "manual");
  // phase: "qr-connecting" | "manual" | "error"

  async function submit(overrideCode) {
    const pairingCode = (overrideCode ?? code).trim().toUpperCase();
    if (!pairingCode) return;
    setLoading(true);
    setError(null);
    try {
      queueMobileLog("info", "pairing.confirm_attempt", "Mobile pairing confirm attempt", { hasQrCode: Boolean(overrideCode) });
      const result = await apiPost("/api/mobile/pairing/confirm", { pairingCode, deviceName });
      cleanUrl();
      queueMobileLog("info", "pairing.confirmed", "Mobile pairing confirmed", { deviceId: result.deviceId, deviceName: result.deviceName });
      onPaired(result);
    } catch (err) {
      queueMobileLog("warn", "pairing.failed", err.message, { code: err.code, status: err.status });
      setError(err.message);
      setLoading(false);
      setPhase("error");
    }
  }

  useEffect(() => {
    if (urlCode) {
      const t = setTimeout(() => submit(urlCode), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const showSpinner = phase === "qr-connecting";
  const showError   = phase === "error";

  return h("div", { className: "pairing-screen" },
    h("div", { className: "pairing-logo-wrap" },
      h("span", { className: "pairing-logo" }, "JON"),
      h("span", { className: "pairing-logo-sub" }, "Workspace AI")
    ),

    showSpinner
      ? h("div", { className: "pairing-auto" },
          h("div", { className: "pairing-spinner" }),
          h("p", { className: "pairing-auto-text" }, "Connexion en cours…")
        )
      : h("div", { className: "pairing-form" },
          showError
            ? h("div", { className: "pairing-error-banner" },
                h("p", { className: "pairing-error-title" }, "Connexion impossible"),
                h("p", { className: "pairing-error-detail" }, error ?? "Erreur inconnue"),
                h("p", { className: "pairing-error-hint" }, "Vérifiez que le code n'a pas expiré (5 min) et que vous êtes sur le même réseau Wi-Fi.")
              )
            : notice
              ? h("div", { className: "pairing-notice-banner" },
                  h("p", { className: "pairing-notice-title" }, "Session mobile à renouveler"),
                  h("p", { className: "pairing-notice-detail" }, notice)
                )
              : null,
          h("input", {
            className: "mobile-input pairing-code-input",
            placeholder: "AB3F9K",
            value: code,
            onChange: (e) => { setCode(e.target.value.toUpperCase()); setPhase("manual"); },
            maxLength: 6,
            autoCapitalize: "characters",
            autoComplete: "off",
            spellCheck: false,
            autoFocus: phase !== "qr-connecting"
          }),
          h("button", {
            className: "mobile-btn primary full-width",
            onClick: () => { setPhase("manual"); submit(); },
            disabled: loading || !code.trim()
          }, loading ? "Connexion…" : "Connecter")
        ),

    h("p", { className: "pairing-hint" },
      "JON desktop → ",
      h("strong", null, "Admin → Pair mobile"),
      " pour obtenir un QR ou un code."
    )
  );
}

function SessionCheckScreen({ state, error, onRetry, onReconnect }) {
  const isOffline = state === "offline";
  return h("div", { className: "pairing-screen" },
    h("div", { className: "pairing-logo-wrap" },
      h("span", { className: "pairing-logo" }, "JON"),
      h("span", { className: "pairing-logo-sub" }, "Mobile")
    ),
    isOffline
      ? h("div", { className: "pairing-form" },
          h("div", { className: "pairing-error-banner" },
            h("p", { className: "pairing-error-title" }, "JON desktop introuvable"),
            h("p", { className: "pairing-error-detail" }, error ?? "La session existe, mais le serveur mobile ne répond pas."),
            h("p", { className: "pairing-error-hint" }, "Gardez le desktop ouvert, le mobile sur le même Wi-Fi, puis réessayez.")
          ),
          h("div", { className: "pairing-status-actions" },
            h("button", { className: "mobile-btn primary", onClick: onRetry }, "Réessayer"),
            h("button", { className: "mobile-btn ghost", onClick: onReconnect }, "Reconnecter")
          )
        )
      : h("div", { className: "pairing-auto" },
          h("div", { className: "pairing-spinner" }),
          h("p", { className: "pairing-auto-text" }, "Vérification de la session mobile…")
        )
  );
}

// ─── Approval Card ────────────────────────────────────────────────────────────

function ApprovalCard({ approval, token, onResolved }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);

  async function respond(decision) {
    setLoading(decision);
    setError(null);
    try {
      await apiPost(`/api/mobile/approvals/${approval.id}/respond`, { decision }, token);
      onResolved(approval.id, decision);
    } catch (err) { setError(err.message); setLoading(null); }
  }

  return h("div", { className: "approval-card" },
    h("div", { className: "approval-header" },
      h("div", { className: "approval-icon-wrap" }, SVG.alert),
      h("div", { className: "approval-header-text" },
        h("span", { className: "approval-title" }, "Approbation requise"),
        h("span", { className: `risk-pill risk-${approval.riskLevel ?? "medium"}` }, approval.riskLevel ?? "medium")
      )
    ),
    h("p", { className: "approval-action" }, approval.actionLabel),
    approval.reason ? h("p", { className: "approval-reason" }, approval.reason) : null,
    error ? h("p", { className: "inline-error" }, error) : null,
    h("div", { className: "approval-actions" },
      h("button", {
        className: "mobile-btn outline-danger",
        onClick: () => respond("deny"),
        disabled: loading !== null
      }, loading === "deny" ? "…" : "Refuser"),
      h("button", {
        className: "mobile-btn success",
        onClick: () => respond("approve"),
        disabled: loading !== null
      }, loading === "approve" ? "…" : "Approuver")
    )
  );
}

// ─── Terminal Alert Card ──────────────────────────────────────────────────────

function TerminalAlertCard({ terminal, projectId, token, onAnswered }) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "answerTerminalPrompt",
        params: { terminalId: terminal.id, answer }
      }, token);
      onAnswered(terminal.id);
    } catch (err) { setError(err.message); setSending(false); }
  }

  return h("div", { className: "terminal-alert-card" },
    h("div", { className: "terminal-alert-header" },
      h("span", { className: "terminal-icon" }, SVG.terminal),
      h("span", { className: "terminal-label" }, terminal.label),
      h("span", { className: "terminal-badge" }, "INPUT")
    ),
    terminal.recentOutput
      ? h("pre", { className: "terminal-output-preview" },
          stripAnsi(terminal.recentOutput).split("\n").filter((l) => l.trim()).slice(-4).join("\n"))
      : null,
    h("textarea", {
      className: "mobile-textarea",
      placeholder: "Votre réponse…",
      value: answer,
      onChange: (e) => setAnswer(e.target.value),
      rows: 2,
      autoFocus: true
    }),
    error ? h("p", { className: "inline-error" }, error) : null,
    h("div", { className: "card-actions" },
      h("button", { className: "mobile-btn ghost", onClick: () => onAnswered(terminal.id) }, "Ignorer"),
      h("button", {
        className: "mobile-btn primary",
        onClick: send,
        disabled: sending || !answer.trim()
      }, sending ? "Envoi…" : "Répondre")
    )
  );
}

// ─── Tab: Chat ────────────────────────────────────────────────────────────────

function ChatTab({ projectId, token, events }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([{
    id: "welcome", role: "jon",
    text: "Bonjour, je suis JON. Dites-moi quoi faire.",
    ts: new Date().toISOString()
  }]);
  const [waiting, setWaiting] = useState(false);
  const [showMission, setShowMission] = useState(false);
  const [objective, setObjective] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    if (last.type === "jon.thinking") setWaiting(true);
    if (last.type === "jon.reply") {
      setWaiting(false);
      const reply = last.payload?.reply || last.message || "";
      if (reply) {
        setMessages((m) => [
          ...m.filter((x) => x.id !== "thinking"),
          { id: `jon-${last.id ?? Date.now()}`, role: "jon", text: reply, ts: last.timestamp ?? new Date().toISOString() }
        ]);
      }
    }
  }, [events]);

  async function send() {
    if (!message.trim()) return;
    const text = message.trim();
    setMessage("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", text, ts: new Date().toISOString() }]);
    setMessages((m) => [...m, { id: "thinking", role: "jon", text: null }]);
    setWaiting(true);
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "sendChatMessage", params: { message: text }
      }, token);
      setTimeout(() => {
        setWaiting((w) => { if (w) setMessages((m) => m.filter((x) => x.id !== "thinking")); return false; });
      }, 30000);
    } catch (err) {
      setWaiting(false);
      setMessages((m) => [
        ...m.filter((x) => x.id !== "thinking"),
        { id: `err-${Date.now()}`, role: "error", text: err.message, ts: new Date().toISOString() }
      ]);
    }
  }

  async function launchMission() {
    if (!objective.trim()) return;
    const obj = objective.trim();
    setObjective("");
    setShowMission(false);
    try {
      const result = await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "startMission", params: { objective: obj }
      }, token);
      setMessages((m) => [...m, {
        id: `jon-${Date.now()}`, role: "jon",
        text: `Mission lancée${result?.result?.runId ? ` (${result.result.runId.slice(0, 8)})` : ""}.`,
        ts: new Date().toISOString()
      }]);
    } catch (err) {
      setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "error", text: err.message, ts: new Date().toISOString() }]);
    }
  }

  return h("div", { className: "tab-content chat-tab" },
    h("div", { className: "chat-messages", ref: listRef },
      messages.map((msg) =>
        msg.id === "thinking"
          ? h("div", { key: "thinking", className: "chat-msg chat-msg-jon chat-msg-thinking" },
              h("span", { className: "thinking-dots" }, h("span"), h("span"), h("span"))
            )
          : h("div", { key: msg.id, className: `chat-msg chat-msg-${msg.role}` },
              h("span", { className: "msg-text" }, msg.text),
              msg.ts && formatTime(msg.ts)
                ? h("span", { className: "msg-ts" }, formatTime(msg.ts))
                : null
            )
      ),
      waiting && !messages.find((m) => m.id === "thinking")
        ? h("div", { className: "chat-msg chat-msg-jon chat-msg-thinking" },
            h("span", { className: "thinking-dots" }, h("span"), h("span"), h("span"))
          )
        : null
    ),

    showMission
      ? h("div", { className: "mission-sheet" },
          h("div", { className: "mission-sheet-header" },
            h("span", { className: "mission-sheet-title" }, "Nouvelle mission"),
            h("button", { className: "icon-close", onClick: () => setShowMission(false), "aria-label": "Fermer" }, SVG.x)
          ),
          h("textarea", {
            className: "mobile-textarea mission-input",
            placeholder: "Décrivez la mission à lancer…",
            value: objective,
            onChange: (e) => setObjective(e.target.value),
            rows: 4,
            autoFocus: true
          }),
          h("div", { className: "card-actions" },
            h("button", { className: "mobile-btn ghost", onClick: () => setShowMission(false) }, "Annuler"),
            h("button", {
              className: "mobile-btn primary",
              onClick: launchMission,
              disabled: !objective.trim()
            }, "Lancer la mission")
          )
        )
      : null,

    h("div", { className: "chat-input-row" },
      h("button", {
        className: "mission-trigger",
        onClick: () => setShowMission(true),
        title: "Lancer une mission",
        "aria-label": "Lancer une mission"
      }, SVG.rocket),
      h("input", {
        ref: inputRef,
        className: "mobile-input chat-input",
        placeholder: "Message…",
        value: message,
        onChange: (e) => setMessage(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && !e.shiftKey && send()
      }),
      h("button", {
        className: `send-trigger ${message.trim() ? "active" : ""}`,
        onClick: send,
        disabled: !message.trim(),
        "aria-label": "Envoyer"
      }, SVG.send)
    )
  );
}

// ─── Tab: Dashboard ──────────────────────────────────────────────────────────

function DashboardTab({ projectId, token, events, session, onDisconnect, pollingInterval, onPollingIntervalChange }) {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [control, setControl] = useState(null);
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  async function refresh() {
    try {
      const [nextStatus, nextRuns, nextTerminals] = await Promise.all([
        apiGet("/api/mobile/status", token),
        apiGet(`/api/mobile/projects/${projectId}/runs`, token),
        apiGet(`/api/mobile/projects/${projectId}/terminals`, token)
      ]);
      setStatus(nextStatus);
      setRuns(Array.isArray(nextRuns) ? nextRuns : []);
      setTerminals(Array.isArray(nextTerminals) ? nextTerminals : []);
      setError(null);
      apiGet(`/api/mobile/projects/${projectId}/control/state`, token)
        .then(setControl)
        .catch(() => setControl((prev) => prev ?? { active: false }));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [projectId, token]);

  useEffect(() => {
    if (events.length > 0) refresh();
  }, [events.length, projectId, token]);

  async function startTask() {
    if (!objective.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "startMission",
        params: { objective: objective.trim() }
      }, token);
      setObjective("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const activeRuns = runs.filter((run) => ["running", "paused"].includes(run.status));
  const latestTasks = runs.slice(0, 4);
  const activeTerminals = terminals.filter((t) => t.status !== "detached");

  return h("div", { className: "tab-content dashboard-tab" },
    // ── Hero — branding propre, sans icône technique ──────────────────────────
    h("div", { className: "dashboard-hero" },
      h("div", null,
        h("p", { className: "eyebrow" }, "JON OS Agent"),
        h("h2", null, "Mon Ordinateur"),
        h("span", { className: "online-pill" }, control?.active ? "Browser actif" : "En ligne")
      ),
      h("div", { className: "dashboard-hero-side" },
        h("div", { className: "jon-orb-small" }, "JON")
      )
    ),

    error ? h("div", { className: "inline-error" }, error) : null,

    h("div", { className: "dashboard-metrics" },
      h("div", null, h("span", null, "Sessions"), h("strong", null, String(activeTerminals.length + (control?.active ? 1 : 0)))),
      h("div", null, h("span", null, "Tâches"), h("strong", null, String(activeRuns.length))),
      h("div", null, h("span", null, "Appareils"), h("strong", null, String(status?.devices?.length ?? 0)))
    ),

    // ── Configuration — dédiée, hors entête et hors branding ──────────────────
    h("div", { className: "section dashboard-config-section" },
      h("button", {
        className: `dashboard-config-toggle ${showSettings ? "active" : ""}`,
        onClick: () => setShowSettings((v) => !v),
        "aria-label": "Configuration de l’agent"
      },
        SVG.settings,
        h("span", null, "Configuration"),
        h("span", { className: "dashboard-config-chevron" }, showSettings ? "▲" : "▼")
      ),
      showSettings
        ? h("div", { className: "dashboard-settings-card" },
            h(MoreTab, { projectId, token, session, events, onDisconnect, pollingInterval, onPollingIntervalChange })
          )
        : null
    ),

    h("div", { className: "quick-command-card" },
      h("textarea", {
        className: "mobile-textarea",
        placeholder: "Demander à JON d’agir sur ton ordinateur…",
        value: objective,
        rows: 3,
        onChange: (e) => setObjective(e.target.value)
      }),
      h("button", {
        className: "mobile-btn primary full-width",
        onClick: startTask,
        disabled: busy || !objective.trim()
      }, busy ? "Lancement…" : "+ Nouvelle tâche")
    ),

    h("div", { className: "section" },
      h("p", { className: "section-title" }, "Sessions actives"),
      h("div", { className: "session-list" },
        h("div", { className: "session-row" },
          h("span", { className: `status-dot ${control?.active ? "running" : "detached"}` }),
          h("strong", null, "Chrome / JON Browser"),
          h("em", null, control?.active ? "Actif" : "Prêt")
        ),
        activeTerminals.slice(0, 3).map((terminal) =>
          h("div", { key: terminal.id, className: "session-row" },
            h("span", { className: `status-dot ${terminal.status}` }),
            h("strong", null, terminal.label),
            h("em", null, terminal.status)
          )
        )
      )
    ),

    h("div", { className: "section" },
      h("p", { className: "section-title" }, "Tâches récentes"),
      latestTasks.length === 0
        ? h("div", { className: "empty-mini" }, "Aucune tâche lancée")
        : latestTasks.map((run) =>
            h("div", { key: run.id, className: "task-mini-row" },
              h("span", { className: `status-dot ${run.status}` }),
              h("div", null,
                h("strong", null, run.mission || "Mission"),
                h("small", null, run.naturalReply || run.summary || run.status)
              )
            )
          )
    )
  );
}

// ─── Tab: Live ────────────────────────────────────────────────────────────────

const STATUS_FR = { running: "En cours", paused: "Pausé", completed: "Terminé", failed: "Échoué", stopped: "Arrêté" };

function LiveTab({ projectId, token, events, approvals, onApprovalResolved }) {
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    apiGet(`/api/mobile/projects/${projectId}/runs`, token).then(setRuns).catch(() => {});
  }, [projectId, token, events.length]);

  async function stopRun(runId) {
    try { await apiPost(`/api/mobile/projects/${projectId}/commands`, { command: "stopRun", params: { runId } }, token); } catch {}
  }

  return h("div", { className: "tab-content" },
    approvals.length > 0
      ? h("div", { className: "section" },
          h("p", { className: "section-title" }, `${approvals.length} approbation${approvals.length > 1 ? "s" : ""} en attente`),
          approvals.map((a) =>
            h(ApprovalCard, { key: a.id, approval: a, token, onResolved: onApprovalResolved })
          )
        )
      : null,
    runs.length === 0
      ? h("div", { className: "empty-state" },
          h("div", { className: "empty-icon" }, IC([h("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })], { width: 40, height: 40 })),
          h("p", { className: "empty-title" }, "Aucune mission en cours"),
          h("p", { className: "empty-sub" }, "Lancez une mission depuis l'onglet Chat")
        )
      : runs.map((run) =>
          h("div", { key: run.id, className: `run-card status-${run.status}` },
            h("div", { className: "run-card-top" },
              h("span", { className: `status-dot ${run.status}` }),
              h("span", { className: "run-status-label" }, STATUS_FR[run.status] ?? run.status),
              h("span", { className: "run-ts" }, run.updatedAt ? formatTime(run.updatedAt) : ""),
              ["running", "paused"].includes(run.status)
                ? h("button", { className: "mobile-btn outline-danger small", onClick: () => stopRun(run.id) }, "Stop")
                : null
            ),
            h("p", { className: "run-mission" }, run.mission),
            run.naturalReply ? h("p", { className: "run-summary natural" }, run.naturalReply) : run.summary ? h("p", { className: "run-summary" }, run.summary) : null,
            run.executionThread?.activeStep
              ? h("div", { className: "mobile-exec-line" },
                  h("span", { className: "mobile-exec-k" }, "Étape"),
                  h("span", { className: "mobile-exec-v" }, run.executionThread.activeStep.label)
                )
              : null,
            run.activeTool
              ? h("div", { className: "mobile-exec-line" },
                  h("span", { className: "mobile-exec-k" }, "Tool"),
                  h("span", { className: `mobile-tool-status status-${run.activeTool.status}` }, run.activeTool.status),
                  h("span", { className: "mobile-exec-v" }, run.activeTool.tool)
                )
              : null,
            h("div", { className: "mobile-run-metrics" },
              h("span", null, `${run.evidenceCount ?? 0} preuve${(run.evidenceCount ?? 0) > 1 ? "s" : ""}`),
              h("span", null, `${run.artifactCount ?? 0} artefact${(run.artifactCount ?? 0) > 1 ? "s" : ""}`),
              run.executionThread?.verification
                ? h("span", { className: run.executionThread.verification.objectiveSatisfied ? "metric-ok" : "metric-warn" },
                    run.executionThread.verification.objectiveSatisfied ? "objectif vérifié" : `verdict ${run.executionThread.verification.verdict ?? "pending"}`)
                : null
            )
          )
        )
  );
}

function TasksTab({ projectId, token, events, approvals, onApprovalResolved }) {
  const [runs, setRuns] = useState([]);
  const [filter, setFilter] = useState("active");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      const next = await apiGet(`/api/mobile/projects/${projectId}/runs`, token);
      setRuns(Array.isArray(next) ? next : []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [projectId, token]);

  useEffect(() => {
    if (events.length > 0) refresh();
  }, [events.length, projectId, token]);

  async function startTask() {
    if (!objective.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "startMission",
        params: { objective: objective.trim() }
      }, token);
      setObjective("");
      setFilter("active");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function stopRun(runId) {
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, { command: "stopRun", params: { runId } }, token);
      await refresh();
    } catch {}
  }

  const visibleApprovals = mergeApprovalLists(approvals, approvalsFromRuns(runs));
  const filtered = runs.filter((run) => {
    if (filter === "active") return ["running", "paused"].includes(run.status);
    if (filter === "planned") return run.status === "created" || run.status === "pending";
    return ["completed", "failed", "stopped"].includes(run.status);
  });

  return h("div", { className: "tab-content tasks-tab" },
    visibleApprovals.length > 0
      ? h("div", { className: "section" },
          h("p", { className: "section-title" }, `${visibleApprovals.length} validation${visibleApprovals.length > 1 ? "s" : ""} en attente`),
          visibleApprovals.map((a) => h(ApprovalCard, { key: a.id, approval: a, token, onResolved: onApprovalResolved }))
        )
      : null,
    error ? h("div", { className: "inline-error" }, error) : null,
    h("div", { className: "task-filter" },
      ["active", "planned", "done"].map((item) =>
        h("button", {
          key: item,
          className: filter === item ? "active" : "",
          onClick: () => setFilter(item)
        }, item === "active" ? "En cours" : item === "planned" ? "Planifiées" : "Terminées")
      )
    ),
    filtered.length === 0
      ? h("div", { className: "empty-state compact" },
          h("p", { className: "empty-title" }, "Aucune tâche"),
          h("p", { className: "empty-sub" }, "Crée une tâche pour que JON agisse sur ton ordinateur.")
        )
      : filtered.map((run) =>
          h("div", { key: run.id, className: `task-card status-${run.status}` },
            h("div", { className: "task-card-top" },
              h("span", { className: `status-dot ${run.status}` }),
              h("strong", null, run.mission || "Mission JON"),
              h("span", { className: `task-status status-${run.status}` }, STATUS_FR[run.status] ?? run.status)
            ),
            run.naturalReply || run.summary
              ? h("p", null, run.naturalReply || run.summary)
              : null,
            run.executionThread?.activeStep?.label && !/^(act on|execute the plan|needed workspace|workspace surface)/i.test(run.executionThread.activeStep.label)
              ? h("small", null, `Étape: ${run.executionThread.activeStep.label}`)
              : null,
            ["running", "paused"].includes(run.status)
              ? h("button", { className: "mobile-btn outline-danger small", onClick: () => stopRun(run.id) }, "Stop")
              : null
          )
        ),
    h("div", { className: "new-task-card" },
      h("textarea", {
        className: "mobile-textarea",
        placeholder: "Nouvelle tâche ou automatisation…",
        rows: 3,
        value: objective,
        onChange: (e) => setObjective(e.target.value)
      }),
      h("button", {
        className: "mobile-btn primary full-width",
        onClick: startTask,
        disabled: busy || !objective.trim()
      }, busy ? "Lancement…" : "+ Nouvelle tâche")
    )
  );
}

// ─── Remote Screen Utilities ──────────────────────────────────────────────────

function mapClientPointToRemotePoint({ px, py, containerWidth, containerHeight, naturalWidth, naturalHeight, scale, translateX, translateY }) {
  const imgX = (px - translateX) / scale;
  const imgY = (py - translateY) / scale;
  return {
    x: Math.max(0, Math.min(naturalWidth - 1, Math.round(imgX * naturalWidth / containerWidth))),
    y: Math.max(0, Math.min(naturalHeight - 1, Math.round(imgY * naturalHeight / containerHeight)))
  };
}

// ─── RemoteScreenViewport ─────────────────────────────────────────────────────

function RemoteScreenViewport({ screenshot, screenshotMime, naturalWidth, naturalHeight, screenOffX, screenOffY, mode, onRemoteClick, onRemoteScroll, onOpenFullscreen, overrideWidth, overrideHeight }) {
  const nw = naturalWidth || 1920;
  const nh = naturalHeight || 1080;
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [tapFeedback, setTapFeedback] = useState(null);
  const containerRef = useRef(null);
  const gestureRef = useRef(null);
  const liveRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const doubleTapTimerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, px: 0, py: 0 });
  const propsRef = useRef({});
  useEffect(() => { propsRef.current = { mode, nw, nh, screenOffX, screenOffY, onRemoteClick, onRemoteScroll, onOpenFullscreen }; });

  function clampAndApply(s, newTx, newTy) {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cw = r.width;
    const ch = r.height;
    const cs = Math.max(1, Math.min(8, s));
    const cTx = cs > 1 ? Math.min(0, Math.max(cw - cw * cs, newTx)) : 0;
    const cTy = cs > 1 ? Math.min(0, Math.max(ch - ch * cs, newTy)) : 0;
    liveRef.current = { scale: cs, tx: cTx, ty: cTy };
    setScale(cs); setTx(cTx); setTy(cTy);
  }

  useEffect(() => {
    clampAndApply(liveRef.current.scale, liveRef.current.tx, liveRef.current.ty);
  }, [nw, nh, overrideWidth, overrideHeight, screenshot]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function gPos(t) { const r = el.getBoundingClientRect(); return { px: t.clientX - r.left, py: t.clientY - r.top }; }
    function gDist(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
    function gMid(a, b) { const r = el.getBoundingClientRect(); return { px: (a.clientX + b.clientX) / 2 - r.left, py: (a.clientY + b.clientY) / 2 - r.top }; }

    function onStart(e) {
      e.preventDefault();
      const { scale: s, tx: cTx, ty: cTy } = liveRef.current;
      if (e.touches.length === 1) {
        const p = gPos(e.touches[0]);
        gestureRef.current = { type: "potential", startPx: p.px, startPy: p.py, startTx: cTx, startTy: cTy, moved: false };
      } else if (e.touches.length >= 2) {
        if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
        const d = gDist(e.touches[0], e.touches[1]);
        const m = gMid(e.touches[0], e.touches[1]);
        gestureRef.current = { type: "pinch", startDist: d, startMidX: m.px, startMidY: m.py, startScale: s, startTx: cTx, startTy: cTy };
      }
    }

    function onMove(e) {
      e.preventDefault();
      const g = gestureRef.current;
      if (!g) return;
      const { scale: s } = liveRef.current;
      if ((g.type === "potential" || g.type === "pan") && e.touches.length === 1) {
        const p = gPos(e.touches[0]);
        const dx = p.px - g.startPx, dy = p.py - g.startPy;
        if (!g.moved && Math.hypot(dx, dy) > 7) { g.type = "pan"; g.moved = true; }
        if (g.type === "pan") clampAndApply(s, g.startTx + dx, g.startTy + dy);
      } else if (g.type === "pinch" && e.touches.length >= 2) {
        const d = gDist(e.touches[0], e.touches[1]);
        const m = gMid(e.touches[0], e.touches[1]);
        const ns = Math.max(1, Math.min(8, g.startScale * d / g.startDist));
        const r = ns / g.startScale;
        clampAndApply(ns, m.px - r * (g.startMidX - g.startTx), m.py - r * (g.startMidY - g.startTy));
      }
    }

    function onEnd(e) {
      e.preventDefault();
      const g = gestureRef.current;
      if (!g) return;
      if (g.type === "pinch" && e.touches.length === 1) {
        const p = gPos(e.touches[0]);
        gestureRef.current = { type: "pan", startPx: p.px, startPy: p.py, startTx: liveRef.current.tx, startTy: liveRef.current.ty, moved: true };
        return;
      }
      if (g.type === "potential" && !g.moved && e.changedTouches.length === 1) {
        const ct = e.changedTouches[0];
        // Snapshot ALL coordinates at event time — do NOT re-read rect later (layout may
        // shift between here and any async callback due to React re-renders from polling).
        const cRect = el.getBoundingClientRect();
        const px = ct.clientX - cRect.left;
        const py = ct.clientY - cRect.top;
        const now = Date.now();
        const { mode: m, nw: nwP, nh: nhP, screenOffX: sox, screenOffY: soy, onRemoteClick: orc, onOpenFullscreen: oof } = propsRef.current;

        if (m === "control" && orc) {
          // Control mode: fire click IMMEDIATELY — no double-tap ambiguity timer.
          // Zooming in control mode is pinch-only.
          if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
          const { scale: s2, tx: tx2, ty: ty2 } = liveRef.current;
          const remote = mapClientPointToRemotePoint({ px, py, containerWidth: cRect.width, containerHeight: cRect.height, naturalWidth: nwP, naturalHeight: nhP, scale: s2, translateX: tx2, translateY: ty2 });
          setTapFeedback({ x: px, y: py, id: Date.now() });
          setTimeout(() => setTapFeedback(null), 500);
          orc((sox || 0) + remote.x, (soy || 0) + remote.y);
        } else {
          // Explore mode: double-tap → zoom, single-tap → open fullscreen.
          const last = lastTapRef.current;
          const isDbl = now - last.time < 350 && Math.hypot(px - last.px, py - last.py) < 50;
          if (isDbl) {
            if (doubleTapTimerRef.current) { clearTimeout(doubleTapTimerRef.current); doubleTapTimerRef.current = null; }
            lastTapRef.current = { time: 0, px: 0, py: 0 };
            const { scale: cs, tx: cTx, ty: cTy } = liveRef.current;
            if (cs > 1.4) {
              clampAndApply(1, 0, 0);
            } else {
              const ns = 2.5, r = ns / cs;
              clampAndApply(ns, px - r * (px - cTx), py - r * (py - cTy));
            }
          } else {
            lastTapRef.current = { time: now, px, py };
            doubleTapTimerRef.current = setTimeout(() => {
              doubleTapTimerRef.current = null;
              if (oof) oof();
            }, 280);
          }
        }
      }
      if (e.touches.length === 0) gestureRef.current = null;
    }

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
    };
  }, []);

  return h("div", { className: "remote-vp-wrap" },
    h("div", {
      ref: containerRef,
      className: "remote-vp",
      style: overrideWidth
        ? { width: `${overrideWidth}px`, height: `${overrideHeight}px`, touchAction: "none" }
        : { paddingBottom: `${(nh / nw * 100).toFixed(3)}%`, touchAction: "none" },
      onWheel: (e) => { const { mode: m, onRemoteScroll: ors } = propsRef.current; if (m === "control" && ors) { e.preventDefault(); ors(e.deltaY > 0 ? 360 : -360); } }
    },
      h("div", { className: "remote-vp-inner" },
        screenshot
          ? h("img", { src: `data:${screenshotMime ?? "image/jpeg"};base64,${screenshot}`, className: "remote-vp-img", style: { transform: `translate(${tx}px,${ty}px) scale(${scale})`, transformOrigin: "0 0" }, draggable: false, alt: "Écran distant" })
          : h("div", { className: "remote-vp-empty" }, h("p", null, "Aucune capture")),
        tapFeedback ? h("div", { key: tapFeedback.id, className: "remote-tap-dot", style: { left: `${tapFeedback.x}px`, top: `${tapFeedback.y}px` } }) : null,
        mode === "explore" && screenshot ? h("div", { className: "remote-explore-hint" }, "Explorer — tap pour plein écran") : null
      )
    ),
    scale > 1
      ? h("div", { className: "remote-vp-footer" },
          h("span", { className: "remote-zoom-badge" }, `${Math.round(scale * 100)}%`),
          h("button", { className: "remote-vp-reset", onClick: () => clampAndApply(1, 0, 0) }, "↺ Reset")
        )
      : null
  );
}

// ─── RemoteKeyboardSheet ──────────────────────────────────────────────────────

function RemoteKeyboardSheet({ onClose, onTypeText, onHotkey, onResolveLlmText }) {
  const [text, setText] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [sending, setSending] = useState(false);
  const [llmStatus, setLlmStatus] = useState(null);
  const hasLlm = hasLlmDirective(text);
  const slashSuggestions = getSlashSuggestion(text);
  const quickKeys = [["Ctrl+C","ctrl+c"],["Ctrl+V","ctrl+v"],["Ctrl+A","ctrl+a"],["Entrée","enter"],["Échap","esc"],["Tab","tab"]];
  const advKeys = [["⌫","backspace"],["↑","up"],["↓","down"],["←","left"],["→","right"],["Ctrl+Z","ctrl+z"],["Ctrl+X","ctrl+x"],["Ctrl+S","ctrl+s"],["Ctrl+W","ctrl+w"],["Alt+Tab","alt+tab"],["Alt+F4","alt+f4"]];

  async function submitText() {
    const raw = text.trim();
    if (!raw || sending) return;

    if (hasLlm && onResolveLlmText) {
      setSending(true);
      setLlmStatus({ state: "resolving", message: "Connexion au provider LLM…" });
      try {
        const result = await onResolveLlmText(raw);
        const generation = firstLlmGeneration(result);
        const resolvedText = result?.text ?? generation?.output ?? raw;
        setText(resolvedText);
        setLlmStatus({
          state: "ready",
          message: `Réponse insérée · ${llmProviderLabel(generation)}`,
          provider: generation?.provider ?? null,
          model: generation?.model ?? null
        });
      } catch (err) {
        setLlmStatus({ state: "error", message: err.message ?? "Génération /llm impossible" });
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    try {
      await onTypeText(raw);
      setText("");
      setLlmStatus(null);
    } finally {
      setSending(false);
    }
  }

  return h("div", { className: "remote-kb-overlay", onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
    h("div", { className: "remote-kb-sheet" },
      h("div", { className: "remote-kb-handle" }),
      h("div", { className: "remote-kb-header" },
        h("span", { className: "remote-kb-title" }, "Clavier"),
        h("button", { className: "remote-kb-close", onClick: onClose }, SVG.x)
      ),
      h("div", { className: "remote-kb-input-row" },
        h("input", {
          className: `mobile-input${hasLlm ? " llm-active" : ""}`,
          placeholder: "Texte à taper… ou /llm{prompt}",
          value: text,
          autoFocus: true,
          onChange: (e) => { setText(e.target.value); if (llmStatus?.state !== "resolving") setLlmStatus(null); },
          onKeyDown: (e) => { if (e.key === "Enter") submitText(); }
        }),
        h("button", { className: "ctrl-send-btn", onClick: submitText, disabled: !text.trim() || sending }, sending ? "…" : SVG.send)
      ),
      h(SlashSuggestion, {
        suggestions: slashSuggestions,
        onSelect: (cmd) => setText(applySlashCommand(text, cmd))
      }),
      hasLlm && llmStatus?.state !== "resolving"
        ? h("div", { className: "llm-directive-hint active" }, "Directive /llm active — la réponse sera insérée dans ce champ")
        : null,
      llmStatus?.state === "resolving"
        ? h("div", { className: "llm-thinking-banner" },
            h("div", { className: "llm-thinking-dots" }, h("span"), h("span"), h("span")),
            llmStatus.message
          )
        : llmStatus
          ? h("div", { className: `llm-field-status ${llmStatus.state}` }, llmStatus.message)
          : null,
      h("div", { className: "remote-kb-shortcuts" }, quickKeys.map(([l, k]) => h("button", { key: k, className: "remote-kb-key", onClick: () => onHotkey(k) }, l))),
      h("button", { className: "ctrl-keyboard-toggle", onClick: () => setShowAdv(v => !v) },
        h("span", null, "Raccourcis avancés"),
        h("span", { className: `ctrl-chevron ${showAdv ? "open" : ""}` }, "▾")
      ),
      showAdv ? h("div", { className: "remote-kb-shortcuts adv" }, advKeys.map(([l, k]) => h("button", { key: k, className: "remote-kb-key", onClick: () => onHotkey(k) }, l))) : null
    )
  );
}

// ─── RemoteScreenFullscreenModal ──────────────────────────────────────────────

function RemoteScreenFullscreenModal({ screenshot, screenshotMime, naturalWidth, naturalHeight, screenOffX, screenOffY, mode, onModeChange, onClose, onRemoteClick, onRemoteScroll, onCapture, captureLoading, onTypeText, onHotkey, onResolveLlmText }) {
  const [isKbOpen, setIsKbOpen] = useState(false);
  const [vpSize, setVpSize] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!bodyRef.current) return;
    const nw = naturalWidth || 1920;
    const nh = naturalHeight || 1080;
    const ratio = nw / nh;
    function compute(w, h) {
      if (w / h > ratio) { const fw = Math.floor(h * ratio); setVpSize({ width: fw, height: Math.floor(h) }); }
      else { const fh = Math.floor(w / ratio); setVpSize({ width: Math.floor(w), height: fh }); }
    }
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      compute(width, height);
    });
    obs.observe(bodyRef.current);
    const r = bodyRef.current.getBoundingClientRect();
    compute(r.width, r.height);
    return () => obs.disconnect();
  }, [naturalWidth, naturalHeight]);

  return h("div", { className: "remote-fs-modal" },
    h("div", { className: "remote-fs-topbar" },
      h("button", { className: "remote-fs-btn close", onClick: onClose }, SVG.x),
      h("div", { className: "remote-fs-mode-toggle" },
        h("button", { className: `remote-fs-mode-btn ${mode === "explore" ? "active" : ""}`, onClick: () => onModeChange("explore") }, "Explorer"),
        h("button", { className: `remote-fs-mode-btn ${mode === "control" ? "active" : ""}`, onClick: () => onModeChange("control") }, "Contrôler")
      ),
      h("div", { className: "remote-fs-actions" },
        h("button", { className: "remote-fs-btn", onClick: () => setIsKbOpen(true) }, IC([h("rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }), h("path", { d: "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" })])),
        h("button", { className: "remote-fs-btn", onClick: onCapture, disabled: captureLoading }, IC([h("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }), h("polyline", { points: "21 3 21 9 15 9" })]))
      )
    ),
    h("div", { className: "remote-fs-body", ref: bodyRef },
      h(RemoteScreenViewport, {
        screenshot, screenshotMime, naturalWidth, naturalHeight, screenOffX, screenOffY, mode, onRemoteClick, onRemoteScroll,
        overrideWidth: vpSize?.width, overrideHeight: vpSize?.height
      })
    ),
    isKbOpen ? h(RemoteKeyboardSheet, { onClose: () => setIsKbOpen(false), onTypeText, onHotkey, onResolveLlmText }) : null
  );
}

// ─── Tab: Control (Desktop + Agent OS) ──────────────────────────────────────

function ControlTab({ projectId, token, events, pollingInterval = 2000 }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [mission, setMission] = useState("");
  const [missionBusy, setMissionBusy] = useState(false);
  const [missionError, setMissionError] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [completedRun, setCompletedRun] = useState(null);
  const [showAllWindows, setShowAllWindows] = useState(false);
  const [windowIcons, setWindowIcons] = useState({});
  const [showMissionInput, setShowMissionInput] = useState(false);
  const [viewportMode, setViewportMode] = useState("explore");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [llmResolving, setLlmResolving] = useState(false);
  const [llmPreview, setLlmPreview] = useState(null); // { resolvedText, generatedText }
  const refreshFailCount = useRef(0);
  const refreshInFlight = useRef(false);

  async function refresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const next = await apiGet(`/api/mobile/projects/${projectId}/desktop/state`, token);
      refreshFailCount.current = 0;
      setError(null);
      setState(next);
      apiGet(`/api/mobile/projects/${projectId}/runs`, token)
        .then((runs) => {
          const allRuns = Array.isArray(runs) ? runs : [];
          const running = allRuns.find((r) => r.status === "running" || r.status === "paused") ?? null;
          setActiveRun(running);
          const DONE_STATUSES = ["completed", "partial_success", "failed", "stopped"];
          const done = allRuns.find((r) => DONE_STATUSES.includes(r.status)) ?? null;
          setCompletedRun(done);
        })
        .catch(() => {});
    } catch (err) {
      refreshFailCount.current += 1;
      // Only surface the error after 2 consecutive failures — avoids transient hiccups
      if (refreshFailCount.current >= 2) {
        setError(err.message);
      }
    } finally {
      refreshInFlight.current = false;
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollingInterval);
    return () => clearInterval(timer);
  }, [projectId, token, pollingInterval]);

  useEffect(() => {
    if (events.length > 0) refresh();
  }, [events.length, projectId, token]);

  async function launchMission() {
    const obj = mission.trim();
    if (!obj) return;
    setMissionError(null);

    if (hasLlmDirective(obj)) {
      setMissionBusy(true);
      setLlmResolving(true);
      setLlmPreview(null);
      try {
        const res = await resolveLlmInlineInput(obj, projectId, token, "mission");
        const generation = firstLlmGeneration(res);
        const resolvedText = res.text ?? generation?.output ?? obj;
        const generatedText = generation?.output ?? resolvedText;
        setMission(resolvedText);
        setLlmPreview({ resolvedText, generatedText, generation });
      } catch (err) {
        setMissionError(err.message);
      } finally {
        setLlmResolving(false);
        setMissionBusy(false);
      }
      return;
    }

    await doStartMission(obj);
  }

  async function doStartMission(objective) {
    setMissionBusy(true);
    setMissionError(null);
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "startMission",
        params: { objective }
      }, token);
      setMission("");
      setShowMissionInput(false);
      setLlmPreview(null);
      await refresh();
    } catch (err) {
      setMissionError(err.message);
    } finally {
      setMissionBusy(false);
    }
  }

  async function stopRun() {
    if (!activeRun) return;
    setMissionBusy(true);
    try {
      await apiPost(`/api/mobile/projects/${projectId}/commands`, {
        command: "stopRun",
        params: { runId: activeRun.id }
      }, token);
      await refresh();
    } catch (err) {
      setMissionError(err.message);
    } finally {
      setMissionBusy(false);
    }
  }

  // Lazy-load real app icons for visible windows, cached by window ID
  const windows = state?.windows ?? [];
  useEffect(() => {
    const uncached = windows.filter((w) => w.id && !(w.id in windowIcons));
    if (uncached.length === 0) return;
    let cancelled = false;
    Promise.all(
      uncached.slice(0, 3).map(async (w) => {
        try {
          const res = await apiPost(`/api/mobile/projects/${projectId}/desktop/action`, {
            action: { type: "getWindowIcon", handle: String(w.id) }
          }, token);
          const b64 = res?.result?.iconBase64 ?? null;
          return [w.id, b64];
        } catch {
          return [w.id, undefined]; // don't cache failures — retry on next windows change
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setWindowIcons((prev) => {
        const next = { ...prev };
        for (const [id, b64] of entries) {
          if (b64 !== undefined) next[id] = b64; // skip errored entries
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [windows.map((w) => w.id).join(",")]);

  async function sendAction(action, label = action.type) {
    setBusy(label);
    setError(null);
    try {
      const response = await apiPost(`/api/mobile/projects/${projectId}/desktop/action`, { action }, token);
      if (response.state) setState(response.state);
      return response;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  function handleRemoteClick(x, y) {
    apiPost(`/api/mobile/projects/${projectId}/desktop/action`, { action: { type: "clickAt", x, y } }, token)
      .catch(() => { /* fire-and-forget: ignore transient errors */ });
  }
  async function handleRemoteScroll(delta) {
    await sendAction({ type: "scroll", delta }, "scroll");
  }
  async function resolveTypeTextLlm(t) {
    setLlmResolving(true);
    setError(null);
    try {
      return await resolveLlmInlineInput(t, projectId, token, "type_text");
    } finally {
      setLlmResolving(false);
    }
  }
  async function handleTypeText(t) {
    if (!t?.trim()) return;
    let resolved = t;
    if (hasLlmDirective(t)) {
      try {
        const res = await resolveTypeTextLlm(t);
        resolved = res.text;
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    await sendAction({ type: "typeText", text: resolved }, "typeText");
  }
  async function handleHotkey(keys) {
    await sendAction({ type: "hotkey", keys }, "hotkey");
  }

  const screenshot = state?.screenshotBase64 ?? null;
  const screenshotMime = state?.screenshotMimeType ?? "image/jpeg";
  const disabled = busy !== null || state?.enabled === false;
  const missionHasLlm = hasLlmDirective(mission);

  const missionBadgeClass = activeRun
    ? activeRun.status === "running" ? "running" : activeRun.status === "paused" ? "paused" : "idle"
    : "idle";

  return h("div", { className: "tab-content control-tab ctrl-cockpit" },

    // ── Errors
    error ? h("div", { className: "inline-error ctrl-error" }, error) : null,
    missionError ? h("div", { className: "inline-error ctrl-error" }, missionError) : null,
    state?.enabled === false
      ? h("div", { className: "inline-error ctrl-error" }, "Contrôle mobile désactivé côté serveur.")
      : null,

    // ── Mission Status Card
    h("div", { className: "ctrl-card ctrl-mission-card" },
      h("div", { className: "ctrl-card-header" },
        h("div", { className: "ctrl-mission-icon" },
          IC([
            h("circle", { cx: 12, cy: 12, r: 9 }),
            h("circle", { cx: 12, cy: 12, r: 4 }),
            h("line", { x1: 12, y1: 2, x2: 12, y2: 5 }),
            h("line", { x1: 12, y1: 19, x2: 12, y2: 22 }),
            h("line", { x1: 2, y1: 12, x2: 5, y2: 12 }),
            h("line", { x1: 19, y1: 12, x2: 22, y2: 12 })
          ])
        ),
        h("div", { className: "ctrl-card-title-group" },
          h("span", { className: "ctrl-card-title" }, "Mission en cours"),
          activeRun
            ? h("span", { className: `ctrl-mission-badge ${missionBadgeClass}` },
                activeRun.status === "running" ? "Actif" : activeRun.status === "paused" ? "En pause" : activeRun.status
              )
            : h("span", { className: "ctrl-mission-badge idle" }, "Inactif")
        )
      ),

      activeRun
        ? h("div", { className: "ctrl-mission-fields" },
            h("div", { className: "ctrl-mission-field" },
              h("span", { className: "ctrl-field-label" }, "Objectif"),
              h("span", { className: "ctrl-field-value" }, String(activeRun.mission ?? activeRun.objective ?? "—").slice(0, 120))
            ),
            activeRun.naturalReply || activeRun.summary
              ? h("div", { className: "ctrl-mission-field" },
                  h("span", { className: "ctrl-field-label" }, "Livrable attendu"),
                  h("span", { className: "ctrl-field-value" }, String(activeRun.naturalReply ?? activeRun.summary ?? "—").slice(0, 100))
                )
              : null,
            activeRun.executionThread?.activeStep
              ? h("div", { className: "ctrl-mission-field" },
                  h("span", { className: "ctrl-field-label" }, "Prochaine action"),
                  h("span", { className: "ctrl-field-value accent" }, String(activeRun.executionThread.activeStep.label ?? "—").slice(0, 80))
                )
              : null
          )
        : h("div", { className: "ctrl-mission-empty" }, "Aucune mission active — lancez-en une ci-dessous"),

      h("div", { className: "ctrl-mission-actions" },
        activeRun
          ? h("div", null,
              h("div", { className: "ctrl-mission-action-btns" },
                h("button", {
                  className: "mobile-btn primary",
                  disabled: true
                }, "Reprendre"),
                h("button", {
                  className: "mobile-btn outline-danger",
                  onClick: stopRun,
                  disabled: missionBusy
                }, missionBusy ? "…" : "Arrêter")
              ),
              activeRun.status === "paused"
                ? h("p", { className: "ctrl-resume-hint" },
                    activeRun.pendingApprovals > 0
                      ? "⚠ Validation requise — approuve l'action dans l'onglet Tâches."
                      : "Mission en pause — va dans Tâches pour reprendre ou arrêter.")
                : null
            )
          : h("button", {
              className: "mobile-btn primary",
              onClick: () => setShowMissionInput((v) => !v)
            }, showMissionInput ? "Annuler" : "+ Nouvelle mission")
      ),

      showMissionInput
        ? h("div", { className: "ctrl-mission-input-wrap" },
            h("div", null,
              h("textarea", {
                className: `mobile-textarea${missionHasLlm ? " llm-active" : ""}`,
                placeholder: "Ex: Ouvre Notepad++ et écris : /llm{CV de Clark Kent pour le Daily Planet}",
                rows: 3,
                value: mission,
                onChange: (e) => { setMission(e.target.value); setLlmPreview(null); },
                autoFocus: true
              }),
              h(SlashSuggestion, {
                suggestions: getSlashSuggestion(mission),
                onSelect: (cmd) => { setMission(applySlashCommand(mission, cmd)); setLlmPreview(null); }
              }),
              missionHasLlm && !missionBusy && !llmResolving
                ? h("div", { className: "llm-directive-hint active" }, "Directive /llm — la réponse sera insérée dans ce champ avant lancement")
                : null,
              llmResolving
                ? h("div", { className: "llm-thinking-banner" },
                    h("div", { className: "llm-thinking-dots" },
                      h("span"), h("span"), h("span")
                    ),
                    "Connexion au provider LLM…"
                  )
                : llmPreview
                  ? h("div", { className: "llm-field-status ready" },
                      `Réponse /llm insérée · ${llmProviderLabel(llmPreview.generation)}`
                    )
                  : null,
              h("button", {
                className: "mobile-btn primary full-width",
                onClick: launchMission,
                disabled: missionBusy || !mission.trim()
              }, llmResolving
                ? "Génération en cours…"
                : missionBusy
                  ? "Lancement…"
                  : missionHasLlm
                    ? "Générer /llm"
                    : "▶ Lancer la mission")
            )
          )
        : null
    ),

    // ── Résultat de mission Card
    completedRun && !activeRun
      ? h("div", { className: "ctrl-card ctrl-result-card" },
          h("div", { className: "ctrl-card-header" },
            h("span", { className: "ctrl-card-title" }, "Résultat de mission"),
            h("span", {
              className: `ctrl-mission-badge ${completedRun.status === "completed" || completedRun.status === "partial_success" ? "running" : "idle"}`
            }, completedRun.status === "completed" ? "Succès"
              : completedRun.status === "partial_success" ? "Partiel"
              : completedRun.status === "failed" ? "Échec"
              : "Arrêté")
          ),
          h("div", { className: "ctrl-mission-fields" },
            h("div", { className: "ctrl-mission-field" },
              h("span", { className: "ctrl-field-label" }, "Objectif"),
              h("span", { className: "ctrl-field-value" }, String(completedRun.mission ?? "—").slice(0, 120))
            ),
            (completedRun.naturalReply || completedRun.summary)
              ? h("div", { className: "ctrl-mission-field" },
                  h("span", { className: "ctrl-field-label" }, "Réponse de JON"),
                  h("span", { className: "ctrl-field-value ctrl-result-reply" }, String(completedRun.naturalReply ?? completedRun.summary ?? "—").slice(0, 400))
                )
              : null,
            completedRun.executionThread?.verification
              ? h("div", { className: "ctrl-mission-field" },
                  h("span", { className: "ctrl-field-label" }, "Vérification"),
                  h("span", { className: "ctrl-field-value" },
                    String(completedRun.executionThread.verification.verdict ?? completedRun.executionThread.verification.status ?? "—")
                    + (completedRun.executionThread.verification.confidence != null
                      ? ` (${Math.round(Number(completedRun.executionThread.verification.confidence) * 100)}%)`
                      : "")
                  )
                )
              : null,
            (completedRun.artifactCount > 0 || completedRun.evidenceCount > 0)
              ? h("div", { className: "ctrl-mission-field" },
                  h("span", { className: "ctrl-field-label" }, "Livrables"),
                  h("span", { className: "ctrl-field-value accent" },
                    [
                      completedRun.artifactCount > 0 ? `${completedRun.artifactCount} artefact(s)` : null,
                      completedRun.evidenceCount > 0 ? `${completedRun.evidenceCount} capture(s)` : null
                    ].filter(Boolean).join(" · ")
                  )
                )
              : null
          )
        )
      : null,

    // ── Controlled Screen Card
    h("div", { className: "ctrl-card ctrl-screen-card" },
      h("div", { className: "ctrl-card-header" },
        h("span", { className: "ctrl-card-title" }, "Écran contrôlé"),
        h("div", { className: "remote-fs-mode-toggle sm" },
          h("button", { className: `remote-fs-mode-btn ${viewportMode === "explore" ? "active" : ""}`, onClick: () => setViewportMode("explore") }, "Explorer"),
          h("button", { className: `remote-fs-mode-btn ${viewportMode === "control" ? "active" : ""}`, onClick: () => setViewportMode("control") }, "Contrôler")
        ),
        h("button", { className: "ctrl-pill-btn accent", onClick: () => sendAction({ type: "captureScreen" }, "captureScreen"), disabled },
          busy === "captureScreen" ? "…" : IC([h("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }), h("polyline", { points: "21 3 21 9 15 9" })], { width: 14, height: 14 })
        ),
        h("button", { className: "ctrl-pill-btn", onClick: () => setIsFullscreen(true) },
          IC([h("path", { d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" })], { width: 14, height: 14 })
        )
      ),
      h(RemoteScreenViewport, {
        screenshot,
        screenshotMime,
        naturalWidth: state?.screenWidth ?? 1920,
        naturalHeight: state?.screenHeight ?? 1080,
        screenOffX: state?.screenX ?? 0,
        screenOffY: state?.screenY ?? 0,
        mode: viewportMode,
        onRemoteClick: handleRemoteClick,
        onRemoteScroll: handleRemoteScroll,
        onOpenFullscreen: () => setIsFullscreen(true)
      }),
      !screenshot
        ? h("button", { className: "mobile-btn primary full-width", onClick: () => sendAction({ type: "captureScreen" }, "captureScreen"), disabled },
            busy === "captureScreen" ? "Capture…" : "Capturer le bureau"
          )
        : null,
      viewportMode === "control"
        ? h("button", { className: "remote-kb-trigger", onClick: () => setIsKeyboardOpen(true) },
            IC([h("rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }), h("path", { d: "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" })], { width: 16, height: 16 }),
            " Clavier"
          )
        : null
    ),

    // Keyboard sheet
    isKeyboardOpen ? h(RemoteKeyboardSheet, { onClose: () => setIsKeyboardOpen(false), onTypeText: handleTypeText, onHotkey: handleHotkey, onResolveLlmText: resolveTypeTextLlm }) : null,

    // Fullscreen modal
    isFullscreen ? h(RemoteScreenFullscreenModal, {
      screenshot,
      screenshotMime,
      naturalWidth: state?.screenWidth ?? 1920,
      naturalHeight: state?.screenHeight ?? 1080,
      screenOffX: state?.screenX ?? 0,
      screenOffY: state?.screenY ?? 0,
      mode: viewportMode,
      onModeChange: setViewportMode,
      onClose: () => setIsFullscreen(false),
      onRemoteClick: handleRemoteClick,
      onRemoteScroll: handleRemoteScroll,
      onCapture: () => sendAction({ type: "captureScreen" }, "captureScreen"),
      captureLoading: busy === "captureScreen",
      onTypeText: handleTypeText,
      onHotkey: handleHotkey,
      onResolveLlmText: resolveTypeTextLlm
    }) : null,

    // ── Open Windows Card
    windows.length > 0
      ? h("div", { className: "ctrl-card ctrl-windows-card" },
          h("div", { className: "ctrl-card-header" },
            h("span", { className: "ctrl-card-title" }, "Fenêtres ouvertes"),
            h("span", { className: "ctrl-windows-count" }, String(windows.length))
          ),
          h("div", { className: "ctrl-windows-list" },
            (showAllWindows ? windows : windows.slice(0, 5)).map((win) => {
              const title = String(win.title ?? win.id ?? "Fenêtre").slice(0, 50);
              const initial = title.replace(/\s+/g, "").slice(0, 1).toUpperCase() || "?";
              const iconB64 = windowIcons[win.id] ?? null;
              const builtinSrc = !iconB64 ? getBuiltinIcon(win.processName, win.title) : null;
              const isFocusing = busy === `focus-${win.id ?? win.handle}`;
              return h("button", {
                key: win.id ?? win.handle,
                className: "ctrl-window-row",
                onClick: () => sendAction({ type: "focusWindow", handle: String(win.id ?? win.handle) }, `focus-${win.id ?? win.handle}`),
                disabled
              },
                h("div", { className: "ctrl-window-icon" },
                  iconB64
                    ? h("img", { src: `data:image/png;base64,${iconB64}`, className: "ctrl-window-icon-img", alt: win.processName ?? "icon" })
                    : builtinSrc
                    ? h("img", { src: builtinSrc, className: "ctrl-window-icon-img", alt: win.processName ?? "icon" })
                    : initial
                ),
                h("div", { className: "ctrl-window-info" },
                  h("span", { className: "ctrl-window-title" }, title),
                  h("span", { className: "ctrl-window-type" }, win.processName ?? "Application")
                ),
                h("span", { className: "ctrl-window-chevron" }, isFocusing ? "…" : "›")
              );
            })
          ),
          windows.length > 5
            ? h("button", {
                className: "ctrl-windows-toggle",
                onClick: () => setShowAllWindows((v) => !v)
              }, showAllWindows
                  ? "Réduire ▲"
                  : `Voir tout (${windows.length}) ▼`)
            : null
        )
      : null
  );
}

// ─── Tab: Browser Tabs ───────────────────────────────────────────────────────

function BrowserTabsTab({ projectId, token, events }) {
  const [tabsState, setTabsState] = useState({ active: false, tabs: [] });
  const [newUrl, setNewUrl] = useState("");
  const [navigateUrl, setNavigateUrl] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [observation, setObservation] = useState(null); // last observeTab result
  const refreshInFlight = useRef(false);

  async function refresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const next = await apiGet(`/api/mobile/projects/${projectId}/browser/tabs`, token);
      setTabsState(next ?? { active: false, tabs: [] });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      refreshInFlight.current = false;
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [projectId, token]);

  useEffect(() => {
    if (events.length > 0) refresh();
  }, [events.length, projectId, token]);

  async function tabAction(action, label = action.type) {
    setBusy(label);
    setError(null);
    try {
      const response = await apiPost(`/api/mobile/projects/${projectId}/browser/tabs/action`, { action }, token);
      if (response.state) setTabsState(response.state);
      if (action.type === "observeTab" && response.result) setObservation(response.result);
      return response;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function openTab(urlOverride = null) {
    const url = normalizeBrowserUrlInput(urlOverride ?? newUrl, { allowBlank: true });
    const response = await tabAction({ type: "openTab", url }, "openTab");
    if (response) setNewUrl("");
  }

  async function navigateActiveTab(tabId) {
    const url = normalizeBrowserUrlInput(navigateUrl, { allowBlank: false });
    if (!url) return;
    const response = await tabAction({ type: "navigateTab", targetId: tabId, url }, `navigate-${tabId}`);
    if (response) setNavigateUrl("");
  }

  const tabs = tabsState?.tabs ?? [];
  const sessionActive = Boolean(tabsState?.active);
  const activeTab = tabs.find((t) => t.active) ?? null;

  return h("div", { className: "tab-content browser-tabs-tab" },
    h("div", { className: "section" },
      h("div", { className: "browser-tabs-header" },
        h("p", { className: "section-title" }, "Onglets JON"),
        h("span", { className: `browser-cdp-badge ${sessionActive ? "connected" : "disconnected"}` },
          sessionActive ? "● Session active" : "○ Aucune session"
        ),
        h("button", {
          className: `mobile-btn ${sessionActive ? "ghost" : "primary"} small`,
          onClick: () => sessionActive ? refresh() : openTab("about:blank"),
          disabled: busy !== null
        }, busy === "openTab" ? "…" : sessionActive ? "↺" : "Ouvrir")
      ),
      error ? h("div", { className: "inline-error" }, error) : null,

      h("div", { className: "new-tab-card browser-new-tab-card" },
        h("input", {
          className: "mobile-input",
          placeholder: "URL ou recherche",
          value: newUrl,
          onChange: (e) => setNewUrl(e.target.value),
          onKeyDown: (e) => e.key === "Enter" && openTab()
        }),
        h("button", {
          className: "mobile-btn primary full-width",
          onClick: () => openTab(),
          disabled: busy !== null
        }, busy === "openTab" ? "Ouverture…" : "+ Nouvel onglet")
      ),

      tabs.length === 0
        ? h("div", { className: "empty-state compact" },
            h("p", { className: "empty-title" }, "Aucun onglet JON"),
            h("p", { className: "empty-sub" }, "Ouvre une session ou saisis une URL/recherche ci-dessus.")
          )
        : tabs.map((tab) =>
            h("div", { key: tab.id, className: `browser-tab-card ${tab.active ? "active" : ""}` },
              h("div", { className: "browser-tab-icon" }, (tab.title || tab.url || "?").slice(0, 1).toUpperCase()),
              h("div", { className: "browser-tab-info" },
                h("strong", null, (tab.title || "Nouvel onglet").slice(0, 40)),
                h("span", null, (tab.url || "about:blank").slice(0, 60))
              ),
              h("div", { className: "browser-tab-actions" },
                !tab.active
                  ? h("button", { className: "mobile-btn ghost small", onClick: () => tabAction({ type: "focusTab", targetId: tab.id }, `focus-${tab.id}`), disabled: busy !== null }, "Focus")
                  : h("span", { className: "tab-active-pill" }, "Actif"),
                h("button", {
                  className: "mobile-btn ghost small",
                  onClick: () => tabAction({ type: "observeTab", targetId: tab.id }, `observe-${tab.id}`),
                  disabled: busy !== null,
                  title: "Observer — extrait DOM + screenshot"
                }, busy === `observe-${tab.id}` ? "…" : "👁"),
                h("button", {
                  className: "mobile-btn ghost small",
                  onClick: () => tabAction({ type: "reloadTab", targetId: tab.id }, `reload-${tab.id}`),
                  disabled: busy !== null
                }, "↺"),
                h("button", { className: "mobile-btn outline-danger small", onClick: () => tabAction({ type: "closeTab", targetId: tab.id }, `close-${tab.id}`), disabled: busy !== null }, "×")
              ),
              // Navigate URL input for this tab
              tab.active && h("div", { className: "browser-tab-nav-row" },
                h("input", {
                  className: "mobile-input small",
                  placeholder: "Naviguer vers…",
                  value: navigateUrl,
                  onChange: (e) => setNavigateUrl(e.target.value),
                  onKeyDown: (e) => e.key === "Enter" && navigateActiveTab(tab.id)
                }),
                h("button", {
                  className: "mobile-btn primary small",
                  onClick: () => navigateActiveTab(tab.id),
                  disabled: busy !== null || !navigateUrl.trim()
                }, busy === `navigate-${tab.id}` ? "…" : "→")
              )
            )
          )
    ),

    // Last observation card
    observation && h("div", { className: "browser-observation-card" },
      h("div", { className: "browser-obs-header" },
        h("span", { className: "browser-obs-title" }, "Dernière observation"),
        h("span", { className: "browser-obs-url" }, (observation.url ?? "").slice(0, 60)),
        h("button", { className: "mobile-btn ghost small", onClick: () => setObservation(null) }, "×")
      ),
      observation.screenshotBase64 && h("img", {
        src: `data:image/png;base64,${observation.screenshotBase64}`,
        className: "browser-obs-screenshot",
        alt: "Screenshot"
      }),
      h("div", { className: "browser-obs-meta" },
        h("span", null, `${observation.interactiveElementCount ?? 0} élts interactifs`),
        h("span", null, `${observation.bodyTextLength ?? 0} chars`),
        observation.blocker?.blocked && h("span", { className: "browser-obs-blocked" }, "⚠ bloqué")
      ),
      observation.bodyText && h("pre", { className: "browser-obs-text" },
        observation.bodyText.slice(0, 400) + (observation.bodyText.length > 400 ? "…" : "")
      )
    )
  );
}

// ─── Terminal shell overlay (interactive WebSocket PTY) ───────────────────────

function TerminalShellOverlay({ token, onClose }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let ws = null;
    let ro = null;

    const term = new Terminal({
      theme: {
        background: "#07080e", foreground: "#dde7f5",
        cursor: "#4f8ef7", cursorAccent: "#07080e",
        selectionBackground: "rgba(79,142,247,0.28)",
        black: "#07080e",     brightBlack: "#4e6585",
        red: "#f06060",       brightRed: "#f07a7a",
        green: "#34d88a",     brightGreen: "#44e89a",
        yellow: "#f5a623",    brightYellow: "#f5c033",
        blue: "#4f8ef7",      brightBlue: "#7ab2ff",
        magenta: "#c792ea",   brightMagenta: "#d7a8f5",
        cyan: "#89d7f7",      brightCyan: "#a9e7ff",
        white: "#dde7f5",     brightWhite: "#ffffff"
      },
      fontFamily: '"SF Mono","Menlo","Consolas","Courier New",monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 2000,
      allowTransparency: false,
      macOptionIsMeta: true
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    const rafId = requestAnimationFrame(() => {
      if (disposed) return;
      try { fit.fit(); } catch {}

      const { cols, rows } = term;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/api/mobile/terminal/ws?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;
      queueMobileLog("info", "ws.connecting", "Opening mobile terminal WebSocket", { cols, rows });
      ws = new WebSocket(url);

      ws.onopen = () => {
        queueMobileLog("info", "ws.open", "Mobile terminal WebSocket connected", { cols, rows });
      };
      ws.onmessage = (e) => {
        if (disposed) return;
        try { term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data)); } catch {}
      };
      ws.onclose = (event) => {
        queueMobileLog(event.wasClean ? "info" : "warn", "ws.close", "Mobile terminal WebSocket closed", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
        if (!disposed) try { term.write("\r\n\x1b[90m[Session terminée]\x1b[0m\r\n"); } catch {}
      };
      ws.onerror = () => {
        queueMobileLog("error", "ws.error", "Mobile terminal WebSocket error");
        if (!disposed) try { term.write("\r\n\x1b[31m[Erreur de connexion WebSocket]\x1b[0m\r\n"); } catch {}
      };

      term.onData((data) => { if (ws?.readyState === 1) ws.send(data); });

      ro = new ResizeObserver(() => {
        if (disposed) return;
        try {
          fit.fit();
          if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        } catch {}
      });
      ro.observe(el);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      try { ws?.close(); } catch {}
      try { term.dispose(); } catch {}
    };
  }, []);

  return h("div", { className: "terminal-shell-overlay" },
    h("div", { className: "terminal-shell-bar" },
      h("span", { className: "terminal-shell-bar-title" }, "Shell"),
      h("button", { className: "terminal-shell-bar-close", onClick: onClose, "aria-label": "Fermer" }, SVG.x)
    ),
    h("div", { ref: containerRef, className: "terminal-shell-viewport" })
  );
}

// ─── Tab: Terminals ────────────────────────────────────────────────────────────

const TERM_STATUS_FR = { running: "En cours", waiting_for_input: "Attend", completed: "Terminé", error: "Erreur", attached: "Attaché", detached: "Détaché" };

function TerminalsTab({ projectId, token, events }) {
  const [terminals, setTerminals] = useState([]);
  const [answeredTerminals, setAnsweredTerminals] = useState(new Set());
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotState, setScreenshotState] = useState("idle"); // idle | loading | error
  const [shellOpen, setShellOpen] = useState(false);

  useEffect(() => {
    function refreshTerminals() {
      apiGet(`/api/mobile/projects/${projectId}/terminals`, token).then(setTerminals).catch(() => {});
    }
    refreshTerminals();
    const timer = setInterval(refreshTerminals, 5000);
    return () => clearInterval(timer);
  }, [projectId, token]);

  useEffect(() => {
    if (events.length > 0) {
      apiGet(`/api/mobile/projects/${projectId}/terminals`, token).then(setTerminals).catch(() => {});
    }
  }, [events.length, projectId, token]);

  async function fetchScreenshot() {
    setScreenshotState("loading");
    try {
      const data = await apiGet(`/api/mobile/projects/${projectId}/screenshot`, token);
      setScreenshot(data?.screenshotBase64 ?? null);
      setScreenshotState(data?.screenshotBase64 ? "ok" : "empty");
    } catch { setScreenshotState("error"); setScreenshot(null); }
  }

  const waiting = terminals.filter((t) => t.waitingForInput && !answeredTerminals.has(t.id));
  const others = terminals.filter((t) => !t.waitingForInput || answeredTerminals.has(t.id));

  return h("div", { className: "tab-content" },

    shellOpen && h(TerminalShellOverlay, { token, onClose: () => setShellOpen(false) }),

    h("button", {
      className: "mobile-btn primary full-width",
      onClick: () => setShellOpen(true)
    }, "+ Shell interactif"),

    waiting.map((t) =>
      h(TerminalAlertCard, {
        key: t.id, terminal: t, projectId, token,
        onAnswered: (id) => setAnsweredTerminals((s) => new Set([...s, id]))
      })
    ),

    h("div", { className: "card" },
      h("div", { className: "card-row" },
        h("span", { className: "card-label" }, "Surface active"),
        h("button", {
          className: "mobile-btn ghost small",
          onClick: fetchScreenshot,
          disabled: screenshotState === "loading"
        }, screenshotState === "loading" ? "…" : screenshot ? "Actualiser" : "Capturer")
      ),
      screenshot
        ? h("img", { src: `data:image/png;base64,${screenshot}`, className: "mobile-screenshot", alt: "Surface" })
        : screenshotState === "error"
          ? h("p", { className: "card-hint error" }, "Capture indisponible")
          : h("p", { className: "card-hint" }, "Appuyez sur Capturer pour voir le bureau")
    ),

    others.length > 0
      ? h("div", { className: "section" },
          h("p", { className: "section-title" }, "Terminaux"),
          others.map((t) =>
            h("div", { key: t.id, className: "terminal-card" },
              h("div", { className: "terminal-card-row" },
                h("span", { className: `status-dot ${t.status}` }),
                h("span", { className: "terminal-name" }, t.label),
                h("span", { className: "terminal-status-text" }, TERM_STATUS_FR[t.status] ?? t.status)
              ),
              t.recentOutput
                ? h("pre", { className: "terminal-output-preview" },
                    stripAnsi(t.recentOutput).split("\n").filter((l) => l.trim()).slice(-3).join("\n"))
                : t.status === "error"
                  ? h("p", { className: "terminal-error-hint" }, "Terminal terminé avec une erreur. Vérifiez les logs ou relancez.")
                  : null
            )
          )
        )
      : waiting.length === 0
        ? h("div", { className: "empty-state" },
            h("div", { className: "empty-icon" }, IC([h("polyline", { points: "4 17 10 11 4 5" }), h("line", { x1: 12, y1: 19, x2: 20, y2: 19 })], { width: 40, height: 40 })),
            h("p", { className: "empty-title" }, "Aucun terminal actif")
          )
        : null
  );
}

// ─── Tab: Résultats ───────────────────────────────────────────────────────────

function ResultatsTab({ projectId, token, events }) {
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    apiGet(`/api/mobile/projects/${projectId}/runs`, token).then(setRuns).catch(() => {});
  }, [projectId, token, events.length]);

  const done = runs.filter((r) => r.status === "completed" || r.status === "failed" || r.summary);

  return h("div", { className: "tab-content" },
    done.length === 0
      ? h("div", { className: "empty-state" },
          h("div", { className: "empty-icon" }, IC([h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), h("polyline", { points: "14 2 14 8 20 8" })], { width: 40, height: 40 })),
          h("p", { className: "empty-title" }, "Aucun résultat"),
          h("p", { className: "empty-sub" }, "Les résultats apparaissent une fois les missions terminées")
        )
      : done.map((run) =>
          h("div", { key: run.id, className: `run-card status-${run.status}` },
            h("div", { className: "run-card-top" },
              h("span", { className: `status-dot ${run.status}` }),
              h("span", { className: "run-status-label" }, STATUS_FR[run.status] ?? run.status),
              h("span", { className: "run-ts" }, run.updatedAt ? formatTime(run.updatedAt) : "")
            ),
            h("p", { className: "run-mission" }, run.mission),
            run.summary ? h("p", { className: "run-summary" }, run.summary) : null
          )
        )
  );
}

// ─── Tab: Admin ───────────────────────────────────────────────────────────────

function AdminTab({ token, session, onDisconnect }) {
  const [status, setStatus] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    apiGet("/api/mobile/status", token).then(setStatus).catch(() => {});
    apiGet("/api/mobile/admin/audit", token)
      .then((d) => setAuditLog(Array.isArray(d) ? d.slice(0, 15) : []))
      .catch(() => {});
  }, [token]);

  async function disconnect() {
    try { await apiPost("/api/mobile/session/revoke", {}, token); } catch {}
    clearSession();
    onDisconnect();
  }

  return h("div", { className: "admin-tab" },

    h("div", { className: "card" },
      h("p", { className: "card-section-title" }, "Session"),
      h("div", { className: "card-row" },
        h("span", { className: "card-label" }, "Appareil"),
        h("span", { className: "card-value" }, session?.deviceName ?? "—")
      ),
      h("div", { className: "card-row" },
        h("span", { className: "card-label" }, "Expire le"),
        h("span", { className: "card-value" }, session?.expiresAt?.slice(0, 16).replace("T", " ") ?? "—")
      )
    ),

    confirmDisconnect
      ? h("div", { className: "confirm-card" },
          h("p", { className: "confirm-title" }, "Déconnecter cet appareil ?"),
          h("p", { className: "confirm-sub" }, "Il faudra rescanner le QR ou entrer un nouveau code."),
          h("div", { className: "card-actions" },
            h("button", { className: "mobile-btn ghost", onClick: () => setConfirmDisconnect(false) }, "Annuler"),
            h("button", { className: "mobile-btn danger", onClick: disconnect }, "Déconnecter")
          )
        )
      : h("button", {
          className: "mobile-btn outline-danger full-width",
          onClick: () => setConfirmDisconnect(true)
        }, "Déconnecter cet appareil"),

    status?.devices?.length > 0
      ? h("div", { className: "card" },
          h("p", { className: "card-section-title" }, "Appareils pairés"),
          status.devices.map((d) =>
            h("div", { key: d.id, className: "device-row" },
              h("span", { className: "device-name" }, d.name),
              h("span", { className: `status-pill status-${d.status}` }, d.status),
              h("span", { className: "device-ts" }, d.lastSeenAt?.slice(0, 10) ?? "")
            )
          )
        )
      : null,

    auditLog.length > 0
      ? h("div", { className: "card" },
          h("p", { className: "card-section-title" }, "Dernières commandes"),
          auditLog.map((entry, i) =>
            h("div", { key: i, className: `audit-row audit-${entry.status}` },
              h("span", { className: "audit-cmd" }, entry.commandType),
              h("span", { className: "audit-status-pill" }, entry.status),
              h("span", { className: "audit-ts" }, entry.createdAt?.slice(11, 16) ?? "")
            )
          )
        )
      : null
  );
}

function ParametresTab({ pollingInterval, onPollingIntervalChange }) {
  return h("div", { className: "tab-content" },
    h("div", { className: "card" },
      h("p", { className: "card-section-title" }, "Rafraîchissement de l'écran"),
      h("p", { className: "card-hint" }, "Fréquence de mise à jour de la vue Contrôle (capture + fenêtres)"),
      h("div", { className: "polling-options" },
        POLLING_INTERVAL_OPTIONS.map((opt) =>
          h("button", {
            key: opt.value,
            className: `polling-option-btn ${pollingInterval === opt.value ? "active" : ""}`,
            onClick: () => onPollingIntervalChange(opt.value)
          }, opt.label)
        )
      )
    )
  );
}

function ConnecteursTab({ token }) {
  const [connectors, setConnectors] = useState([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [toolsText, setToolsText] = useState('[{"name":"send_email","description":"Envoyer un email avec approbation explicite."}]');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    try {
      const data = await apiGet("/api/mobile/connectors", token);
      setConnectors(Array.isArray(data?.connectors) ? data.connectors : []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [token]);

  async function addConnector() {
    const connectorName = name.trim();
    if (!connectorName) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      let tools = [];
      if (toolsText.trim()) {
        const parsed = JSON.parse(toolsText);
        tools = Array.isArray(parsed) ? parsed : [parsed];
      }
      await apiPost("/api/mobile/connectors", {
        type: "mcp",
        name: connectorName,
        command: command.trim(),
        url: url.trim(),
        tools
      }, token);
      setName("");
      setCommand("");
      setUrl("");
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return h("div", { className: "tab-content connectors-tab" },
    h("div", { className: "card" },
      h("p", { className: "card-section-title" }, "Connecteurs"),
      h("p", { className: "card-hint" }, "Ajoute un serveur MCP ou un connecteur externe pour que JON puisse le sélectionner comme outil agentique."),
      connectors.length === 0
        ? h("div", { className: "empty-mini" }, "Aucun connecteur")
        : connectors.map((connector) =>
            h("div", { key: connector.connectorId, className: "connector-row" },
              h("div", null,
                h("strong", null, connector.name),
                h("small", null, `${connector.type ?? connector.category ?? "builtin"} · ${(connector.capabilities ?? []).slice(0, 3).join(", ") || "outil"}`)
              ),
              h("span", { className: `status-pill status-${connector.status}` }, connector.status === "connected" ? "Connecté" : "À configurer")
            )
          )
    ),
    h("div", { className: "card connector-form-card" },
      h("p", { className: "card-section-title" }, "Ajouter MCP"),
      h("input", {
        className: "mobile-input",
        value: name,
        onChange: (e) => setName(e.target.value),
        placeholder: "Nom du connecteur"
      }),
      h("input", {
        className: "mobile-input",
        value: command,
        onChange: (e) => setCommand(e.target.value),
        placeholder: "Commande stdio, ex: npx mon-mcp"
      }),
      h("input", {
        className: "mobile-input",
        value: url,
        onChange: (e) => setUrl(e.target.value),
        placeholder: "URL HTTP/SSE optionnelle"
      }),
      h("textarea", {
        className: "mobile-textarea connector-tools-textarea",
        value: toolsText,
        onChange: (e) => setToolsText(e.target.value),
        rows: 4,
        placeholder: '[{"name":"tool_name","description":"Ce que fait le tool"}]'
      }),
      h("button", {
        className: "mobile-btn primary full-width",
        onClick: addConnector,
        disabled: busy || !name.trim()
      }, busy ? "Ajout…" : "Ajouter le connecteur"),
      error ? h("div", { className: "inline-error" }, error) : null,
      saved ? h("div", { className: "llm-field-status ready" }, "Connecteur ajouté au graphe de capacités") : null
    )
  );
}

function MoreTab({ projectId, token, session, events, onDisconnect, pollingInterval, onPollingIntervalChange }) {
  const [view, setView] = useState("params");
  return h("div", { className: "more-tab-wrap" },
    h("div", { className: "more-segment" },
      h("button", { className: view === "params" ? "active" : "", onClick: () => setView("params") }, "Paramètres"),
      h("button", { className: view === "connectors" ? "active" : "", onClick: () => setView("connectors") }, "Connecteurs"),
      h("button", { className: view === "admin" ? "active" : "", onClick: () => setView("admin") }, "Admin")
    ),
    view === "params"
      ? h(ParametresTab, { pollingInterval, onPollingIntervalChange })
      : view === "connectors"
        ? h(ConnecteursTab, { token })
      : h(AdminTab, { token, session, onDisconnect })
  );
}

// ─── SSE hook ─────────────────────────────────────────────────────────────────

function useEventStream(token, onEvent, onStatus) {
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onEventRef.current = onEvent;
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    if (!token) return;
    onStatusRef.current("connecting");
    queueMobileLog("info", "sse.connecting", "Opening mobile event stream");
    const es = new EventSource(`/api/mobile/events?token=${encodeURIComponent(token)}&since=`);
    es.addEventListener("open", () => {
      queueMobileLog("info", "sse.open", "Mobile event stream connected");
      onStatusRef.current("connected");
    });
    es.addEventListener("error", () => {
      queueMobileLog("warn", "sse.error", "Mobile event stream disconnected or retrying", { readyState: es.readyState });
      onStatusRef.current("reconnecting");
    });
    es.addEventListener("mobile.event", (e) => {
      try { onEventRef.current(JSON.parse(e.data)); } catch {}
    });
    return () => {
      queueMobileLog("info", "sse.close", "Mobile event stream closed");
      es.close();
    };
  }, [token]);
}

// ─── App Header ───────────────────────────────────────────────────────────────

const CONN_LABELS = {
  connected: "En ligne",
  connecting: "Connexion…",
  reconnecting: "Reconnexion…",
  disconnected: "Hors ligne"
};

function AppHeader({ connStatus }) {
  return h("div", { className: "app-header" },
    h("span", { className: "app-header-brand" }, "JON"),
    h("div", { className: `app-header-status conn-${connStatus}` },
      h("span", { className: "conn-dot" }),
      h("span", { className: "conn-label" }, CONN_LABELS[connStatus] ?? "…")
    )
  );
}

// ─── Alert Banner ──────────────────────────────────────────────────────────────

function AlertBanner({ event, onDismiss }) {
  if (!event) return null;
  return h("div", { className: "alert-banner" },
    h("div", { className: "alert-dot" }),
    h("span", { className: "alert-msg" }, event.message),
    h("button", { className: "alert-dismiss", onClick: onDismiss, "aria-label": "Fermer" }, SVG.x)
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [session, setSession] = useState(() => getStoredSession());
  const [authState, setAuthState] = useState(() => (getStoredSession() ? "checking" : "none"));
  const [authError, setAuthError] = useState(null);
  const [authRetryTick, setAuthRetryTick] = useState(0);
  const [pairingNotice, setPairingNotice] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [events, setEvents] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [connStatus, setConnStatus] = useState("connecting");
  const [chatUnread, setChatUnread] = useState(0);
  const [alertEvent, setAlertEvent] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(getStoredPollingInterval);

  const projectId = "default";
  const sessionToken = session?.sessionToken ?? null;

  const dropSessionToPairing = useCallback((notice = null) => {
    queueMobileLog("warn", "session.dropped", notice ?? "Mobile session cleared");
    clearSession();
    setMobileLogSession(null);
    setSession(null);
    setAuthState("none");
    setAuthError(null);
    setConnStatus("disconnected");
    setEvents([]);
    setPendingApprovals([]);
    setPairingNotice(notice);
  }, []);

  const acceptSession = useCallback((nextSession) => {
    setMobileLogSession(nextSession);
    queueMobileLog("info", "session.accepted", "Mobile session stored", { deviceId: nextSession.deviceId });
    storeSession(nextSession);
    setSession(nextSession);
    setAuthState("valid");
    setAuthError(null);
    setPairingNotice(null);
    setConnStatus("connecting");
  }, []);

  const refreshPendingApprovals = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const next = await apiGet(`/api/mobile/projects/${projectId}/approvals`, sessionToken);
      setPendingApprovals(normalizeApprovalList(next));
    } catch (err) {
      queueMobileLog("warn", "approvals.refresh_failed", err.message, { code: err.code, status: err.status });
    }
  }, [projectId, sessionToken]);

  function onEvent(ev) {
    setEvents((prev) => [...prev.slice(-99), ev]);
    if (ev.type === "approval.required" && ev.payload?.approvalId) {
      setPendingApprovals((prev) => mergeApprovalLists(prev, [{ ...ev.payload, id: ev.payload.approvalId, createdAt: ev.timestamp }]));
    }
    if (["approval.granted", "approval.denied", "approval.auto_resolved", "approval.policy_blocked"].includes(ev.type)) {
      const approvalId = ev.payload?.approvalId ?? ev.approvalId ?? null;
      if (approvalId) setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
    }
    if (ev.severity === "high") setAlertEvent(ev);
    if ((ev.type === "jon.reply" || ev.type === "jon.needs_user") && activeTab !== "dashboard") {
      setChatUnread((n) => n + 1);
    }
  }

  function handleApprovalResolved(id) {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
    setTimeout(refreshPendingApprovals, 250);
  }

  useEffect(() => {
    setMobileLogSession(session);
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return;
    let disposed = false;
    let timer = null;

    async function verifySession({ silent = false } = {}) {
      if (!silent) {
        setAuthState("checking");
        setAuthError(null);
        setConnStatus("connecting");
      }
      try {
        await validateMobileSession(sessionToken);
        if (disposed) return;
        if (!silent) queueMobileLog("info", "session.validated", "Mobile session validated");
        setAuthState("valid");
        setAuthError(null);
      } catch (err) {
        if (disposed) return;
        if (isAuthError(err)) {
          queueMobileLog("warn", "session.invalid", err.message, { status: err.status, code: err.code });
          dropSessionToPairing("La session enregistrée n'est plus acceptée par JON desktop. Scannez un nouveau QR ou entrez un nouveau code.");
          return;
        }
        if (!silent) queueMobileLog("warn", "session.validation_failed", err.message, { code: err.code, status: err.status });
        setAuthState((current) => (current === "valid" ? "valid" : "offline"));
        setAuthError(err.message ?? "Connexion impossible");
        setConnStatus("reconnecting");
      }
    }

    verifySession();
    timer = setInterval(() => verifySession({ silent: true }), 15000);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [sessionToken, authRetryTick, dropSessionToPairing]);

  useEffect(() => {
    const onInvalidAuth = () => {
      dropSessionToPairing("La session mobile a expiré ou le serveur JON a redémarré. Reconnectez ce mobile depuis JON desktop.");
    };
    window.addEventListener("jon-mobile-auth-invalid", onInvalidAuth);
    return () => window.removeEventListener("jon-mobile-auth-invalid", onInvalidAuth);
  }, [dropSessionToPairing]);

  useEffect(() => {
    if (authState !== "valid" || !sessionToken) return;
    refreshPendingApprovals();
    const timer = setInterval(refreshPendingApprovals, 5000);
    return () => clearInterval(timer);
  }, [authState, sessionToken, refreshPendingApprovals]);

  useEventStream(authState === "valid" ? sessionToken : null, onEvent, setConnStatus);

  if (!session) {
    return h(PairingScreen, { notice: pairingNotice, onPaired: acceptSession });
  }

  if (authState !== "valid") {
    return h(SessionCheckScreen, {
      state: authState,
      error: authError,
      onRetry: () => setAuthRetryTick((n) => n + 1),
      onReconnect: () => dropSessionToPairing("Session locale effacée. Entrez un nouveau code depuis JON desktop.")
    });
  }

  const tabBadge = {
    dashboard: chatUnread || 0,
    tasks: pendingApprovals.length,
    terminal: events.filter((e) => e.type === "terminal.waiting_for_input").slice(-20)
      .filter((e) => !events.find((x) => x.type === "terminal.completed" && x.terminalId === e.terminalId && x.timestamp > e.timestamp))
      .length
  };

  const connDot = { connected: "green", connecting: "amber", reconnecting: "amber", disconnected: "red" }[connStatus] ?? "amber";

  return h("div", { className: "mobile-app" },
    h(AppHeader, { connStatus }),
    h(AlertBanner, { event: alertEvent, onDismiss: () => setAlertEvent(null) }),
    h("div", { className: "mobile-content" },
      activeTab === "dashboard" && h(DashboardTab, {
        projectId,
        token: sessionToken,
        events,
        session,
        onDisconnect: () => dropSessionToPairing(null),
        pollingInterval,
        onPollingIntervalChange: (v) => { setPollingInterval(v); savePollingInterval(v); }
      }),
      activeTab === "control" && h(ControlTab, { projectId, token: sessionToken, events, pollingInterval }),
      activeTab === "tabs" && h(BrowserTabsTab, { projectId, token: sessionToken, events }),
      activeTab === "terminal" && h(TerminalsTab, { projectId, token: sessionToken, events }),
      activeTab === "tasks" && h(TasksTab, { projectId, token: sessionToken, events, approvals: pendingApprovals, onApprovalResolved: handleApprovalResolved })
    ),
    h("nav", { className: "mobile-tabs" },
      TABS.map((tab) =>
        h("button", {
          key: tab,
          className: `mobile-tab ${activeTab === tab ? "active" : ""}`,
          onClick: () => { setActiveTab(tab); if (tab === "dashboard") setChatUnread(0); }
        },
          h("div", { className: "tab-icon-wrap" },
            h("span", { className: "tab-icon" }, TAB_ICONS[tab]),
            tabBadge[tab] ? h("span", { className: "tab-badge" }, tabBadge[tab]) : null
          ),
          h("span", { className: "tab-label" }, TAB_LABELS[tab])
        )
      )
    )
  );
}

function mount() {
  const root = document.getElementById("jon-mobile-root");
  if (!root) return;
  try {
    createRoot(root).render(h(App));
  } catch (err) {
    queueMobileLog("error", "app.mount_failed", err.message, { error: serializeLogArg(err) });
    root.innerHTML = `<div style="color:#f06060;padding:2rem;font-family:monospace;font-size:14px">JON Mobile failed to start: ${err.message}</div>`;
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
