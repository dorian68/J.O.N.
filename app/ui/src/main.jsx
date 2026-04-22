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
  return sortConversations(next).slice(0, 50);
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyHydratedProjectId, setHistoryHydratedProjectId] = useState(null);
  const [conversationSessions, setConversationSessions] = useState(() => {
    const stored = sortConversations(loadStoredConversations());
    return stored.length > 0 ? stored : [createLocalConversation({ title: stringsForLocale(detectInitialLocale()).newConversation })];
  });
  const [activeConversationId, setActiveConversationId] = useState(null);

  const selectedProjectIdRef = useRef(null);
  const selectedRunIdRef = useRef(null);
  const transcriptRef = useRef(null);
  const composerInputRef = useRef(null);

  const project = useMemo(() => currentProject(dashboard, selectedProjectId), [dashboard, selectedProjectId]);
  const runs = useMemo(() => latestRuns(dashboard, selectedProjectId), [dashboard, selectedProjectId]);
  const availableBrowsers = dashboard?.desktopActionSupport?.availableBrowsers ?? [];
  const pendingApprovals = runDetail?.pendingApprovals ?? [];
  const run = runDetail?.run ?? null;
  const activeConversation = conversationSessions.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeConversationBackendId = conversationBackendId(activeConversation);
  const hasConversation = messages.length > 0 || Boolean(selectedRunId);
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
      const active = current.find((conversation) => conversation.id === activeConversationId);
      if ((!active || (active.source === "local" && !active.backendId && (active.messages ?? []).length === 0)) && merged[0]) {
        queueMicrotask(() => setActiveConversationId(merged[0].id));
      }
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
    if (!activeConversationId && conversationSessions[0]?.id) {
      setActiveConversationId(conversationSessions[0].id);
      setMessages(conversationSessions[0].messages ?? []);
      if (conversationSessions[0].runId) {
        setSelectedRunId(conversationSessions[0].runId);
        selectedRunIdRef.current = conversationSessions[0].runId;
      }
    }
  }, [activeConversationId, conversationSessions]);

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
    if (!selectedProjectId || historyHydratedProjectId === selectedProjectId || messages.length > 0 || selectedRunId) {
      return;
    }
    const persistedMessages = conversationTurnsToMessages(dashboard?.conversation?.recentTurns ?? []);
    if (persistedMessages.length > 0) {
      setMessages(persistedMessages.slice(-32));
    }
    setHistoryHydratedProjectId(selectedProjectId);
  }, [dashboard?.conversation?.recentTurns, historyHydratedProjectId, messages.length, selectedProjectId, selectedRunId]);

  async function selectConversation(conversationId) {
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
    stream.onopen = () => setLiveStatus("live");
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
    stream.onerror = () => setLiveStatus("degraded");

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

  function stageClarificationAnswer(answer) {
    const text = compactText(answer);
    if (!text) {
      composerInputRef.current?.focus();
      return;
    }
    setDraft((current) => ({
      ...current,
      objective: text
    }));
    setFeedback({ tone: "info", text: t.clarificationReady });
    requestAnimationFrame(() => composerInputRef.current?.focus());
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

  async function reviewMission() {
    const objective = draft.objective.trim();
    if (!objective || !selectedProjectId) {
      return;
    }
    setFeedback(null);
    setPreflight(null);
    setConfirmedDraft(null);
    setSelectedRunId(null);
    selectedRunIdRef.current = null;
    setRunDetail(null);
    appendMessage({ role: "user", kind: "mission", text: objective });
    const activeConversationForRequest = conversationSessions.find((conversation) => conversation.id === activeConversationId);
    const backendConversationId = conversationBackendId(activeConversationForRequest);
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
            recentMessages: messages.slice(-8).map((message) => ({
              role: message.role,
              kind: message.kind,
              text: message.text
            }))
          },
          missionSpec: buildMissionSpec(draft, {
            includeMode: draft.modeTouched && Boolean(draft.mode)
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
      if (response.conversation && activeConversationId) {
        setConversationSessions((current) => sortConversations(current.map((conversation) => {
          if (conversation.id !== activeConversationId) {
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
          <span className={`live-pill ${liveStatus}`}>{liveStatus === "live" ? t.live : liveStatus === "connecting" ? t.connecting : t.degraded}</span>
          <button type="button" className="ghost small" onClick={startNewMission}>{t.new}</button>
          <a className="secondary small link-button" href="/admin">{t.openAdmin}</a>
        </div>
      </header>

      {feedback ? <div className={`react-feedback ${feedback.tone ?? ""}`}>{feedback.text}</div> : null}

      <main className={`react-cowork-main ${historyOpen ? "history-open" : "history-collapsed"} ${inspectorOpen ? "inspector-open" : "inspector-collapsed"}`}>
        <ConversationSidebar
          conversations={conversationSessions}
          activeConversationId={activeConversationId}
          onSelect={selectConversation}
          onNew={startNewMission}
          open={historyOpen}
          onToggle={() => setHistoryOpen((current) => !current)}
          locale={locale}
          t={t}
        />
        <section className="conversation-surface">
          <div className="conversation-thread" ref={transcriptRef} aria-live="polite">
            {!hasConversation ? <EmptyConversation t={t} /> : null}
            {selectedRunId && run ? <RunReviewIntro run={run} t={t} /> : null}
            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onStartMission={startMission}
                onClarificationAnswer={stageClarificationAnswer}
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
        </section>
        <ActivityPanel
          run={run}
          runDetail={runDetail}
          events={activityEvents}
          runs={runs}
          selectedRunId={selectedRunId}
          conversation={activeConversation}
          conversationId={activeConversationBackendId}
          onOpenRun={openRun}
          open={inspectorOpen}
          onToggle={() => setInspectorOpen((current) => !current)}
          pendingApprovals={pendingApprovals}
          liveStatus={liveStatus}
          locale={locale}
          t={t}
        />
      </main>
    </div>
  );
}

function ConversationSidebar({ conversations, activeConversationId, onSelect, onNew, open, onToggle, locale, t }) {
  if (!open) {
    return (
      <aside className="conversation-sidebar collapsed" aria-label={t.conversations} data-testid="conversation-sidebar">
        <button type="button" className="side-rail-button" onClick={onToggle} aria-label={t.openConversations} title={t.openConversations}>
          <span>|||</span>
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
          <button type="button" className="ghost small" onClick={onToggle}>{t.collapse}</button>
        </div>
      </div>
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

function ActivityPanel({ run, runDetail, events, runs, selectedRunId, conversation, conversationId, onOpenRun, open, onToggle, pendingApprovals, liveStatus, locale, t }) {
  const linkedRunIds = new Set([
    ...(Array.isArray(conversation?.metadata?.linkedRunIds) ? conversation.metadata.linkedRunIds : []),
    conversation?.metadata?.latestRunId,
    conversation?.runId
  ].filter(Boolean));
  const hasConversationScope = Boolean(conversationId) || linkedRunIds.size > 0;
  const matchesConversation = (candidate) => {
    if (!candidate) {
      return false;
    }
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
  const traceItems = runTraceItems({
    scopedRun,
    events: scopedEvents,
    approvals: scopedPendingApprovals,
    artifacts,
    evidence,
    calls,
    t
  });
  const capabilitySummary = runCapabilitySummary(scopedRun, scopedRunDetail);
  if (!open) {
    return (
      <aside className="activity-panel collapsed" aria-label={t.runInspector} data-testid="run-inspector">
        <button type="button" className="side-rail-button" onClick={onToggle} aria-label={t.openInspector} title={t.openInspector}>
          <span>i</span>
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
          <button type="button" className="ghost small" onClick={onToggle}>{t.collapse}</button>
        </div>
      </div>

      <section className="activity-section">
        <h3>{t.currentRun}</h3>
        {scopedRun ? (
          <div className="activity-card">
            <strong>{scopedRun.metadata?.missionSpec?.objective ?? scopedRun.mission ?? t.selectedMission}</strong>
            <span>{t.status}: {scopedRun.status}</span>
            <small>{t.updated}: {formatDate(scopedRun.updatedAt ?? scopedRun.createdAt, locale)}</small>
            {scopedPendingApprovals.length > 0 ? <span className="mini-badge warn">{t.confirmationNeeded}</span> : null}
          </div>
        ) : <p className="muted">{t.noRunSelected}</p>}
      </section>

      <section className="activity-section">
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
      </section>

      <section className="activity-section">
        <h3>{t.decisionTrace}</h3>
        <div className="inspector-grid">
          <span>{t.frame}<strong>{capabilitySummary.frame || t.notAvailable}</strong></span>
          <span>{t.capability}<strong>{capabilitySummary.capability || t.notAvailable}</strong></span>
          <span>{t.skill}<strong>{capabilitySummary.skill || t.notAvailable}</strong></span>
          <span>{t.policy}<strong>{capabilitySummary.policy || t.notAvailable}</strong></span>
        </div>
      </section>

      <section className="activity-section">
        <h3>{t.artifacts}</h3>
        {artifacts.length === 0 ? <p className="muted">{t.noArtifacts}</p> : null}
        {artifacts.slice(0, 8).map((artifact, index) => (
          <a className="activity-link" key={artifact.id ?? artifact.path ?? index} href={artifact.href ?? artifact.url ?? "#"} target="_blank" rel="noreferrer">
            <strong>{artifact.title ?? artifact.name ?? artifact.path ?? `Artifact ${index + 1}`}</strong>
            {artifact.description ? <span>{artifact.description}</span> : null}
          </a>
        ))}
      </section>

      <section className="activity-section">
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

      <section className="activity-section">
        <h3>{t.recentActions}</h3>
        {scopedEvents.length === 0 ? <p className="muted">{t.noRecentActions}</p> : null}
        <ul className="activity-timeline">
          {scopedEvents.slice(0, 10).map((event) => (
            <li key={technicalEventKey(event)}>
              <span>{eventLabel(event)}</span>
              <small>{event.type} · {formatDate(event.createdAt, locale)}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="activity-section">
        <h3>{t.generation}</h3>
        {calls.length === 0 ? <p className="muted">0 {t.llmCalls}</p> : null}
        <ul className="activity-timeline compact">
          {calls.slice(-6).reverse().map((call) => (
            <li key={call.id}>
              <span>{call.callType}</span>
              <small>{call.resultStatus} · {call.tokenUsage?.totalTokens ?? 0} {t.tokens}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="activity-section">
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
    </aside>
  );
}

function EmptyConversation({ t }) {
  const examples = [
    "Ouvre mon navigateur et cherche les dernières informations sur un sujet.",
    "Observe la fenêtre active et dis-moi ce qui manque.",
    "Fais une recherche puis capture une preuve exploitable."
  ];
  return (
    <div className="empty-conversation">
      <div className="orbital-mark" aria-hidden="true" />
      <p className="eyebrow">{t.jonDesktop}</p>
      <h1>{t.emptyTitle}</h1>
      <p>{t.emptySubtitle}</p>
      <div className="example-row">
        {examples.map((example) => <span key={example}>{example}</span>)}
      </div>
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
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              onReview();
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

function Message({ message, onStartMission, onClarificationAnswer, busy, t }) {
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

function TurnMessage({ message, onStartMission, onClarificationAnswer, busy, t }) {
  const turn = message.turn ?? {};
  const understanding = normalizePreflight(message.preflight);
  const requiresClarification = Boolean(turn.requiresClarification || understanding?.requiresClarification);
  const clarificationQuestion = turn.clarificationQuestion || understanding?.clarificationQuestion || t.clarificationFallback;
  const clarificationOptions = Array.isArray(understanding?.clarificationOptions)
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
          <ClarificationCard
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

function ClarificationCard({ question, options = [], onAnswer, t }) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  return (
    <div className="clarification-card" data-testid="clarification-card">
      <div>
        <strong>{t.clarificationNeededTitle}</strong>
        <p>{question || t.clarificationFallback}</p>
      </div>
      {normalizedOptions.length > 0 ? (
        <div className="clarification-options" aria-label={t.clarificationOptions}>
          {normalizedOptions.slice(0, 6).map((option) => {
            const label = compactText(option?.label ?? option?.name ?? option?.id ?? option);
            const value = compactText(option?.reply ?? option?.value ?? clarificationAnswerText(option, t));
            return (
              <button type="button" key={`${label}-${value}`} onClick={() => onAnswer?.(value || label)}>
                {label}
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
  return (
    <article className={`react-message assistant ${requiresClarification ? "warn" : "ok"}`}>
      <div className="react-avatar">JON</div>
      <div className="react-bubble preflight-bubble">
        {message.meta ? <p className="chat-meta">{message.meta}</p> : null}
        <p>{understanding.missionSummary ?? understanding.clarifiedObjective ?? message.text}</p>
        {requiresClarification ? (
          <ClarificationCard
            question={understanding.clarificationQuestion}
            options={understanding.clarificationOptions}
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

createRoot(document.getElementById("cowork-user-root")).render(<App />);
