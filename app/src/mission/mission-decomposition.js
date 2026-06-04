// Backward-compatible decomposition facade.
//
// The real "request → execution plan" brain now lives in mission-translator.js
// (registry-driven and scalable). This module keeps the historical
// `decomposeMissionSurfaces` API used by the orchestrator and tests, delegating
// to the translator so there is a single source of truth.
import { translateRequest, DEFAULT_CAPABILITIES } from "./mission-translator.js";

export const SURFACE = { BROWSER: "browser", DESKTOP: "desktop", TERMINAL: "terminal" };

// Returns { multiSurface, reason, detectedSurfaces, phases } where each phase has
// { id, surface, actionType, objective, constraints, expectedTools, role,
//   producesData, consumesPrevious }.
export function decomposeMissionSurfaces(objective) {
  const plan = translateRequest(objective, { capabilities: DEFAULT_CAPABILITIES });
  return {
    multiSurface: plan.multiSurface,
    reason: plan.reason,
    detectedSurfaces: plan.surfaces,
    phases: plan.phases
  };
}
