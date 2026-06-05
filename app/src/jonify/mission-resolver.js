// Mission resolver — maps a natural-language mission to a JON-ified app + the most
// likely workflow, so the planner can reason on a mapped app instead of guessing.
// Pure + deterministic (token overlap + intent hints); the LLM can refine later.

const STOP = new Set(["the","a","an","to","of","in","on","my","me","and","or","for","va","dans","le","la","les","un","une","des","mon","ma","mes","de","du","et","ou","sur","vers","puis","stp"]);

function tokens(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((t) => t && t.length > 2 && !STOP.has(t));
}
function overlap(a, b) {
  const setB = new Set(b);
  let n = 0; for (const t of new Set(a)) if (setB.has(t)) n += 1;
  return n;
}

// Intent verb → workflow/action type (helps pick the right workflow).
const INTENT = [
  [/\b(cree|creer|create|new|nouveau|nouvelle|ajoute|ajouter|add)\b/, "create"],
  [/\b(supprime|supprimer|delete|remove)\b/, "delete"],
  [/\b(cherche|chercher|recherche|rechercher|search|find|trouve)\b/, "search"],
  [/\b(exporte|exporter|export|telecharge|download)\b/, "export"],
  [/\b(envoie|envoyer|send|email)\b/, "send"]
];
function intentType(objective) {
  const o = String(objective ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [re, type] of INTENT) if (re.test(o)) return type;
  return null;
}

function scoreApp(objTokens, manifest) {
  const hay = tokens([
    manifest.app?.name, manifest.app?.businessPurpose, manifest.app?.id,
    ...(manifest.surfaces ?? []).map((s) => s.name),
    ...(manifest.workflows ?? []).map((w) => w.name)
  ].join(" "));
  return overlap(objTokens, hay);
}

function pickWorkflow(objective, objTokens, manifest) {
  const wfs = manifest.workflows ?? [];
  if (!wfs.length) return null;
  const wantType = intentType(objective);
  const actionsById = new Map((manifest.actions ?? []).map((a) => [a.id, a]));
  const scored = wfs.map((w) => {
    let score = overlap(objTokens, tokens(w.name));
    // Bonus if the workflow contains an action whose type matches the intent.
    if (wantType && (w.steps ?? []).some((st) => actionsById.get(st.actionId)?.type === wantType)) score += 3;
    return { w, score };
  }).sort((x, y) => y.score - x.score);
  return scored[0].score > 0 ? scored[0].w : wfs[0];
}

// manifests: array of full jonification manifests. Returns the best match or null.
export function resolveJonifiedAppForMission(objective, manifests = []) {
  const objTokens = tokens(objective);
  if (!objTokens.length || !manifests.length) return null;
  const ranked = manifests
    .map((m) => ({ m, score: scoreApp(objTokens, m) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0];
  const workflow = pickWorkflow(objective, objTokens, best.m);
  return {
    appId: best.m.app?.id ?? null,
    appName: best.m.app?.name ?? null,
    score: best.score,
    workflow: workflow ? { id: workflow.id, name: workflow.name, confidence: workflow.confidence } : null,
    reason: `Mission rapprochée de l'app « ${best.m.app?.name} » (${best.score} mots-clés communs)${workflow ? ` → workflow « ${workflow.name} »` : ""}.`,
    alternatives: ranked.slice(1, 3).map((r) => ({ appId: r.m.app?.id, score: r.score }))
  };
}
