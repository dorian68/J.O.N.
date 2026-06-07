// Workflow inference — assembles probable multi-step workflows from discovered
// actions. V1 heuristics over action types; uncertain workflows are flagged for
// human review.

function byType(actions, type) { return actions.filter((a) => a.type === type); }
function minConfidence(steps, actions) {
  const ids = new Set(steps.map((s) => s.actionId));
  const vals = actions.filter((a) => ids.has(a.id)).map((a) => a.confidence ?? 0.6);
  return vals.length ? Number(Math.min(...vals).toFixed(2)) : 0.6;
}

export function identifyMissingInputs(workflow, actions) {
  const ids = new Set(workflow.steps.map((s) => s.actionId));
  const inputs = [];
  for (const a of actions) if (ids.has(a.id)) for (const i of a.inputs ?? []) if (i.required) inputs.push(i.name);
  return [...new Set(inputs.filter(Boolean))];
}

export function scoreWorkflowConfidence(workflow, actions) { return minConfidence(workflow.steps, actions); }

export function inferWorkflows(surfaces, actions) {
  const workflows = [];
  const push = (wf) => { wf.confidence = scoreWorkflowConfidence(wf, actions); wf.requiredInputs = identifyMissingInputs(wf, actions); workflows.push(wf); };

  // Create workflow: a create/open action followed by a submit.
  const create = byType(actions, "create")[0];
  const submit = byType(actions, "submit")[0];
  if (create && submit) {
    push({
      id: "create-object-workflow", name: "Créer un objet",
      description: "Ouvrir le formulaire de création puis enregistrer.",
      steps: [{ actionId: create.id }, { actionId: submit.id }],
      expectedOutcome: "Un objet est créé (bannière de succès / page de détail).",
      needsHumanReview: true
    });
  } else if (create) {
    push({ id: "open-create-workflow", name: "Ouvrir la création", description: "Ouvrir le formulaire de création.",
      steps: [{ actionId: create.id }], expectedOutcome: "Un formulaire apparaît.", needsHumanReview: false });
  } else if (submit) {
    push({
      id: "submit-form-workflow", name: "Renseigner et valider",
      description: "Renseigner les champs détectés puis valider le formulaire.",
      steps: [{ actionId: submit.id }],
      expectedOutcome: "Les valeurs sont appliquées et l'application confirme la validation.",
      needsHumanReview: true
    });
  }

  // Edit-content workflow: an editable control without a create/submit flow
  // (e.g. a text editor like Notepad). Lets JON write into the app.
  const update = byType(actions, "update")[0];
  if (update && !create && !submit) {
    push({
      id: "edit-content-workflow", name: "Éditer le contenu",
      description: "Saisir / mettre à jour le contenu d'un champ éditable.",
      steps: [{ actionId: update.id }],
      expectedOutcome: "Le contenu du champ éditable est mis à jour.",
      needsHumanReview: false
    });
  }

  // Search workflow.
  const search = byType(actions, "search")[0];
  if (search) push({ id: "search-workflow", name: "Rechercher", description: "Lancer une recherche.",
    steps: [{ actionId: search.id }], expectedOutcome: "Des résultats filtrés s'affichent.", needsHumanReview: false });

  // Delete workflow (sensitive).
  const del = byType(actions, "delete")[0];
  if (del) push({ id: "delete-workflow", name: "Supprimer un objet", description: "Supprimer un objet (action critique).",
    steps: [{ actionId: del.id }], expectedOutcome: "L'objet disparaît après confirmation.", needsHumanReview: true });

  // Export workflow.
  const exp = byType(actions, "export")[0];
  if (exp) push({ id: "export-workflow", name: "Exporter", description: "Exporter des données.",
    steps: [{ actionId: exp.id }], expectedOutcome: "Un fichier est généré/téléchargé.", needsHumanReview: true });

  return workflows;
}
