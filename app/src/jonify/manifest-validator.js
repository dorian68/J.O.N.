// Manifest validator — structural + cross-reference + safety-invariant checks.
// Returns { valid, errors[], warnings[] }. JON uses this before registering an app.

const VALID_RISK = new Set(["low", "medium", "high", "critical"]);

export function validateManifest(manifest) {
  const errors = [];
  const warnings = [];
  const fail = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!manifest || typeof manifest !== "object") return { valid: false, errors: ["Manifest is not an object."], warnings };
  if (!manifest.schemaVersion) fail("schemaVersion missing");
  if (!manifest.app?.id) fail("app.id missing");

  const surfaceIds = new Set((manifest.surfaces ?? []).map((s) => s.id));
  const actionIds = new Set((manifest.actions ?? []).map((a) => a.id));

  if (!surfaceIds.size) fail("no surfaces detected");
  if (!actionIds.size) fail("no actions detected");

  for (const s of manifest.surfaces ?? []) {
    if (!s.id) fail("a surface has no id");
    if (!s.purpose) warn(`surface ${s.id} has no purpose`);
  }

  for (const a of manifest.actions ?? []) {
    if (!a.id) fail("an action has no id");
    if (!surfaceIds.has(a.surfaceId)) fail(`action ${a.id} references unknown surface ${a.surfaceId}`);
    const risk = a.safety?.riskLevel;
    if (!VALID_RISK.has(risk)) fail(`action ${a.id} has invalid riskLevel ${risk}`);
    // Safety invariant: high/critical MUST require confirmation.
    if ((risk === "high" || risk === "critical") && a.safety?.requiresConfirmation !== true) {
      fail(`action ${a.id} is ${risk} but requiresConfirmation is not true`);
    }
    if (!a.trigger?.selector && !a.trigger?.targetElementId) warn(`action ${a.id} has no selector/target (needs fallback)`);
    if (!a.successState?.description) warn(`action ${a.id} has no success state`);
  }

  for (const w of manifest.workflows ?? []) {
    if (!w.id) fail("a workflow has no id");
    for (const step of w.steps ?? []) {
      if (!actionIds.has(step.actionId)) fail(`workflow ${w.id} references unknown action ${step.actionId}`);
    }
  }

  // Low overall confidence must surface human review.
  if (typeof manifest.confidence === "number" && manifest.confidence < 0.8 && !manifest.humanReview?.required) {
    warn("confidence < 0.8 but humanReview.required is not set");
  }
  if (!(manifest.safety?.globalRules ?? []).length) warn("no global safety rules");

  return { valid: errors.length === 0, errors, warnings };
}
