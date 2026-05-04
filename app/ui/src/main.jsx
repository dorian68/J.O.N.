import React, { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SUPPORTED_LOCALES,
  detectInitialLocale,
  formatTime,
  normalizeLocale,
  stringsForLocale
} from "./i18n.js";

const EMPTY_DRAFT = Object.freeze({
  objective: "",
  deliverable: "",
  constraints: "",
  forbiddenActions: "",
  mode: "",
  modeTouched: false,
  browserId: "",
  autoContinue: false
});

const CONVERSATION_STORAGE_KEY = "jon.conversations.v1";
const JON_CONVERSATION_ID = "jon";

function id(prefix = "msg") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

async function streamApi(path, options = {}, handlers = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;

  function processFrame(frame) {
    const lines = frame.split(/\r?\n/);
    let eventName = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;
    const payload = JSON.parse(dataLines.join("\n"));
    if (eventName === "reply.delta") {
      handlers.onDelta?.(payload.text ?? "");
    } else if (eventName === "turn.completed") {
      finalPayload = payload;
      handlers.onCompleted?.(payload);
    } else if (eventName === "turn.error") {
      throw new Error(payload.message ?? "Conversation stream failed.");
    } else {
      handlers.onEvent?.(eventName, payload);
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.trim()) {
        processFrame(frame);
      }
    }
  }
  if (buffer.trim()) {
    processFrame(buffer);
  }
  return finalPayload;
}

function compactText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => compactText(item)).filter(Boolean);
  }
  return String(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value, locale = "fr") {
  return formatTime(value, locale);
}

function loadStoredConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONVERSATION_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function persistStoredConversations(conversations) {
  try {
    localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(conversations.slice(0, 50)));
  } catch {
    // local persistence is a UX convenience; backend history remains authoritative for runs/turns.
  }
}

function titleFromMessage(text, fallback = "Nouvelle conversation") {
  const cleaned = compactText(text, fallback).replace(/\s+/g, " ");
  return cleaned.length > 58 ? `${cleaned.slice(0, 55)}...` : cleaned;
}

function createLocalConversation({ title = "Nouvelle conversation", messages = [], runId = null, metadata = {} } = {}) {
  const createdAt = new Date().toISOString();
  return {
    id: id("conv"),
    backendId: null,
    title,
    messages,
    runId,
    metadata,
    source: "local",
    createdAt,
    updatedAt: createdAt
  };
}

function conversationBackendId(conversation) {
  return conversation?.backendId ?? (/^conv_[a-f0-9]+$/i.test(conversation?.id ?? "") ? conversation.id : null);
}

function backendConversationToSession(conversation, existing = null) {
  const metadata = {
    ...(existing?.metadata ?? {}),
    ...(conversation.metadata ?? {})
  };
  return {
    id: existing?.id ?? conversation.id,
    backendId: conversation.id,
    title: conversation.title,
    messages: existing?.messages ?? [],
    runId: existing?.runId ?? metadata.latestRunId ?? null,
    metadata,
    source: "backend",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

function mergeBackendConversations(current = [], backend = []) {
  const next = [...current];
  for (const conversation of backend) {
    const existingIndex = next.findIndex((candidate) => conversationBackendId(candidate) === conversation.id || candidate.id === conversation.id);
    if (existingIndex >= 0) {
      next[existingIndex] = backendConversationToSession(conversation, next[existingIndex]);
    } else {
      next.push(backendConversationToSession(conversation));
    }
  }
  const withoutEmptyPlaceholders = next.filter((conversation) => {
    const isEmptyLocalPlaceholder = conversation.source === "local"
      && !conversation.backendId
      && !conversation.runId
      && (conversation.messages ?? []).length === 0;
    return !isEmptyLocalPlaceholder;
  });
  return sortConversations(withoutEmptyPlaceholders).slice(0, 50);
}

function sortConversations(conversations = []) {
  return [...conversations].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

function conversationPreview(conversation, locale = "fr") {
  const last = [...(conversation.messages ?? [])].reverse().find((message) => compactText(message.text));
  if (!last) {
    return stringsForLocale(locale).historyEmpty;
  }
  return titleFromMessage(last.text, "");
}

function currentProject(dashboard, selectedProjectId) {
  return dashboard?.projects?.find((project) => project.id === selectedProjectId)
    ?? dashboard?.projects?.[0]
    ?? null;
}

function projectRuns(dashboard, selectedProjectId) {
  return currentProject(dashboard, selectedProjectId)?.runs ?? [];
}

function latestRuns(dashboard, selectedProjectId) {
  return [...projectRuns(dashboard, selectedProjectId)].sort((left, right) => {
    const leftDate = left.updatedAt ?? left.createdAt ?? "";
    const rightDate = right.updatedAt ?? right.createdAt ?? "";
    return String(rightDate).localeCompare(String(leftDate));
  });
}

function eventLabel(event) {
  const type = String(event?.type ?? "");
  const payload = event?.payload ?? {};
  if (type === "run.started") return "Action lancée.";
  if (type === "run.settled" || type === "run.completed") return "Résultat prêt.";
  if (type === "run.failed") return "Action interrompue.";
  if (type === "approval.requested") return "Confirmation demandée.";
  if (type === "approval.resolved" || type === "approval.granted") return "Confirmation reçue.";
  if (type === "tool.executed") return `Action effectuée${payload.primitive ? ` : ${payload.primitive}` : ""}.`;
  if (type === "tool.blocked") return `Action bloquée${payload.reason ? ` : ${payload.reason}` : ""}.`;
  if (type === "tool.recovery_attempted") return "Récupération tentée.";
  if (type === "evidence.recorded") return "Preuve capturée.";
  if (type === "run.chain.decided") return "Suite évaluée.";
  if (type === "run.chain.continued") return "Suite lancée.";
  if (type === "run.chain.blocked") return "Suite en attente d’une précision.";
  if (type === "llm.degraded_mode.activated") return "Mode IA dégradé, fallback sûr activé.";
  return type ? `Événement : ${type}` : "Mise à jour reçue.";
}

function statusTone(status) {
  if (["completed", "passed", "approved_once"].includes(status)) return "ok";
  if (["failed", "error", "denied", "stop_run"].includes(status)) return "danger";
  if (["paused", "pending", "running"].includes(status)) return "warn";
  return "";
}

function technicalEventKey(event) {
  return [
    event?.type,
    event?.createdAt,
    event?.id,
    event?.payload?.approvalId,
    event?.payload?.evidenceId,
    event?.payload?.primitive
  ].filter(Boolean).join(":");
}

function buildActivityEvents(runDetail, recentActivity, run) {
  const runId = run?.id ?? null;
  const rootRunId = run?.metadata?.orchestration?.rootRunId ?? runId;
  const items = [
    ...(runDetail?.events ?? []).map((event) => ({
      ...event,
      payload: event.payload ?? {},
      source: "run"
    })),
    ...recentActivity.map((event) => ({
      ...event,
      payload: event.payload ?? {},
      source: "live"
    }))
  ];
  const seen = new Set();
  return items
    .filter((event) => !runId || !event.runId || event.runId === runId || event.runId === rootRunId || event.payload?.runId === runId)
    .filter((event) => {
      const key = technicalEventKey(event);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .slice(0, 18);
}

function buildProgressSteps({ run, pendingApprovals = [], events = [], outcome = null, t = stringsForLocale("fr") }) {
  const eventTypes = new Set(events.map((event) => event.type));
  const hasEvidence = eventTypes.has("evidence.recorded") || Boolean(outcome?.proofItems);
  const hasToolAction = events.some((event) => String(event.type ?? "").startsWith("tool."));
  const waitingApproval = run?.status === "paused" || pendingApprovals.length > 0;
  return [
    {
      id: "understood",
      label: t.progressUnderstood,
      detail: t.progressUnderstoodDetail,
      status: run ? "done" : "active"
    },
    {
      id: "approval",
      label: waitingApproval ? t.progressApprovalNeeded : t.progressApprovalVerified,
      detail: waitingApproval ? t.progressApprovalNeededDetail : t.progressApprovalVerifiedDetail,
      status: waitingApproval ? "active" : run ? "done" : "idle"
    },
    {
      id: "action",
      label: run?.status === "completed" ? t.progressActionDone : run?.status === "failed" ? t.progressActionFailed : t.progressActionRunning,
      detail: run?.summary || (hasToolAction ? t.progressActionDefault : t.progressActionPreparing),
      status: run?.status === "completed" ? "done" : run?.status === "failed" ? "blocked" : run?.status === "running" ? "active" : "idle"
    },
    {
      id: "verify",
      label: hasEvidence || run?.status === "completed" ? t.progressResultVerified : t.progressVerificationPlanned,
      detail: hasEvidence ? t.progressEvidenceLinked : t.progressWillVerify,
      status: run?.status === "completed" ? "done" : hasEvidence ? "active" : "idle"
    }
  ];
}

function buildMissionSpec(draft, { includeMode = false } = {}) {
  const missionSpec = {
    objective: draft.objective,
    deliverable: draft.deliverable,
    constraints: draft.constraints,
    forbiddenActions: draft.forbiddenActions
  };
  if (includeMode && draft.mode) {
    missionSpec.mode = draft.mode;
  }
  if (draft.browserId) {
    missionSpec.parameters = {
      browserLaunch: { browserId: draft.browserId }
    };
  }
  return missionSpec;
}

function normalizePreflight(preflight) {
  return preflight?.understanding ?? preflight ?? null;
}

function conversationTurnsToMessages(turns = []) {
  return [...(turns ?? [])].map((turn) => {
    const payload = turn.payload ?? {};
    if (turn.role === "user") {
      return {
        id: turn.id,
        role: "user",
        kind: "mission",
        text: turn.content,
        createdAt: turn.createdAt
      };
    }
    if (turn.kind === "terminal_alert") {
      return {
        id: turn.id,
        role: "assistant",
        kind: "terminal_alert",
        text: turn.content,
        terminalAlert: {
          terminalId: payload.terminalId,
          terminalLabel: payload.terminalLabel,
          terminalStatus: payload.terminalStatus,
          agentKind: payload.agentKind,
          decisionAction: payload.decisionAction,
          requiresApproval: payload.requiresApproval,
          reason: payload.reason,
          recentOutput: payload.recentOutput,
          autonomyMode: payload.autonomyMode,
          missionObjective: payload.missionObjective,
          suggestedInput: payload.suggestedInput ?? null,
          suggestionReasoning: payload.suggestionReasoning ?? null,
          projectId: payload.projectId ?? turn.projectId
        },
        tone: payload.requiresApproval ? "warn" : payload.terminalStatus === "error" ? "danger" : "neutral",
        createdAt: turn.createdAt
      };
    }
    if (turn.kind === "terminal_started") {
      return {
        id: turn.id,
        role: "assistant",
        kind: "terminal_started",
        text: turn.content,
        terminalEvent: {
          terminalId: payload.terminalId,
          terminalLabel: payload.terminalLabel,
          agentKind: payload.agentKind,
          autonomyMode: payload.autonomyMode
        },
        createdAt: turn.createdAt
      };
    }
    if (turn.kind === "terminal_completion") {
      return {
        id: turn.id,
        role: "assistant",
        kind: "terminal_completion",
        text: turn.content,
        terminalEvent: {
          terminalId: payload.terminalId,
          terminalLabel: payload.terminalLabel,
          agentKind: payload.agentKind,
          exitCode: payload.exitCode,
          recentOutput: payload.recentOutput
        },
        createdAt: turn.createdAt
      };
    }
    if (turn.kind === "terminal_auto_action") {
      return {
        id: turn.id,
        role: "assistant",
        kind: "terminal_auto_action",
        text: turn.content,
        terminalEvent: {
          terminalId: payload.terminalId,
          terminalLabel: payload.terminalLabel,
          injectedInput: payload.injectedInput,
          reasoning: payload.reasoning,
          confidence: payload.confidence
        },
        createdAt: turn.createdAt
      };
    }
    if (turn.kind === "mission_paused") {
      return {
        id: turn.id,
        role: "assistant",
        kind: "mission_paused",
        text: turn.content,
        missionPause: {
          runId: payload.runId,
          approvalId: payload.approvalId,
          actionLabel: payload.actionLabel,
          reason: payload.reason
        },
        createdAt: turn.createdAt
      };
    }
    return {
      id: turn.id,
      role: "assistant",
      kind: "turn",
      text: turn.content,
      turn: {
        intentType: payload.intentType,
        action: payload.action,
        uiBlocks: payload.uiBlocks ?? [],
        requiresClarification: payload.requiresClarification,
        clarificationQuestion: payload.clarificationQuestion,
        clarificationOptions: payload.clarificationOptions ?? [],
        choiceRequest: payload.choiceRequest ?? null,
        clarificationResolved: payload.clarificationResolved ?? null,
        generationMode: turn.metadata?.generationMode,
        fallbackReason: turn.metadata?.fallbackReason,
        llm: turn.metadata?.llm
      },
      uiBlocks: payload.uiBlocks ?? [],
      preflight: payload.preflight ?? null,
      missionDraft: payload.missionDraft ?? null,
      tone: payload.requiresClarification ? "warn" : payload.action === "refuse" ? "danger" : "",
      createdAt: turn.createdAt
    };
  });
}

// ─── PairDeviceModal ──────────────────────────────────────────────────────────

function PairDeviceModal({ t, onClose }) {
  const [pairingData, setPairingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setPairingData(null);
    try {
      const data = await api("/api/mobile/pairing/start", { method: "POST" });
      setPairingData(data);
      const ttl = Math.round((new Date(data.expiresAt) - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, ttl));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { generate(); }, []);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  async function copyLink() {
    const toCopy = pairingData?.pairingUrl ?? pairingData?.lanUrl ?? `${window.location.origin}/mobile/`;
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  const expired = secondsLeft === 0;
  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : null;
  const secs = secondsLeft !== null ? String(secondsLeft % 60).padStart(2, "0") : null;
  const displayUrl = pairingData?.lanUrl ? `${pairingData.lanUrl}/mobile/` : `${window.location.origin}/mobile/`;

  return (
    <div className="pair-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pair-modal">
        <div className="pair-modal-header">
          <h2 className="pair-modal-title">{t.pairDeviceTitle}</h2>
          <button type="button" className="ghost icon-only" onClick={onClose} aria-label={t.pairDeviceClose}>✕</button>
        </div>

        <p className="pair-modal-subtitle">{t.pairDeviceSubtitle}</p>

        {loading ? (
          <div className="pair-modal-loading">{t.pairDeviceLoading}</div>
        ) : error ? (
          <div className="pair-modal-error">{t.pairDeviceError} : {error}</div>
        ) : pairingData ? (
          <>
            {pairingData.lanEnabled === false ? (
              <div className="pair-modal-lan-warning">
                <strong>⚠ Serveur en mode local uniquement</strong>
                <span>Le mobile ne peut pas atteindre ce serveur. Redémarre avec <code>COWORK_LAN=1</code> pour activer l'accès réseau.</span>
              </div>
            ) : null}

            {pairingData.qrDataUri ? (
              <div className="pair-modal-qr">
                <img src={pairingData.qrDataUri} alt="QR pairing" className="pair-qr-img" />
                <span className="pair-qr-hint">{t.pairDeviceQrHint}</span>
              </div>
            ) : null}

            <div className="pair-modal-url-row">
              <span className="pair-modal-label">{t.pairDeviceLanUrl}</span>
              <a className="pair-modal-url" href={displayUrl} target="_blank" rel="noreferrer">{displayUrl}</a>
              <button type="button" className="ghost small" onClick={copyLink}>
                {copied ? t.pairDeviceCopied : t.pairDeviceCopy}
              </button>
            </div>

            {pairingData.publicUrl ? (
              <div className="pair-modal-url-row">
                <span className="pair-modal-label">{t.pairDevicePublicUrl}</span>
                <span className="pair-modal-url">{pairingData.publicUrl}/mobile/</span>
              </div>
            ) : null}

            <div className={`pair-modal-code-block ${expired ? "expired" : ""}`}>
              <span className="pair-modal-code-label">{t.pairDeviceCode}</span>
              <span className="pair-modal-code">{pairingData.pairingCode}</span>
              {!expired && secondsLeft !== null ? (
                <span className="pair-modal-countdown">{t.pairDeviceExpires} {mins}:{secs}</span>
              ) : null}
              {expired ? (
                <span className="pair-modal-expired">{t.pairDeviceExpired}</span>
              ) : null}
            </div>
            <button type="button" className="secondary small" onClick={generate} style={{ alignSelf: "flex-start" }}>
              {t.pairDeviceNew}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── SettingsModal ────────────────────────────────────────────────────────────

function SettingsModal({ t, projectId, agentConfiguration, availableApplications, availableBrowsers, project, llmGatewayStatus, onClose }) {
  const existing = agentConfiguration?.guardrails ?? {};
  const [trustedApps, setTrustedApps] = useState(() => new Set(existing.trustedApplications ?? []));
  const [trustedBrowsers, setTrustedBrowsers] = useState(() => new Set(existing.trustedBrowserIds ?? []));
  const [domainsText, setDomainsText] = useState(() => (project?.allowlistedDomains ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  function toggleApp(appId) {
    setTrustedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId); else next.add(appId);
      return next;
    });
    setSaved(false);
  }

  function toggleBrowser(browserId) {
    setTrustedBrowsers((prev) => {
      const next = new Set(prev);
      if (next.has(browserId)) next.delete(browserId); else next.add(browserId);
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const domains = domainsText.split("\n").map((d) => d.trim().toLowerCase()).filter(Boolean);
      await Promise.all([
        api("/api/agent/config", {
          method: "PUT",
          body: JSON.stringify({
            guardrails: {
              ...existing,
              trustedApplications: [...trustedApps],
              trustedBrowserIds: [...trustedBrowsers]
            }
          })
        }),
        projectId ? api(`/api/projects/${encodeURIComponent(projectId)}/allowlisted-domains`, {
          method: "PUT",
          body: JSON.stringify({ domains })
        }) : Promise.resolve()
      ]);
      setSaved(true);
    } catch {
      setSaveError("Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pair-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pair-modal" style={{ maxWidth: "520px", maxHeight: "80vh", overflowY: "auto" }}>
        <div className="pair-modal-header">
          <h2>{t.settingsTitle}</h2>
          <button type="button" className="ghost icon-only" onClick={onClose}>✕</button>
        </div>

        {availableApplications.length > 0 ? (
          <section style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "13px", marginBottom: "6px" }}>{t.settingsTrustedApps}</h3>
            <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{t.settingsTrustedAppsHint}</p>
            <div className="settings-toggle-list">
              {availableApplications.map((app) => (
                <label key={app.id} className="settings-toggle-row">
                  <span className="settings-toggle-label">{app.label ?? app.id}</span>
                  <input
                    type="checkbox"
                    checked={trustedApps.has(app.id)}
                    onChange={() => toggleApp(app.id)}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {availableBrowsers.length > 0 ? (
          <section style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "13px", marginBottom: "6px" }}>{t.settingsTrustedBrowsers}</h3>
            <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{t.settingsTrustedBrowsersHint}</p>
            <div className="settings-toggle-list">
              {availableBrowsers.map((browser) => (
                <label key={browser.id} className="settings-toggle-row">
                  <span className="settings-toggle-label">{browser.label ?? browser.id}</span>
                  <input
                    type="checkbox"
                    checked={trustedBrowsers.has(browser.id)}
                    onChange={() => toggleBrowser(browser.id)}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginBottom: "20px" }}>
          <h3 style={{ fontSize: "13px", marginBottom: "6px" }}>{t.settingsAllowedDomains}</h3>
          <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>{t.settingsAllowedDomainsHint}</p>
          <textarea
            className="settings-domains-textarea"
            value={domainsText}
            onChange={(e) => { setDomainsText(e.target.value); setSaved(false); }}
            placeholder={t.settingsAllowedDomainsPlaceholder}
            rows={5}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "12px", resize: "vertical" }}
          />
        </section>

        {llmGatewayStatus ? (
          <section style={{ marginBottom: "20px", padding: "10px 12px", background: "var(--bg-strong)", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>Moteur de raisonnement</h3>
            {llmGatewayStatus.effectiveMode === "mock_only" || llmGatewayStatus.effectiveMode === "degraded_mock_only" ? (
              <p style={{ fontSize: "12px", color: "var(--warn, orange)", lineHeight: 1.5 }}>
                ⚠ Mode simulation (hors-ligne) actif — JON ne peut pas raisonner en temps réel sur des missions complexes.<br />
                Pour activer un vrai LLM, lancez JON avec <code style={{ background: "var(--bg)", padding: "1px 4px", borderRadius: "4px" }}>COWORK_LLM_PROVIDER_MODE=openai_compatible</code> et configurez votre clé API.
              </p>
            ) : (
              <p style={{ fontSize: "12px", color: "var(--success, green)" }}>
                ✓ LLM actif — Mode : <strong>{llmGatewayStatus.effectiveMode}</strong>
              </p>
            )}
          </section>
        ) : null}

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button type="button" className="primary small" onClick={handleSave} disabled={saving}>
            {saving ? t.settingsSaving : t.settingsSave}
          </button>
          <button type="button" className="ghost small" onClick={onClose}>{t.settingsClose}</button>
          {saved ? <span style={{ fontSize: "12px", color: "var(--success, green)" }}>{t.settingsSaved} ✓</span> : null}
          {saveError ? <span style={{ fontSize: "12px", color: "var(--danger, red)" }}>{saveError}</span> : null}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [locale, setLocale] = useState(() => detectInitialLocale());
  const t = useMemo(() => stringsForLocale(locale), [locale]);
  const [dashboard, setDashboard] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [runDetail, setRunDetail] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [confirmedDraft, setConfirmedDraft] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState({ loading: true, reviewing: false, starting: false, approvalId: null });
  const [feedback, setFeedback] = useState(null);
  const [liveStatus, setLiveStatus] = useState("connecting");
  const [recentActivity, setRecentActivity] = useState([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workspacePanel, setWorkspacePanel] = useState(null);
  const [terminalViewMode, setTerminalViewMode] = useState("cards");
  const [terminalRequestedView, setTerminalRequestedView] = useState(null);
  const [terminalOverlayId, setTerminalOverlayId] = useState(null);
  const [terminalOverlayFullscreen, setTerminalOverlayFullscreen] = useState(false);
  const [historyHydratedProjectId, setHistoryHydratedProjectId] = useState(null);
  const [conversationSessions, setConversationSessions] = useState(() => {
    const stored = sortConversations(loadStoredConversations());
    return stored;
  });
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [jonQueue, setJonQueue] = useState([]);
  const [jonUnread, setJonUnread] = useState(0);
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedProjectIdRef = useRef(null);
  const selectedRunIdRef = useRef(null);
  const activeConversationIdRef = useRef(null);
  const terminalViewPreferenceRef = useRef(null);
  const transcriptRef = useRef(null);
  const composerInputRef = useRef(null);

  const project = useMemo(() => currentProject(dashboard, selectedProjectId), [dashboard, selectedProjectId]);
  const runs = useMemo(() => latestRuns(dashboard, selectedProjectId), [dashboard, selectedProjectId]);
  const configuredTerminalWorkspaceView = dashboard?.agentConfiguration?.guardrails?.terminalWorkspaceView ?? "cards";
  const availableBrowsers = dashboard?.desktopActionSupport?.availableBrowsers ?? [];
  const pendingApprovals = runDetail?.pendingApprovals ?? [];
  const run = runDetail?.run ?? null;
  const activeConversation = conversationSessions.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeConversationBackendId = conversationBackendId(activeConversation);
  const hasConversation = messages.length > 0 || Boolean(selectedRunId) || activeConversationId === JON_CONVERSATION_ID;
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const activityEvents = useMemo(
    () => buildActivityEvents(runDetail, recentActivity, run),
    [recentActivity, run, runDetail]
  );

  useEffect(() => {
    try {
      localStorage.setItem("jon.locale", locale);
    } catch {
      // Ignore local preference persistence failures.
    }
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    persistStoredConversations(conversationSessions);
  }, [conversationSessions]);

  useEffect(() => {
    const backendConversations = dashboard?.conversation?.conversations ?? [];
    if (backendConversations.length === 0) {
      return;
    }
    setConversationSessions((current) => {
      const merged = mergeBackendConversations(current, backendConversations);
      return merged;
    });
  }, [dashboard?.conversation?.conversations]);

  useEffect(() => {
    const active = conversationSessions.find((conversation) => conversation.id === activeConversationId);
    const backendId = conversationBackendId(active);
    if (!backendId || !selectedProjectId || (active?.messages ?? []).length > 0) {
      return;
    }
    let cancelled = false;
    api(`/api/projects/${selectedProjectId}/conversation?limit=80&conversationId=${encodeURIComponent(backendId)}`)
      .then((payload) => {
        if (!cancelled) {
          setMessages(conversationTurnsToMessages(payload.turns ?? []));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({ tone: "danger", text: error.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, conversationSessions, selectedProjectId]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    const messageFingerprint = JSON.stringify(messages.map((message) => ({
      id: message.id,
      role: message.role,
      kind: message.kind,
      text: message.text,
      streaming: Boolean(message.streaming)
    })));
    setConversationSessions((current) => {
      const index = current.findIndex((conversation) => conversation.id === activeConversationId);
      if (index < 0) {
        return current;
      }
      const active = current[index];
      const activeFingerprint = JSON.stringify((active.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        kind: message.kind,
        text: message.text,
        streaming: Boolean(message.streaming)
      })));
      if (activeFingerprint === messageFingerprint && (active.runId ?? null) === (selectedRunId ?? null)) {
        return current;
      }
      const firstUser = messages.find((message) => message.role === "user" && compactText(message.text))?.text;
      const defaultTitles = new Set([
        stringsForLocale("fr").newConversation,
        stringsForLocale("en").newConversation
      ]);
      const next = [...current];
      next[index] = {
        ...active,
        title: firstUser && (!active.title || defaultTitles.has(active.title)) ? titleFromMessage(firstUser, t.newConversation) : active.title,
        messages,
        runId: selectedRunId ?? active.runId ?? null,
        updatedAt: new Date().toISOString()
      };
      return sortConversations(next).slice(0, 50);
    });
  }, [activeConversationId, messages, selectedRunId, t.newConversation]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    if (activeConversationId === JON_CONVERSATION_ID) {
      setJonUnread(0);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!configuredTerminalWorkspaceView) {
      return;
    }
    if (
      terminalViewPreferenceRef.current == null
      || terminalViewPreferenceRef.current !== configuredTerminalWorkspaceView
    ) {
      terminalViewPreferenceRef.current = configuredTerminalWorkspaceView;
      setTerminalViewMode(configuredTerminalWorkspaceView);
    }
  }, [configuredTerminalWorkspaceView]);

  useEffect(() => {
    if (!selectedProjectId || historyHydratedProjectId === selectedProjectId) {
      return;
    }
    setHistoryHydratedProjectId(selectedProjectId);
  }, [historyHydratedProjectId, selectedProjectId]);

  async function selectConversation(conversationId) {
    if (conversationId === JON_CONVERSATION_ID) {
      setActiveConversationId(JON_CONVERSATION_ID);
      setMessages(jonQueue);
      setJonQueue([]);
      setSelectedRunId(null);
      setRunDetail(null);
      setRecentActivity([]);
      setPreflight(null);
      setConfirmedDraft(null);
      setFeedback(null);
      selectedRunIdRef.current = null;
      return;
    }
    const conversation = conversationSessions.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      return;
    }
    setActiveConversationId(conversation.id);
    const backendId = conversationBackendId(conversation);
    if (backendId && selectedProjectId) {
      try {
        const payload = await api(`/api/projects/${selectedProjectId}/conversation?limit=80&conversationId=${encodeURIComponent(backendId)}`);
        setMessages(conversationTurnsToMessages(payload.turns ?? []));
      } catch (error) {
        setFeedback({ tone: "danger", text: error.message });
        setMessages(conversation.messages ?? []);
      }
    } else {
      setMessages(conversation.messages ?? []);
    }
    setRecentActivity([]);
    setPreflight(null);
    setConfirmedDraft(null);
    setFeedback(null);
    selectedRunIdRef.current = conversation.runId ?? null;
    setSelectedRunId(conversation.runId ?? null);
    if (conversation.runId) {
      setBusy((current) => ({ ...current, loading: true }));
      try {
        setRunDetail(await api(`/api/runs/${conversation.runId}`));
      } catch (error) {
        setFeedback({ tone: "danger", text: error.message });
      } finally {
        setBusy((current) => ({ ...current, loading: false }));
      }
    } else {
      setRunDetail(null);
    }
  }

  async function refreshDashboard({ explicitRunId = undefined, preferActive = false } = {}) {
    const projectQuery = selectedProjectIdRef.current
      ? `?projectId=${encodeURIComponent(selectedProjectIdRef.current)}`
      : "";
    const nextDashboard = await api(`/api/dashboard${projectQuery}`);
    const currentProjectId = selectedProjectIdRef.current;
    const nextProjectId = nextDashboard.projects?.some((candidate) => candidate.id === currentProjectId)
      ? currentProjectId
      : nextDashboard.selectedProjectId ?? nextDashboard.projects?.[0]?.id ?? null;
    const nextRuns = latestRuns(nextDashboard, nextProjectId);
    const activeRun = nextRuns.find((candidate) => (nextDashboard.activeRunIds ?? []).includes(candidate.id)) ?? null;
    let nextRunId = explicitRunId === undefined ? selectedRunIdRef.current : explicitRunId;

    if (preferActive && activeRun) {
      nextRunId = activeRun.id;
    }
    if (nextRunId && !nextRuns.some((candidate) => candidate.id === nextRunId)) {
      nextRunId = null;
    }

    startTransition(() => {
      setDashboard(nextDashboard);
      setSelectedProjectId(nextProjectId);
      setSelectedRunId(nextRunId);
    });
    selectedProjectIdRef.current = nextProjectId;
    selectedRunIdRef.current = nextRunId;

    if (nextRunId) {
      setRunDetail(await api(`/api/runs/${nextRunId}`));
    } else {
      setRunDetail(null);
    }
  }

  useEffect(() => {
    let mounted = true;
    refreshDashboard({ preferActive: true })
      .catch((error) => {
        if (mounted) setFeedback({ tone: "danger", text: error.message });
      })
      .finally(() => {
        if (mounted) setBusy((current) => ({ ...current, loading: false }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const element = transcriptRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages, runDetail, busy.reviewing, busy.starting]);

  useEffect(() => {
    if (!window.EventSource) {
      setLiveStatus("polling");
      const poller = window.setInterval(() => {
        refreshDashboard().catch(() => setLiveStatus("degraded"));
      }, 5000);
      return () => window.clearInterval(poller);
    }

    const stream = new EventSource("/api/events");
    stream.onmessage = (message) => {
      setLiveStatus("live");
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        event = { type: "stream.message", createdAt: new Date().toISOString(), payload: {} };
      }
      if (event.type && event.type !== "stream.connected" && !event.type.startsWith("conversation.")) {
        const runId = event.payload?.runId ?? event.payload?.nextRunId ?? null;
        if (runId && !selectedRunIdRef.current) {
          selectedRunIdRef.current = runId;
          setSelectedRunId(runId);
        }
        const pushJonMessage = (msg) => {
          const full = { id: id(), createdAt: new Date().toISOString(), ...msg };
          if (activeConversationIdRef.current === JON_CONVERSATION_ID) {
            setMessages((prev) => [...prev, full].slice(-32));
          } else {
            setJonQueue((prev) => [...prev, full].slice(-32));
            setJonUnread((n) => n + 1);
          }
        };
        if (event.type === "workspace.terminal.conversation_alert") {
          const payload = event.payload ?? {};
          pushJonMessage({
            role: "assistant",
            kind: "terminal_alert",
            text: payload.alertText ?? `Terminal ${payload.terminalLabel ?? ""} : ${payload.terminalStatus ?? ""}`,
            terminalAlert: {
              terminalId: payload.terminalId,
              terminalLabel: payload.terminalLabel,
              terminalStatus: payload.terminalStatus,
              agentKind: payload.agentKind,
              decisionAction: payload.decisionAction,
              requiresApproval: payload.requiresApproval,
              reason: payload.reason,
              recentOutput: payload.recentOutput,
              autonomyMode: payload.autonomyMode,
              missionObjective: payload.missionObjective,
              suggestedInput: payload.suggestedInput ?? null,
              suggestionReasoning: payload.suggestionReasoning ?? null,
              projectId: payload.projectId
            },
            tone: payload.requiresApproval ? "warn" : payload.terminalStatus === "error" ? "danger" : "neutral"
          });
        }
        if (event.type === "workspace.terminal.conversation_started") {
          const payload = event.payload ?? {};
          pushJonMessage({
            role: "assistant",
            kind: "terminal_started",
            text: payload.startText ?? `Terminal ${payload.terminalLabel ?? ""} démarré.`,
            terminalEvent: {
              terminalId: payload.terminalId,
              terminalLabel: payload.terminalLabel,
              agentKind: payload.agentKind,
              autonomyMode: payload.autonomyMode
            }
          });
        }
        if (event.type === "workspace.terminal.conversation_completion") {
          const payload = event.payload ?? {};
          pushJonMessage({
            role: "assistant",
            kind: "terminal_completion",
            text: `Terminal **${payload.terminalLabel ?? ""}** terminé.`,
            terminalEvent: {
              terminalId: payload.terminalId,
              terminalLabel: payload.terminalLabel,
              agentKind: payload.agentKind ?? null,
              exitCode: null,
              recentOutput: null
            }
          });
        }
        if (event.type === "workspace.terminal.auto_action") {
          const payload = event.payload ?? {};
          pushJonMessage({
            role: "assistant",
            kind: "terminal_auto_action",
            text: `JON a répondu au terminal **${payload.terminalLabel ?? ""}** : \`${payload.injectedInput ?? ""}\``,
            terminalEvent: {
              terminalId: payload.terminalId,
              terminalLabel: payload.terminalLabel,
              injectedInput: payload.injectedInput,
              reasoning: null,
              confidence: null
            }
          });
        }
        if (event.type === "mission.paused_for_manual_action") {
          const payload = event.payload ?? {};
          pushJonMessage({
            role: "assistant",
            kind: "mission_paused",
            text: `⏸ **JON est en pause** — action manuelle requise : **${payload.actionLabel ?? ""}**`,
            missionPause: {
              runId: payload.runId,
              approvalId: payload.approvalId,
              actionLabel: payload.actionLabel,
              reason: null
            }
          });
        }
        setRecentActivity((current) => [
          {
            ...event,
            id: event.id ?? id("activity"),
            payload: event.payload ?? {}
          },
          ...current
        ].slice(0, 24));
      }
      refreshDashboard({ preferActive: Boolean(event.payload?.runId) }).catch(() => setLiveStatus("degraded"));
    };
    stream.onerror = () => setLiveStatus("reconnecting");
    stream.onopen = () => setLiveStatus("live");

    const poller = window.setInterval(() => {
      refreshDashboard().catch(() => setLiveStatus("degraded"));
    }, 15000);

    return () => {
      stream.close();
      window.clearInterval(poller);
    };
  }, []);

  function appendMessage(message) {
    const nextMessage = { id: id(), createdAt: new Date().toISOString(), ...message };
    setMessages((current) => [
      ...current,
      nextMessage
    ].slice(-32));
    return nextMessage.id;
  }

  function updateMessage(messageId, patchOrUpdater) {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(message) : patchOrUpdater;
      return {
        ...message,
        ...patch
      };
    }));
  }

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreflight(null);
    setConfirmedDraft(null);
  }

  function startNewMission() {
    const nextConversation = createLocalConversation({ title: t.newConversation });
    setConversationSessions((current) => sortConversations([nextConversation, ...current]).slice(0, 50));
    setActiveConversationId(nextConversation.id);
    setSelectedRunId(null);
    selectedRunIdRef.current = null;
    setRunDetail(null);
    setPreflight(null);
    setConfirmedDraft(null);
    setMessages([]);
    setRecentActivity([]);
    setHistoryHydratedProjectId(selectedProjectId);
    setDraft({ ...EMPTY_DRAFT });
    setFeedback(null);
  }

  async function stageClarificationAnswer(answer) {
    const text = compactText(answer);
    if (!text) {
      composerInputRef.current?.focus();
      return;
    }
    if (busy.reviewing) {
      setDraft((current) => ({
        ...current,
        objective: text
      }));
      setFeedback({ tone: "info", text: t.clarificationReady });
      requestAnimationFrame(() => composerInputRef.current?.focus());
      return;
    }
    await submitConversationMessage(text, { source: "clarification" });
  }

  async function openRun(runId) {
    setSelectedRunId(runId);
    selectedRunIdRef.current = runId;
    setMessages([]);
    setRecentActivity([]);
    setPreflight(null);
    setConfirmedDraft(null);
    setBusy((current) => ({ ...current, loading: true }));
    try {
      setRunDetail(await api(`/api/runs/${runId}`));
    } catch (error) {
      setFeedback({ tone: "danger", text: error.message });
    } finally {
      setBusy((current) => ({ ...current, loading: false }));
    }
  }

  async function submitConversationMessage(rawObjective, { source = "composer" } = {}) {
    const objective = compactText(rawObjective);
    if (!objective || !selectedProjectId) {
      return;
    }
    const draftForRequest = {
      ...draft,
      objective
    };
    setDraft((current) => ({
      ...current,
      objective: ""
    }));
    setFeedback(null);
    setPreflight(null);
    setConfirmedDraft(null);
    setSelectedRunId(null);
    selectedRunIdRef.current = null;
    setRunDetail(null);
    let conversationIdForRequest = activeConversationId;
    let conversationForRequest = conversationSessions.find((conversation) => conversation.id === conversationIdForRequest) ?? null;
    if (!conversationForRequest) {
      conversationForRequest = createLocalConversation({
        title: titleFromMessage(objective, t.newConversation),
        messages: []
      });
      conversationIdForRequest = conversationForRequest.id;
      setConversationSessions((current) => sortConversations([conversationForRequest, ...current]).slice(0, 50));
      setActiveConversationId(conversationIdForRequest);
    }
    appendMessage({ role: "user", kind: "mission", text: objective });
    const backendConversationId = conversationBackendId(conversationForRequest);
    const assistantMessageId = appendMessage({
      role: "assistant",
      kind: "turn",
      text: "",
      streaming: true,
      turn: null,
      uiBlocks: []
    });
    setBusy((current) => ({ ...current, reviewing: true }));
    try {
      const response = await streamApi(`/api/projects/${selectedProjectId}/conversation/stream`, {
        method: "POST",
        body: JSON.stringify({
          message: objective,
          conversationId: backendConversationId,
          context: {
            conversationId: backendConversationId,
            source,
            recentMessages: messages.slice(-8).map((message) => ({
              role: message.role,
              kind: message.kind,
              text: message.text
            }))
          },
          missionSpec: buildMissionSpec(draftForRequest, {
            includeMode: draftForRequest.modeTouched && Boolean(draftForRequest.mode)
          })
        })
      }, {
        onDelta: (text) => {
          updateMessage(assistantMessageId, (message) => ({
            text: `${message.text ?? ""}${text}`,
            streaming: true
          }));
        }
      });
      if (!response?.turn) {
        throw new Error("Conversation stream ended without a turn payload.");
      }
      setPreflight(response.preflight ?? null);
      setConfirmedDraft(response.missionDraft ?? null);
      if (response.conversation && conversationIdForRequest) {
        setConversationSessions((current) => sortConversations(current.map((conversation) => {
          if (conversation.id !== conversationIdForRequest) {
            return conversation;
          }
          return {
            ...conversation,
            backendId: response.conversation.id,
            title: response.conversation.title ?? conversation.title,
            source: "backend",
            updatedAt: response.conversation.updatedAt ?? new Date().toISOString()
          };
        })));
      }
      if (response.autoLaunchedRunId) {
        selectedRunIdRef.current = response.autoLaunchedRunId;
        setSelectedRunId(response.autoLaunchedRunId);
      }
      updateMessage(assistantMessageId, {
        turn: response.turn,
        uiBlocks: response.turn?.uiBlocks ?? [],
        preflight: response.preflight,
        missionDraft: response.missionDraft,
        text: response.turn?.reply ?? t.done,
        streaming: false,
        tone: response.turn?.requiresClarification || normalizePreflight(response.preflight)?.requiresClarification ? "warn" : response.turn?.action === "refuse" ? "danger" : "ok"
      });
    } catch (error) {
      updateMessage(assistantMessageId, {
        kind: "error",
        text: error.message,
        tone: "danger",
        streaming: false,
        meta: t.error
      });
    } finally {
      setBusy((current) => ({ ...current, reviewing: false }));
    }
  }

  async function reviewMission() {
    await submitConversationMessage(draft.objective.trim(), { source: "composer" });
  }

  async function startMission() {
    if (!selectedProjectId || !preflight || busy.starting) {
      return;
    }
    const understanding = normalizePreflight(preflight);
    if (understanding?.requiresClarification) {
      setFeedback({ tone: "warn", text: understanding.clarificationQuestion || t.clarification });
      return;
    }
    setBusy((current) => ({ ...current, starting: true }));
    setFeedback(null);
    try {
      const missionDraft = confirmedDraft ?? buildMissionSpec(draft, {
        includeMode: draft.modeTouched && Boolean(draft.mode)
      });
      const response = await api(`/api/projects/${selectedProjectId}/missions`, {
        method: "POST",
        body: JSON.stringify({
          missionSpec: missionDraft,
          preflight,
          conversationId: activeConversationBackendId,
          orchestration: {
            autoContinue: Boolean(draft.autoContinue),
            maxAutoRuns: draft.autoContinue ? 2 : 1
          }
        })
      });
      selectedRunIdRef.current = response.runId;
      setSelectedRunId(response.runId);
      if (activeConversationId) {
        setConversationSessions((current) => sortConversations(current.map((conversation) => {
          if (conversation.id !== activeConversationId) {
            return conversation;
          }
          return {
            ...conversation,
            backendId: response.conversation?.id ?? conversation.backendId,
            runId: response.runId,
            metadata: {
              ...(conversation.metadata ?? {}),
              latestRunId: response.runId
            },
            updatedAt: response.conversation?.updatedAt ?? new Date().toISOString()
          };
        })));
      }
      await refreshDashboard({ explicitRunId: response.runId });
    } catch (error) {
      appendMessage({ role: "assistant", kind: "error", text: error.message, tone: "danger", meta: t.error });
    } finally {
      setBusy((current) => ({ ...current, starting: false }));
    }
  }

  async function sendTerminalInput(projectId, terminalId, input, { approved = false } = {}) {
    if (!input?.trim() || !projectId || !terminalId) {
      return;
    }
    try {
      await api(`/api/projects/${projectId}/workspace/terminals/${encodeURIComponent(terminalId)}/input`, {
        method: "POST",
        body: JSON.stringify({ input: input.trim(), approved })
      });
      appendMessage({
        role: "user",
        kind: "terminal_reply",
        text: `[Terminal reply → ${input.trim()}]`,
        meta: t.terminalReplySent
      });
      await refreshDashboard();
    } catch (error) {
      appendMessage({ role: "assistant", kind: "error", text: error.message, tone: "danger", meta: t.error });
    }
  }

  async function resolveApproval(approval, decision) {
    setBusy((current) => ({ ...current, approvalId: approval.id }));
    try {
      await api(`/api/approvals/${approval.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, rationale: null })
      });
      appendMessage({
        role: "user",
        kind: "approval",
        text: decision === "denied" ? t.deny : decision === "stop_run" ? t.stopRun : t.approveOnce,
        meta: t.decision
      });
      await refreshDashboard();
    } catch (error) {
      appendMessage({ role: "assistant", kind: "error", text: error.message, tone: "danger", meta: t.error });
    } finally {
      setBusy((current) => ({ ...current, approvalId: null }));
    }
  }

  function openTerminalWorkspace(view = null) {
    setTerminalRequestedView(view);
    setWorkspacePanel("terminals");
  }

  function openTraceWorkspace() {
    setWorkspacePanel("trace");
  }

  function toggleTerminalSidebar() {
    setWorkspacePanel((current) => {
      const next = current === "terminals" ? null : "terminals";
      if (!next) {
        setTerminalRequestedView(null);
        setTerminalOverlayId(null);
        setTerminalOverlayFullscreen(false);
      }
      return next;
    });
  }

  function toggleInspectorSidebar() {
    setWorkspacePanel((current) => (current === "trace" ? null : "trace"));
  }

  function openBrowserWorkspace() {
    setWorkspacePanel("browser");
  }

  function toggleBrowserSidebar() {
    setWorkspacePanel((current) => (current === "browser" ? null : "browser"));
  }

  function openTerminalOverlay(terminalId) {
    setTerminalOverlayId(terminalId);
    setTerminalOverlayFullscreen(false);
  }

  function closeTerminalOverlay() {
    setTerminalOverlayId(null);
    setTerminalOverlayFullscreen(false);
  }

  async function stopWorkspaceTerminal(terminalId) {
    if (!selectedProjectId) return;
    try {
      await api(`/api/projects/${selectedProjectId}/workspace/terminals/${encodeURIComponent(terminalId)}/stop`, {
        method: "POST",
        body: JSON.stringify({})
      });
      refreshDashboard();
    } catch {
      // ignore — terminal may already be stopped
    }
  }

  return (
    <div className="react-cowork-shell">
      <header className="react-cowork-topbar">
        <button type="button" className="brand-button" onClick={startNewMission}>
          <img src="/assets/cowork-mark.svg" alt="" />
          <span>
            <strong>{t.jonDesktop}</strong>
            <small>{t.appSubtitle}</small>
          </span>
        </button>
        <div className="react-topbar-actions">
          <label className="locale-select">
            <span>{t.language}</span>
            <select value={locale} onChange={(event) => setLocale(normalizeLocale(event.target.value))}>
              {SUPPORTED_LOCALES.map((candidate) => (
                <option key={candidate} value={candidate}>{candidate === "fr" ? t.french : t.english}</option>
              ))}
            </select>
          </label>
          <span className={`live-pill ${liveStatus === "reconnecting" ? "degraded" : liveStatus}`}>{liveStatus === "live" ? t.live : liveStatus === "connecting" ? t.connecting : liveStatus === "reconnecting" ? (t.reconnecting ?? "…") : t.degraded}</span>
          <button type="button" className="ghost small" onClick={startNewMission}>{t.new}</button>
          <button type="button" className="ghost small" onClick={() => setSettingsOpen(true)}>⚙ {t.openSettings}</button>
          <button type="button" className="ghost small" onClick={() => setPairModalOpen(true)}>📱 {t.pairDevice}</button>
          <a className="secondary small link-button" href="/admin">{t.openAdmin}</a>
        </div>
      </header>

      {pairModalOpen ? <PairDeviceModal t={t} onClose={() => setPairModalOpen(false)} /> : null}
      {settingsOpen ? (
        <SettingsModal
          t={t}
          projectId={selectedProjectId}
          agentConfiguration={dashboard?.agentConfiguration ?? null}
          availableApplications={dashboard?.desktopActionSupport?.availableApplications ?? []}
          availableBrowsers={dashboard?.desktopActionSupport?.availableBrowsers ?? []}
          project={project}
          llmGatewayStatus={dashboard?.llmGatewayStatus ?? null}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {feedback ? <div className={`react-feedback ${feedback.tone ?? ""}`}>{feedback.text}</div> : null}

      <main className={`react-cowork-main ${historyOpen ? "history-open" : "history-collapsed"} ${workspacePanel ? "workspace-open" : "workspace-collapsed"} ${workspacePanel === "terminals" && terminalViewMode === "surface" ? "terminal-surface-open" : ""}`}>
        <ConversationSidebar
          conversations={conversationSessions}
          activeConversationId={activeConversationId}
          onSelect={selectConversation}
          onNew={startNewMission}
          open={historyOpen}
          onToggle={() => setHistoryOpen((current) => !current)}
          jonUnread={jonUnread}
          jonHasAlert={jonUnread > 0}
          locale={locale}
          t={t}
        />
        <section className="conversation-surface">
          <div className="conversation-thread" ref={transcriptRef} aria-live="polite">
            {!hasConversation ? <EmptyConversation t={t} /> : null}
            {activeConversationId === JON_CONVERSATION_ID ? (
              <WorkspaceTerminalMessage
                workspace={dashboard?.workspace ?? null}
                availableCliAgents={dashboard?.desktopActionSupport?.availableCliAgents ?? []}
                onOpenTerminals={() => openTerminalWorkspace(null)}
                onNewTerminal={() => openTerminalWorkspace("launch")}
                onAttachTerminal={() => openTerminalWorkspace("attach")}
                t={t}
              />
            ) : null}
            {selectedRunId && run ? <RunReviewIntro run={run} t={t} /> : null}
            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onStartMission={startMission}
                onClarificationAnswer={stageClarificationAnswer}
                onTerminalInput={sendTerminalInput}
                busy={busy}
                t={t}
              />
            ))}
            {busy.reviewing && !hasStreamingMessage ? <ThinkingMessage text={t.thinking} t={t} /> : null}
            {busy.starting ? <ThinkingMessage text={t.launching} t={t} /> : null}
            {run ? (
              <RunProgressMessage
                run={run}
                runDetail={runDetail}
                liveStatus={liveStatus}
                pendingApprovals={pendingApprovals}
                events={activityEvents}
                t={t}
              />
            ) : null}
            {pendingApprovals.map((approval) => (
              <ApprovalMessage
                key={approval.id}
                approval={approval}
                busy={busy.approvalId === approval.id}
                onResolve={resolveApproval}
                t={t}
              />
            ))}
            {runDetail?.review?.outcomeSummary && ["completed", "failed"].includes(run?.status) ? (
              <OutcomeMessage run={run} runDetail={runDetail} t={t} />
            ) : null}
          </div>

          <PromptSuggestions
            draft={draft}
            onDraftChange={updateDraft}
            inputRef={composerInputRef}
            disabled={busy.loading || busy.reviewing || busy.starting || !project}
          />
          <Composer
            draft={draft}
            busy={busy}
            project={project}
            onDraftChange={updateDraft}
            onReview={reviewMission}
            detailsOpen={detailsOpen}
            setDetailsOpen={setDetailsOpen}
            availableBrowsers={availableBrowsers}
            modes={dashboard?.missionEntry?.modes ?? []}
            inputRef={composerInputRef}
            t={t}
          />
          {terminalOverlayId ? (
            <TerminalOverlay
              terminalId={terminalOverlayId}
              terminals={dashboard?.workspace?.terminals ?? []}
              terminalEvents={dashboard?.workspace?.terminalEvents ?? []}
              terminalDecisions={dashboard?.workspace?.decisions ?? []}
              workspace={dashboard?.workspace ?? null}
              projectId={selectedProjectId}
              onInput={sendTerminalInput}
              onStop={stopWorkspaceTerminal}
              onClose={closeTerminalOverlay}
              onSelectTerminal={setTerminalOverlayId}
              fullscreen={terminalOverlayFullscreen}
              onToggleFullscreen={() => setTerminalOverlayFullscreen((f) => !f)}
              t={t}
              locale={locale}
            />
          ) : null}
        </section>
        {!workspacePanel ? (
          <WorkspaceRail
            onOpenTerminals={() => openTerminalWorkspace(null)}
            onOpenTrace={openTraceWorkspace}
            onCreateTerminal={() => openTerminalWorkspace("launch")}
            onOpenBrowser={openBrowserWorkspace}
            workspace={dashboard?.workspace ?? null}
            run={run}
            t={t}
          />
        ) : null}
        {workspacePanel === "terminals" ? (
          <TerminalSidebar
            projectId={selectedProjectId}
            conversationId={activeConversationBackendId}
            workspace={dashboard?.workspace ?? null}
            onTerminalInput={sendTerminalInput}
            onRefresh={refreshDashboard}
            open
            onToggle={toggleTerminalSidebar}
            onOpenTrace={openTraceWorkspace}
            requestedView={terminalRequestedView}
            onViewHandled={() => setTerminalRequestedView(null)}
            availableCliAgents={dashboard?.desktopActionSupport?.availableCliAgents ?? []}
            onRequestOpenView={openTerminalWorkspace}
            viewMode={terminalViewMode}
            onViewModeChange={setTerminalViewMode}
            onOpenOverlay={openTerminalOverlay}
            activeOverlayId={terminalOverlayId}
            t={t}
            locale={locale}
          />
        ) : null}
        {workspacePanel === "trace" ? (
          <ActivityPanel
            run={run}
            runDetail={runDetail}
            events={activityEvents}
            runs={runs}
            workspace={dashboard?.workspace ?? null}
            selectedRunId={selectedRunId}
            conversation={activeConversation}
            conversationId={activeConversationBackendId}
            onOpenRun={openRun}
            open
            onToggle={toggleInspectorSidebar}
            onOpenTerminals={() => openTerminalWorkspace(null)}
            pendingApprovals={pendingApprovals}
            liveStatus={liveStatus}
            locale={locale}
            t={t}
          />
        ) : null}
        {workspacePanel === "browser" ? (
          <BrowserSurfacePanel
            projectId={selectedProjectId}
            dashboard={dashboard}
            onToggle={toggleBrowserSidebar}
            t={t}
          />
        ) : null}
      </main>
      <TokenStatusBar projectId={selectedProjectId} dashboard={dashboard} t={t} />
    </div>
  );
}

function ConversationSidebar({ conversations, activeConversationId, onSelect, onNew, open, onToggle, jonUnread, jonHasAlert, locale, t }) {
  if (!open) {
    return (
      <aside className="conversation-sidebar collapsed" aria-label={t.conversations} data-testid="conversation-sidebar">
        <button
          type="button"
          className={`side-rail-button ${activeConversationId === JON_CONVERSATION_ID ? "active-button" : ""} ${jonHasAlert ? "jon-rail-alert" : ""}`}
          onClick={() => onSelect(JON_CONVERSATION_ID)}
          aria-label="JON"
          title="JON"
        >
          <span className={jonHasAlert ? "jon-rail-icon-alert" : ""}>◈</span>
          <small>JON</small>
          {jonUnread > 0 ? <span className="rail-count-badge warn">{jonUnread}</span> : null}
        </button>
        <button type="button" className="side-rail-button" onClick={onToggle} aria-label={t.openConversations} title={t.openConversations}>
          <span>≡</span>
          <small>{t.conversationsShort}</small>
        </button>
        <button type="button" className="side-rail-button subtle" onClick={onNew} aria-label={t.newConversation} title={t.newConversation}>
          <span>+</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className="conversation-sidebar open" aria-label={t.conversations} data-testid="conversation-sidebar">
      <div className="side-panel-header">
        <div>
          <p className="eyebrow">{t.localOnly}</p>
          <h2>{t.conversations}</h2>
        </div>
        <div className="side-panel-actions">
          <button type="button" className="small" onClick={onNew}>{t.new}</button>
          <button type="button" className="ghost small" onClick={onToggle} aria-label={t.collapseConversations} title={t.collapseConversations}>{t.collapse}</button>
        </div>
      </div>

      <button
        type="button"
        className={`jon-conversation-item ${activeConversationId === JON_CONVERSATION_ID ? "selected" : ""}`}
        onClick={() => onSelect(JON_CONVERSATION_ID)}
        data-testid="jon-conversation-item"
      >
        <div className={`jon-conversation-bubble ${jonHasAlert ? "has-alert" : ""}`}>◈</div>
        <div className="jon-conversation-info">
          <strong>JON</strong>
          <span>{t.jonPilotHint}</span>
        </div>
        {jonUnread > 0 ? <span className="jon-unread-badge">{jonUnread}</span> : null}
      </button>
      <div className="conversation-separator" />

      <p className="side-panel-hint">{t.localOnlyHint}</p>
      <div className="conversation-list">
        {conversations.length === 0 ? <p className="muted">{t.noConversation}</p> : null}
        {conversations.map((conversation) => (
          <button
            type="button"
            key={conversation.id}
            className={`conversation-item ${conversation.id === activeConversationId ? "selected" : ""}`}
            onClick={() => onSelect(conversation.id)}
          >
            <strong>{conversation.title || t.newConversation}</strong>
            <span>{conversationPreview(conversation, locale)}</span>
            <small>{formatDate(conversation.updatedAt ?? conversation.createdAt, locale)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function WorkspaceRail({ onOpenTerminals, onOpenTrace, onCreateTerminal, onOpenBrowser, workspace, run, t }) {
  const terminals = workspace?.terminals ?? [];
  const activeCount = terminals.filter((terminal) => ["running", "waiting_for_input", "needs_attention"].includes(terminal.status)).length;
  return (
    <aside className="workspace-rail collapsed" aria-label={t.workspacePanel ?? t.terminalSurfaces} data-testid="workspace-rail">
      <button type="button" className="side-rail-button" onClick={onOpenTerminals} aria-label={t.openTerminals} title={t.openTerminals}>
        <span>⌁</span>
        <small>Term.</small>
        {activeCount > 0 ? <span className="rail-count-badge warn">{activeCount}</span> : null}
      </button>
      <button type="button" className="side-rail-button" onClick={onOpenTrace} aria-label={t.openInspector} title={t.openInspector}>
        <span>◎</span>
        <small>{t.inspectorShort}</small>
        {run ? <span className={`rail-status-dot ${statusTone(run.status)}`} title={run.status} /> : null}
      </button>
      <button type="button" className="side-rail-button" onClick={onOpenBrowser} aria-label="Browser" title="Browser workspace">
        <span>⊡</span>
        <small>Nav.</small>
      </button>
      <button type="button" className="side-rail-button subtle" onClick={onCreateTerminal} aria-label={t.newTerminal} title={t.newTerminal}>
        <span>+</span>
      </button>
    </aside>
  );
}

function runTraceItems({ scopedRun, events = [], approvals = [], artifacts = [], evidence = [], calls = [], t }) {
  const items = [];
  if (scopedRun) {
    items.push({
      id: `run-${scopedRun.id}`,
      tone: statusTone(scopedRun.status),
      label: scopedRun.status === "paused" ? t.waitingApproval : scopedRun.status === "completed" ? t.done : scopedRun.status === "failed" ? t.failed : t.working,
      detail: scopedRun.summary ?? scopedRun.metadata?.missionSpec?.objective ?? t.selectedMission,
      timestamp: scopedRun.updatedAt ?? scopedRun.createdAt
    });
  }
  for (const approval of approvals.slice(0, 2)) {
    items.push({
      id: `approval-${approval.id}`,
      tone: "warn",
      label: t.confirmationNeeded,
      detail: approval.actionLabel || approval.reason || t.waitingApproval,
      timestamp: approval.createdAt
    });
  }
  for (const event of events.slice(0, 6)) {
    items.push({
      id: technicalEventKey(event),
      tone: event.type?.includes("failed") || event.type?.includes("blocked") ? "danger" : event.type?.includes("approval") ? "warn" : "ok",
      label: eventLabel(event),
      detail: event.type,
      timestamp: event.createdAt
    });
  }
  if (artifacts.length > 0) {
    items.push({
      id: "artifacts",
      tone: "ok",
      label: t.artifacts,
      detail: `${artifacts.length} ${t.artifactCount}`,
      timestamp: null
    });
  }
  if (evidence.length > 0) {
    items.push({
      id: "evidence",
      tone: "ok",
      label: t.evidence,
      detail: `${evidence.length} ${t.evidenceCount}`,
      timestamp: null
    });
  }
  if (calls.length > 0) {
    items.push({
      id: "llm-calls",
      tone: "neutral",
      label: t.generation,
      detail: `${calls.length} ${t.llmCalls}`,
      timestamp: calls.at(-1)?.createdAt
    });
  }
  return items.slice(0, 12);
}

function runCapabilitySummary(scopedRun, scopedRunDetail) {
  const missionSpec = scopedRun?.metadata?.missionSpec ?? {};
  const routing = missionSpec.routing ?? {};
  const review = scopedRunDetail?.review ?? {};
  return {
    frame: missionSpec.mode ?? routing.mode ?? scopedRun?.metadata?.scenarioType ?? "",
    capability: routing.capabilityId ?? review.capabilityId ?? scopedRun?.metadata?.capabilityId ?? "",
    skill: routing.skillId ?? review.skillId ?? scopedRun?.metadata?.skillId ?? "",
    policy: scopedRun?.lifecycleStage ?? scopedRun?.status ?? ""
  };
}

function browserStateFromEvidence(evidence = []) {
  const states = evidence
    .map((item) => item.metadata?.browserState)
    .filter(Boolean);
  return states.at(-1) ?? null;
}

function terminalStatusLabel(status, t) {
  if (status === "waiting_for_input" || status === "needs_attention") {
    return t.terminalWaiting;
  }
  if (status === "running") {
    return t.terminalRunning;
  }
  if (status === "completed") {
    return t.terminalCompleted;
  }
  if (status === "error") {
    return t.terminalError;
  }
  return t.terminalAttached;
}

function terminalStatusTone(status) {
  if (status === "waiting_for_input" || status === "needs_attention") {
    return "warn";
  }
  if (status === "error") {
    return "danger";
  }
  if (status === "completed") {
    return "ok";
  }
  return "neutral";
}

function TerminalCard({ terminal, projectId, onInput, onStop, t, locale }) {
  const [reply, setReply] = React.useState("");
  const [replySent, setReplySent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const tone = terminalStatusTone(terminal.status);
  const isInteractiveShell = terminal.agentKind === "generic_cli";

  async function handleReply() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      await onInput(projectId, terminal.id, reply, { approved: true });
      setReply("");
      if (!isInteractiveShell) {
        setReplySent(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (busy) return;
    setBusy(true);
    try {
      await onStop(terminal.id);
    } finally {
      setBusy(false);
    }
  }

  const canStop = !["detached", "completed", "error"].includes(terminal.status);
  const canReply = terminal.status === "waiting_for_input"
    || terminal.status === "needs_attention"
    || (isInteractiveShell && terminal.status === "running");

  return (
    <div className={`terminal-card ${tone}`}>
      <div className="terminal-card-header">
        <div className="terminal-card-title">
          <span className={`mini-badge ${tone}`}>{terminalStatusLabel(terminal.status, t)}</span>
          <strong>{terminal.label}</strong>
          <small className="terminal-kind">{terminal.agentKind}</small>
        </div>
        <div className="terminal-card-actions">
          <span className="mini-badge neutral">{terminal.autonomyMode}</span>
          {canStop ? (
            <button type="button" className="tiny ghost danger" onClick={handleStop} disabled={busy}>
              {t.terminalStop}
            </button>
          ) : null}
        </div>
      </div>
      {terminal.recentOutput ? (
        <pre className="terminal-output-snippet">{terminal.recentOutput.slice(-800)}</pre>
      ) : null}
      {canReply && !replySent ? (
        <div className="terminal-reply-row">
          <input
            type="text"
            className="terminal-reply-input"
            placeholder={isInteractiveShell ? (t.terminalShellPlaceholder ?? t.terminalReplyPlaceholder) : t.terminalReplyPlaceholder}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
            disabled={busy}
          />
          <button type="button" className="small" onClick={handleReply} disabled={busy || !reply.trim()}>
            {busy ? t.sending : t.terminalReplySend}
          </button>
        </div>
      ) : null}
      {replySent ? <p className="terminal-alert-sent">{t.terminalReplySentConfirm}</p> : null}
      <small className="terminal-card-meta">{t.updated}: {formatDate(terminal.updatedAt, locale)}</small>
    </div>
  );
}

function terminalEventTone(event) {
  if (event.eventType === "process.error" || event.stream === "stderr") {
    return "danger";
  }
  if (event.eventType === "process.input" || event.eventType === "process.stop_requested") {
    return "warn";
  }
  if (event.eventType === "process.started" || event.eventType === "process.exit") {
    return "ok";
  }
  return "neutral";
}

function terminalEventHeading(event, t) {
  if (event.eventType === "process.output") {
    const streamLabel = event.stream === "stdout"
      ? t.terminalStdout
      : event.stream === "stderr"
        ? t.terminalStderr
        : event.stream === "stdin"
          ? t.terminalStdin
          : event.stream;
    const baseLabel = streamLabel ? `${t.terminalTranscript} · ${streamLabel}` : t.terminalTranscript;
    return event.count && event.count > 1 ? `${baseLabel} · x${event.count}` : baseLabel;
  }
  if (event.eventType === "process.input") {
    return event.count && event.count > 1 ? `${t.terminalLastPrompt} · x${event.count}` : t.terminalLastPrompt;
  }
  if (event.eventType === "process.started") {
    return `${t.terminalEvent} · ${t.terminalEventStart}`;
  }
  if (event.eventType === "process.exit") {
    return `${t.terminalEvent} · ${t.terminalEventExit}`;
  }
  if (event.eventType === "process.error") {
    return `${t.terminalEvent} · ${t.terminalEventError}`;
  }
  if (event.eventType === "process.stop_requested") {
    return `${t.terminalEvent} · ${t.terminalEventStop}`;
  }
  return event.eventType || t.terminalEvent;
}

function terminalEventContent(event, t) {
  if (event.content) {
    return event.content;
  }
  if (event.eventType === "process.started") {
    const pid = event.metadata?.snapshot?.pid;
    return pid ? `pid ${pid}` : t.terminalProcessStarted;
  }
  if (event.eventType === "process.exit") {
    const exitCode = event.metadata?.exitCode;
    const signal = event.metadata?.signal;
    if (exitCode != null) {
      return `${t.terminalExitCode} ${exitCode}`;
    }
    if (signal) {
      return `${t.terminalSignal} ${signal}`;
    }
    return t.terminalProcessExited;
  }
  if (event.eventType === "process.error") {
    return event.metadata?.message ?? t.terminalProcessError;
  }
  return "";
}

function activeTerminalProcess(terminal, workspace = null) {
  const liveProcess = (workspace?.liveProcesses ?? []).find((candidate) => candidate.terminalId === terminal?.id);
  return liveProcess ?? terminal?.metadata?.process ?? null;
}

function groupTerminalEvents(events = []) {
  const ordered = [...events].sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
  const groups = [];
  for (const event of ordered) {
    const previous = groups.at(-1);
    const mergeOutput = previous
      && event.eventType === "process.output"
      && previous.eventType === "process.output"
      && previous.stream === event.stream;
    const mergeInput = previous
      && event.eventType === "process.input"
      && previous.eventType === "process.input";
    if (mergeOutput || mergeInput) {
      previous.count += 1;
      previous.updatedAt = event.createdAt;
      previous.content = [previous.content, event.content].filter(Boolean).join("\n");
      continue;
    }
    groups.push({
      ...event,
      count: 1,
      updatedAt: event.createdAt
    });
  }
  return groups;
}

function terminalDecisionTone(action) {
  if (action === "request_human_approval" || action === "suggest_user_reply") {
    return "warn";
  }
  if (action === "escalate_human") {
    return "danger";
  }
  if (action === "auto_inject_context") {
    return "ok";
  }
  return "neutral";
}

function terminalDecisionLabel(action, t) {
  if (action === "request_human_approval") {
    return t.terminalDecisionRequestApproval;
  }
  if (action === "suggest_user_reply") {
    return t.terminalDecisionSuggestReply;
  }
  if (action === "auto_inject_context") {
    return t.terminalDecisionAutoInject;
  }
  if (action === "escalate_human") {
    return t.terminalDecisionEscalate;
  }
  return t.terminalDecisionObserve;
}

function terminalExpectation(terminal, latestDecision, missionObjective, t) {
  if (latestDecision?.action === "request_human_approval") {
    return {
      tone: "warn",
      title: t.terminalWhatJonNeeds,
      detail: t.terminalAwaitingApproval,
      next: latestDecision.reason || missionObjective || "",
      canInject: false
    };
  }
  if (latestDecision?.action === "suggest_user_reply") {
    return {
      tone: "warn",
      title: t.terminalWhatJonNeeds,
      detail: t.terminalAwaitingReply,
      next: latestDecision.reason || terminal.recentOutput || "",
      canInject: false
    };
  }
  if (latestDecision?.action === "auto_inject_context") {
    return {
      tone: "ok",
      title: t.terminalWhatJonNeeds,
      detail: t.terminalMayInjectContext,
      next: missionObjective || latestDecision.reason || "",
      canInject: Boolean(missionObjective)
    };
  }
  if (terminal.status === "error") {
    return {
      tone: "danger",
      title: t.terminalWhatJonNeeds,
      detail: t.terminalErrorStateSummary,
      next: latestDecision?.reason || terminal.recentOutput || "",
      canInject: false
    };
  }
  if (terminal.status === "completed") {
    return {
      tone: "ok",
      title: t.terminalWhatJonNeeds,
      detail: t.terminalCompletedStateSummary,
      next: latestDecision?.reason || "",
      canInject: false
    };
  }
  if (terminal.status === "running") {
    return {
      tone: "neutral",
      title: t.terminalWhatJonNeeds,
      detail: t.terminalRunningStateSummary,
      next: latestDecision?.reason || terminal.recentOutput || "",
      canInject: false
    };
  }
  return {
    tone: "neutral",
    title: t.terminalWhatJonNeeds,
    detail: t.terminalMonitoring,
    next: latestDecision?.reason || "",
    canInject: false
  };
}

function XtermView({ projectId, terminalId, interactive = true }) {
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    if (!containerRef.current || !projectId || !terminalId) return;
    let term;
    let source;
    let fitAddon;
    let ro;
    let disposed = false;

    Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit")
    ]).then(([xtermMod, fitMod]) => {
      if (disposed || !containerRef.current) return;
      const Terminal = xtermMod.Terminal;
      const FitAddon = fitMod.FitAddon;
      term = new Terminal({
        cursorBlink: interactive,
        fontSize: 13,
        fontFamily: "Consolas, 'Courier New', monospace",
        theme: { background: "#0d1117", foreground: "#e6edf3", cursor: "#58a6ff" },
        disableStdin: !interactive
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      source = new EventSource(
        `/api/projects/${encodeURIComponent(projectId)}/workspace/terminals/${encodeURIComponent(terminalId)}/stream`
      );
      source.addEventListener("pty.data", (e) => {
        try {
          const { chunk } = JSON.parse(e.data);
          term.write(atob(chunk));
        } catch { /* malformed chunk */ }
      });
      source.addEventListener("pty.exit", () => {
        term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
        source.close();
      });

      if (interactive) {
        term.onData((data) => {
          fetch(
            `/api/projects/${encodeURIComponent(projectId)}/workspace/terminals/${encodeURIComponent(terminalId)}/input`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ input: data, raw: true, approved: true })
            }
          ).catch(() => {});
        });

        term.onResize(({ cols, rows }) => {
          fetch(
            `/api/projects/${encodeURIComponent(projectId)}/workspace/terminals/${encodeURIComponent(terminalId)}/resize`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ cols, rows })
            }
          ).catch(() => {});
        });
      }

      ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch { /* ignore */ } });
      ro.observe(containerRef.current);
    }).catch(() => { /* import failed */ });

    return () => {
      disposed = true;
      if (source) source.close();
      if (ro) ro.disconnect();
      if (term) term.dispose();
    };
  }, [projectId, terminalId, interactive]);

  return <div ref={containerRef} className="xterm-container" />;
}

function TerminalSurfaceView({
  terminal,
  terminals = [],
  terminalEvents = [],
  terminalDecisions = [],
  workspace,
  projectId,
  onSelectTerminal,
  onInput,
  onStop,
  t,
  locale
}) {
  const [reply, setReply] = React.useState("");
  const [replySent, setReplySent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const transcriptRef = React.useRef(null);

  React.useEffect(() => {
    setReply("");
    setReplySent(false);
  }, [terminal?.id]);

  React.useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [terminalEvents.length]);

  if (!terminal) {
    return (
      <div className="terminal-surface-empty" data-testid="terminal-surface-view">
        <strong>{t.terminalSurfaceTitle}</strong>
        <p>{t.terminalNoSurfaceTerminal}</p>
      </div>
    );
  }

  const tone = terminalStatusTone(terminal.status);
  const isInteractiveShell = terminal.agentKind === "generic_cli";
  const isPipeTerminal = terminal.metadata?.terminalType === "pipe";
  const canReply = terminal.status === "waiting_for_input"
    || terminal.status === "needs_attention"
    || (isInteractiveShell && terminal.status === "running")
    || (isPipeTerminal && (terminal.status === "running" || terminal.status === "attached"));
  const canStop = !["detached", "completed", "error"].includes(terminal.status);
  const processSnapshot = activeTerminalProcess(terminal, workspace);
  const launchMetadata = terminal.metadata?.launch ?? {};
  const missionObjective = workspace?.missionBrief?.objective ?? null;
  const events = terminalEvents
    .filter((event) => event.terminalId === terminal.id)
    .slice(0, 80)
    .reverse();
  const decisions = terminalDecisions
    .filter((decision) => decision.terminalId === terminal.id)
    .slice(0, 6);
  const latestDecision = decisions.at(-1) ?? null;
  const expectation = terminalExpectation(terminal, latestDecision, missionObjective, t);
  const groupedEvents = groupTerminalEvents(events);

  async function handleReply() {
    if (!reply.trim() || busy) {
      return;
    }
    setBusy(true);
    try {
      await onInput(projectId, terminal.id, reply, { approved: true });
      setReply("");
      if (!isInteractiveShell) {
        setReplySent(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (busy || !canStop) {
      return;
    }
    setBusy(true);
    try {
      await onStop(terminal.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleInjectContext() {
    if (!missionObjective || busy) {
      return;
    }
    setBusy(true);
    try {
      await onInput(projectId, terminal.id, missionObjective, { approved: true });
      setReplySent(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vsc-terminal" data-testid="terminal-surface-view">
      {/* VS Code-style session tab bar */}
      <div className="vsc-terminal-tabs">
        {terminals.map((candidate) => (
          <button
            type="button"
            key={candidate.id}
            className={`vsc-terminal-tab ${candidate.id === terminal.id ? "active" : ""}`}
            onClick={() => onSelectTerminal(candidate.id)}
          >
            <span className={`vsc-tab-dot ${terminalStatusTone(candidate.status)}`} />
            <span>{candidate.label}</span>
            <span className="vsc-tab-kind">{candidate.agentKind}</span>
          </button>
        ))}
      </div>

      {/* JON context / current state bar */}
      <div className={`vsc-terminal-jon-bar ${expectation.tone}`} data-testid="terminal-surface-current-state">
        <span className="vsc-jon-icon">⌁</span>
        <span className="vsc-jon-title">{expectation.title}</span>
        <strong className="vsc-jon-detail">{expectation.detail}</strong>
        {missionObjective ? <span className="vsc-jon-mission">{missionObjective}</span> : null}
        {expectation.next && expectation.next !== missionObjective ? (
          <span className="vsc-jon-next">{expectation.next}</span>
        ) : null}
      </div>

      {/* Dark terminal body */}
      {terminal.metadata?.terminalType === "pty" || terminal.metadata?.terminalType === "pipe" ? (
        <XtermView
          projectId={projectId}
          terminalId={terminal.id}
          interactive={terminal.metadata?.terminalType === "pty"}
        />
      ) : (
        <div ref={transcriptRef} className="vsc-terminal-body" data-testid="terminal-transcript-grouped">
          <div className="vsc-term-meta">
            <span className="vsc-term-meta-item">$ {terminal.command || launchMetadata.command || terminal.agentKind}</span>
            {(terminal.cwd || launchMetadata.cwd) ? (
              <span className="vsc-term-meta-item">{terminal.cwd || launchMetadata.cwd}</span>
            ) : null}
            {processSnapshot?.pid ? (
              <span className="vsc-term-meta-item">pid {processSnapshot.pid}</span>
            ) : null}
            {terminal.authorized ? (
              <span className="vsc-term-meta-item vsc-term-ok">{t.terminalAuthorized}</span>
            ) : null}
          </div>

          {groupedEvents.length === 0 ? (
            terminal.recentOutput ? (
              <div className="vsc-term-line neutral"><pre className="vsc-term-pre">{terminal.recentOutput}</pre></div>
            ) : (
              <div className="vsc-term-empty">{t.terminalNoTranscript}</div>
            )
          ) : (
            groupedEvents.map((event) => (
              <div key={event.id} className={`vsc-term-line ${terminalEventTone(event)}`}>
                <span className="vsc-term-type">{terminalEventHeading(event, t)}</span>
                {terminalEventContent(event, t) ? (
                  <pre className="vsc-term-pre">{terminalEventContent(event, t)}</pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      {/* Reply input — VS Code terminal prompt style; hidden when xterm handles the session */}
      {terminal.metadata?.terminalType !== "pty" ? (
        canReply ? (
          <div className="vsc-terminal-prompt">
            <span className="vsc-prompt-glyph">$</span>
            <input
              type="text"
              className="terminal-reply-input vsc-prompt-input"
              placeholder={isInteractiveShell ? (t.terminalShellPlaceholder ?? t.terminalReplyPlaceholder) : t.terminalReplyPlaceholder}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleReply();
                }
              }}
              disabled={busy}
            />
            <button type="button" className="vsc-prompt-send" onClick={handleReply} disabled={busy || !reply.trim()}>
              {busy ? t.sending : t.terminalReplySend}
            </button>
            {canStop ? (
              <button type="button" className="vsc-prompt-stop" onClick={handleStop} disabled={busy}>
                {t.terminalStop}
              </button>
            ) : null}
            {expectation.canInject ? (
              <button type="button" className="vsc-prompt-inject" onClick={handleInjectContext} disabled={busy}>
                {t.terminalInjectContextNow}
              </button>
            ) : null}
          </div>
        ) : canStop ? (
          <div className="vsc-terminal-actions">
            <button type="button" className="ghost small" onClick={handleStop} disabled={busy}>
              {t.terminalStop}
            </button>
            {expectation.canInject ? (
              <button type="button" className="secondary small" onClick={handleInjectContext} disabled={busy}>
                {t.terminalInjectContextNow}
              </button>
            ) : null}
          </div>
        ) : null
      ) : canStop ? (
        <div className="vsc-terminal-actions">
          <button type="button" className="ghost small" onClick={handleStop} disabled={busy}>
            {t.terminalStop}
          </button>
        </div>
      ) : null}

      {replySent ? <p className="terminal-alert-sent vsc-reply-sent">{t.terminalReplySentConfirm}</p> : null}
    </section>
  );
}

function parseCliArgs(raw) {
  const args = [];
  let current = "";
  let inQuote = null;
  for (const char of String(raw ?? "")) {
    if (inQuote) {
      if (char === inQuote) { inQuote = null; }
      else { current += char; }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " " || char === "\t") {
      if (current) { args.push(current); current = ""; }
    } else {
      current += char;
    }
  }
  if (current) { args.push(current); }
  return args;
}

function TerminalOverlay({
  terminalId,
  terminals,
  terminalEvents,
  terminalDecisions,
  workspace,
  projectId,
  onInput,
  onStop,
  onClose,
  onSelectTerminal,
  fullscreen,
  onToggleFullscreen,
  t,
  locale
}) {
  const terminal = terminals.find((term) => term.id === terminalId) ?? null;
  const tone = terminal ? terminalStatusTone(terminal.status) : "neutral";

  return (
    <div className={`terminal-overlay ${fullscreen ? "fullscreen" : "split"}`} data-testid="terminal-overlay">
      <div className="terminal-overlay-bar">
        <div className="terminal-overlay-bar-left">
          {terminal ? (
            <>
              <span className={`mini-badge ${tone}`}>{terminalStatusLabel(terminal.status, t)}</span>
              <strong className="terminal-overlay-label">{terminal.label}</strong>
              <span className="terminal-kind">{terminal.agentKind}</span>
            </>
          ) : (
            <strong className="terminal-overlay-label">{t.terminalSurfaceTitle}</strong>
          )}
        </div>
        <div className="terminal-overlay-bar-right">
          <button
            type="button"
            className="ghost small"
            onClick={onToggleFullscreen}
            title={fullscreen ? t.terminalExitFullscreen : t.terminalFullscreen}
            aria-label={fullscreen ? t.terminalExitFullscreen : t.terminalFullscreen}
          >
            {fullscreen ? "⊡" : "⊞"}
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={onClose}
            title={t.terminalClosePanel}
            aria-label={t.terminalClosePanel}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="terminal-overlay-body">
        <TerminalSurfaceView
          terminal={terminal}
          terminals={terminals}
          terminalEvents={terminalEvents}
          terminalDecisions={terminalDecisions}
          workspace={workspace}
          projectId={projectId}
          onSelectTerminal={onSelectTerminal}
          onInput={onInput}
          onStop={onStop}
          t={t}
          locale={locale}
        />
      </div>
    </div>
  );
}

function TerminalSidebar({
  projectId,
  conversationId,
  workspace,
  onTerminalInput,
  onRefresh,
  open,
  onToggle,
  onOpenTrace,
  requestedView,
  onViewHandled,
  availableCliAgents = [],
  onRequestOpenView,
  viewMode,
  onViewModeChange,
  onOpenOverlay,
  activeOverlayId,
  t,
  locale
}) {
  const [showLaunch, setShowLaunch] = React.useState(false);
  const [showAttach, setShowAttach] = React.useState(false);
  const [showMission, setShowMission] = React.useState(false);
  const [launchCommand, setLaunchCommand] = React.useState(availableCliAgents[0]?.command ?? "");
  const [launchLabel, setLaunchLabel] = React.useState("");
  const [launchArgs, setLaunchArgs] = React.useState("");
  const [launchCwd, setLaunchCwd] = React.useState("");
  const [launchAutonomy, setLaunchAutonomy] = React.useState("assisted");
  const [launchError, setLaunchError] = React.useState(null);
  const [launchBusy, setLaunchBusy] = React.useState(false);
  const [attachLabel, setAttachLabel] = React.useState("");
  const [attachKind, setAttachKind] = React.useState("generic_cli");
  const [attachStatus, setAttachStatus] = React.useState("attached");
  const [attachOutput, setAttachOutput] = React.useState("");
  const [attachAuthorized, setAttachAuthorized] = React.useState(true);
  const [attachAutonomy, setAttachAutonomy] = React.useState("assisted");
  const [attachError, setAttachError] = React.useState(null);
  const [attachBusy, setAttachBusy] = React.useState(false);
  const [missionObjective, setMissionObjective] = React.useState("");
  const [missionBusy, setMissionBusy] = React.useState(false);
  const missionBrief = workspace?.missionBrief ?? null;
  const terminals = workspace?.terminals ?? [];
  const activeCount = terminals.filter((terminal) => ["running", "waiting_for_input", "needs_attention"].includes(terminal.status)).length;

  const prevObjectiveRef = React.useRef(null);
  React.useEffect(() => {
    if (missionBrief?.objective && missionBrief.objective !== prevObjectiveRef.current) {
      prevObjectiveRef.current = missionBrief.objective;
      setMissionObjective(missionBrief.objective);
    }
  }, [missionBrief?.objective]);

  React.useEffect(() => {
    if (availableCliAgents.length === 0) {
      setLaunchCommand("");
      return;
    }
    if (!availableCliAgents.some((agent) => agent.command === launchCommand)) {
      setLaunchCommand(availableCliAgents[0].command);
    }
  }, [availableCliAgents, launchCommand]);

  React.useEffect(() => {
    if (!open || !requestedView) {
      return;
    }
    setShowLaunch(requestedView === "launch");
    setShowAttach(requestedView === "attach");
    setShowMission(requestedView === "mission");
    if (requestedView === "launch") {
      setLaunchError(null);
    }
    if (requestedView === "attach") {
      setAttachError(null);
    }
    onViewHandled?.();
  }, [open, requestedView, onViewHandled]);

  async function handleLaunch() {
    if (!projectId || !launchCommand || launchBusy) return;
    setLaunchBusy(true);
    setLaunchError(null);
    try {
      const response = await api(`/api/projects/${projectId}/workspace/terminal-processes`, {
        method: "POST",
        body: JSON.stringify({
          command: launchCommand,
          args: launchArgs.trim() ? parseCliArgs(launchArgs) : [],
          label: launchLabel.trim() || launchCommand,
          cwd: launchCwd.trim() || undefined,
          autonomyMode: launchAutonomy,
          conversationId: conversationId ?? undefined,
          authorized: true
        })
      });
      setShowLaunch(false);
      setLaunchLabel("");
      setLaunchArgs("");
      setLaunchCwd("");
      await onRefresh();
      if (response?.terminal?.id) {
        onOpenOverlay?.(response.terminal.id);
      }
    } catch (error) {
      setLaunchError(error.message);
    } finally {
      setLaunchBusy(false);
    }
  }

  async function handleAttach() {
    if (!projectId || !attachLabel.trim() || attachBusy) return;
    setAttachBusy(true);
    setAttachError(null);
    try {
      const response = await api(`/api/projects/${projectId}/workspace/terminals`, {
        method: "POST",
        body: JSON.stringify({
          label: attachLabel.trim(),
          agentKind: attachKind,
          status: attachStatus,
          recentOutput: attachOutput.trim(),
          authorized: attachAuthorized,
          autonomyMode: attachAutonomy,
          conversationId: conversationId ?? undefined,
          processRunning: attachStatus === "running" || attachStatus === "waiting_for_input"
        })
      });
      setShowAttach(false);
      setAttachLabel("");
      setAttachOutput("");
      await onRefresh();
      if (response?.terminal?.id) {
        onOpenOverlay?.(response.terminal.id);
      }
    } catch (error) {
      setAttachError(error.message);
    } finally {
      setAttachBusy(false);
    }
  }

  async function handleMissionSave() {
    if (!projectId || !missionObjective.trim() || missionBusy) return;
    setMissionBusy(true);
    try {
      await api(`/api/projects/${projectId}/workspace/mission-brief`, {
        method: "POST",
        body: JSON.stringify({ objective: missionObjective.trim(), status: "active" })
      });
      setShowMission(false);
      await onRefresh();
    } catch {
      // silent — mission brief is optional
    } finally {
      setMissionBusy(false);
    }
  }

  async function handleStopTerminal(terminalId) {
    if (!projectId) return;
    try {
      await api(`/api/projects/${projectId}/workspace/terminals/${encodeURIComponent(terminalId)}/stop`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await onRefresh();
    } catch {
      // ignore — terminal may already be stopped
    }
  }

  const launchForm = (
    <div className="workspace-form">
      <label className="workspace-field">
        <span>{t.terminalCommand}</span>
        <select value={launchCommand} onChange={(e) => setLaunchCommand(e.target.value)} disabled={availableCliAgents.length === 0}>
          {availableCliAgents.length === 0 ? <option value="">{t.noCliAgentsDetected}</option> : null}
          {availableCliAgents.map((agent) => (
            <option key={agent.id} value={agent.command}>{agent.label}</option>
          ))}
        </select>
      </label>
      {availableCliAgents.length > 0 ? (
        <p className="workspace-form-hint">{t.availableCliAgents}: {availableCliAgents.map((agent) => agent.label).join(", ")}</p>
      ) : (
        <p className="workspace-form-error">{t.noCliAgentsDetected}</p>
      )}
      <label className="workspace-field">
        <span>{t.terminalLabel}</span>
        <input type="text" value={launchLabel} onChange={(e) => setLaunchLabel(e.target.value)} placeholder={launchCommand} />
      </label>
      <label className="workspace-field">
        <span>{t.terminalArgs}</span>
        <input type="text" value={launchArgs} onChange={(e) => setLaunchArgs(e.target.value)} placeholder='--no-ansi --print "hello world"' />
      </label>
      <label className="workspace-field">
        <span>{t.terminalCwd}</span>
        <input type="text" value={launchCwd} onChange={(e) => setLaunchCwd(e.target.value)} placeholder={t.terminalCwdPlaceholder} />
      </label>
      <label className="workspace-field">
        <span>{t.terminalAutonomyMode}</span>
        <select value={launchAutonomy} onChange={(e) => setLaunchAutonomy(e.target.value)}>
          <option value="assisted">{t.autonomyAssisted}</option>
          <option value="supervised_autonomy">{t.autonomySupervised}</option>
          <option value="manual_only">{t.autonomyManual}</option>
        </select>
      </label>
      {launchError ? <p className="workspace-form-error">{launchError}</p> : null}
      <div className="workspace-form-actions">
        <button type="button" className="small" onClick={handleLaunch} disabled={launchBusy || availableCliAgents.length === 0 || !launchCommand}>
          {launchBusy ? t.sending : t.terminalLaunchBtn}
        </button>
        <button type="button" className="ghost small" onClick={() => { setShowLaunch(false); setLaunchError(null); }}>{t.hide}</button>
      </div>
    </div>
  );

  const attachForm = (
    <div className="workspace-form">
      <label className="workspace-field">
        <span>{t.terminalLabel}</span>
        <input type="text" value={attachLabel} onChange={(e) => setAttachLabel(e.target.value)} placeholder={t.terminalLabel} />
      </label>
      <label className="workspace-field">
        <span>{t.terminalAgent}</span>
        <select value={attachKind} onChange={(e) => setAttachKind(e.target.value)}>
          <option value="codex_cli">{t.agentKindCodexCli}</option>
          <option value="claude_code_cli">{t.agentKindClaudeCode}</option>
          <option value="generic_cli">{t.agentKindGenericCli}</option>
          <option value="unknown">{t.agentKindUnknown}</option>
        </select>
      </label>
      <label className="workspace-field">
        <span>{t.status}</span>
        <select value={attachStatus} onChange={(e) => setAttachStatus(e.target.value)}>
          <option value="attached">{t.statusAttachedLabel}</option>
          <option value="running">{t.statusRunningLabel}</option>
          <option value="waiting_for_input">{t.statusWaitingLabel}</option>
          <option value="needs_attention">{t.statusNeedsAttentionLabel}</option>
        </select>
      </label>
      <label className="workspace-field">
        <span>{t.terminalAutonomyMode}</span>
        <select value={attachAutonomy} onChange={(e) => setAttachAutonomy(e.target.value)}>
          <option value="assisted">{t.autonomyAssisted}</option>
          <option value="supervised_autonomy">{t.autonomySupervised}</option>
          <option value="manual_only">{t.autonomyManual}</option>
        </select>
      </label>
      <label className="workspace-field">
        <span>{t.terminalTranscript}</span>
        <textarea rows={3} value={attachOutput} onChange={(e) => setAttachOutput(e.target.value)} placeholder={t.terminalRecentOutputHint} />
      </label>
      <label className="workspace-field checkbox">
        <input type="checkbox" checked={attachAuthorized} onChange={(e) => setAttachAuthorized(e.target.checked)} />
        <span>{t.terminalAuthorizedLabel}</span>
      </label>
      {attachError ? <p className="workspace-form-error">{attachError}</p> : null}
      <div className="workspace-form-actions">
        <button type="button" className="small" onClick={handleAttach} disabled={attachBusy || !attachLabel.trim()}>
          {attachBusy ? t.sending : t.terminalAttachBtn}
        </button>
        <button type="button" className="ghost small" onClick={() => { setShowAttach(false); setAttachError(null); }}>{t.hide}</button>
      </div>
    </div>
  );

  if (!open) {
    return (
      <aside className="terminal-sidebar collapsed" aria-label={t.terminalSurfaces} data-testid="terminal-sidebar">
        <button type="button" className="side-rail-button" onClick={onToggle} aria-label={t.terminalSurfaces} title={t.terminalSurfaces}>
          <span>⌁</span>
          <small>Term.</small>
          {activeCount > 0 ? <span className="rail-count-badge warn">{activeCount}</span> : null}
        </button>
        <button
          type="button"
          className="side-rail-button subtle"
          title={t.newTerminal}
          aria-label={t.newTerminal}
          onClick={() => { if (onRequestOpenView) { onRequestOpenView("launch"); } else { onToggle(); } }}
        >
          <span>+</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="terminal-sidebar open" aria-label={t.terminalSurfaces} data-testid="terminal-sidebar">
      <div className="side-panel-header">
        <div>
          <p className="eyebrow">Workspace AI</p>
          <h2>{t.terminalSurfaces}</h2>
        </div>
        <div className="side-panel-actions">
          <button type="button" className="ghost small" onClick={onOpenTrace}>{t.runInspector}</button>
          <button type="button" className="ghost small" onClick={onToggle} aria-label={t.collapseTerminals} title={t.collapseTerminals}>{t.collapse}</button>
        </div>
      </div>

      <section className="terminal-sidebar-mission">
        <div className="activity-section-header">
          <strong className="sidebar-section-label">{t.workspaceMission}</strong>
          <button type="button" className="ghost tiny" onClick={() => setShowMission(!showMission)}>
            {showMission ? t.hide : (missionBrief ? t.options : t.setMissionBrief)}
          </button>
        </div>
        {showMission ? (
          <div className="workspace-form">
            <textarea
              className="workspace-form-textarea"
              placeholder={t.missionBriefPlaceholder}
              value={missionObjective}
              onChange={(e) => setMissionObjective(e.target.value)}
              rows={3}
            />
            <div className="workspace-form-actions">
              <button type="button" className="small" onClick={handleMissionSave} disabled={missionBusy || !missionObjective.trim()}>
                {missionBusy ? t.sending : t.save}
              </button>
              <button type="button" className="ghost small" onClick={() => setShowMission(false)}>{t.hide}</button>
            </div>
          </div>
        ) : missionBrief ? (
          <div className="terminal-mission-card">
            <p className="terminal-mission-objective">{missionBrief.objective}</p>
            {missionBrief.blockers?.length > 0 ? (
              <p className="terminal-mission-meta warn">{t.missionBriefBlockers}: {missionBrief.blockers[0]}</p>
            ) : null}
            {missionBrief.nextSteps?.length > 0 ? (
              <p className="terminal-mission-meta">{t.nextSteps}: {missionBrief.nextSteps[0]}</p>
            ) : null}
          </div>
        ) : (
          <p className="muted small-muted">{t.noWorkspaceMission}</p>
        )}
      </section>

      <div className="terminal-sidebar-actions">
        <button
          type="button"
          className={`terminal-action-btn ${showLaunch ? "active" : ""}`}
          onClick={() => { setShowLaunch(!showLaunch); setShowAttach(false); setLaunchError(null); }}
        >
          <span>↗</span> {t.launchCli}
        </button>
        <button
          type="button"
          className={`terminal-action-btn ${showAttach ? "active" : ""}`}
          onClick={() => { setShowAttach(!showAttach); setShowLaunch(false); setAttachError(null); }}
        >
          <span>⊕</span> {t.attachTerminal}
        </button>
      </div>

      {showLaunch ? launchForm : null}
      {showAttach ? attachForm : null}

      <div className="terminal-sidebar-list" data-testid="terminal-list">
        {terminals.length === 0 && !showLaunch && !showAttach ? (
          <div className="terminal-empty-state">
            <p>{t.noTerminals}</p>
            <small>{t.terminalWorkspaceLead}</small>
          </div>
        ) : null}
        {terminals.slice(0, 20).map((terminal) => (
          <button
            key={terminal.id}
            type="button"
            className={`terminal-row-item ${terminal.id === activeOverlayId ? "active" : ""}`}
            onClick={() => onOpenOverlay?.(terminal.id)}
          >
            <span className={`terminal-row-dot ${terminalStatusTone(terminal.status)}`} />
            <span className="terminal-row-label">{terminal.label}</span>
            <span className="mini-badge neutral">{terminal.agentKind}</span>
            <span className={`mini-badge ${terminalStatusTone(terminal.status)}`}>{terminalStatusLabel(terminal.status, t)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── Panel widget registry ────────────────────────────────────────────────────

const PANEL_CONFIG_KEY = "jon.panel.widgets.v1";

const PANEL_WIDGET_REGISTRY = [
  { id: "mission_state",       label: "Mission & Progression",     category: "mission",   defaultOn: true  },
  { id: "jon_needs",           label: "Ce que JON attend",         category: "mission",   defaultOn: true  },
  { id: "semantic_verify",     label: "Vérification sémantique",   category: "mission",   defaultOn: true  },
  { id: "token_budget",        label: "Budget tokens & DOM",       category: "telemetry", defaultOn: true  },
  { id: "browser_state",       label: "État du navigateur",        category: "surfaces",  defaultOn: true  },
  { id: "desktop_state",       label: "État du desktop",           category: "surfaces",  defaultOn: false },
  { id: "approval_queue",      label: "Approbations en attente",   category: "mission",   defaultOn: true  },
  { id: "run_narrative",       label: "Trace de la mission",       category: "trace",     defaultOn: true  },
  { id: "llm_stages",         label: "Appels LLM",                category: "telemetry", defaultOn: true  },
  { id: "evidence",            label: "Preuves & captures",        category: "trace",     defaultOn: true  },
  { id: "artifacts",           label: "Artefacts",                 category: "trace",     defaultOn: false },
  { id: "terminal_alerts",     label: "Alertes terminal",          category: "surfaces",  defaultOn: false },
  { id: "terminal_transcript", label: "Transcript terminal",       category: "surfaces",  defaultOn: false },
  { id: "run_history",         label: "Historique des missions",   category: "trace",     defaultOn: false },
];

const PANEL_CATEGORIES = [
  { id: "mission",   label: "Mission" },
  { id: "surfaces",  label: "Surfaces" },
  { id: "telemetry", label: "Télémétrie" },
  { id: "trace",     label: "Trace" },
];

function loadPanelConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_CONFIG_KEY) ?? "null");
    if (stored && typeof stored === "object") return stored;
  } catch { /* ignore */ }
  return Object.fromEntries(PANEL_WIDGET_REGISTRY.map((w) => [w.id, w.defaultOn]));
}

function savePanelConfig(config) {
  try { localStorage.setItem(PANEL_CONFIG_KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

// ── Individual widget renderers ──────────────────────────────────────────────

function WMissionState({ scopedRun, t, locale }) {
  const sv = scopedRun?.metadata?.semanticVerification ?? null;
  const mp = scopedRun?.metadata?.missionProgress ?? null;
  const steps = mp?.steps ?? null;
  const verdict = sv?.verificationVerdict ?? null;
  const verdictTone = { pass: "ok", partial: "warn", fail: "danger", degraded: "warn" }[verdict] ?? "neutral";

  return (
    <section className="activity-section">
      <h3>Mission &amp; Progression</h3>
      {scopedRun ? (
        <div className="widget-mission-state">
          <div className="widget-objective">
            <span className="widget-label">Objectif</span>
            <strong>{scopedRun.metadata?.missionSpec?.objective ?? scopedRun.mission ?? "—"}</strong>
          </div>
          {steps && (
            <div className="widget-progress-row">
              <div className="widget-progress-bar-track">
                <div
                  className={`widget-progress-bar-fill ${steps.total > 0 && steps.completed === steps.total ? "done" : ""}`}
                  style={{ width: steps.total > 0 ? `${Math.round((steps.completed / steps.total) * 100)}%` : "0%" }}
                />
              </div>
              <span className="widget-progress-label">
                {steps.completed ?? 0}/{steps.total ?? "?"} étapes
                {steps.consecutiveFailures > 0 ? <span className="mini-badge danger"> {steps.consecutiveFailures} échecs consécutifs</span> : null}
              </span>
            </div>
          )}
          {steps?.dynamicReplans > 0 && <p className="widget-hint">↺ {steps.dynamicReplans} replan{steps.dynamicReplans > 1 ? "s" : ""}</p>}
          <div className="widget-status-row">
            <span className={`mini-badge ${verdictTone}`}>{verdict ?? scopedRun.status}</span>
            <small>{t.updated}: {formatDate(scopedRun.updatedAt ?? scopedRun.createdAt, locale)}</small>
          </div>
        </div>
      ) : <p className="muted">{t.noRunSelected}</p>}
    </section>
  );
}

function WJonNeeds({ scopedRun, scopedPendingApprovals, t }) {
  const sv = scopedRun?.metadata?.semanticVerification ?? null;
  const needsApproval = scopedPendingApprovals.length > 0;
  const verificationFailed = sv && !sv.verifiedByOutcomes;
  const nextAction = sv?.nextBestAction ?? null;
  const failureReason = sv?.failureReason ?? null;

  if (!scopedRun) return null;
  if (!needsApproval && !verificationFailed && !nextAction) return null;

  return (
    <section className="activity-section">
      <h3>Ce que JON attend</h3>
      <div className="widget-jon-needs">
        {needsApproval && (
          <div className="card warning widget-need-card">
            <strong>⏳ Approbation requise</strong>
            {scopedPendingApprovals.slice(0, 2).map((a) => (
              <span key={a.id}>{a.actionLabel ?? a.category} <span className={`mini-badge ${a.riskLevel === "high" ? "danger" : "warn"}`}>{a.riskLevel}</span></span>
            ))}
          </div>
        )}
        {verificationFailed && failureReason && (
          <div className="card warning widget-need-card">
            <strong>✗ Objectif non vérifié</strong>
            <span>{failureReason}</span>
          </div>
        )}
        {nextAction && (
          <div className="card widget-need-card">
            <strong>→ Prochaine action</strong>
            <span>{nextAction}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function WSemanticVerify({ scopedRun }) {
  const sv = scopedRun?.metadata?.semanticVerification ?? null;
  if (!scopedRun) return null;

  const verdictLabel = { pass: "✓ Vérifié", partial: "~ Partiel", fail: "✗ Échec", degraded: "⚠ Dégradé" };
  const verdictTone = { pass: "ok", partial: "warn", fail: "danger", degraded: "warn" };

  return (
    <section className="activity-section">
      <h3>Vérification sémantique</h3>
      {sv ? (
        <div className="widget-semantic">
          <div className="widget-verdict-row">
            <span className={`mini-badge ${verdictTone[sv.verificationVerdict] ?? "neutral"}`}>
              {verdictLabel[sv.verificationVerdict] ?? sv.verificationVerdict}
            </span>
            <span className="mini-badge neutral">confiance: {sv.confidence ?? "?"}</span>
          </div>
          {sv.satisfiedOutcomes?.length > 0 && (
            <ul className="widget-outcome-list ok">
              {sv.satisfiedOutcomes.slice(0, 4).map((o, i) => <li key={i}>✓ {o}</li>)}
            </ul>
          )}
          {sv.unsatisfiedOutcomes?.length > 0 && (
            <ul className="widget-outcome-list fail">
              {sv.unsatisfiedOutcomes.slice(0, 4).map((o, i) => <li key={i}>✗ {o}</li>)}
            </ul>
          )}
        </div>
      ) : <p className="muted">Pas encore vérifié</p>}
    </section>
  );
}

function WTokenBudget({ calls, scopedRun }) {
  const totalTokens = calls.reduce((acc, c) => acc + (c.tokenUsage?.totalTokens ?? 0), 0);
  const totalCost = calls.reduce((acc, c) => acc + (c.estimatedCost ?? 0), 0);
  const browserPlanCall = [...calls].reverse().find((c) => c.callType === "browser_plan" || c.callType === "browser_replan");
  const domInputTokens = browserPlanCall?.tokenUsage?.inputTokens ?? null;
  const perStage = {};
  for (const c of calls) {
    const stage = c.callType ?? "unknown";
    if (!perStage[stage]) perStage[stage] = { count: 0, tokens: 0 };
    perStage[stage].count++;
    perStage[stage].tokens += c.tokenUsage?.totalTokens ?? 0;
  }
  const topStages = Object.entries(perStage).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 5);
  const budgetTokens = 50_000;
  const usagePct = Math.min(100, Math.round((totalTokens / budgetTokens) * 100));
  const budgetTone = usagePct > 85 ? "danger" : usagePct > 60 ? "warn" : "ok";

  return (
    <section className="activity-section">
      <h3>Budget tokens &amp; DOM</h3>
      <div className="widget-token-budget">
        <div className="widget-progress-bar-track">
          <div className={`widget-progress-bar-fill ${budgetTone}`} style={{ width: `${usagePct}%` }} />
        </div>
        <div className="inspector-grid">
          <span>Run total<strong className={`mini-badge ${budgetTone}`}>{totalTokens.toLocaleString()} tok</strong></span>
          <span>Coût<strong>${(totalCost).toFixed(4)}</strong></span>
          <span>Appels LLM<strong>{calls.length}</strong></span>
          {domInputTokens && <span>DOM estimé<strong className="mini-badge warn">{domInputTokens.toLocaleString()} tok</strong></span>}
        </div>
        {topStages.length > 0 && (
          <ul className="activity-timeline compact">
            {topStages.map(([stage, data]) => (
              <li key={stage}>
                <span>{stage}</span>
                <small>{data.tokens.toLocaleString()} tok · {data.count} appel{data.count > 1 ? "s" : ""}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Panel configure drawer ───────────────────────────────────────────────────

function PanelConfigDrawer({ config, onClose, onChange }) {
  return (
    <div className="panel-config-drawer">
      <div className="panel-config-header">
        <strong>Configurer le panel</strong>
        <button type="button" className="ghost small" onClick={onClose}>Fermer</button>
      </div>
      <div className="panel-config-body">
        {PANEL_CATEGORIES.map((cat) => (
          <div key={cat.id} className="panel-config-category">
            <p className="eyebrow">{cat.label}</p>
            {PANEL_WIDGET_REGISTRY.filter((w) => w.category === cat.id).map((w) => (
              <label key={w.id} className="panel-config-toggle">
                <input
                  type="checkbox"
                  checked={config[w.id] ?? w.defaultOn}
                  onChange={(e) => onChange(w.id, e.target.checked)}
                />
                <span>{w.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="panel-config-footer">
        <button type="button" className="ghost small" onClick={() => {
          const reset = Object.fromEntries(PANEL_WIDGET_REGISTRY.map((w) => [w.id, w.defaultOn]));
          PANEL_WIDGET_REGISTRY.forEach((w) => onChange(w.id, w.defaultOn, reset));
        }}>Réinitialiser</button>
      </div>
    </div>
  );
}

function ActivityPanel({ run, runDetail, events, runs, workspace, selectedRunId, conversation, conversationId, onOpenRun, open, onToggle, onOpenTerminals, pendingApprovals, liveStatus, locale, t }) {
  const linkedRunIds = new Set([
    ...(Array.isArray(conversation?.metadata?.linkedRunIds) ? conversation.metadata.linkedRunIds : []),
    conversation?.metadata?.latestRunId,
    conversation?.runId
  ].filter(Boolean));
  const hasConversationScope = Boolean(conversationId) || linkedRunIds.size > 0;
  const matchesConversation = (candidate) => {
    if (!candidate) return false;
    return linkedRunIds.has(candidate.id)
      || candidate.metadata?.conversationId === conversationId
      || candidate.metadata?.conversation?.id === conversationId;
  };
  const visibleRuns = hasConversationScope ? runs.filter(matchesConversation) : runs;
  const scopedRun = hasConversationScope && run ? (matchesConversation(run) ? run : null) : run;
  const scopedRunDetail = scopedRun ? runDetail : null;
  const scopedEvents = scopedRun ? events : [];
  const scopedPendingApprovals = scopedRun ? pendingApprovals : [];
  const evidence = scopedRunDetail?.evidence ?? [];
  const artifacts = [
    ...(scopedRunDetail?.artifacts ?? []),
    ...(scopedRunDetail?.review?.artifacts ?? [])
  ].filter(Boolean);
  const calls = scopedRunDetail?.llmCalls ?? [];
  const browserState = browserStateFromEvidence(evidence);
  const browserActionTypes = (browserState?.recentActions ?? [])
    .map((action) => action.action)
    .filter(Boolean)
    .slice(-6);
  const workspaceDecisions = workspace?.decisions ?? [];
  const workspaceTerminalEvents = workspace?.terminalEvents ?? [];
  const traceItems = runTraceItems({ scopedRun, events: scopedEvents, approvals: scopedPendingApprovals, artifacts, evidence, calls, t });
  const capabilitySummary = runCapabilitySummary(scopedRun, scopedRunDetail);

  const [panelConfig, setPanelConfig] = React.useState(loadPanelConfig);
  const [configOpen, setConfigOpen] = React.useState(false);

  const handleWidgetToggle = (id, checked) => {
    const next = { ...panelConfig, [id]: checked };
    setPanelConfig(next);
    savePanelConfig(next);
  };

  const renderWidget = (widgetId) => {
    switch (widgetId) {
      case "mission_state":
        return <WMissionState key={widgetId} scopedRun={scopedRun} t={t} locale={locale} />;

      case "jon_needs":
        return <WJonNeeds key={widgetId} scopedRun={scopedRun} scopedPendingApprovals={scopedPendingApprovals} t={t} />;

      case "semantic_verify":
        return <WSemanticVerify key={widgetId} scopedRun={scopedRun} />;

      case "token_budget":
        return <WTokenBudget key={widgetId} calls={calls} scopedRun={scopedRun} />;

      case "approval_queue":
        if (scopedPendingApprovals.length === 0) return null;
        return (
          <section key={widgetId} className="activity-section">
            <h3>Approbations <span className="mini-badge warn">{scopedPendingApprovals.length}</span></h3>
            <div className="compact-run-list">
              {scopedPendingApprovals.slice(0, 5).map((a) => (
                <div key={a.id} className="activity-card">
                  <strong>{a.actionLabel ?? a.category}</strong>
                  <span className={`mini-badge ${a.riskLevel === "high" ? "danger" : "warn"}`}>{a.riskLevel}</span>
                </div>
              ))}
            </div>
          </section>
        );

      case "run_narrative":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.runNarrative}</h3>
            {traceItems.length === 0 ? <p className="muted">{t.noRecentActions}</p> : null}
            <ol className="run-trace-list">
              {traceItems.map((item) => (
                <li key={item.id} className={item.tone ?? ""}>
                  <i aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                    {item.timestamp ? <small>{formatDate(item.timestamp, locale)}</small> : null}
                  </div>
                </li>
              ))}
            </ol>
            {scopedEvents.length > 0 && (
              <ul className="activity-timeline compact" style={{ marginTop: "0.5rem" }}>
                {scopedEvents.slice(0, 6).map((event) => (
                  <li key={technicalEventKey(event)}>
                    <span>{eventLabel(event)}</span>
                    <small>{event.type} · {formatDate(event.createdAt, locale)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );

      case "browser_state":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.browserState}</h3>
            {browserState ? (
              <>
                <div className="inspector-grid">
                  <span>{t.pageTitle}<strong>{browserState.title || t.notAvailable}</strong></span>
                  <span>{t.activeUrl}<strong>{browserState.url || t.notAvailable}</strong></span>
                  <span>{t.navigationSteps}<strong>{browserState.navigationHistory?.length ?? 0}</strong></span>
                  <span>{t.blockers}<strong>{browserState.blocker?.blocked ? browserState.blocker.reason || t.failed : t.notAvailable}</strong></span>
                </div>
                {browserActionTypes.length > 0 && (
                  <ul className="activity-timeline compact">
                    {browserActionTypes.map((action, index) => (
                      <li key={`${action}-${index}`}>
                        <span>{action}</span>
                        <small>{t.lastBrowserActions}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className="muted">{t.noBrowserState}</p>}
          </section>
        );

      case "desktop_state":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.decisionTrace}</h3>
            <div className="inspector-grid">
              <span>{t.workspaceBrowserMode}<strong>{workspace?.browserStrategy?.preferredMode === "workspace_browser_mode" ? t.done : t.notAvailable}</strong></span>
              <span>{t.frame}<strong>{capabilitySummary.frame || t.notAvailable}</strong></span>
              <span>{t.capability}<strong>{capabilitySummary.capability || t.notAvailable}</strong></span>
              <span>{t.skill}<strong>{capabilitySummary.skill || t.notAvailable}</strong></span>
              <span>{t.policy}<strong>{capabilitySummary.policy || t.notAvailable}</strong></span>
            </div>
          </section>
        );

      case "llm_stages":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.generation}</h3>
            {calls.length === 0 ? <p className="muted">0 {t.llmCalls}</p> : null}
            <ul className="activity-timeline compact">
              {calls.slice(-8).reverse().map((call) => (
                <li key={call.id}>
                  <span>{call.callType}</span>
                  <small>{call.resultStatus} · {call.tokenUsage?.totalTokens ?? 0} {t.tokens}</small>
                </li>
              ))}
            </ul>
          </section>
        );

      case "evidence":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.evidence}</h3>
            {evidence.length === 0 ? <p className="muted">{t.noEvidence}</p> : null}
            {evidence.slice(0, 8).map((item) => (
              <a
                key={item.id}
                className="activity-link"
                href={item.hasScreenshot && scopedRun ? `/api/runs/${scopedRun.id}/evidence/${item.id}/screenshot` : "#"}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{item.kind ?? "evidence"}</strong>
                <span>{item.description ?? item.path ?? item.id}</span>
              </a>
            ))}
          </section>
        );

      case "artifacts":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.artifacts}</h3>
            {artifacts.length === 0 ? <p className="muted">{t.noArtifacts}</p> : null}
            {artifacts.slice(0, 8).map((artifact, index) => (
              <a className="activity-link" key={artifact.id ?? artifact.path ?? index} href={artifact.href ?? artifact.url ?? "#"} target="_blank" rel="noreferrer">
                <strong>{artifact.title ?? artifact.name ?? artifact.path ?? `Artifact ${index + 1}`}</strong>
                {artifact.description ? <span>{artifact.description}</span> : null}
              </a>
            ))}
          </section>
        );

      case "terminal_alerts":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.terminalAlerts}</h3>
            {workspace?.alerts?.length > 0 ? (
              <ol className="run-trace-list">
                {workspace.alerts.map((alert) => (
                  <li key={alert.id} className={alert.requiresApproval ? "warn" : "neutral"}>
                    <i aria-hidden="true" />
                    <div>
                      <strong>{alert.action}</strong>
                      <span>{alert.reason}</span>
                      <small>{formatDate(alert.createdAt, locale)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
            {workspaceDecisions.length > 0 && (
              <ul className="activity-timeline compact">
                {workspaceDecisions.slice(-4).reverse().map((decision) => (
                  <li key={decision.id}>
                    <span>{decision.action}</span>
                    <small>{decision.reason} · {formatDate(decision.createdAt, locale)}</small>
                  </li>
                ))}
              </ul>
            )}
            {(!workspace?.alerts?.length && !workspaceDecisions.length) && <p className="muted">{t.noTerminalDecisions}</p>}
          </section>
        );

      case "terminal_transcript":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.terminalTranscript}</h3>
            {workspaceTerminalEvents.length === 0 ? <p className="muted">{t.noTerminalTranscript}</p> : null}
            <ul className="activity-timeline compact">
              {workspaceTerminalEvents.slice(-6).reverse().map((event) => (
                <li key={event.id}>
                  <span>{event.eventType}{event.stream ? ` · ${event.stream}` : ""}</span>
                  <small>{event.content ? event.content.slice(0, 180) : formatDate(event.createdAt, locale)}</small>
                </li>
              ))}
            </ul>
          </section>
        );

      case "run_history":
        return (
          <section key={widgetId} className="activity-section">
            <h3>{t.runHistory}</h3>
            {visibleRuns.length === 0 ? <p className="muted">{t.noRuns}</p> : null}
            <div className="compact-run-list">
              {visibleRuns.slice(0, 8).map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  className={`compact-run-item ${candidate.id === selectedRunId ? "selected" : ""}`}
                  onClick={() => onOpenRun(candidate.id)}
                >
                  <strong>{candidate.metadata?.missionSpec?.objective ?? candidate.mission ?? t.selectedMission}</strong>
                  <span>{candidate.status} · {formatDate(candidate.updatedAt ?? candidate.createdAt, locale)}</span>
                </button>
              ))}
            </div>
          </section>
        );

      default:
        return null;
    }
  };

  if (!open) {
    return (
      <aside className="activity-panel collapsed" aria-label={t.runInspector} data-testid="run-inspector">
        <button type="button" className="side-rail-button" onClick={onToggle} aria-label={t.openInspector} title={t.openInspector}>
          <span>⌁</span>
          <small>{t.inspectorShort}</small>
        </button>
        {scopedRun ? <span className={`rail-status-dot ${statusTone(scopedRun.status)}`} title={scopedRun.status} /> : null}
      </aside>
    );
  }

  return (
    <aside className="activity-panel open" aria-label={t.runInspector} data-testid="run-inspector">
      <div className="side-panel-header">
        <div>
          <p className="eyebrow">{t.sessionInspector}</p>
          <h2>{t.runInspector}</h2>
        </div>
        <div className="side-panel-actions">
          <span className={`mini-badge ${liveStatus === "live" ? "ok" : "warn"}`}>{liveStatus === "live" ? t.live : t.degraded}</span>
          <button type="button" className="ghost small" onClick={onOpenTerminals}>{t.terminalSurfaces}</button>
          <button type="button" className="ghost small" onClick={() => setConfigOpen((v) => !v)} title="Configurer le panel" aria-label="Configurer le panel">⚙</button>
          <button type="button" className="ghost small" onClick={onToggle} aria-label={t.collapseInspector} title={t.collapseInspector}>{t.collapse}</button>
        </div>
      </div>

      {configOpen && (
        <PanelConfigDrawer
          config={panelConfig}
          onClose={() => setConfigOpen(false)}
          onChange={handleWidgetToggle}
        />
      )}

      {PANEL_WIDGET_REGISTRY.filter((w) => panelConfig[w.id]).map((w) => renderWidget(w.id))}
    </aside>
  );
}

function EmptyConversation({ t }) {
  return (
    <div className="empty-conversation">
      <div className="orbital-mark" aria-hidden="true" />
      <p className="eyebrow">{t.jonDesktop}</p>
      <h1>{t.emptyTitle}</h1>
      <p>{t.emptySubtitle}</p>
    </div>
  );
}

// ── Prompt suggestion bubbles ────────────────────────────────────────────────

const SUGGESTION_POOL = [
  "Va sur Upwork et trouve-moi 5 missions freelance en rapport avec l'IA publiées cette semaine",
  "Recherche les 10 meilleures extensions VS Code pour le développement Python en 2025 et liste-les avec leurs notes",
  "Va sur LinkedIn et récupère les offres d'emploi 'Product Manager IA' à Paris publiées ce mois-ci",
  "Trouve les 5 dernières levées de fonds de startups françaises dans la deeptech sur Crunchbase",
  "Va sur Hacker News et résume les 3 fils de discussion les plus commentés aujourd'hui",
  "Recherche le prix actuel du Bitcoin, Ethereum et Solana sur CoinGecko et compare leur variation sur 7 jours",
  "Va sur Polymarket et liste les 5 marchés avec le plus gros volume d'échange en ce moment",
  "Trouve les dernières publications académiques sur les LLM multimodaux parues sur arXiv cette semaine",
  "Va sur Product Hunt et récupère les 5 produits les mieux notés lancés cette semaine",
  "Recherche sur Amazon les écouteurs sans fil avec le meilleur rapport qualité-prix sous 100 €",
  "Va sur GitHub Trending et liste les 5 repos les plus populaires cette semaine avec leur description",
  "Trouve les dernières news sur Anthropic Claude publiées aujourd'hui sur TechCrunch",
  "Récupère les notes et avis des 3 meilleurs restaurants végétariens à Paris sur Google Maps",
  "Va sur Glassdoor et trouve les salaires moyens pour un développeur senior React en France",
  "Recherche les conférences tech en Europe prévues pour les 3 prochains mois et liste-les avec les dates",
  "Va sur Twitter/X et trouve les 5 tweets les plus viraux sur le sujet 'agent IA' des dernières 24h",
  "Trouve les tarifs de tous les plans de Notion, Linear et Jira et crée un tableau comparatif",
  "Va sur Reddit r/MachineLearning et résume les 3 posts les plus commentés de la semaine",
  "Recherche les mises à jour de l'API OpenAI publiées ces 30 derniers jours dans leur changelog",
  "Va sur Booking.com et trouve un hôtel 4 étoiles à Lyon pour ce weekend sous 150 €/nuit",
  "Trouve les 5 freelances les mieux notés en développement React sur Malt",
  "Va sur Dribbble et collecte les 5 designs UI les plus likés de cette semaine",
  "Recherche les benchmarks de performance des derniers GPU Nvidia RTX 4000 sur Tom's Hardware",
  "Va sur Coursera et liste tous les cours certifiants en IA générative avec leur prix et durée",
  "Trouve les 10 podcasts tech francophones les mieux notés sur Spotify",
  "Va sur IndieHackers et récupère les 3 success stories les plus récentes avec leurs revenus",
  "Recherche les offres de stage en data science à Paris sur Indeed et filtre celles qui débutent en septembre",
  "Va sur Figma Community et liste les 5 templates UI kit les plus téléchargés cette semaine",
  "Trouve les dernières décisions réglementaires sur l'IA en Europe publiées sur le site de l'UE",
  "Va sur Stack Overflow et trouve les questions sur 'React Server Components' les plus vues ce mois",
  "Recherche les prix des abonnements Claude, ChatGPT Plus et Gemini Advanced et compare-les",
  "Va sur Y Combinator et liste les startups de la dernière batch qui travaillent sur des agents IA",
  "Trouve les plugins Figma les mieux notés pour l'accessibilité WCAG",
  "Va sur Vercel et collecte les nouvelles fonctionnalités annoncées dans leurs release notes du mois",
  "Recherche les 5 meilleures alternatives open source à Notion avec leurs fonctionnalités clés",
  "Va sur Dev.to et liste les articles les plus aimés sur TypeScript publiés cette semaine",
  "Trouve les taux de change actuels EUR/USD, EUR/GBP et EUR/JPY",
  "Va sur Behance et collecte les 5 projets de branding les plus vus ce mois-ci",
  "Recherche les dernières mises à jour du framework Next.js et résume les changements majeurs",
  "Va sur Numbeo et compare le coût de la vie à Paris, Berlin et Amsterdam",
];

function pickSuggestions(exclude = []) {
  const pool = SUGGESTION_POOL.filter((s) => !exclude.includes(s));
  const picked = [];
  const available = [...pool];
  while (picked.length < 3 && available.length > 0) {
    const i = Math.floor(Math.random() * available.length);
    picked.push(available.splice(i, 1)[0]);
  }
  return picked;
}

function PromptSuggestions({ draft, onDraftChange, inputRef, disabled }) {
  const [suggestions, setSuggestions] = React.useState(() => pickSuggestions());
  const visible = !draft.objective;

  if (!visible) return null;

  const handlePick = (text) => {
    onDraftChange({ objective: text });
    inputRef?.current?.focus();
  };

  const handleRefresh = () => setSuggestions((prev) => pickSuggestions(prev));

  return (
    <div className="prompt-suggestions">
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          className="prompt-suggestion-chip"
          disabled={disabled}
          onClick={() => handlePick(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="prompt-suggestion-refresh"
        onClick={handleRefresh}
        title="Nouvelles suggestions"
        aria-label="Nouvelles suggestions"
      >
        ↻
      </button>
    </div>
  );
}

function Composer({ draft, busy, project, onDraftChange, onReview, detailsOpen, setDetailsOpen, availableBrowsers, modes, inputRef, t }) {
  const disabled = busy.loading || busy.reviewing || busy.starting || !project;
  return (
    <section className="react-composer-card">
      <div className="react-composer-row">
        <textarea
          ref={inputRef}
          value={draft.objective}
          onChange={(event) => onDraftChange({ objective: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!disabled && draft.objective.trim()) {
                onReview();
              }
            }
          }}
          placeholder={t.composerPlaceholder}
          disabled={disabled}
        />
        <button
          type="button"
          className="chat-send-button"
          disabled={disabled || !draft.objective.trim()}
          onClick={onReview}
        >
          {busy.reviewing ? t.sending : t.send}
        </button>
      </div>
      <div className="react-composer-meta">
        <span>{t.composerHint}</span>
        <button type="button" className="ghost small" onClick={() => setDetailsOpen(!detailsOpen)}>
          {detailsOpen ? t.hide : t.options}
        </button>
      </div>
      {detailsOpen ? (
        <div className="react-details-grid">
          <label>
            {t.expectedResult}
            <input value={draft.deliverable} onChange={(event) => onDraftChange({ deliverable: event.target.value })} placeholder={t.options} disabled={disabled} />
          </label>
          <label>
            {t.constraints}
            <textarea value={draft.constraints} onChange={(event) => onDraftChange({ constraints: event.target.value })} placeholder={t.constraints} disabled={disabled} />
          </label>
          <label>
            {t.avoid}
            <textarea value={draft.forbiddenActions} onChange={(event) => onDraftChange({ forbiddenActions: event.target.value })} placeholder={t.options} disabled={disabled} />
          </label>
          <label>
            {t.preferredBrowser}
            <select value={draft.browserId} onChange={(event) => onDraftChange({ browserId: event.target.value })} disabled={disabled}>
              <option value="">{t.letCoworkChoose}</option>
              {availableBrowsers.map((browser) => <option key={browser.id} value={browser.id}>{browser.label}</option>)}
            </select>
          </label>
          <label>
            {t.advancedFrame}
            <select value={draft.mode} onChange={(event) => onDraftChange({ mode: event.target.value, modeTouched: Boolean(event.target.value) })} disabled={disabled}>
              <option value="">{t.letJonChoose}</option>
              {modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.autoContinue} onChange={(event) => onDraftChange({ autoContinue: event.target.checked })} disabled={disabled} />
            {t.autoContinue}
          </label>
        </div>
      ) : null}
    </section>
  );
}

function TerminalEventMessage({ message, t }) {
  const ev = message.terminalEvent ?? {};
  const kindMeta = {
    terminal_started: { icon: "⌁", labelKey: "terminalStartedTitle", tone: "neutral" },
    terminal_completion: { icon: "✓", labelKey: "terminalCompletionTitle", tone: "ok" },
    terminal_auto_action: { icon: "⚡", labelKey: "terminalAutoActionTitle", tone: "neutral" }
  }[message.kind] ?? { icon: "⌁", labelKey: "terminalAlertTitle", tone: "neutral" };
  return (
    <article className={`react-message assistant terminal-event-message ${kindMeta.tone}`}>
      <div className="react-avatar">{kindMeta.icon}</div>
      <div className="react-bubble terminal-event-bubble">
        <p className="chat-meta">{t[kindMeta.labelKey] ?? kindMeta.labelKey}</p>
        <strong>{ev.terminalLabel ?? ev.terminalId ?? "Terminal"}</strong>
        {ev.agentKind ? <span className="mini-badge neutral" style={{marginLeft:"6px"}}>{ev.agentKind}</span> : null}
        {ev.recentOutput ? <pre className="terminal-output-snippet">{ev.recentOutput}</pre> : null}
        {ev.injectedInput ? (
          <p className="terminal-alert-reason">
            <span className="mini-badge ok">→</span> <code>{ev.injectedInput}</code>
            {ev.reasoning ? <span style={{marginLeft:"6px",opacity:0.7}}>— {ev.reasoning}</span> : null}
          </p>
        ) : null}
        {ev.exitCode != null ? <span className="mini-badge neutral">exit {ev.exitCode}</span> : null}
      </div>
    </article>
  );
}

function MissionPausedMessage({ message, t }) {
  const pause = message.missionPause ?? {};
  return (
    <article className="react-message assistant terminal-event-message warn">
      <div className="react-avatar">⏸</div>
      <div className="react-bubble terminal-event-bubble">
        <p className="chat-meta">{t.missionPausedTitle ?? "Mission en pause"}</p>
        <strong>{pause.actionLabel ?? "Action manuelle requise"}</strong>
        {pause.reason ? <p style={{marginTop:"4px",opacity:0.8}}>{pause.reason}</p> : null}
        <p style={{marginTop:"6px",fontSize:"0.82em",opacity:0.7}}>{t.missionPausedHint ?? "Effectuez l'action puis cliquez sur Continuer dans le panneau de mission."}</p>
      </div>
    </article>
  );
}

function Message({ message, onStartMission, onClarificationAnswer, onTerminalInput, busy, t }) {
  if (message.kind === "terminal_alert") {
    return <TerminalAlertMessage message={message} onTerminalInput={onTerminalInput} t={t} />;
  }
  if (message.kind === "terminal_started" || message.kind === "terminal_completion" || message.kind === "terminal_auto_action") {
    return <TerminalEventMessage message={message} t={t} />;
  }
  if (message.kind === "mission_paused") {
    return <MissionPausedMessage message={message} t={t} />;
  }
  if (message.kind === "turn") {
    return <TurnMessage
      message={message}
      onStartMission={onStartMission}
      onClarificationAnswer={onClarificationAnswer}
      busy={busy.starting}
      t={t}
    />;
  }
  if (message.kind === "preflight") {
    return <PreflightMessage
      message={message}
      onStartMission={onStartMission}
      onClarificationAnswer={onClarificationAnswer}
      busy={busy.starting}
      t={t}
    />;
  }
  if (message.kind === "thinking") {
    return <ThinkingMessage text={message.text} meta={message.meta} t={t} />;
  }
  return (
    <article className={`react-message ${message.role ?? "assistant"} ${message.tone ?? ""}`}>
      <div className="react-avatar">{message.role === "user" ? t.userAvatar : message.role === "tool" ? t.toolAvatar : "JON"}</div>
      <div className="react-bubble">
        {message.meta ? <p className="chat-meta">{message.meta}</p> : null}
        <p>{message.text}</p>
        {message.eventType ? <span className="mini-badge">{message.eventType}</span> : null}
      </div>
    </article>
  );
}

function WorkspaceTerminalMessage({
  workspace,
  availableCliAgents = [],
  onOpenTerminals,
  onNewTerminal,
  onAttachTerminal,
  t
}) {
  const terminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];
  const hasContent = terminals.length > 0 || availableCliAgents.length > 0;
  if (!hasContent) {
    return null;
  }
  const activeCount = terminals.filter((terminal) => ["running", "waiting_for_input", "needs_attention"].includes(terminal.status)).length;
  const waitingCount = terminals.filter((terminal) => ["waiting_for_input", "needs_attention"].includes(terminal.status)).length;
  const leadingTerminals = terminals.slice(0, 3);
  return (
    <article className="react-message assistant workspace-terminal-message">
      <div className="react-avatar">⌁</div>
      <div className="react-bubble workspace-terminal-bubble" data-testid="workspace-terminal-bubble">
        <div className="workspace-terminal-bubble-head">
          <div>
            <p className="chat-meta">{t.terminalWorkspaceTitle}</p>
            <strong>{t.terminalWorkspaceLead}</strong>
          </div>
          <button type="button" className="bubble-icon-button" onClick={onNewTerminal} aria-label={t.createTerminal} title={t.createTerminal}>+</button>
        </div>
        <div className="pill-row">
          <span className="mini-badge neutral">{terminals.length} terminal{terminals.length > 1 ? "s" : ""}</span>
          {activeCount > 0 ? <span className="mini-badge ok">{activeCount} {t.terminalRunning}</span> : null}
          {waitingCount > 0 ? <span className="mini-badge warn">{waitingCount} {t.terminalWaiting}</span> : null}
        </div>
        {availableCliAgents.length > 0 ? (
          <div className="workspace-terminal-agent-row">
            <span>{t.availableCliAgents}</span>
            <div className="workspace-terminal-agent-list">
              {availableCliAgents.map((agent) => (
                <span key={agent.id} className="mini-badge neutral">{agent.label}</span>
              ))}
            </div>
          </div>
        ) : (
          <p className="terminal-alert-reason">{t.noCliAgentsDetected}</p>
        )}
        {leadingTerminals.length > 0 ? (
          <div className="workspace-terminal-mini-list">
            {leadingTerminals.map((terminal) => (
              <div key={terminal.id} className="workspace-terminal-mini-card">
                <strong>{terminal.label}</strong>
                <span>{terminalStatusLabel(terminal.status, t)} · {terminal.agentKind}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="terminal-alert-reason">{t.terminalBubbleEmpty}</p>
        )}
        <div className="workspace-terminal-actions">
          <button type="button" className="secondary small" onClick={onOpenTerminals}>{t.openTerminals}</button>
          <button type="button" className="ghost small" onClick={onAttachTerminal}>{t.attachTerminal}</button>
        </div>
      </div>
    </article>
  );
}

function TerminalAlertMessage({ message, onTerminalInput, t }) {
  const alert = message.terminalAlert ?? {};
  const [replyInput, setReplyInput] = React.useState(alert.suggestedInput ?? "");
  const [replySent, setReplySent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const statusToneMap = {
    waiting_for_input: "warn",
    needs_attention: "warn",
    error: "danger",
    completed: "ok",
    running: "neutral"
  };
  const tone = statusToneMap[alert.terminalStatus] ?? "neutral";

  const [contextInjected, setContextInjected] = React.useState(false);

  async function handleSendReply() {
    if (!replyInput.trim() || busy) return;
    setBusy(true);
    try {
      await onTerminalInput?.(alert.projectId, alert.terminalId, replyInput, { approved: true });
      setReplySent(true);
      setReplyInput("");
    } finally {
      setBusy(false);
    }
  }

  async function handleInjectContext() {
    if (!alert.missionObjective || busy || contextInjected) return;
    setBusy(true);
    try {
      await onTerminalInput?.(alert.projectId, alert.terminalId, alert.missionObjective, { approved: true });
      setContextInjected(true);
    } finally {
      setBusy(false);
    }
  }

  const showInjectContext = alert.autonomyMode === "supervised_autonomy"
    && alert.decisionAction === "auto_inject_context"
    && alert.missionObjective
    && !contextInjected;

  return (
    <article className={`react-message assistant terminal-alert-message ${tone}`}>
      <div className="react-avatar">⌁</div>
      <div className="react-bubble terminal-alert-bubble">
        <p className="chat-meta">{t.terminalAlertTitle}</p>
        <div className="terminal-alert-header">
          <span className={`mini-badge ${tone}`}>{t[`terminal${alert.terminalStatus === "waiting_for_input" ? "Waiting" : alert.terminalStatus === "error" ? "Error" : "Running"}`] ?? alert.terminalStatus}</span>
          <strong>{alert.terminalLabel ?? alert.agentKind}</strong>
        </div>
        {alert.reason ? <p className="terminal-alert-reason">{alert.reason}</p> : null}
        {alert.recentOutput ? (
          <pre className="terminal-output-snippet">{alert.recentOutput}</pre>
        ) : null}
        {alert.suggestedInput ? (
          <p className="terminal-alert-reason">
            <span className="mini-badge ok">{t.terminalSuggestedInput ?? "Suggestion JON"}</span>{" "}
            <code>{alert.suggestedInput}</code>
            {alert.suggestionReasoning ? <span style={{marginLeft:"6px",opacity:0.7}}>— {alert.suggestionReasoning}</span> : null}
          </p>
        ) : null}
        {alert.decisionAction ? (
          <p className="terminal-alert-action">
            <span className="mini-badge neutral">{alert.decisionAction}</span>
          </p>
        ) : null}
        {showInjectContext ? (
          <div className="terminal-inject-row">
            <button type="button" className="small warn" onClick={handleInjectContext} disabled={busy}>
              {busy ? t.sending : t.terminalInjectContext}
            </button>
            <span className="terminal-inject-hint">{alert.missionObjective}</span>
          </div>
        ) : null}
        {contextInjected ? <p className="terminal-alert-sent">{t.terminalContextInjected}</p> : null}
        {(alert.terminalStatus === "waiting_for_input" || alert.terminalStatus === "needs_attention") && !replySent && !showInjectContext ? (
          <div className="terminal-reply-row">
            <input
              type="text"
              className="terminal-reply-input"
              placeholder={t.terminalReplyPlaceholder}
              value={replyInput}
              onChange={(e) => setReplyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
              disabled={busy}
            />
            <button type="button" className="small" onClick={handleSendReply} disabled={busy || !replyInput.trim()}>
              {busy ? t.sending : t.terminalReplySend}
            </button>
          </div>
        ) : null}
        {replySent ? <p className="terminal-alert-sent">{t.terminalReplySentConfirm}</p> : null}
      </div>
    </article>
  );
}

function TurnMessage({ message, onStartMission, onClarificationAnswer, busy, t }) {
  const turn = message.turn ?? {};
  const understanding = normalizePreflight(message.preflight);
  const choiceRequest = turn.choiceRequest ?? understanding?.choiceRequest ?? null;
  const requiresClarification = Boolean(turn.requiresClarification || understanding?.requiresClarification);
  const clarificationQuestion = choiceRequest?.question || turn.clarificationQuestion || understanding?.clarificationQuestion || t.clarificationFallback;
  const clarificationOptions = Array.isArray(choiceRequest?.options)
    ? choiceRequest.options
    : Array.isArray(understanding?.clarificationOptions)
    ? understanding.clarificationOptions
    : Array.isArray(turn.clarificationOptions)
      ? turn.clarificationOptions
      : [];
  const canStart = Boolean(message.preflight && !requiresClarification);
  const showStatusChip = Boolean(requiresClarification || canStart || turn.action === "refuse");
  return (
    <article className={`react-message assistant ${message.tone ?? ""}`}>
      <div className="react-avatar">JON</div>
      <div className="react-bubble turn-bubble">
        {message.meta ? <p className="chat-meta">{message.meta}</p> : null}
        {message.text ? <p>{message.text}<StreamingCursor active={message.streaming} /></p> : message.streaming ? <div className="typing-row compact"><span /><span /><span /></div> : null}
        {showStatusChip ? (
          <div className="pill-row">
            {requiresClarification ? <span className="mini-badge warn">{t.clarification}</span> : null}
            {canStart ? <span className="mini-badge warn">{t.confirmationNeeded}</span> : null}
            {turn.action === "refuse" ? <span className="mini-badge warn">{t.actionNotStarted}</span> : null}
          </div>
        ) : null}
        {!message.streaming ? <UiBlocks blocks={message.uiBlocks ?? turn.uiBlocks ?? []} /> : null}
        {requiresClarification ? (
          <ChoiceCard
            choiceRequest={choiceRequest}
            question={clarificationQuestion}
            options={clarificationOptions}
            onAnswer={onClarificationAnswer}
            t={t}
          />
        ) : null}
        {canStart ? <ActionConfirmCard understanding={understanding} onStartMission={onStartMission} busy={busy} t={t} /> : null}
      </div>
    </article>
  );
}

function StreamingCursor({ active }) {
  return active ? <span className="stream-cursor" aria-hidden="true" /> : null;
}

function clarificationAnswerText(option, t) {
  const label = compactText(option?.label ?? option?.name ?? option?.id ?? option);
  return label ? `${t.clarificationAnswerPrefix} ${label}` : "";
}

function ChoiceCard({ choiceRequest = null, question, options = [], onAnswer, t }) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const title = compactText(choiceRequest?.title) || t.clarificationNeededTitle;
  return (
    <div className="clarification-card choice-card" data-testid="choice-card">
      <div>
        <strong>{title}</strong>
        <p>{question || t.clarificationFallback}</p>
      </div>
      {normalizedOptions.length > 0 ? (
        <div className="clarification-options" aria-label={t.clarificationOptions}>
          {normalizedOptions.slice(0, 6).map((option) => {
            const label = compactText(option?.label ?? option?.name ?? option?.id ?? option);
            const value = compactText(option?.reply ?? label ?? option?.value ?? clarificationAnswerText(option, t));
            return (
              <button type="button" key={`${label}-${value}`} onClick={() => onAnswer?.(value || label)}>
                <span>{label}</span>
                {option?.description ? <small>{option.description}</small> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <button type="button" className="secondary small" onClick={() => onAnswer?.("")}>
          {t.answerInComposer}
        </button>
      )}
      <small>{t.clarificationHelp}</small>
    </div>
  );
}

function ActionConfirmCard({ understanding, onStartMission, busy, t }) {
  const label = understanding?.missionSummary ?? understanding?.clarifiedObjective ?? t.confirmationNeeded;
  return (
    <div className="approval-inline-card action-confirm-card">
      <div>
        <strong>{label}</strong>
        <span>{t.launchNow}</span>
      </div>
      <button type="button" onClick={onStartMission} disabled={busy}>
        {busy ? t.sending : t.confirm}
      </button>
    </div>
  );
}

function RunPlanPreview({ understanding }) {
  return (
    <div className="run-plan-preview">
      <div>
        <strong>{understanding.missionSummary ?? understanding.clarifiedObjective ?? "Plan proposé"}</strong>
        {understanding.whyThisFrame ? <p>{understanding.whyThisFrame}</p> : null}
      </div>
      <div className="preflight-grid compact">
        <MiniList title="Je peux faire maintenant" items={understanding.canDoNow ?? understanding.coveredNow} />
        <MiniList title="Je vérifierai" items={understanding.verificationGoals} />
        <MiniList title="Pas dans ce run" items={understanding.cannotDoNow ?? understanding.notCoveredNow ?? understanding.unsupportedRequests} tone="warn" />
      </div>
      {understanding.nextRunSuggestion ? (
        <div className="soft-note">
          <strong>Suite possible</strong>
          <span>{understanding.nextRunSuggestion}</span>
        </div>
      ) : null}
    </div>
  );
}

function UiBlocks({ blocks = [] }) {
  const normalized = Array.isArray(blocks) ? blocks : [];
  if (normalized.length === 0) return null;
  return (
    <div className="ui-block-stack">
      {normalized.map((block, index) => <UiBlock key={block.id ?? `${block.type}-${index}`} block={block} />)}
    </div>
  );
}

function UiBlock({ block }) {
  switch (block.type) {
    case "folderList":
      return <FolderListBlock block={block} />;
    case "table":
      return <TableBlock block={block} />;
    case "metricCards":
      return <MetricCardsBlock block={block} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "reportPreview":
      return <ReportPreviewBlock block={block} />;
    case "artifactCard":
      return <ArtifactCardBlock block={block} />;
    case "actionPlan":
      return <ActionPlanBlock block={block} />;
    case "evidenceGallery":
      return <EvidenceGalleryBlock block={block} />;
    case "approvalCard":
      return <ApprovalUiBlock block={block} />;
    case "text":
    default:
      return <TextUiBlock block={block} />;
  }
}

function TextUiBlock({ block }) {
  return (
    <div className={`ui-block text-block ${block.tone ?? ""}`}>
      {block.title ? <strong>{block.title}</strong> : null}
      {block.text ? <p>{block.text}</p> : null}
    </div>
  );
}

function FolderListBlock({ block }) {
  const folders = Array.isArray(block.folders) ? block.folders : [];
  return (
    <div className="ui-block folder-list-block">
      <div className="ui-block-header">
        <strong>{block.title ?? "Dossiers"}</strong>
        <span>{folders.length} élément(s)</span>
      </div>
      {folders.length === 0 ? <p className="muted">Aucun dossier trouvé.</p> : null}
      <div className="folder-list">
        {folders.slice(0, 24).map((folder) => (
          <div className="folder-row" key={`${folder.pathLabel}-${folder.name}`}>
            <span className="folder-icon">DIR</span>
            <div>
              <strong>{folder.name}</strong>
              <small>{folder.pathLabel}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableBlock({ block }) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  if (columns.length === 0) return null;
  return (
    <div className="ui-block table-block">
      {block.title ? <strong>{block.title}</strong> : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column, columnIndex) => (
                  <td key={column}>{Array.isArray(row) ? row[columnIndex] : row?.[column]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCardsBlock({ block }) {
  const metrics = Array.isArray(block.metrics) ? block.metrics : [];
  return (
    <div className="ui-block metric-block">
      {block.title ? <strong>{block.title}</strong> : null}
      <div className="metric-grid">
        {metrics.map((metric) => (
          <div className={`metric-card ${metric.tone ?? ""}`} key={`${metric.label}-${metric.value}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {metric.caption ? <small>{metric.caption}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartBlock({ block }) {
  const points = Array.isArray(block.points) ? block.points : [];
  const maxValue = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  return (
    <div className="ui-block chart-block">
      {block.title ? <strong>{block.title}</strong> : null}
      <div className="bar-chart">
        {points.map((point) => (
          <div className="bar-row" key={point.label}>
            <span>{point.label}</span>
            <div><i style={{ width: `${Math.max(4, ((Number(point.value) || 0) / maxValue) * 100)}%` }} /></div>
            <b>{point.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportPreviewBlock({ block }) {
  return (
    <div className="ui-block report-block">
      <strong>{block.title ?? "Rapport"}</strong>
      {block.summary ? <p>{block.summary}</p> : null}
      {block.htmlPreview ? (
        <iframe
          className="report-frame"
          sandbox=""
          srcDoc={block.htmlPreview}
          title={block.title ?? "Aperçu du rapport"}
        />
      ) : null}
      <div className="report-sections">
        {(block.sections ?? []).map((section) => <span key={section}>{section}</span>)}
      </div>
    </div>
  );
}

function ArtifactCardBlock({ block }) {
  return (
    <div className="ui-block artifact-block">
      <strong>{block.title ?? "Artefact"}</strong>
      {block.description ? <p>{block.description}</p> : null}
      {block.href ? <a href={block.href} target="_blank" rel="noreferrer">Ouvrir l’artefact</a> : null}
    </div>
  );
}

function ActionPlanBlock({ block }) {
  return (
    <div className="ui-block action-plan-block">
      <strong>{block.title ?? "Plan"}</strong>
      <MiniList title="Étapes" items={block.steps} />
      <MiniList title="Vérifications" items={block.checks} />
      <MiniList title="Limites" items={block.limitations} tone="warn" />
    </div>
  );
}

function EvidenceGalleryBlock({ block }) {
  return (
    <div className="ui-block evidence-gallery-block">
      <strong>{block.title ?? "Preuves"}</strong>
      {(block.items ?? []).map((item) => (
        <a key={`${item.href}-${item.label}`} href={item.href} target="_blank" rel="noreferrer">{item.label ?? item.href}</a>
      ))}
    </div>
  );
}

function ApprovalUiBlock({ block }) {
  return (
    <div className="ui-block approval-ui-block">
      <strong>{block.title ?? "Approval"}</strong>
      <p>{block.actionLabel}</p>
      {block.reason ? <small>{block.reason}</small> : null}
    </div>
  );
}

function ThinkingMessage({ text, meta, t = stringsForLocale("fr") }) {
  return (
    <article className="react-message assistant active">
      <div className="react-avatar">JON</div>
      <div className="react-bubble">
        <p className="chat-meta">{meta ?? t.working}</p>
        <div className="typing-row"><span /><span /><span /></div>
        <p>{text}</p>
      </div>
    </article>
  );
}

function PreflightMessage({ message, onStartMission, onClarificationAnswer, busy, t }) {
  const understanding = normalizePreflight(message.preflight);
  if (!understanding) return null;
  const requiresClarification = Boolean(understanding.requiresClarification);
  const choiceRequest = understanding.choiceRequest ?? null;
  return (
    <article className={`react-message assistant ${requiresClarification ? "warn" : "ok"}`}>
      <div className="react-avatar">JON</div>
      <div className="react-bubble preflight-bubble">
        {message.meta ? <p className="chat-meta">{message.meta}</p> : null}
        <p>{understanding.missionSummary ?? understanding.clarifiedObjective ?? message.text}</p>
        {requiresClarification ? (
          <ChoiceCard
            choiceRequest={choiceRequest}
            question={choiceRequest?.question ?? understanding.clarificationQuestion}
            options={choiceRequest?.options ?? understanding.clarificationOptions}
            onAnswer={onClarificationAnswer}
            t={t}
          />
        ) : (
          <ActionConfirmCard understanding={understanding} onStartMission={onStartMission} busy={busy} t={t} />
        )}
      </div>
    </article>
  );
}

function MiniList({ title, items, tone = "" }) {
  const normalized = asList(items);
  if (normalized.length === 0) return null;
  return (
    <article className={`mini-card ${tone}`}>
      <h4>{title}</h4>
      <ul>
        {normalized.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
      </ul>
    </article>
  );
}

function RunReviewIntro({ run, t }) {
  return (
    <article className="react-message user">
      <div className="react-avatar">{t.userAvatar}</div>
      <div className="react-bubble">
        <p className="chat-meta">{t.selectedMission}</p>
        <p>{run.metadata?.missionSpec?.objective ?? run.mission ?? t.selectedMission}</p>
      </div>
    </article>
  );
}

function RunProgressMessage({ run, runDetail, liveStatus, pendingApprovals, events, t }) {
  const outcome = runDetail?.review?.outcomeSummary ?? null;
  const steps = buildProgressSteps({
    run,
    pendingApprovals,
    events,
    outcome,
    t
  });
  const heading = run.status === "running"
    ? t.working
    : run.status === "completed"
      ? t.done
      : run.status === "paused"
        ? t.waitingApproval
        : run.status === "failed"
          ? t.failed
          : `${t.status}: ${run.status}`;
  return (
    <article className={`react-message assistant progress-message ${statusTone(run.status)}`}>
      <div className="react-avatar">JON</div>
      <div className="react-bubble progress-bubble">
        <p className="chat-meta">{t.progress}</p>
        <h3>{heading}</h3>
        <p>{run.status === "paused" ? t.waitingApproval : run.summary ?? t.working}</p>
        <div className="pill-row">
          <span className={`mini-badge ${statusTone(run.status)}`}>{run.status === "paused" ? t.confirmationNeeded : run.status}</span>
          <span className={`mini-badge ${liveStatus === "live" ? "ok" : "warn"}`}>{liveStatus === "live" ? t.live : t.degraded}</span>
        </div>
        <ol className="premium-progress-list">
          {steps.map((step) => (
            <li key={step.id} className={step.status}>
              <i aria-hidden="true" />
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function ApprovalMessage({ approval, busy, onResolve, t }) {
  const scope = approval.targetLabel ?? approval.metadata?.targetWindowId ?? approval.metadata?.targetPage ?? t.approvalSurface;
  const risk = approval.riskLevel ?? "medium";
  return (
    <article className="react-message approval premium-approval warn">
      <div className="react-avatar">OK</div>
      <div className="react-bubble approval-bubble">
        <p className="chat-meta">{t.confirmationNeeded}</p>
        <div className="approval-hero">
          <div>
            <h3>{approval.actionLabel || t.confirmationNeeded}</h3>
            <p>{approval.reason || t.waitingApproval}</p>
          </div>
          <span className={`risk-badge ${risk}`}>{t.approvalRisk} {risk}</span>
        </div>
        <div className="approval-scope-grid">
          <div>
            <span>{t.approvalSurface}</span>
            <strong>{scope}</strong>
          </div>
          <div>
            <span>{t.approvalExpectedEffect}</span>
            <strong>{approval.expectedEffect || t.working}</strong>
          </div>
          <div>
            <span>{t.approvalLimit}</span>
            <strong>{approval.consequenceOfRefusal || t.waitingApproval}</strong>
          </div>
        </div>
        <div className="approval-actions premium">
          <button type="button" disabled={busy} onClick={() => onResolve(approval, "approved_once")}>{t.approveOnce}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => onResolve(approval, "denied")}>{t.deny}</button>
          <button type="button" className="danger ghost-danger" disabled={busy} onClick={() => onResolve(approval, "stop_run")}>{t.stopRun}</button>
        </div>
        <p className="approval-footnote">{t.approvalFootnote}</p>
      </div>
    </article>
  );
}

function TechnicalActivityDrawer({ events = [], runDetail }) {
  const calls = runDetail?.llmCalls ?? [];
  if (events.length === 0 && calls.length === 0) {
    return null;
  }
  return (
    <details className="technical-activity-drawer">
      <summary>
        <span>Détails techniques</span>
        <small>{events.length} événement(s) · {calls.length} appel(s) IA</small>
      </summary>
      <div className="technical-activity-grid">
        <section>
          <h4>Timeline</h4>
          <ul>
            {events.slice(0, 12).map((event) => (
              <li key={technicalEventKey(event)}>
                <span>{eventLabel(event)}</span>
                <small>{event.type} · {formatDate(event.createdAt)}</small>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>IA</h4>
          <ul>
            {calls.slice(-8).reverse().map((call) => (
              <li key={call.id}>
                <span>{call.callType}</span>
                <small>{call.resultStatus} · {call.tokenUsage?.totalTokens ?? 0} tokens</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}

function EventMessage({ event }) {
  return (
    <article className={`react-message ${event.type?.startsWith("tool.") ? "tool" : "assistant"} compact`}>
      <div className="react-avatar">{event.type?.startsWith("tool.") ? "Tool" : "AI"}</div>
      <div className="react-bubble">
        <p className="chat-meta">{formatDate(event.createdAt)}</p>
        <p>{eventLabel(event)}</p>
      </div>
    </article>
  );
}

function OutcomeMessage({ run, runDetail, t }) {
  const outcome = runDetail.review.outcomeSummary;
  return (
    <article className={`react-message assistant ${statusTone(run.status)}`}>
      <div className="react-avatar">JON</div>
      <div className="react-bubble outcome-bubble">
        <p className="chat-meta">{t.result}</p>
        <h3>{run.status === "completed" ? t.completedSummary : t.establishedSummary}</h3>
        <div className="preflight-grid compact">
          <MiniList title={t.did} items={outcome.didNow} />
          <MiniList title={t.verified} items={outcome.verifiedNow} />
          <MiniList title={t.notDone} items={outcome.notDoneNow} tone="warn" />
        </div>
        <div className="proof-strip">
          <span>{outcome.artifactsCreated ?? 0} {t.artifactCount}</span>
          <span>{outcome.proofItems ?? 0} {t.evidenceCount}</span>
        </div>
        {runDetail.evidence?.filter((item) => item.hasScreenshot).slice(0, 3).map((item) => (
          <a key={item.id} className="proof-link" href={`/api/runs/${run.id}/evidence/${item.id}/screenshot`} target="_blank" rel="noreferrer">
            {t.proofScreenshot}
          </a>
        ))}
      </div>
    </article>
  );
}

function fmtK(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(n) {
  if (!n && n !== 0) return "—";
  if (n < 0.001) return "<$0.001";
  return `$${n.toFixed(3)}`;
}

function usagePercent(used, budget) {
  if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / budget) * 100)));
}

function usageColor(used, budget) {
  if (!budget || budget <= 0) return "";
  const pct = used / budget;
  if (pct >= 0.8) return "token-bar-danger";
  if (pct >= 0.5) return "token-bar-warn";
  return "token-bar-ok";
}

function BrowserSurfacePanel({ projectId, dashboard, onToggle, t }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  useEffect(() => {
    if (!projectId) { setState(null); return; }
    let cancelled = false;
    setLoading(true);
    api(`/api/projects/${encodeURIComponent(projectId)}/workspace/browser`)
      .then((data) => { if (!cancelled) { setState(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, dashboard]);

  async function handleStartBrowser() {
    if (!projectId || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workspace/browser/open`, { method: "POST", body: JSON.stringify({}) });
      const data = await api(`/api/projects/${encodeURIComponent(projectId)}/workspace/browser`);
      setState(data);
    } catch (err) {
      setStartError(t.browserStartError);
    } finally {
      setStarting(false);
    }
  }

  const active = state?.activeSession ?? null;
  const recent = state?.recentSessions ?? [];

  function statusBadge(status) {
    if (status === "active") return "ok";
    if (status === "navigating") return "warn";
    if (status === "error") return "danger";
    return "muted";
  }

  return (
    <aside className="browser-surface-panel open" aria-label="Browser workspace" data-testid="browser-surface-panel">
      <div className="side-panel-header">
        <div>
          <p className="eyebrow">Workspace AI</p>
          <h2 className="side-panel-title">Navigateur</h2>
        </div>
        <button type="button" className="ghost icon-only" onClick={onToggle} aria-label="Fermer">✕</button>
      </div>

      {loading && !state ? (
        <div className="browser-panel-loading">Chargement…</div>
      ) : null}

      {active ? (
        <section className="browser-panel-active">
          <div className="browser-panel-status-row">
            <span className={`browser-status-dot ${statusBadge(active.status)}`} />
            <span className="browser-status-label">{active.status}</span>
            <span className="browser-mode-badge">{active.mode === "workspace_browser" ? "workspace" : active.mode}</span>
          </div>
          {active.currentUrl ? (
            <div className="browser-panel-url" title={active.currentUrl}>
              <span className="browser-url-title">{active.currentTitle || active.currentUrl}</span>
              <span className="browser-url-text">{active.currentUrl}</span>
            </div>
          ) : null}
          {active.hasScreenshot && active.screenshotBase64 ? (
            <div className="browser-panel-screenshot">
              <img
                src={`data:image/png;base64,${active.screenshotBase64}`}
                alt="Capture navigateur"
                className="browser-screenshot-img"
              />
            </div>
          ) : null}
          {active.navigationHistory?.length > 0 ? (
            <div className="browser-panel-history">
              <p className="browser-history-label">Historique récent</p>
              {active.navigationHistory.slice(-5).reverse().map((nav, i) => (
                <div key={i} className="browser-history-entry">
                  <span className="browser-history-title">{nav.title || nav.url}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <div className="browser-panel-inactive">
          <p>Aucune session browser active.</p>
          <p className="browser-panel-hint">JON ouvrira un navigateur automatiquement lors d{"'"}une mission web.</p>
          <button
            type="button"
            className="primary small"
            onClick={handleStartBrowser}
            disabled={starting}
            style={{ marginTop: "12px" }}
          >
            {starting ? t.browserStarting : t.browserStartSession}
          </button>
          {startError ? <p className="browser-panel-error">{startError}</p> : null}
        </div>
      )}

      {recent.length > 0 && !active ? (
        <section className="browser-panel-recent">
          <p className="browser-history-label">Sessions récentes</p>
          {recent.slice(0, 3).map((s) => (
            <div key={s.id} className="browser-recent-entry">
              <span className={`browser-status-dot muted`} />
              <span className="browser-recent-url">{s.currentUrl ?? "—"}</span>
              <span className="browser-recent-status">{s.status}</span>
            </div>
          ))}
        </section>
      ) : null}
    </aside>
  );
}

function TokenStatusBar({ projectId, dashboard, t }) {
  const [usage, setUsage] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!projectId) { setUsage(null); return; }
    let cancelled = false;
    const load = () => {
      api(`/api/projects/${encodeURIComponent(projectId)}/token-usage`)
        .then((data) => { if (!cancelled) setUsage(data); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, dashboard]);

  const session = usage?.session ?? null;
  const activeRun = usage?.activeRun ?? null;
  const budgets = usage?.budgets ?? null;
  const llmDashboard = dashboard?.llmDashboard ?? null;
  const topStages = (llmDashboard?.topTokenDrivers?.length
    ? llmDashboard.topTokenDrivers
    : llmDashboard?.stageBreakdown ?? []).slice(0, 3);

  const sessionTokenColor = session && budgets ? usageColor(session.totalTokens, budgets.perSessionTokens) : "";
  const sessionCostColor = session && budgets ? usageColor(session.estimatedCost, budgets.perSessionUsd) : "";
  const runTokenColor = activeRun && budgets ? usageColor(activeRun.totalTokens, budgets.perRunTokens) : "";
  const runCostColor = activeRun && budgets ? usageColor(activeRun.estimatedCost, budgets.perRunUsd) : "";
  const sessionTokenPct = usagePercent(session?.totalTokens, budgets?.perSessionTokens);
  const sessionCostPct = usagePercent(session?.estimatedCost, budgets?.perSessionUsd);
  const runTokenPct = usagePercent(activeRun?.totalTokens, budgets?.perRunTokens);
  const totalCalls = session?.callCount ?? llmDashboard?.callCount ?? 0;

  return (
    <section className="token-status-bar" aria-label="Token usage">
      <button
        type="button"
        className="token-dashboard-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setExpanded(false);
        }}
        title="Token dashboard"
      >
        <span className="token-dashboard-title">{t?.tokens ?? "tokens"}</span>
        <span className={`token-dashboard-pill ${sessionTokenColor}`}>
          <span className="token-bar-label">session</span>
          <span>{fmtK(session?.totalTokens)}{budgets ? `/${fmtK(budgets.perSessionTokens)}` : ""}</span>
        </span>
        <span className="token-mini-meter" aria-hidden="true">
          <span className={`token-mini-meter-fill ${sessionTokenColor}`} style={{ width: `${sessionTokenPct}%` }} />
        </span>
        <span className={`token-bar-value ${sessionCostColor}`}>
          {fmtUsd(session?.estimatedCost)}{budgets ? `/${fmtUsd(budgets.perSessionUsd)}` : ""}
        </span>
        {activeRun ? (
          <span className={`token-dashboard-pill active ${runTokenColor}`}>
            <span className="token-bar-label">run</span>
            <span>{fmtK(activeRun.totalTokens)}{budgets ? `/${fmtK(budgets.perRunTokens)}` : ""}</span>
          </span>
        ) : null}
        <span className="token-dashboard-caret" aria-hidden="true">{expanded ? "▾" : "▴"}</span>
      </button>
      {expanded ? (
        <aside className="token-dashboard-popover" aria-label="Token usage details">
          <div className="token-dashboard-header">
            <strong>Token dashboard</strong>
            <span>{totalCalls} calls</span>
          </div>
          <div className="token-dashboard-grid">
            <div>
              <span className="token-detail-label">Session tokens</span>
              <strong className={sessionTokenColor}>{fmtK(session?.totalTokens)}</strong>
              <div className="token-detail-meter">
                <span className={`token-detail-meter-fill ${sessionTokenColor}`} style={{ width: `${sessionTokenPct}%` }} />
              </div>
              <small>{sessionTokenPct}% budget</small>
            </div>
            <div>
              <span className="token-detail-label">Coût session</span>
              <strong className={sessionCostColor}>{fmtUsd(session?.estimatedCost)}</strong>
              <div className="token-detail-meter">
                <span className={`token-detail-meter-fill ${sessionCostColor}`} style={{ width: `${sessionCostPct}%` }} />
              </div>
              <small>{sessionCostPct}% budget</small>
            </div>
            <div>
              <span className="token-detail-label">Run actif</span>
              <strong className={runTokenColor}>{activeRun ? fmtK(activeRun.totalTokens) : "—"}</strong>
              <div className="token-detail-meter">
                <span className={`token-detail-meter-fill ${runTokenColor}`} style={{ width: `${runTokenPct}%` }} />
              </div>
              <small>{activeRun ? `${runTokenPct}% budget` : "aucun run"}</small>
            </div>
            <div>
              <span className="token-detail-label">Coût run</span>
              <strong className={runCostColor}>{activeRun ? fmtUsd(activeRun.estimatedCost) : "—"}</strong>
              <small>{budgets ? `${fmtUsd(budgets.perRunUsd)} max` : "budget non défini"}</small>
            </div>
          </div>
          {topStages.length > 0 ? (
            <div className="token-stage-list">
              <span className="token-detail-label">Postes principaux</span>
              {topStages.map((stage, index) => (
                <div key={`${stage.label ?? stage.stage ?? stage.stageLabel ?? "stage"}-${index}`} className="token-stage-row">
                  <span>{stage.label ?? stage.stageLabel ?? stage.stage}</span>
                  <strong>{fmtK(stage.totalTokens)}</strong>
                  <small>{fmtUsd(stage.estimatedCost)}</small>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}

createRoot(document.getElementById("cowork-user-root")).render(<App />);
