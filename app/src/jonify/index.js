// JON-ify orchestrator — the auto-discovery protocol end to end.
//
// JON observes → maps surfaces/actions/workflows → classifies safety → generates
// the manifest itself → validates → produces human-review questions. The user
// only validates ambiguity; they never write the manifest.

import { observeHtml, observeUrl } from "./app-observer.js";
import { generateJonificationManifest } from "./manifest-generator.js";
import { validateManifest } from "./manifest-validator.js";
import { simulateWorkflow } from "./workflow-simulator.js";
import { listJonifiedApps, getJonifiedApp } from "./registry.js";

const nowIso = () => null; // timestamps injected by caller to keep this pure/deterministic

// Full pipeline from raw HTML (fixture or captured page).
export function jonifyFromHtml(html, { url = null, businessPurpose = null, startedAt = null, completedAt = null } = {}) {
  const observation = observeHtml(html, { url });
  const manifest = generateJonificationManifest(observation, { startedAt, completedAt, businessPurpose });
  const validation = validateManifest(manifest);
  return { observation, manifest, validation };
}

// Full pipeline from a live URL (uses JON's browser controller).
export async function jonifyFromUrl(url, { browserController = null, businessPurpose = null } = {}) {
  const observation = await observeUrl(url, { browserController });
  const manifest = generateJonificationManifest(observation, { businessPurpose });
  const validation = validateManifest(manifest);
  return { observation, manifest, validation };
}

export { simulateWorkflow };

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
