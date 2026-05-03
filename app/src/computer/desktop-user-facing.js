function lastAction(actionLog = []) {
  return [...actionLog].reverse().find((entry) => entry?.status && entry.status !== "completed") ?? actionLog.at(-1) ?? null;
}

export function buildDesktopUserFacingError({
  error = null,
  actionLog = [],
  observationSummary = null,
  latestEvidencePath = null
} = {}) {
  const last = lastAction(actionLog);
  const stepLabel = last?.step?.label ?? last?.step?.primitive ?? "la dernière action";
  const windowTitle = observationSummary?.lastWindowTitle ?? last?.perceptionAfter?.title ?? null;
  const reason = String(error?.message ?? last?.error ?? "L'action n'a pas pu être vérifiée.").replace(/\s+/g, " ").trim();
  return {
    title: "Je n'ai pas pu terminer cette action desktop",
    message: windowTitle
      ? `Je me suis arrêté après "${stepLabel}" sur "${windowTitle}".`
      : `Je me suis arrêté après "${stepLabel}".`,
    likelyCause: reason,
    nextAction: "Vérifie l'état de la fenêtre, puis relance la mission ou précise la cible à utiliser.",
    evidenceHint: latestEvidencePath
      ? "Une preuve de l'état visible a été enregistrée pour revue."
      : "Aucune capture finale exploitable n'a été disponible.",
    evidencePath: latestEvidencePath,
    lastStepId: last?.step?.id ?? null,
    lastPrimitive: last?.step?.primitive ?? null,
    observationSummary: observationSummary ?? null
  };
}

