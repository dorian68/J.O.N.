import { normalizeUiBlocks } from "./ui-blocks.js";

const FINAL_STATUSES = new Set(["completed", "failed", "stopped", "cancelled"]);
const RUNNING_STATUSES = new Set(["queued", "pending", "running", "in_progress"]);
const WAITING_STATUSES = new Set(["paused", "waiting", "waiting_for_input", "approval_pending"]);

const COPY = Object.freeze({
  fr: {
    done: "C’est fait.",
    blocked: "Je suis bloqué pour l’instant.",
    partial: "J’ai avancé, mais je ne peux pas encore considérer la mission comme terminée.",
    working: "Je travaille dessus.",
    waitingApproval: "Je suis en pause : j’ai besoin de ton accord pour continuer.",
    failed: "Je n’ai pas pu terminer la mission.",
    proofLinked: "La preuve est liée au run.",
    noProofYet: "Il manque encore une preuve exploitable.",
    next: "Prochaine action",
    resultTitle: "Résumé du résultat",
    proofTitle: "Preuve",
    approvalTitle: "Accord nécessaire",
    recoveryTitle: "Récupération proposée",
    artifactTitle: "Artefact",
    terminalTitle: "Le terminal attend une réponse",
    objectiveSatisfied: "objectif vérifié",
    objectiveNotSatisfied: "objectif non vérifié",
    objectivePending: "vérification en cours",
    liveObserve: "J’observe l’état du workspace.",
    liveAct: "J’exécute l’action autorisée.",
    liveVerify: "Je compare le résultat avec ton objectif.",
    liveEvidence: "Je capture ou relie une preuve.",
    liveApproval: "J’attends ton accord avant de continuer.",
    liveBlocked: "Je prépare une récupération propre."
  },
  en: {
    done: "Done.",
    blocked: "I’m blocked for now.",
    partial: "I made progress, but I can’t mark the mission complete yet.",
    working: "I’m working on it.",
    waitingApproval: "I’m paused: I need your approval to continue.",
    failed: "I couldn’t complete the mission.",
    proofLinked: "The proof is linked to this run.",
    noProofYet: "Usable proof is still missing.",
    next: "Next action",
    resultTitle: "Result summary",
    proofTitle: "Proof",
    approvalTitle: "Approval needed",
    recoveryTitle: "Recovery plan",
    artifactTitle: "Artifact",
    terminalTitle: "The terminal is waiting for input",
    objectiveSatisfied: "objective verified",
    objectiveNotSatisfied: "objective not verified",
    objectivePending: "verification in progress",
    liveObserve: "I’m observing the workspace state.",
    liveAct: "I’m running the approved action.",
    liveVerify: "I’m comparing the result with your objective.",
    liveEvidence: "I’m capturing or linking proof.",
    liveApproval: "I’m waiting for your approval before continuing.",
    liveBlocked: "I’m preparing a clean recovery."
  }
});

function localeCopy(locale) {
  return COPY[String(locale ?? "").toLowerCase().startsWith("en") ? "en" : "fr"];
}

function cleanText(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function compactList(value, maxItems = 6) {
  return asArray(value).map((entry) => cleanText(entry, 220)).filter(Boolean).slice(0, maxItems);
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function missionSpecFromRun(run = {}) {
  return run.metadata?.missionSpec ?? run.plan?.missionSpec ?? {};
}

function proofRequired(run = {}) {
  const objective = `${run.mission ?? ""} ${missionSpecFromRun(run).objective ?? ""}`.toLowerCase();
  return /\b(capture|screenshot|preuve|capture d.?écran|proof|evidence|screen)\b/i.test(objective)
    || Boolean(run.metadata?.missionProgress?.proof?.required);
}

function evidenceLabel(item, index = 0) {
  return firstText(item.label, item.description, item.kind, item.evidenceType, item.path, item.storagePath, `Evidence ${index + 1}`);
}

function evidenceHref(run, item) {
  if (!run?.id || !item?.id) {
    return cleanText(item?.href ?? item?.url ?? "", 300);
  }
  if (item.hasScreenshot || item.metadata?.screenshotPath || item.kind === "screenshot" || item.evidenceType === "screenshot") {
    return `/api/runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(item.id)}/screenshot`;
  }
  return cleanText(item.href ?? item.url ?? "", 300);
}

function browserStateFromEvidence(evidence = []) {
  return asArray(evidence)
    .map((item) => item.metadata?.browserState)
    .filter(Boolean)
    .at(-1) ?? null;
}

function deriveVerification({ run = {}, evidence = [], artifacts = [] } = {}) {
  const semantic = run.metadata?.semanticVerification ?? run.metadata?.missionProgress?.semanticVerification ?? null;
  const missionProgress = run.metadata?.missionProgress ?? null;
  const objectiveSatisfied = semantic?.objectiveSatisfied === true || semantic?.verifiedByOutcomes === true;
  const explicitUnsatisfied = semantic?.objectiveSatisfied === false || semantic?.verifiedByOutcomes === false;
  const requiredProof = proofRequired(run);
  const evidenceUsed = compactList(
    semantic?.evidenceUsed
      ?? missionProgress?.proof?.evidenceUsedInVerification
      ?? evidence.map((item) => item.id ?? evidenceLabel(item)),
    10
  );
  const missingEvidence = compactList(
    semantic?.missingEvidence
      ?? missionProgress?.proof?.missingEvidence
      ?? (requiredProof && evidence.length === 0 ? ["screenshot"] : []),
    10
  );
  let verdict = cleanText(semantic?.verificationVerdict ?? semantic?.verdict, 40);
  if (!verdict) {
    if (objectiveSatisfied) {
      verdict = "satisfied";
    } else if (run.status === "failed") {
      verdict = "failed";
    } else if (run.status === "paused" || missingEvidence.length > 0 || explicitUnsatisfied) {
      verdict = "partial";
    } else {
      verdict = FINAL_STATUSES.has(run.status) ? "blocked" : "pending";
    }
  }
  return {
    objectiveSatisfied,
    explicitUnsatisfied,
    verdict,
    confidence: Number.isFinite(Number(semantic?.confidence)) ? Number(semantic.confidence) : null,
    evidenceUsed,
    missingEvidence,
    proofRequired: requiredProof,
    proofAvailable: evidence.length > 0,
    artifactsAvailable: artifacts.length > 0,
    failureReason: firstText(semantic?.failureReason, semantic?.reason, run.metadata?.userFacingError, run.summary),
    nextBestAction: firstText(
      semantic?.nextBestAction,
      missionProgress?.semanticVerification?.nextBestAction,
      missionProgress?.nextAction?.summary,
      run.metadata?.nextBestAction
    )
  };
}

function statusForPlanStep(step, runStatus, linkedStatus = "") {
  const raw = cleanText(linkedStatus || step.status || step.state || "", 40).toLowerCase();
  if (["done", "completed", "succeeded", "verified"].includes(raw)) return "completed";
  if (["failed", "error"].includes(raw)) return "failed";
  if (["blocked", "paused", "waiting"].includes(raw)) return "blocked";
  if (["cancelled", "skipped"].includes(raw)) return raw;
  if (["running", "active", "in_progress"].includes(raw)) return "active";
  if (FINAL_STATUSES.has(runStatus)) return "completed";
  return "planned";
}

function buildPlan(run = {}, verification = {}, toolCalls = []) {
  const rawSteps = asArray(
    run.plan?.steps
      ?? run.metadata?.missionProgress?.plan?.steps
      ?? run.metadata?.browserPlan?.steps
  );
  if (rawSteps.length > 0) {
    return rawSteps.slice(0, 12).map((step, index) => ({
      id: cleanText(step.id, 80) || `step_${index + 1}`,
      label: firstText(step.label, step.title, step.objective, step.description, step.action, `Step ${index + 1}`),
      status: statusForPlanStep(
        step,
        run.status,
        toolCalls.find((call) => call.stepId && call.stepId === step.id)?.status
      ),
      reason: firstText(step.reason, step.detail, step.rationale, step.action)
    }));
  }
  return [
    {
      id: "understand",
      label: firstText(missionSpecFromRun(run).objective, run.mission, "Understand the mission"),
      status: run.id ? "completed" : "active",
      reason: ""
    },
    {
      id: "act",
      label: "Act on the needed workspace surface",
      status: run.status === "failed" ? "failed" : run.status === "paused" ? "blocked" : FINAL_STATUSES.has(run.status) ? "completed" : "active",
      reason: firstText(run.summary)
    },
    {
      id: "verify",
      label: "Verify the user objective",
      status: verification.objectiveSatisfied ? "completed" : FINAL_STATUSES.has(run.status) ? "blocked" : "planned",
      reason: verification.failureReason
    }
  ];
}

function toolNameFromPrimitive(primitive = "", payload = {}) {
  const source = `${primitive} ${payload.tool ?? ""} ${payload.action ?? ""} ${payload.surface ?? ""}`.toLowerCase();
  if (source.includes("terminal") && /(inject|write|input|send)/.test(source)) return "terminal.injectInput";
  if (source.includes("terminal")) return "terminal.read";
  if (source.includes("artifact")) return "artifact.create";
  if (source.includes("file") && /(write|save|create)/.test(source)) return "file.write";
  if (/(verify|semantic|outcome|check)/.test(source)) return "verifier.checkOutcome";
  if (source.includes("browser") && /(dom|extract|content|read)/.test(source)) return "browser.extractDom";
  if (source.includes("browser") && /(screenshot|capture)/.test(source)) return "browser.captureScreenshot";
  if (source.includes("browser") && /(navigate|search|url|page|go)/.test(source)) return "browser.navigate";
  if (source.includes("browser") && /(open|launch|start)/.test(source)) return "browser.open";
  if (/(screenshot|capture)/.test(source)) return "desktop.captureScreenshot";
  if (/(type|write_text|text|input)/.test(source)) return "desktop.typeText";
  if (/(focus|activate|window)/.test(source)) return "desktop.focusWindow";
  if (/(launch|open|start|application|app)/.test(source)) return "desktop.launchApplication";
  return cleanText(payload.tool ?? primitive, 80) || "workspace.action";
}

function toolStatusFromEvent(type, payload = {}) {
  const explicit = cleanText(payload.status ?? payload.resultStatus ?? "", 40).toLowerCase();
  if (["planned", "running", "succeeded", "failed", "skipped", "blocked"].includes(explicit)) return explicit;
  if (type.endsWith(".planned") || type.includes("plan")) return "planned";
  if (type.endsWith(".started") || type.endsWith(".running")) return "running";
  if (type.includes("blocked") || type.includes("failed") || type.includes("error")) return "failed";
  if (type.includes("skipped")) return "skipped";
  if (type.includes("requested")) return "planned";
  if (type.includes("resolved") || type.includes("granted") || type.includes("recorded") || type.includes("created") || type.includes("completed") || type.includes("executed")) {
    return "succeeded";
  }
  return "succeeded";
}

function eventToToolCall(event = {}, index = 0, context = {}) {
  const type = cleanText(event.type, 120);
  const payload = event.payload ?? {};
  if (!type) return null;

  let tool = "";
  if (type.startsWith("tool.")) {
    tool = toolNameFromPrimitive(payload.primitive ?? payload.tool ?? type, payload);
  } else if (type === "evidence.recorded") {
    const evidence = context.evidenceById?.get(payload.evidenceId) ?? null;
    const isBrowser = Boolean(evidence?.metadata?.browserState || payload.surface === "browser" || payload.browserState);
    tool = isBrowser ? "browser.captureScreenshot" : "desktop.captureScreenshot";
  } else if (type === "artifact.created") {
    tool = "artifact.create";
  } else if (type === "approval.requested") {
    tool = "approval.request";
  } else if (type === "approval.resolved" || type === "approval.granted") {
    tool = "approval.resolve";
  } else if (type.includes("verification") || type.includes("semantic")) {
    tool = "verifier.checkOutcome";
  } else if (type.startsWith("browser.")) {
    tool = toolNameFromPrimitive(type, { ...payload, surface: "browser" });
  } else if (type.startsWith("desktop.")) {
    tool = toolNameFromPrimitive(type, { ...payload, surface: "desktop" });
  } else if (type.includes("terminal")) {
    tool = /(inject|write|send|stdin)/i.test(type) ? "terminal.injectInput" : "terminal.read";
  } else {
    return null;
  }

  const durationMs = Number.isFinite(Number(payload.durationMs ?? payload.latencyMs))
    ? Number(payload.durationMs ?? payload.latencyMs)
    : null;
  const evidenceId = cleanText(payload.evidenceId, 120);
  const inputSummary = firstText(payload.inputSummary, payload.actionLabel, payload.primitive, payload.url, payload.target, payload.query);
  const outputSummary = firstText(payload.outputSummary, payload.resultSummary, payload.summary, payload.reason, event.summary);
  return {
    id: cleanText(payload.toolCallId, 120) || cleanText(event.id, 120) || `${type}_${index}`,
    toolCallId: cleanText(payload.toolCallId, 120),
    stepId: cleanText(payload.stepId, 120),
    toolName: tool,
    tool,
    reason: firstText(payload.reason, payload.rationale, event.summary, inputSummary),
    status: toolStatusFromEvent(type, payload),
    inputSummary,
    outputSummary,
    evidenceId,
    durationMs,
    createdAt: event.createdAt ?? null
  };
}

function dedupeToolCalls(calls = []) {
  const byKey = new Map();
  for (const call of calls) {
    if (!call?.tool) continue;
    const key = call.toolCallId || [call.tool, call.inputSummary, call.evidenceId, call.createdAt].filter(Boolean).join("|") || call.id;
    const existing = byKey.get(key);
    if (!existing || statusWeight(call.status) >= statusWeight(existing.status)) {
      byKey.set(key, call);
    }
  }
  return Array.from(byKey.values()).slice(-20);
}

function statusWeight(status) {
  return { planned: 1, running: 2, skipped: 3, blocked: 4, failed: 5, succeeded: 6 }[status] ?? 0;
}

function buildToolCalls(events = [], evidence = []) {
  const evidenceById = new Map(asArray(evidence).map((item) => [item.id, item]));
  const calls = asArray(events)
    .slice()
    .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
    .map((event, index) => eventToToolCall(event, index, { evidenceById }))
    .filter(Boolean);
  return dedupeToolCalls(calls);
}

function activeBlocker(run = {}, verification = {}, approvals = []) {
  const approval = asArray(approvals).find((entry) => !entry.decision || entry.status === "pending");
  if (approval) {
    return firstText(approval.reason, approval.actionLabel, "Approval is required.");
  }
  const manualBrowserHandoff = run.metadata?.manualBrowserHandoff;
  if (manualBrowserHandoff?.awaitingUser) {
    return firstText(manualBrowserHandoff.reason, manualBrowserHandoff.userAction, run.summary);
  }
  if (run.status === "failed") {
    return verification.failureReason || run.summary || "Run failed.";
  }
  if (verification.explicitUnsatisfied || verification.missingEvidence.length > 0) {
    return verification.failureReason || verification.missingEvidence.join(", ");
  }
  const blocker = asArray(run.metadata?.missionProgress?.blockers).at(-1);
  return firstText(blocker?.reason, blocker?.summary, blocker);
}

function buildNaturalReply({ run = {}, verification = {}, evidence = [], artifacts = [], approvals = [], locale = "fr" } = {}) {
  const copy = localeCopy(locale);
  const objective = firstText(missionSpecFromRun(run).objective, run.mission);
  const blocker = activeBlocker(run, verification, approvals);
  const nextAction = verification.nextBestAction || firstText(asArray(run.metadata?.missionProgress?.nextSteps).at(0));
  const proofText = evidence.length > 0 ? copy.proofLinked : verification.proofRequired ? copy.noProofYet : "";
  const artifactText = artifacts.length > 0
    ? (localeCopy(locale) === COPY.fr ? `${artifacts.length} artefact(s) prêt(s).` : `${artifacts.length} artifact(s) ready.`)
    : "";

  if (run.status === "paused" && run.metadata?.manualBrowserHandoff?.awaitingUser) {
    const action = firstText(run.metadata.manualBrowserHandoff.userAction);
    return [
      localeCopy(locale) === COPY.fr ? "Je suis en pause dans le navigateur." : "I’m paused in the browser.",
      blocker ? blocker : "",
      action ? `${copy.next}: ${action}` : ""
    ].filter(Boolean).join(" ");
  }

  if (approvals.length > 0 || run.status === "paused") {
    return [
      copy.waitingApproval,
      blocker ? blocker : "",
      nextAction ? `${copy.next}: ${nextAction}` : ""
    ].filter(Boolean).join(" ");
  }

  if (verification.objectiveSatisfied && run.status === "completed") {
    const detail = objective
      ? (localeCopy(locale) === COPY.fr ? `J’ai traité la mission : ${objective}.` : `I handled the mission: ${objective}.`)
      : "";
    return [copy.done, detail, proofText, artifactText].filter(Boolean).join(" ");
  }

  if (run.status === "failed") {
    return [copy.failed, blocker, nextAction ? `${copy.next}: ${nextAction}` : ""].filter(Boolean).join(" ");
  }

  if (FINAL_STATUSES.has(run.status) && !verification.objectiveSatisfied) {
    return [copy.partial, blocker, nextAction ? `${copy.next}: ${nextAction}` : ""].filter(Boolean).join(" ");
  }

  if (RUNNING_STATUSES.has(run.status) || WAITING_STATUSES.has(run.lifecycleStage)) {
    return [copy.working, currentWorkingStatus({ run, verification, approvals, evidence, locale })].filter(Boolean).join(" ");
  }

  if (blocker) {
    return [copy.blocked, blocker, nextAction ? `${copy.next}: ${nextAction}` : ""].filter(Boolean).join(" ");
  }

  return [copy.working, objective ? (localeCopy(locale) === COPY.fr ? `Objectif : ${objective}.` : `Objective: ${objective}.`) : ""].filter(Boolean).join(" ");
}

function currentWorkingStatus({ run = {}, verification = {}, approvals = [], evidence = [], locale = "fr" } = {}) {
  const copy = localeCopy(locale);
  if (run.status === "paused" && run.metadata?.manualBrowserHandoff?.awaitingUser) {
    return localeCopy(locale) === COPY.fr
      ? "J’attends ton action manuelle dans le navigateur."
      : "I’m waiting for your manual action in the browser.";
  }
  if (approvals.length > 0 || run.status === "paused") return copy.liveApproval;
  if (run.status === "failed" || verification.explicitUnsatisfied) return copy.liveBlocked;
  if (verification.objectiveSatisfied) return copy.liveVerify;
  if (evidence.length > 0) return copy.liveVerify;
  const latestStage = cleanText(run.lifecycleStage, 80).toLowerCase();
  if (latestStage.includes("evidence") || latestStage.includes("screenshot")) return copy.liveEvidence;
  if (latestStage.includes("observe") || latestStage.includes("inspect")) return copy.liveObserve;
  return RUNNING_STATUSES.has(run.status) ? copy.liveAct : copy.liveObserve;
}

function buildUiBlocks({ run = {}, verification = {}, evidence = [], artifacts = [], approvals = [], events = [], locale = "fr" } = {}) {
  const copy = localeCopy(locale);
  const blocks = [];
  const blocker = activeBlocker(run, verification, approvals);
  const terminalWaiting = asArray(events).find((event) => {
    const payload = event.payload ?? {};
    return String(event.type ?? "").includes("terminal")
      && ["waiting_for_input", "needs_attention"].includes(payload.terminalStatus ?? payload.status);
  });
  if (approvals.length > 0) {
    const approval = approvals[0];
    blocks.push({
      id: `approval_${approval.id ?? "pending"}`,
      type: "approvalCard",
      title: copy.approvalTitle,
      actionLabel: firstText(approval.actionLabel, approval.category, "Approval required"),
      reason: firstText(approval.reason, approval.expectedEffect),
      riskLevel: cleanText(approval.riskLevel, 40)
    });
  }
  if (run.status === "paused" && run.metadata?.manualBrowserHandoff?.awaitingUser) {
    const handoff = run.metadata.manualBrowserHandoff;
    blocks.push({
      id: "manual_browser_handoff",
      type: "nextStepCard",
      title: localeCopy(locale) === COPY.fr ? "Action manuelle nécessaire" : "Manual action needed",
      text: firstText(handoff.userAction, blocker),
      status: "waiting_user",
      runId: run.id
    });
  }
  if (terminalWaiting) {
    const payload = terminalWaiting.payload ?? {};
    blocks.push({
      id: "terminal_prompt",
      type: "terminalPromptCard",
      title: copy.terminalTitle,
      terminalId: cleanText(payload.terminalId, 120),
      prompt: firstText(payload.lastPrompt, payload.recentOutput, payload.reason, terminalWaiting.summary),
      suggestedReply: firstText(payload.suggestedReply, payload.suggestion),
      requiresApproval: payload.requiresApproval !== false
    });
  }
  blocks.push({
    id: "result_summary",
    type: "resultSummary",
    title: copy.resultTitle,
    status: run.status ?? "",
    verdict: verification.verdict,
    objectiveSatisfied: verification.objectiveSatisfied,
    summary: firstText(run.summary, verification.failureReason),
    bullets: [
      verification.objectiveSatisfied ? copy.objectiveSatisfied : verification.explicitUnsatisfied ? copy.objectiveNotSatisfied : copy.objectivePending,
      evidence.length > 0 ? copy.proofLinked : verification.proofRequired ? copy.noProofYet : "",
      artifacts.length > 0 ? `${artifacts.length} ${localeCopy(locale) === COPY.fr ? "artefact(s)" : "artifact(s)"}` : ""
    ].filter(Boolean)
  });
  const proof = asArray(evidence).find((item) => item.hasScreenshot || item.metadata?.screenshotPath || item.href || item.url) ?? evidence[0];
  if (proof) {
    blocks.push({
      id: `proof_${proof.id ?? "item"}`,
      type: "proofCard",
      title: copy.proofTitle,
      label: evidenceLabel(proof),
      description: firstText(proof.description, proof.linkedSurface, proof.kind, proof.evidenceType),
      href: evidenceHref(run, proof),
      evidenceId: cleanText(proof.id, 120),
      kind: cleanText(proof.kind ?? proof.evidenceType, 80)
    });
  }
  const artifact = artifacts[0];
  if (artifact) {
    blocks.push({
      id: `artifact_${artifact.id ?? "item"}`,
      type: "artifactPreview",
      title: firstText(artifact.title, artifact.name, copy.artifactTitle),
      description: firstText(artifact.description, artifact.summary, artifact.storagePath),
      href: cleanText(artifact.href ?? artifact.url ?? "", 300),
      artifactId: cleanText(artifact.id, 120),
      format: cleanText(artifact.format ?? artifact.artifactType, 60)
    });
  }
  if (blocker && (run.status === "failed" || verification.explicitUnsatisfied || verification.missingEvidence.length > 0)) {
    blocks.push({
      id: "error_recovery",
      type: "errorRecoveryCard",
      title: copy.recoveryTitle,
      blocker,
      recovery: verification.nextBestAction || "",
      retryable: run.status !== "completed"
    });
  }
  if (verification.nextBestAction) {
    blocks.push({
      id: "next_step",
      type: "nextStepCard",
      title: copy.next,
      action: verification.nextBestAction,
      reason: blocker
    });
  }
  return normalizeUiBlocks(blocks);
}

function buildState({ run = {}, evidence = [], artifacts = [], approvals = [], verification = {} } = {}) {
  const snapshot = run.metadata?.workspaceStateSnapshot ?? run.metadata?.stateSnapshot ?? {};
  const browserState = browserStateFromEvidence(evidence);
  return {
    activeWindow: firstText(snapshot.activeWindow?.title, snapshot.activeWindow, run.metadata?.desktopObservationSummary?.activeWindow),
    activeBrowser: firstText(browserState?.title, snapshot.browser?.title, snapshot.activeBrowser?.title),
    activeBrowserUrl: firstText(browserState?.url, snapshot.browser?.url, snapshot.activeBrowser?.url),
    activeTerminal: firstText(snapshot.activeTerminal?.label, snapshot.terminal?.label, snapshot.activeTerminal),
    pendingApprovals: approvals.length,
    evidenceCount: evidence.length,
    artifactCount: artifacts.length,
    blockage: activeBlocker(run, verification, approvals),
    nextAction: verification.nextBestAction || firstText(asArray(run.metadata?.missionProgress?.nextSteps).at(0))
  };
}

function buildExecutionThread({ run = {}, events = [], approvals = [], evidence = [], artifacts = [], verification = {} } = {}) {
  const spec = missionSpecFromRun(run);
  const toolCalls = buildToolCalls(events, evidence);
  return {
    mission: {
      objective: firstText(spec.objective, run.mission),
      deliverable: firstText(spec.deliverable, run.metadata?.expectedDeliverable),
      constraints: compactList(spec.constraints ?? run.metadata?.constraints, 8),
      status: run.status ?? "unknown"
    },
    plan: buildPlan(run, verification, toolCalls),
    toolCalls,
    state: buildState({ run, evidence, artifacts, approvals, verification }),
    verification: {
      objectiveSatisfied: verification.objectiveSatisfied,
      verdict: verification.verdict,
      confidence: verification.confidence,
      evidenceUsed: verification.evidenceUsed,
      missingEvidence: verification.missingEvidence,
      proofRequired: verification.proofRequired,
      proofAvailable: verification.proofAvailable
    }
  };
}

export function buildConversationResponsePlan({
  run = {},
  review = null,
  events = [],
  pendingApprovals = [],
  approvals = [],
  evidence = [],
  artifacts = [],
  locale = "fr"
} = {}) {
  const mergedApprovals = asArray(pendingApprovals).length > 0
    ? asArray(pendingApprovals)
    : asArray(approvals).filter((approval) => !approval.decision || approval.status === "pending");
  const reviewArtifacts = asArray(review?.artifacts);
  const mergedArtifacts = [...asArray(artifacts), ...reviewArtifacts]
    .filter((item, index, all) => item && all.findIndex((candidate) => (candidate.id ?? candidate.href ?? candidate.title) === (item.id ?? item.href ?? item.title)) === index);
  const verification = deriveVerification({ run, evidence: asArray(evidence), artifacts: mergedArtifacts });
  const naturalReply = buildNaturalReply({
    run,
    verification,
    evidence: asArray(evidence),
    artifacts: mergedArtifacts,
    approvals: mergedApprovals,
    locale
  });
  const executionThread = buildExecutionThread({
    run,
    events: asArray(events),
    approvals: mergedApprovals,
    evidence: asArray(evidence),
    artifacts: mergedArtifacts,
    verification
  });
  const uiBlocks = buildUiBlocks({
    run,
    verification,
    evidence: asArray(evidence),
    artifacts: mergedArtifacts,
    approvals: mergedApprovals,
    events: asArray(events),
    locale
  });
  return {
    naturalReply,
    currentWorkingStatus: currentWorkingStatus({
      run,
      verification,
      approvals: mergedApprovals,
      evidence: asArray(evidence),
      locale
    }),
    uiBlocks,
    executionThread,
    whereAreWe: {
      status: run.status ?? "unknown",
      objectiveSatisfied: verification.objectiveSatisfied,
      verdict: verification.verdict,
      blocker: executionThread.state.blockage,
      nextAction: executionThread.state.nextAction
    }
  };
}
