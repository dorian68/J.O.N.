import { STAGE_STATUS } from "./workspace-plan.js";
import { VERDICT } from "./semantic-terminal-verifier.js";

export function aggregatePlanState(plan, verifications = []) {
  if (!plan) return null;

  const verifByStageId = new Map(verifications.map(v => [v.stageId, v]));

  const completedStages = plan.stages.filter(s => s.status === STAGE_STATUS.COMPLETED);
  const runningStages = plan.stages.filter(s => s.status === STAGE_STATUS.RUNNING);
  const blockedStages = plan.stages.filter(s => [STAGE_STATUS.BLOCKED, STAGE_STATUS.FAILED].includes(s.status));
  const pendingStages = plan.stages.filter(s => s.status === STAGE_STATUS.PENDING);
  const decisionStages = plan.stages.filter(s => s.status === STAGE_STATUS.NEEDS_USER_DECISION);

  const openRisks = [];
  const allEvidence = [];
  const allModifiedFiles = [];
  const allTestsFailed = [];

  for (const stage of plan.stages) {
    const v = verifByStageId.get(stage.id);
    if (!v) continue;
    allEvidence.push(...(v.observedEvidence ?? []));
    allModifiedFiles.push(...(v.modifiedFiles ?? []));
    allTestsFailed.push(...(v.testsFailed ?? []).map(t => `[${stage.label}] ${t}`));
    if (v.risks?.length) {
      openRisks.push(...v.risks.map(r => `[${stage.label}] ${r}`));
    }
  }

  const stagesWithVerdicts = plan.stages.map(s => {
    const v = verifByStageId.get(s.id);
    return {
      id: s.id,
      label: s.label,
      agentType: s.agentType,
      status: s.status,
      dependsOn: s.dependsOn,
      successCriteria: s.successCriteria,
      expectedArtifacts: s.expectedArtifacts,
      verdict: v?.verdict ?? null,
      verdictConfidence: v?.confidence ?? null,
      verdictSummary: v?.summary ?? null,
      recommendedNextAction: v?.recommendedNextAction ?? null,
      terminalId: s.terminalId,
      startedAt: s.startedAt,
      completedAt: s.completedAt
    };
  });

  const overallProgress = plan.stages.length > 0
    ? Math.round((completedStages.length / plan.stages.length) * 100)
    : 0;

  // Build a human-readable status sentence
  const statusNarrative = buildStatusNarrative({
    plan, completedStages, runningStages, blockedStages, pendingStages, decisionStages
  });

  return {
    planId: plan.id,
    planStatus: plan.status,
    objective: plan.objective,
    overallProgress,
    statusNarrative,
    stages: stagesWithVerdicts,
    summary: {
      total: plan.stages.length,
      completed: completedStages.length,
      running: runningStages.length,
      blocked: blockedStages.length,
      pending: pendingStages.length,
      needsDecision: decisionStages.length
    },
    currentAgents: runningStages.map(s => ({
      stageId: s.id,
      stageLabel: s.label,
      agentType: s.agentType,
      terminalId: s.terminalId
    })),
    awaitingUserDecision: decisionStages.map(s => {
      const v = verifByStageId.get(s.id);
      return {
        stageId: s.id,
        stageLabel: s.label,
        agentType: s.agentType,
        reason: v?.summary ?? "Décision utilisateur requise.",
        recommendedNextAction: v?.recommendedNextAction ?? null,
        risks: v?.risks ?? []
      };
    }),
    evidence: [...new Set(allEvidence)].slice(0, 30),
    modifiedFiles: [...new Set(allModifiedFiles)].slice(0, 50),
    testsFailed: [...new Set(allTestsFailed)].slice(0, 20),
    openRisks: openRisks.slice(0, 20),
    updatedAt: plan.updatedAt
  };
}

function buildStatusNarrative({ plan, completedStages, runningStages, blockedStages, pendingStages, decisionStages }) {
  if (plan.status === "completed") {
    return `Mission terminée — ${completedStages.length}/${plan.stages.length} étapes complétées.`;
  }
  if (plan.status === "failed") {
    return `Mission échouée — ${blockedStages.length} étape(s) bloquée(s).`;
  }
  if (decisionStages.length > 0) {
    return `En attente de décision sur : ${decisionStages.map(s => s.label).join(", ")}.`;
  }
  if (runningStages.length > 0) {
    return `En cours : ${runningStages.map(s => `${s.label} (${s.agentType})`).join(", ")}.`;
  }
  if (blockedStages.length > 0) {
    return `Bloqué sur : ${blockedStages.map(s => s.label).join(", ")}.`;
  }
  if (pendingStages.length > 0 && completedStages.length > 0) {
    return `${completedStages.length} étape(s) terminée(s). Prochaine : ${pendingStages[0]?.label ?? "?"}`;
  }
  return `Plan actif — ${plan.stages.length} étape(s) définie(s).`;
}

// Compact version for conversation injection
export function buildPlanStatusMessage(planState) {
  if (!planState) return null;
  const lines = [
    `**${planState.objective.slice(0, 120)}**`,
    `Progression : ${planState.overallProgress}% — ${planState.statusNarrative}`
  ];
  if (planState.modifiedFiles.length > 0) {
    lines.push(`Fichiers modifiés : ${planState.modifiedFiles.slice(0, 5).join(", ")}`);
  }
  if (planState.testsFailed.length > 0) {
    lines.push(`Tests échoués : ${planState.testsFailed.slice(0, 3).join(", ")}`);
  }
  if (planState.openRisks.length > 0) {
    lines.push(`Risques : ${planState.openRisks.slice(0, 2).join(" | ")}`);
  }
  return lines.join("\n");
}
