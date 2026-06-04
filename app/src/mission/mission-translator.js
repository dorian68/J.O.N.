// Mission Translator — the isolated, scalable "request → tool calls" brain.
//
// This is the single module that turns a natural-language request into an
// ordered EXECUTION PLAN: which surfaces are involved, in which order, with
// which sub-objective, guidance, expected tool calls, and how data flows
// between phases.
//
// Scalability principle: behaviour is driven by a REGISTRY of surface
// capabilities, not by hard-coded if/else. Supporting a new kind of work
// (terminal, email, files, an MCP connector, …) means REGISTERING a capability
// descriptor — never editing the core algorithm. The cinestar→Notepad case is
// just one instance of the general rule "gather somewhere, act somewhere else".
//
// A capability descriptor:
//   {
//     id:            surface id (e.g. "browser", "desktop")
//     actionType:    runtime action type to force (e.g. "browser_autonomy") | null
//     role:          "gather" (produces data) | "act" (consumes/uses data) | "standalone"
//     producesData:  bool   — its output should be handed to later phases
//     consumesData:  bool   — it should receive earlier phases' output
//     detect(text):  bool   — is this surface involved in the request?
//     matchClause(c):bool   — does a single clause belong to this surface?
//     expectedTools: string[] — the relevant tool calls for this surface
//     objective(clause): string — short per-phase objective (length-capped upstream)
//     constraints():  string[] — focused guidance for the phase
//   }

const WEB_INTENT = /\b(ouvre?(?:-moi)?\s+(?:le\s+)?site|va\s+sur|aller\s+sur|rends?-toi\s+sur|acc[eè]de|visite|navigue|open\s+(?:the\s+)?(?:[\w-]+\s+)?(?:site|web\s?site|web\s?page|page)|go\s+to|browse|website|web\s?site|sur\s+(?:le\s+)?(?:site|web)|en\s+ligne|online|cherche\s+sur|recherche\s+sur|search\s+on)\b/i;
const SITE_HINT = /\b([a-z0-9-]+\.(?:com|fr|org|net|io|co|tv))\b|\bsite\s+([a-z0-9-]{3,})\b|\bcinestar\b|\b(amazon|google|youtube|imdb|allocine|allociné|linkedin|indeed|ebay)\b/i;
const DESKTOP_WRITE_INTENT = /\b(notepad|bloc-?notes|wordpad|word\b|fichier\s+texte|text\s+file|[ée]cris(?:-moi)?|ecris|tape(?:r)?\b|saisis|note\s+(?:dans|sur)|write\s+(?:to|in|on|down)|type\s+(?:in|into|on)|enregistre\s+dans|colle\s+dans|paste\s+(?:in|into))\b/i;
const APP_LAUNCH_INTENT = /\b(ouvre?(?:-moi)?\s+(?:le\s+|l['’]|un\s+|une\s+)?(notepad|bloc-?notes|wordpad|word|excel|paint|calculatrice|calculator|explorer|explorateur)|open\s+(?:the\s+)?(notepad|wordpad|word|excel|paint|calculator|explorer))\b/i;
const TERMINAL_INTENT = /\b(terminal|powershell|cmd|invite\s+de\s+commande|command\s+line|cli\b|bash|codex|claude\s+code)\b/i;

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function splitClauses(text) {
  return clean(text)
    .split(/\s+(?:et\s+ensuite|et\s+puis|puis|ensuite|et\b|then\b|and\s+then|and\b|,\s*then|,\s*puis)\s+/i)
    .map(clean)
    .filter(Boolean);
}

// ── Built-in surface capability registry ────────────────────────────────────
export const DEFAULT_CAPABILITIES = [
  {
    id: "browser",
    actionType: "browser_autonomy",
    role: "gather",
    producesData: true,
    consumesData: false,
    detect: (text) => WEB_INTENT.test(text) || SITE_HINT.test(text),
    matchClause: (c) => WEB_INTENT.test(c) || SITE_HINT.test(c),
    expectedTools: ["browser.open", "browser.navigate", "browser.observe", "browser.extractText", "browser.click", "browser.captureScreenshot"],
    objective: (clause) => `${clause} — récupère les informations demandées et restitue-les en texte.`.slice(0, 300),
    constraints: () => [
      "Phase web: browse and gather only — do not open any local app.",
      "If the site is named without a URL, search it and open the official site.",
      "Resolve relative dates (demain/tomorrow) before filtering.",
      "Report the gathered data as plain text."
    ]
  },
  {
    id: "desktop",
    actionType: "desktop_autonomy",
    role: "act",
    producesData: false,
    consumesData: true,
    detect: (text) => DESKTOP_WRITE_INTENT.test(text) || APP_LAUNCH_INTENT.test(text),
    matchClause: (c) => DESKTOP_WRITE_INTENT.test(c) || APP_LAUNCH_INTENT.test(c),
    expectedTools: ["desktop.inspectWindows", "desktop.launchApplication", "desktop.typeText", "desktop.click", "desktop.captureWindow"],
    objective: (clause) => `${clause} (écris les informations déjà récupérées).`.slice(0, 300),
    constraints: () => [
      "Phase desktop: the data was gathered earlier (provided as inline content).",
      "Open the requested local app and type that data in as-is."
    ]
  },
  {
    id: "terminal",
    actionType: null,
    role: "standalone",
    producesData: false,
    consumesData: false,
    detect: (text) => TERMINAL_INTENT.test(text),
    matchClause: (c) => TERMINAL_INTENT.test(c),
    expectedTools: ["terminal.launch", "terminal.read", "terminal.sendInput", "verifier.checkOutcome"],
    objective: (clause) => clause.slice(0, 300),
    constraints: () => ["Phase terminal: run the requested command under supervision."]
  }
];

// Producers run before consumers; standalone keep their textual order.
const ROLE_ORDER = { gather: 0, standalone: 1, act: 2 };

// Translate a request into an ordered execution plan over registered surfaces.
// `capabilities` is injectable so new surfaces can be added without editing core.
export function translateRequest(objective, { capabilities = DEFAULT_CAPABILITIES } = {}) {
  const text = clean(objective);
  if (!text) {
    return { multiSurface: false, reason: "empty_objective", surfaces: [], phases: [] };
  }

  const clauses = splitClauses(text);
  const involved = capabilities.filter((cap) => cap.detect(text));

  if (involved.length === 0) {
    return { multiSurface: false, reason: "no_local_surface", surfaces: [], phases: [] };
  }

  // Build one phase per involved surface, using the clause that best matches it
  // (falling back to the whole request).
  const phases = involved
    .map((cap, idx) => {
      const clause = clauses.find((c) => cap.matchClause(c)) ?? text;
      return {
        capability: cap,
        textualOrder: idx,
        clause
      };
    })
    .sort((a, b) => {
      const ra = ROLE_ORDER[a.capability.role] ?? 1;
      const rb = ROLE_ORDER[b.capability.role] ?? 1;
      return ra === rb ? a.textualOrder - b.textualOrder : ra - rb;
    })
    .map((entry, index) => {
      const cap = entry.capability;
      const consumesPrevious = Boolean(cap.consumesData) && index > 0;
      return {
        id: `phase_${index + 1}`,
        surface: cap.id,
        actionType: cap.actionType,
        role: cap.role,
        objective: cap.objective(entry.clause),
        constraints: cap.constraints(),
        expectedTools: cap.expectedTools,
        producesData: Boolean(cap.producesData),
        consumesPrevious
      };
    });

  const multiSurface = phases.length > 1;
  return {
    multiSurface,
    reason: multiSurface ? `${phases.map((p) => p.surface).join("_then_")}` : "single_surface",
    surfaces: phases.map((p) => p.surface),
    phases
  };
}
