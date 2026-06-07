// Action discovery — derives callable actions from interactive elements.
// Each action gets a type, a trigger (element), inferred inputs, a risk level and
// an expected success state. Deterministic keyword heuristics (V1, no LLM).

import { classifyRisk } from "./safety-classifier.js";

const TYPE_RULES = [
  [/\b(delete|remove|supprimer|trash)\b/i, "delete"],
  [/\b(pay|checkout|purchase|payer|paiement)\b/i, "payment"],
  [/\b(publish|publier)\b/i, "publish"],
  [/\b(send|envoyer|email)\b/i, "send"],
  [/\b(export|download|télécharger|telecharger)\b/i, "export"],
  [/\b(import|upload|téléverser|televerser)\b/i, "import"],
  [/\b(save|submit|enregistrer|valider|soumettre|confirm)\b/i, "submit"],
  [/\b(new|create|add|créer|creer|ajouter|nouveau|nouvelle)\b/i, "create"],
  [/\b(edit|update|modifier|éditer|editer)\b/i, "update"],
  [/\b(search|rechercher|find)\b/i, "search"],
  [/\b(filter|filtrer|sort|trier)\b/i, "filter"],
  [/\b(connect|link|connecter|lier)\b/i, "connect_account"]
];

function inferActionType(el) {
  const text = `${el.label ?? ""} ${el.testId ?? ""} ${el.name ?? ""}`;
  if (el.kind === "link") return "navigate";
  // Desktop editable controls (UIA ValuePattern) are operable → an "update"
  // action (set value). Web non-search inputs stay non-actionable on their own.
  if (el.kind === "input") return el.type === "search" ? "search" : (el.uiaPattern === "value" ? "update" : "read");
  if (el.type === "submit") return "submit";
  for (const [re, type] of TYPE_RULES) if (re.test(text)) return type;
  return "navigate";
}

function actionName(type, label) {
  const verb = {
    navigate: "Aller à", open_form: "Ouvrir", create: "Créer", update: "Modifier",
    delete: "Supprimer", submit: "Soumettre", send: "Envoyer", export: "Exporter",
    import: "Importer", search: "Rechercher", filter: "Filtrer", connect_account: "Connecter",
    payment: "Payer", publish: "Publier", read: "Lire"
  }[type] ?? "Action";
  return `${verb}${label ? " : " + label : ""}`.slice(0, 80);
}

// Find a form near a "create/open_form" element to infer required inputs.
function inputsForAction(type, surface) {
  if (!["create", "submit", "update"].includes(type)) return [];
  const form = (surface.forms ?? [])[0];
  if (!form) return [];
  return (form.inputs ?? []).filter((i) => i.type !== "hidden").map((i) => ({
    name: i.name,
    type: i.type,
    required: Boolean(i.required),
    placeholder: i.placeholder ?? null,
    selector: i.selector ?? i.preferredSelector ?? null,
    testId: i.testId ?? null
  }));
}

export function classifyAction(el) {
  const type = inferActionType(el);
  return { type, ...classifyRisk(type) };
}

export function discoverActions(surface) {
  const seen = new Set();
  const actions = [];
  const hasSearchInput = (surface.elements ?? []).some((el) => el.kind === "input" && el.type === "search");
  for (const el of surface.elements ?? []) {
    // Inputs that are not search fields are not standalone actions.
    // Keep web non-search inputs out, but DO map desktop editable controls.
    if (el.kind === "input" && el.type !== "search" && el.uiaPattern !== "value") continue;
    const type = inferActionType(el);
    if (hasSearchInput && type === "search" && el.kind !== "input") continue;
    const risk = classifyRisk(type);
    const id = `${type}-${(el.id || el.label || "el").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/^-|-$/g, "");
    if (seen.has(id)) continue;
    seen.add(id);
    const inputs = inputsForAction(type, surface);
    actions.push({
      id, name: actionName(type, el.label), type,
      description: `Action détectée (${type}) sur « ${el.label ?? el.id} » de la surface ${surface.id}.`,
      surfaceId: surface.id,
      trigger: { type: el.uiaPattern === "value" ? "set_value" : (el.kind === "input" ? "submit" : "click"), targetElementId: el.id, selector: el.preferredSelector, href: el.href ?? null },
      inputs,
      safety: { riskLevel: risk.riskLevel, requiresConfirmation: risk.requiresConfirmation, reason: risk.reason },
      successState: {
        type: type === "navigate" || type === "open_form" ? "url_or_element_change" : "banner_or_element_change",
        description: type === "delete" ? "L'élément disparaît / bannière de confirmation."
          : type === "submit" || type === "create" ? "Bannière de succès ou page de détail."
          : "Changement d'URL ou apparition d'un élément."
      },
      confidence: el.testId ? 0.82 : el.label ? 0.7 : 0.55,
      needsHumanReview: risk.riskLevel === "critical" || (!el.testId && !el.label)
    });
  }
  return actions;
}
