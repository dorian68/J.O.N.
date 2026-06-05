// Safety classifier — maps an action type to a risk level + confirmation policy.
// V1 never auto-executes high/critical actions.

const RISK_BY_TYPE = {
  navigate: "low",
  open_form: "low",
  search: "low",
  filter: "low",
  read: "low",
  create: "medium",
  update: "medium",
  upload: "medium",
  import: "medium",
  submit: "high",
  send: "high",
  export: "high",
  download: "high",
  connect_account: "high",
  delete: "critical",
  payment: "critical",
  publish: "critical"
};

const REASON = {
  low: "Navigation / lecture / ouverture — sans effet de bord notable.",
  medium: "Modifie un état (création/édition) — réversible, confirmation légère.",
  high: "Action sortante ou engageante (envoi/soumission/export) — confirmation requise.",
  critical: "Action destructrice ou irréversible (suppression/paiement/publication) — confirmation explicite, jamais auto en V1."
};

export function classifyRisk(actionType) {
  const riskLevel = RISK_BY_TYPE[actionType] ?? "medium";
  const requiresConfirmation = riskLevel === "high" || riskLevel === "critical";
  return { riskLevel, requiresConfirmation, reason: REASON[riskLevel], autoExecutable: riskLevel === "low" };
}

export const GLOBAL_SAFETY_RULES = Object.freeze([
  "Never submit a payment without explicit confirmation.",
  "Never delete data without explicit confirmation.",
  "Never publish or send content/email without explicit confirmation.",
  "High/critical actions are never executed automatically in V1."
]);
