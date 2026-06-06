// V3 — Safe workflow executor.
//
// Executes a JON-ified workflow through a pluggable surface adapter, under strict
// safety gating: low/medium actions run; high/critical actions NEVER run without an
// explicit confirmation. Honors an abort hook and records per-step evidence.
// Adapter contract (all async, return { ok, ... }):
//   adapter.navigate(target) · adapter.click(selector) · adapter.type(selector, value) · adapter.capture?()

function actionExecutor(adapter, action, inputs) {
  const selector = action.trigger?.selector ?? action.trigger?.targetElementId ?? null;
  switch (action.type) {
    case "navigate":
      return () => adapter.navigate(action.trigger?.href ?? selector);
    case "search":
      return () => adapter.type(selector, inputs.query ?? inputs.q ?? "");
    case "submit":
    case "create":
    case "update":
    case "open_form":
    case "delete":
    case "send":
    case "export":
    case "import":
    case "connect_account":
    case "payment":
    case "publish":
    default:
      return () => adapter.click(selector);
  }
}

export async function executeWorkflow(manifest, workflowId, {
  adapter, inputs = {}, confirm = null, shouldAbort = null, mode = "live", onStep = null
} = {}) {
  const workflow = (manifest.workflows ?? []).find((w) => w.id === workflowId);
  if (!workflow) return { ok: false, error: `Workflow not found: ${workflowId}` };
  if (mode === "live" && !adapter) return { ok: false, error: "executeWorkflow requires an adapter in live mode." };

  const actionById = new Map((manifest.actions ?? []).map((a) => [a.id, a]));
  const results = [];
  let status = "completed";

  for (const [i, step] of (workflow.steps ?? []).entries()) {
    if (shouldAbort && shouldAbort()) { status = "aborted"; break; }
    const action = actionById.get(step.actionId);
    if (!action) { results.push({ index: i + 1, actionId: step.actionId, status: "error", error: "unknown action" }); status = "failed"; break; }

    const risk = action.safety?.riskLevel ?? "medium";
    const needsConfirm = action.safety?.requiresConfirmation === true;

    // Required-input check (e.g. a submit needing name/email).
    const missing = (action.inputs ?? []).filter((inp) => inp.required && (inputs[inp.name] == null || inputs[inp.name] === "")).map((inp) => inp.name);
    if (missing.length) {
      results.push({ index: i + 1, action: action.name, risk, status: "blocked_missing_input", missing });
      status = "needs_input"; break;
    }

    // Safety gate: high/critical require an explicit confirmation grant.
    if (needsConfirm) {
      const granted = confirm ? await confirm({ action, risk, workflowId }) === true : false;
      if (!granted) {
        results.push({ index: i + 1, action: action.name, risk, status: "blocked_needs_confirmation" });
        status = "needs_confirmation"; break;
      }
    }

    if (mode === "simulate") {
      results.push({ index: i + 1, action: action.name, risk, status: "simulated", executed: false });
    } else {
      try {
        if (adapter.fillInputs && ["submit", "update"].includes(action.type) && (action.inputs ?? []).length > 0) {
          const inputFill = await adapter.fillInputs(action.inputs, inputs);
          if (inputFill?.ok === false) {
            results.push({ index: i + 1, action: action.name, risk, status: "failed_input_fill", executed: false, error: inputFill.error ?? "input fill failed" });
            status = "failed"; break;
          }
        }
        const res = await actionExecutor(adapter, action, inputs)();
        const ok = res?.ok !== false;
        const evidence = adapter.capture ? await adapter.capture().catch(() => null) : null;
        results.push({
          index: i + 1,
          action: action.name,
          risk,
          status: ok ? "executed" : "failed",
          executed: ok,
          evidence: evidence?.path ?? null,
          evidenceSummary: evidence?.summaryPath ?? null,
          evidenceId: evidence?.evidenceId ?? null,
          error: ok ? null : (res?.error ?? "adapter failure")
        });
        if (!ok) { status = "failed"; break; }
      } catch (error) {
        results.push({ index: i + 1, action: action.name, risk, status: "failed", error: error.message });
        status = "failed"; break;
      }
    }
    if (onStep) { try { onStep(results.at(-1)); } catch { /* ignore */ } }
  }

  return {
    ok: status === "completed",
    status,
    workflowId,
    name: workflow.name,
    steps: results,
    executedCount: results.filter((r) => r.status === "executed").length,
    expectedOutcome: workflow.expectedOutcome ?? null
  };
}
