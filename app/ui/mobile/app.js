import { createElement as h, useState, useEffect, useRef, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = ["chat", "live", "terminals", "resultats", "admin"];
const TAB_LABELS = { chat: "Chat", live: "Live", terminals: "Terminaux", resultats: "Résultats", admin: "Admin" };

const IC = (d, extra = {}) =>
  h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", ...extra }, ...d);

const TAB_ICONS = {
  chat: IC([h("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" })]),
  live: IC([h("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })]),
  terminals: IC([h("polyline", { points: "4 17 10 11 4 5" }), h("line", { x1: 12, y1: 19, x2: 20, y2: 19 })]),
  resultats: IC([h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), h("polyline", { points: "14 2 14 8 20 8" }), h("line", { x1: 9, y1: 13, x2: 15, y2: 13 }), h("line", { x1: 9, y1: 17, x2: 12, y2: 17 })]),
  admin: IC([h("circle", { cx: 12, cy: 12, r: 3 }), h("path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" })])
};

const SVG = {
  send: IC([h("line", { x1: 22, y1: 2, x2: 11, y2: 13 }), h("polygon", { points: "22 2 15 22 11 13 2 9 22 2" })], { width: 18, height: 18 }),
  rocket: IC([h("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })], { width: 18, height: 18 }),
  alert: IC([h("path", { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }), h("line", { x1: 12, y1: 9, x2: 12, y2: 13 }), h("line", { x1: 12, y1: 17, x2: 12.01, y2: 17 })], { width: 16, height: 16 }),
  terminal: IC([h("polyline", { points: "4 17 10 11 4 5" }), h("line", { x1: 12, y1: 19, x2: 20, y2: 19 })], { width: 15, height: 15 }),
  x: IC([h("line", { x1: 18, y1: 6, x2: 6, y2: 18 }), h("line", { x1: 6, y1: 6, x2: 18, y2: 18 })], { width: 16, height: 16 })
};

const BASE = "";

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
    if (s?.expiresAt && new Date(s.expiresAt) < new Date()) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}
function storeSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

// ─── API ──────────────────────────────────────────────────────────────────────

function apiHeaders(token) {
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}
const FETCH_TIMEOUT_MS = 10000;

async function apiPost(path, body, token) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: apiHeaders(token), body: JSON.stringify(body), signal: ac.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Délai dépassé — vérifiez que vous êtes sur le même réseau Wi-Fi que le desktop");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
async function apiGet(path, token) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: apiHeaders(token), signal: ac.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Délai dépassé");
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

function PairingScreen({ onPaired }) {
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
      const result = await apiPost("/api/mobile/pairing/confirm", { pairingCode, deviceName });
      cleanUrl();
      storeSession(result);
      onPaired(result);
    } catch (err) {
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
          String(terminal.recentOutput).split("\n").slice(-4).join("\n"))
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
            run.summary ? h("p", { className: "run-summary" }, run.summary) : null
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
      ws = new WebSocket(url);

      ws.onmessage = (e) => {
        if (disposed) return;
        try { term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data)); } catch {}
      };
      ws.onclose = () => {
        if (!disposed) try { term.write("\r\n\x1b[90m[Session terminée]\x1b[0m\r\n"); } catch {}
      };
      ws.onerror = () => {
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
    apiGet(`/api/mobile/projects/${projectId}/terminals`, token).then(setTerminals).catch(() => {});
  }, [projectId, token, events.length]);

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
                    String(t.recentOutput).split("\n").slice(-3).join("\n"))
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

  return h("div", { className: "tab-content admin-tab" },

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

// ─── SSE hook ─────────────────────────────────────────────────────────────────

function useEventStream(token, onEvent, onStatus) {
  useEffect(() => {
    if (!token) return;
    onStatus("connecting");
    const es = new EventSource(`/api/mobile/events?token=${encodeURIComponent(token)}&since=`);
    es.addEventListener("open", () => onStatus("connected"));
    es.addEventListener("error", () => onStatus("reconnecting"));
    es.addEventListener("mobile.event", (e) => {
      try { onEvent(JSON.parse(e.data)); } catch {}
    });
    return () => { es.close(); };
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
  const [activeTab, setActiveTab] = useState("chat");
  const [events, setEvents] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [connStatus, setConnStatus] = useState("connecting");
  const [chatUnread, setChatUnread] = useState(0);
  const [alertEvent, setAlertEvent] = useState(null);

  const projectId = "default";

  function onEvent(ev) {
    setEvents((prev) => [...prev.slice(-99), ev]);
    if (ev.type === "approval.required" && ev.payload?.approvalId) {
      setPendingApprovals((prev) => [...prev, {
        id: ev.payload.approvalId,
        actionLabel: ev.payload.actionLabel ?? "Action",
        reason: ev.payload.reason ?? "",
        riskLevel: ev.payload.riskLevel ?? "medium"
      }]);
    }
    if (ev.severity === "high") setAlertEvent(ev);
    if ((ev.type === "jon.reply" || ev.type === "jon.needs_user") && activeTab !== "chat") {
      setChatUnread((n) => n + 1);
    }
  }

  function handleApprovalResolved(id) {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
  }

  useEventStream(session?.sessionToken ?? null, onEvent, setConnStatus);

  if (!session) {
    return h(PairingScreen, { onPaired: (s) => setSession(s) });
  }

  const tabBadge = {
    chat: chatUnread || 0,
    live: pendingApprovals.length,
    terminals: events.filter((e) => e.type === "terminal.waiting_for_input").slice(-20)
      .filter((e) => !events.find((x) => x.type === "terminal.completed" && x.terminalId === e.terminalId && x.timestamp > e.timestamp))
      .length
  };

  const connDot = { connected: "green", connecting: "amber", reconnecting: "amber", disconnected: "red" }[connStatus] ?? "amber";

  return h("div", { className: "mobile-app" },
    h(AppHeader, { connStatus }),
    h(AlertBanner, { event: alertEvent, onDismiss: () => setAlertEvent(null) }),
    h("div", { className: "mobile-content" },
      activeTab === "chat" && h(ChatTab, { projectId, token: session.sessionToken, events }),
      activeTab === "live" && h(LiveTab, { projectId, token: session.sessionToken, events, approvals: pendingApprovals, onApprovalResolved: handleApprovalResolved }),
      activeTab === "terminals" && h(TerminalsTab, { projectId, token: session.sessionToken, events }),
      activeTab === "resultats" && h(ResultatsTab, { projectId, token: session.sessionToken, events }),
      activeTab === "admin" && h(AdminTab, { token: session.sessionToken, session, onDisconnect: () => setSession(null) })
    ),
    h("nav", { className: "mobile-tabs" },
      TABS.map((tab) =>
        h("button", {
          key: tab,
          className: `mobile-tab ${activeTab === tab ? "active" : ""}`,
          onClick: () => { setActiveTab(tab); if (tab === "chat") setChatUnread(0); }
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
    root.innerHTML = `<div style="color:#f06060;padding:2rem;font-family:monospace;font-size:14px">JON Mobile failed to start: ${err.message}</div>`;
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
