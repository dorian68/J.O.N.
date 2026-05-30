import { STAGE_STATUS } from "./workspace-plan.js";
import { VERDICT } from "./semantic-terminal-verifier.js";

export const ESCALATION_REASON = Object.freeze({
  SENSITIVE_ACTION: "sensitive_action_required",
  SCOPE_CHANGE: "scope_change_detected",
  AGENT_CONTRADICTION: "agent_output_contradicts_objective",
  TESTS_FAILED: "tests_failed_non_trivially",
  PRODUCT_DECISION: "product_decision_required",
  CREDENTIALS_REQUESTED: "credentials_or_secrets_requested",
  SECURITY_RISK: "security_risk_detected",
  MAX_RETRIES: "max_retries_exceeded",
  BUDGET_EXCEEDED: "orchestration_budget_exceeded",
  STAGE_FAILED: "stage_definitively_failed"
});

const SECURITY_PATTERNS = /security|injection|exploit|credential|privilege escalation|bypass|xss|csrf|rce|shell injection/i;
const CREDENTIAL_PATTERNS = /password|api.?key|token|secret|bearer|passphrase|private.?key|auth.?key/i;
const SCOPE_CHANGE_PATTERNS = /unrelated|out of scope|separate project|new repo|different codebase|change requirements/i;

export function evaluateEscalationNeed({ stage, verdict, planState, terminal } = {}) {
  const reasons = [];

  // 1. Security risk in verdict or terminal output
  const riskText = (verdict?.risks ?? []).join(" ");
  if (SECURITY_PATTERNS.test(riskText)) {
    reasons.push({
      reason: ESCALATION_REASON.SECURITY_RISK,
      priority: "high",
      detail: (verdict?.risks ?? []).filter(r => SECURITY_PATTERNS.test(r)).slice(0, 3).join("; ")
    });
  }

  // 2. Credentials requested in terminal output
  if (terminal?.recentOutput && CREDENTIAL_PATTERNS.test(terminal.recentOutput)) {
    reasons.push({
      reason: ESCALATION_REASON.CREDENTIALS_REQUESTED,
      priority: "high",
      detail: "Terminal output suggests a credential or secret was requested."
    });
  }

  // 3. Tests failed non-trivially
  const failedTests = verdict?.testsFailed ?? [];
  if (failedTests.length > 0) {
    reasons.push({
      reason: ESCALATION_REASON.TESTS_FAILED,
      priority: "medium",
      detail: `${failedTests.length} test(s) échoué(s) : ${failedTests.slice(0, 3).join(", ")}`
    });
  }

  // 4. Stage definitively failed
  if (verdict?.verdict === VERDICT.FAILED || stage?.status === STAGE_STATUS.FAILED) {
    reasons.push({
      reason: ESCALATION_REASON.STAGE_FAILED,
      priority: "high",
      detail: verdict?.summary ?? `L'étape "${stage?.label}" a échoué.`
    });
  }

  // 5. Partial success with open risks → product decision
  if (verdict?.verdict === VERDICT.PARTIAL_SUCCESS && (verdict?.risks?.length ?? 0) > 0) {
    reasons.push({
      reason: ESCALATION_REASON.PRODUCT_DECISION,
      priority: "medium",
      detail: `L'étape "${stage?.label}" est partiellement réussie. Décision requise : ${(verdict.risks ?? []).slice(0, 2).join("; ")}`
    });
  }

  // 6. Scope change detected in recommended action
  if (verdict?.recommendedNextAction && SCOPE_CHANGE_PATTERNS.test(verdict.recommendedNextAction)) {
    reasons.push({
      reason: ESCALATION_REASON.SCOPE_CHANGE,
      priority: "medium",
      detail: `Action recommandée hors du périmètre : ${verdict.recommendedNextAction.slice(0, 200)}`
    });
  }

  // 7. Contradiction: agents disagree on what's completed
  if (planState && _detectAgentContradiction(planState, stage)) {
    reasons.push({
      reason: ESCALATION_REASON.AGENT_CONTRADICTION,
      priority: "medium",
      detail: "Plusieurs agents rapportent des résultats contradictoires pour ce périmètre."
    });
  }

  const shouldEscalate = reasons.length > 0;
  const priority = reasons.some(r => r.priority === "high") ? "high" : reasons.length > 0 ? "medium" : "none";

  return {
    shouldEscalate,
    priority,
    reasons,
    primaryReason: reasons[0] ?? null
  };
}

function _detectAgentContradiction(planState, currentStage) {
  if (!currentStage) return false;
  // If a previous stage modified the same files as this stage's expected artifacts
  // and that stage failed — contradiction signal
  const completedWithModifiedFiles = (planState.stages ?? [])
    .filter(s => s.status === STAGE_STATUS.COMPLETED && s.id !== currentStage.id)
    .flatMap(s => s.modifiedFiles ?? []);
  const currentExpected = currentStage.expectedArtifacts ?? [];
  return currentExpected.some(a => completedWithModifiedFiles.includes(a));
}

export function buildEscalationMessage({ stage, verdict, escalation, planState }) {
  if (!escalation?.shouldEscalate) return null;

  const lines = [];
  lines.push(`**JON a besoin d'une décision** — étape : **${stage?.label ?? "inconnue"}**`);
  lines.push("");

  for (const r of escalation.reasons.slice(0, 4)) {
    const icon = r.priority === "high" ? "🔴" : "🟡";
    const label = r.reason.replace(/_/g, " ");
    lines.push(`${icon} **${label}** : ${r.detail}`);
  }

  if (verdict?.verdict) {
    lines.push("");
    lines.push(`**Verdict sémantique :** ${verdict.verdict} (confiance : ${Math.round((verdict.confidence ?? 0) * 100)}%)`);
    if (verdict.summary) lines.push(`_${verdict.summary}_`);
  }

  if (verdict?.recommendedNextAction) {
    lines.push("");
    lines.push(`**Prochaine action recommandée :** ${verdict.recommendedNextAction}`);
  }

  if ((planState?.modifiedFiles ?? []).length > 0) {
    lines.push("");
    lines.push(`**Fichiers concernés :** ${planState.modifiedFiles.slice(0, 5).join(", ")}`);
  }

  return lines.join("\n");
}

// Escalation for orchestration budget overrun
export function buildBudgetEscalationMessage({ plan, elapsedMs, actionCount, maxElapsedMs }) {
  const elapsedMin = Math.round(elapsedMs / 60000);
  return [
    `**JON a atteint sa limite de temps** pour la mission "${plan.objective.slice(0, 100)}"`,
    "",
    `⏱ Temps écoulé : ${elapsedMin} min (limite : ${Math.round(maxElapsedMs / 60000)} min)`,
    `Actions effectuées : ${actionCount}`,
    "",
    "Que souhaitez-vous faire ? Continuer, ajuster le plan, ou arrêter la mission ?"
  ].join("\n");
}
