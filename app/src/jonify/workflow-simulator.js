// Workflow simulator — dry-run a workflow WITHOUT executing anything. Reports what
// JON would do, missing inputs, required confirmations, expected success states,
// and low-confidence points.

export function simulateWorkflow(manifest, workflowId) {
  const workflow = (manifest.workflows ?? []).find((w) => w.id === workflowId);
  if (!workflow) {
    return { ok: false, error: `Workflow not found: ${workflowId}`, available: (manifest.workflows ?? []).map((w) => w.id) };
  }
  const actionById = new Map((manifest.actions ?? []).map((a) => [a.id, a]));
  const steps = [];
  const missingInputs = new Set();
  const confirmations = [];
  let maxRisk = "low";
  const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

  for (const [i, step] of (workflow.steps ?? []).entries()) {
    const action = actionById.get(step.actionId);
    if (!action) { steps.push({ index: i + 1, error: `unknown action ${step.actionId}` }); continue; }
    const risk = action.safety?.riskLevel ?? "medium";
    if (RISK_ORDER[risk] > RISK_ORDER[maxRisk]) maxRisk = risk;
    for (const inp of action.inputs ?? []) if (inp.required) missingInputs.add(inp.name);
    if (action.safety?.requiresConfirmation) confirmations.push({ actionId: action.id, name: action.name, risk });
    steps.push({
      index: i + 1,
      action: action.name,
      type: action.type,
      selector: action.trigger?.selector ?? action.trigger?.targetElementId ?? null,
      risk,
      requiresConfirmation: Boolean(action.safety?.requiresConfirmation),
      expectedSuccess: action.successState?.description ?? null,
      confidence: action.confidence ?? null,
      wouldExecuteAutomatically: risk === "low"
    });
  }

  return {
    ok: true,
    workflowId,
    name: workflow.name,
    plannedSteps: steps,
    missingInputs: [...missingInputs],
    confirmationsRequired: confirmations,
    maxRisk,
    expectedOutcome: workflow.expectedOutcome ?? null,
    confidence: workflow.confidence ?? null,
    lowConfidence: (workflow.confidence ?? 1) < 0.7,
    needsHumanReview: Boolean(workflow.needsHumanReview),
    // V1 never auto-executes: anything above low risk is a dry-run only.
    executionMode: maxRisk === "low" ? "auto_eligible" : "confirmation_required"
  };
}
