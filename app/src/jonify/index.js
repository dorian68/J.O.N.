// JON-ify orchestrator — the auto-discovery protocol end to end.
//
// JON observes → maps surfaces/actions/workflows → classifies safety → generates
// the manifest itself → validates → produces human-review questions. The user
// only validates ambiguity; they never write the manifest.

import { observeHtml, observeUrl } from "./app-observer.js";
import { generateJonificationManifest, scoreManifestConfidence, detectManifestGaps } from "./manifest-generator.js";
import { validateManifest } from "./manifest-validator.js";
import { simulateWorkflow } from "./workflow-simulator.js";
import { inferWorkflows } from "./workflow-inference.js";
import { observeAccessibility } from "./desktop-adapter.js";
import { executeWorkflow } from "./executor.js";
import { createBrowserWorkflowAdapter, BrowserWorkflowAdapter, inferBrowserAllowlistedHosts } from "./browser-adapter.js";
import { createDesktopWorkflowAdapter, DesktopWorkflowAdapter } from "./desktop-workflow-adapter.js";
import { jonifyCli, parseCliHelp } from "./cli-jonify.js";
import { createCliWorkflowAdapter, CliWorkflowAdapter } from "./cli-adapter.js";
import { classifyApp } from "./app-classifier.js";
import { listJonifiedApps, getJonifiedApp } from "./registry.js";
import { resolveJonifiedAppForMission } from "./mission-resolver.js";

const nowIso = () => null; // timestamps injected by caller to keep this pure/deterministic

// Full pipeline from raw HTML (fixture or captured page).
export function jonifyFromHtml(html, { url = null, businessPurpose = null, startedAt = null, completedAt = null } = {}) {
  const observation = observeHtml(html, { url });
  const manifest = generateJonificationManifest(observation, { startedAt, completedAt, businessPurpose });
  const validation = validateManifest(manifest);
  return { observation, manifest, validation };
}

// V2 — merge several observed pages into one richer manifest (more surfaces /
// actions, higher confidence). Surfaces with the same id keep the richer one.
export function jonifyFromObservations(pages, { businessPurpose = null } = {}) {
  const manifests = pages.map((p) => generateJonificationManifest(observeHtml(p.html, { url: p.url }), { businessPurpose }));
  const surfacesById = new Map();
  for (const m of manifests) for (const s of m.surfaces) {
    const prev = surfacesById.get(s.id);
    if (!prev || (s.keyElements?.length ?? 0) > (prev.keyElements?.length ?? 0)) surfacesById.set(s.id, s);
  }
  const actionsById = new Map();
  for (const m of manifests) for (const a of m.actions) if (!actionsById.has(a.id)) actionsById.set(a.id, a);
  const surfaces = [...surfacesById.values()];
  const actions = [...actionsById.values()];
  const workflows = inferWorkflows(surfaces, actions);
  const manifest = {
    ...manifests[0], surfaces, actions, workflows,
    discovery: { ...manifests[0].discovery, pagesVisited: pages.length, elementsDetected: surfaces.reduce((n, s) => n + (s.keyElements?.length ?? 0), 0), actionsDetected: actions.length, workflowsInferred: workflows.length }
  };
  manifest.confidence = scoreManifestConfidence(manifest);
  manifest.humanReview = { required: false, questions: detectManifestGaps(manifest) };
  manifest.humanReview.required = manifest.confidence < 0.8 || manifest.humanReview.questions.length > 0;
  manifest.discovery.requiresHumanReview = manifest.humanReview.required;
  return { manifest, validation: validateManifest(manifest) };
}

// V4 — JON-ify a desktop window from its UI Automation accessibility tree.
export function jonifyFromAccessibility(accessibility, { title = null, appName = null, businessPurpose = null } = {}) {
  const observation = observeAccessibility(accessibility, { title, appName });
  const manifest = generateJonificationManifest(observation, { businessPurpose });
  return { observation, manifest, validation: validateManifest(manifest) };
}

export { executeWorkflow };
export { createBrowserWorkflowAdapter, BrowserWorkflowAdapter, inferBrowserAllowlistedHosts };
export { createDesktopWorkflowAdapter, DesktopWorkflowAdapter };
export { createCliWorkflowAdapter, CliWorkflowAdapter, jonifyCli, parseCliHelp };
export { classifyApp };

// V4 — JON-ify a CLI tool from its --help output.
export function jonifyFromCliHelp(binary, helpText, { businessPurpose = null } = {}) {
  const manifest = jonifyCli(binary, helpText, { businessPurpose });
  return { manifest, validation: validateManifest(manifest) };
}

// Intelligent router: classify the target, then JON-ify with the right method.
// target: { url } | { command, helpText } | { window } (window incl. accessibility tree)
export function jonifyAuto(target = {}) {
  const classification = classifyApp(target);
  switch (classification.method) {
    case "web-dom":
      return { classification, ...(target.html != null ? jonifyFromHtml(target.html, { url: target.url }) : { manifest: null, validation: null, note: "Provide html (or use the browser observer) for web-dom." }) };
    case "uia":
      return { classification, ...(target.window?.accessibility ? jonifyFromAccessibility(target.window.accessibility, { title: target.window.title, appName: target.window.processName }) : { manifest: null, validation: null, note: "Provide window.accessibility for the UIA method." }) };
    case "cli":
      return { classification, ...(target.helpText != null ? jonifyFromCliHelp(classification.cliBinary, target.helpText) : { manifest: null, validation: null, note: `Run "${classification.cliBinary} --help" and pass helpText to JON-ify the CLI.` }) };
    case "vision":
      return { classification, manifest: null, validation: null, note: "Vision-based mapping not yet implemented (screenshot+OCR). Prefer the app's CLI when available." };
    default:
      return { classification, manifest: null, validation: null };
  }
}

// Full pipeline from a live URL (uses JON's browser controller).
export async function jonifyFromUrl(url, { browserController = null, businessPurpose = null } = {}) {
  const observation = await observeUrl(url, { browserController });
  const manifest = generateJonificationManifest(observation, { businessPurpose });
  const validation = validateManifest(manifest);
  return { observation, manifest, validation };
}

export { simulateWorkflow, resolveJonifiedAppForMission };

// Given a mission, resolve the JON-ified app + workflow and DRY-RUN it. V1 never
// executes app tools — it returns what JON would do, missing inputs and required
// confirmations, so the planner can decide / ask the user.
export function planJonifyMission(objective, { loadManifests = null } = {}) {
  const manifests = (loadManifests ? loadManifests() : listJonifiedApps().map((a) => getJonifiedApp(a.appId)))
    .filter(Boolean);
  const match = resolveJonifiedAppForMission(objective, manifests);
  if (!match) return { matched: false, reason: "Aucune app JON-ifiée ne correspond à cette mission.", knownApps: manifests.map((m) => m.app?.id) };
  const app = manifests.find((m) => m.app?.id === match.appId);
  const simulation = match.workflow ? simulateWorkflow(app, match.workflow.id) : null;
  return {
    matched: true,
    appId: match.appId,
    appName: match.appName,
    workflow: match.workflow,
    reason: match.reason,
    simulation,
    executionMode: "simulate_only_v1", // real execution arrives in V3
    alternatives: match.alternatives
  };
}

// Context provider for the planner/operator: what JON knows about jonified apps.
export function jonifyContextProvider({ currentApp = null } = {}) {
  const apps = listJonifiedApps();
  const current = currentApp ? getJonifiedApp(currentApp) : null;
  return {
    jonifiedApps: apps,
    currentApp: currentApp ?? null,
    availableSurfaces: current ? (current.surfaces ?? []).map((s) => ({ id: s.id, name: s.name, type: s.type })) : [],
    availableActions: current ? (current.actions ?? []).map((a) => ({ id: a.id, name: a.name, type: a.type, risk: a.safety?.riskLevel })) : [],
    availableWorkflows: current ? (current.workflows ?? []).map((w) => ({ id: w.id, name: w.name, confidence: w.confidence })) : [],
    safetyRules: current ? (current.safety?.globalRules ?? []) : [],
    humanReviewRequired: current ? (current.humanReview?.questions ?? []) : []
  };
}
