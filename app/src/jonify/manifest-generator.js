// Manifest generator — assembles the jonification.manifest.json from observations.
// JON generates this; the user only validates ambiguity (see humanReview).

import { detectSurfaces } from "./surface-detector.js";
import { discoverActions } from "./action-discovery.js";
import { inferWorkflows } from "./workflow-inference.js";
import { GLOBAL_SAFETY_RULES } from "./safety-classifier.js";

const SCHEMA_VERSION = "0.1.0";

function appIdFromObservation(observation) {
  const summary = observation.pages?.[0]?.summary ?? observation.summary ?? {};
  const fromData = summary.dataApp ?? null;
  const host = summary.url ? (() => { try { return new URL(summary.url).hostname; } catch { return null; } })() : null;
  const fromTitle = (summary.title ?? "").split(/[—|-]/)[0].trim();
  return (fromData || host || fromTitle || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

export function scoreManifestConfidence(manifest) {
  const all = [
    ...manifest.surfaces.map((s) => s.confidence ?? 0.6),
    ...manifest.actions.map((a) => a.confidence ?? 0.6),
    ...manifest.workflows.map((w) => w.confidence ?? 0.6)
  ];
  if (!all.length) return 0;
  return Number((all.reduce((s, v) => s + v, 0) / all.length).toFixed(2));
}

// Things JON is unsure about → targeted human-review questions (NOT a form).
export function detectManifestGaps(manifest) {
  const questions = [];
  if (manifest.app.businessPurpose) {
    questions.push({ id: "confirm-business-purpose", question: `Cette app sert-elle bien à : « ${manifest.app.businessPurpose} » ?`, suggestedAnswer: "oui" });
  }
  for (const a of manifest.actions) {
    if (a.type === "delete") questions.push({ id: `confirm-delete-${a.id}`, question: `L'action « ${a.name} » supprime-t-elle définitivement un objet ?`, suggestedAnswer: "oui" });
    if (a.type === "send") questions.push({ id: `confirm-send-${a.id}`, question: `« ${a.name} » envoie-t-elle un message/email réel ?`, suggestedAnswer: "oui" });
    if (a.type === "payment") questions.push({ id: `confirm-payment-${a.id}`, question: `« ${a.name} » déclenche-t-elle un paiement réel ?`, suggestedAnswer: "oui" });
  }
  for (const w of manifest.workflows) {
    if (w.needsHumanReview) questions.push({ id: `confirm-workflow-${w.id}`, question: `Le workflow détecté « ${w.name} » est-il correct ?`, suggestedAnswer: "oui" });
  }
  return questions;
}

function inferBusinessPurpose(observation, providedPurpose) {
  if (providedPurpose) return providedPurpose;
  const summary = observation.pages?.[0]?.summary ?? observation.summary ?? {};
  const text = `${summary.title ?? ""} ${(summary.headings ?? []).map((h) => h.text).join(" ")} ${(summary.navLinks ?? []).map((l) => l.label).join(" ")}`.toLowerCase();
  if (/lead|crm|contact|pipeline/.test(text)) return "Gérer des leads / un CRM.";
  if (/invoice|billing|facture/.test(text)) return "Facturation / gestion financière.";
  if (/ticket|support|helpdesk/.test(text)) return "Support / gestion de tickets.";
  return "But métier inféré à confirmer.";
}

export function generateJonificationManifest(observation, { startedAt = null, completedAt = null, businessPurpose = null } = {}) {
  const summary = observation.pages?.[0]?.summary ?? observation.summary ?? {};
  const surfaces = detectSurfaces(observation);
  const actions = surfaces.flatMap((s) => discoverActions(s));
  const workflows = inferWorkflows(surfaces, actions);
  const appId = appIdFromObservation(observation);
  const baseUrl = summary.url ? (() => { try { const u = new URL(summary.url); return `${u.protocol}//${u.host}`; } catch { return null; } })() : null;

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: "JON",
    generationMode: "auto-assisted",
    confidence: 0,
    app: {
      id: appId,
      name: (summary.title ?? appId).split(/[—|-]/)[0].trim() || appId,
      description: `Application observée automatiquement par JON (${surfaces.length} surfaces, ${actions.length} actions).`,
      baseUrl,
      environment: summary.url ? "web" : "unknown",
      businessPurpose: inferBusinessPurpose(observation, businessPurpose)
    },
    discovery: {
      startedAt, completedAt,
      pagesVisited: observation.pages?.length ?? 1,
      elementsDetected: summary.interactive?.length ?? 0,
      actionsDetected: actions.length,
      workflowsInferred: workflows.length,
      requiresHumanReview: false
    },
    surfaces: surfaces.map((s) => ({
      id: s.id, name: s.name, urlPattern: s.urlPattern, type: s.type, purpose: s.purpose, confidence: s.confidence,
      detectedFrom: s.detectedFrom,
      keyElements: (s.elements ?? []).map((el) => ({
        id: el.id, label: el.label ?? el.placeholder ?? el.id, type: el.kind,
        selectorCandidates: el.selectorCandidates, preferredSelector: el.preferredSelector,
        description: `${el.kind} « ${el.label ?? el.placeholder ?? el.id} »`,
        importance: el.testId ? "high" : "medium",
        confidence: el.testId ? 0.82 : 0.65
      }))
    })),
    actions,
    workflows,
    safety: { globalRules: [...GLOBAL_SAFETY_RULES] },
    humanReview: { required: false, questions: [] }
  };

  manifest.confidence = scoreManifestConfidence(manifest);
  manifest.humanReview.questions = detectManifestGaps(manifest);
  manifest.humanReview.required = manifest.confidence < 0.8 || manifest.humanReview.questions.length > 0;
  manifest.discovery.requiresHumanReview = manifest.humanReview.required;
  return manifest;
}

// V2 hook: merge a new observation into an existing manifest (selector/confidence improvement).
export function mergeManifestCandidates(existing, addition) {
  if (!existing) return addition;
  const surfaces = [...existing.surfaces];
  for (const s of addition.surfaces) if (!surfaces.some((x) => x.id === s.id)) surfaces.push(s);
  const actions = [...existing.actions];
  for (const a of addition.actions) if (!actions.some((x) => x.id === a.id)) actions.push(a);
  return { ...existing, surfaces, actions, workflows: existing.workflows.length ? existing.workflows : addition.workflows };
}
