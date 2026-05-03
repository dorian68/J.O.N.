import { normalizeUiBlocks } from "./ui-blocks.js";
import { DEFAULT_VISIBLE_ASSISTANT_SYSTEM_PROMPT } from "./agent-config.js";

export const CONVERSATION_INTENT_TYPES = Object.freeze([
  "simple_conversation",
  "local_question",
  "safe_inspection",
  "desktop_action",
  "long_mission",
  "report_generation",
  "workspace_cli",
  "ambiguous",
  "out_of_scope"
]);

export const CONVERSATION_ACTIONS = Object.freeze([
  "answer_directly",
  "inspect_then_answer",
  "ask_clarification",
  "prepare_mission_preflight",
  "start_bounded_run_after_confirmation",
  "generate_structured_response",
  "launch_workspace_cli",
  "refuse"
]);

export const SAFE_CAPABILITY_IDS = Object.freeze([
  "inspect_desktop_folders",
  "list_installed_applications",
  "list_installed_browsers",
  "generate_report_preview"
]);

const SUPPORTED_MISSION_DRAFT_MODES = Object.freeze(new Set(["research", "form", "computer", ""]));

function cleanText(value, maxLength = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 10, maxLength = 240) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => cleanText(entry, maxLength)).filter(Boolean).slice(0, maxItems);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCapabilityRequest(value, index) {
  const candidate = isObject(value) ? value : {};
  const id = cleanText(candidate.id, 80);
  if (!SAFE_CAPABILITY_IDS.includes(id)) {
    return null;
  }
  return {
    id,
    reason: cleanText(candidate.reason, 260),
    parameters: isObject(candidate.parameters) ? candidate.parameters : {},
    order: Number.isFinite(Number(candidate.order)) ? Number(candidate.order) : index + 1
  };
}

function normalizeMissionDraft(value, fallbackObjective) {
  if (!isObject(value)) {
    return null;
  }
  const objective = cleanText(value.objective ?? fallbackObjective, 360);
  if (!objective) {
    return null;
  }
  return {
    objective,
    deliverable: cleanText(value.deliverable, 180),
    constraints: cleanList(value.constraints, 6, 180),
    forbiddenActions: cleanList(value.forbiddenActions, 6, 180),
    mode: SUPPORTED_MISSION_DRAFT_MODES.has(cleanText(value.mode, 40)) ? cleanText(value.mode, 40) : "",
    parameters: isObject(value.parameters) ? value.parameters : {}
  };
}

function normalizeAction(value) {
  const action = cleanText(value, 80);
  return CONVERSATION_ACTIONS.includes(action) ? action : "answer_directly";
}

function normalizeIntentType(value) {
  const intentType = cleanText(value, 80);
  return CONVERSATION_INTENT_TYPES.includes(intentType) ? intentType : "simple_conversation";
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function desktopFolderIntent(text) {
  return containsAny(text, [
    /\b(dossiers?|folders?)\b[\s\S]{0,80}\b(bureau|desktop)\b/i,
    /\b(bureau|desktop)\b[\s\S]{0,80}\b(dossiers?|folders?)\b/i,
    /\b(quels?|liste|list|show|affiche)\b[\s\S]{0,120}\b(bureau|desktop)\b/i
  ]);
}

function appCatalogIntent(text) {
  return containsAny(text, [
    /\b(applications?|apps?|logiciels?)\b[\s\S]{0,100}\b(disponibles?|installees?|installées?|installed|available)\b/i,
    /\b(quels?|quelles?|liste|list|show)\b[\s\S]{0,80}\b(applications?|apps?|logiciels?)\b/i,
    /\b(applications?|apps?|logiciels?)\b[\s\S]{0,100}\b(utiliser|use|lancer|ouvrir)\b/i
  ]);
}

function browserCatalogIntent(text) {
  return containsAny(text, [
    /\b(navigateurs?|browsers?)\b[\s\S]{0,100}\b(disponibles?|install[eé]s?|installed|available)\b/i,
    /\b(quels?|liste|list|show)\b[\s\S]{0,80}\b(navigateurs?|browsers?)\b/i
  ]);
}

function desktopActionIntent(text) {
  return containsAny(text, [
    /\b(ouvre|ouvrir|open|launch|lance|d[ée]marre|start)\b/i,
    /\b(capture|screenshot|clique|click|tape|type|write|écris|ecris|scroll)\b/i,
    /\b(copie|copy|renomme|rename|d[ée]place|move|cr[ée]e|create|supprime|delete|lis|read|liste|list)\b[\s\S]{0,80}\b(fichier|file|dossier|folder|bureau|desktop|documents|downloads)\b/i,
    /\b(navigateur|browser|chrome|edge|firefox|brave|bloc-notes|notepad|calculatrice|calculator|explorer|explorateur)\b/i
  ]);
}

function reportIntent(text) {
  return containsAny(text, [
    /\b(rapport|report|performance|dashboard|graphique|chart|tableau|table)\b/i,
    /\b(synth[eè]se|summary)\b[\s\S]{0,80}\b(chiffres?|metrics?|m[eé]triques?)\b/i
  ]);
}

function outOfScopeIntent(text) {
  return containsAny(text, [
    /\b(connecte-toi|login|mot de passe|password|credentials?|api key|token|secret)\b/i,
    /\b(ach[eè]te|acheter|buy|purchase|payment|paiement|checkout)\b/i,
    /\b(bypass|contourne|désactive l'antivirus|desactive l'antivirus|elevate|uac)\b/i,
    /\b(exfiltre|exfiltrate|vole|steal)\b/i
  ]);
}

function greetingIntent(text) {
  return containsAny(text, [
    /^(salut|bonjour|hello|hi|coucou|yo)\b/i,
    /\b(comment ça marche|comment ca marche|que peux-tu faire|what can you do)\b/i
  ]);
}

function workspaceCliIntent(text) {
  return containsAny(text, [
    /\b(lance|lancer|d[ée]marre|d[ée]marrer|start|open|ouvre|ouvrir|utilise|utiliser|use)\b[\s\S]{0,60}\b(codex|claude code|claude cli|terminal|shell|powershell|bash)\b/i,
    /\b(codex|claude code|claude cli)\b[\s\S]{0,60}\b(pour|pour faire|to|and|afin de)\b/i,
    /\b(terminal|shell|console)\b[\s\S]{0,40}\b(codex|claude|cli|workspace)\b/i,
    /\b(workspace|espace de travail)\b[\s\S]{0,60}\b(terminal|cli|codex|claude)\b/i
  ]);
}

const ALLOWED_CLI_COMMANDS = new Set(["codex", "claude", "powershell", "pwsh", "bash", "cmd", "sh", "zsh"]);

function normalizeWorkspaceCliRequest(value, availableCliAgents = []) {
  if (!isObject(value)) return null;
  const rawCommand = cleanText(value.command, 200).trim().toLowerCase();
  if (!rawCommand) return null;
  const baseCommand = rawCommand.split(/[\s/\\]/).at(-1).replace(/\.exe$/i, "");
  if (!ALLOWED_CLI_COMMANDS.has(baseCommand)) return null;
  // Verify the command is actually available when a catalog is provided
  if (availableCliAgents.length > 0) {
    const knownCommands = new Set(availableCliAgents.map((a) => String(a.command ?? "").toLowerCase()));
    if (!knownCommands.has(baseCommand) && !knownCommands.has(rawCommand)) return null;
  }
  return {
    command: baseCommand,
    args: Array.isArray(value.args) ? value.args.map((a) => cleanText(String(a ?? ""), 500)).filter(Boolean).slice(0, 20) : [],
    label: cleanText(value.label, 120) || baseCommand,
    cwd: value.cwd ? cleanText(value.cwd, 500) : null,
    autonomyMode: ["assisted", "supervised_autonomy"].includes(value.autonomyMode) ? value.autonomyMode : "assisted"
  };
}

const BANNED_VISIBLE_REPLY_PATTERNS = Object.freeze([
  /\bbefore acting\b/i,
  /\bi will qualify this request\b/i,
  /\bwhat i will do\b/i,
  /\bwhat i will not do\b/i,
  /\bforbidden actions\b/i,
  /\blimitations\b/i,
  /\bthis run will not\b/i,
  /\bno stronger bounded signal was detected\b/i,
  /\bavant d['’]agir\b/i,
  /\bje vais qualifier\b/i,
  /\bce que je (vais faire|ferai|peux faire)\b/i,
  /\bce que je ne (vais pas faire|ferai pas)\b/i,
  /\bactions interdites\b/i,
  /\blimites\b/i,
  /\bce run ne\b/i,
  /\brun born[ée]\b/i,
  /\bmission born[ée]\b/i
]);

function containsBannedVisiblePattern(text) {
  return BANNED_VISIBLE_REPLY_PATTERNS.some((pattern) => pattern.test(text));
}

function polishVisibleReply(text) {
  let polished = cleanText(text, 1800);
  if (!polished) {
    return polished;
  }

  if (/j['’]ai besoin de ton accord/i.test(polished) && /\btu pr[ée]f[èe]res\b/i.test(polished)) {
    polished = polished.replace(/^.*?\b(tu pr[ée]f[èe]res\b)/i, "$1");
  }

  polished = polished
    .replace(/^oui\.\s*j['’]ai besoin de ton accord pour lancer l['’]application\.?$/i, "Confirme et je lance l'application.")
    .replace(/^oui\.\s*j['’]ai besoin de ton accord pour lancer ([^.?!]+)\.?$/i, "Confirme et je lance $1.")
    .replace(/^oui\.\s*j['’]ai besoin de ton accord pour ouvrir ([^.?!]+)\.?$/i, "Confirme et j'ouvre $1.")
    .replace(/\bje peux lancer l['’]action avec ton accord\.?$/i, "Confirme et je lance.");

  return cleanText(polished, 1800);
}

function naturalFallbackReply({ action, intentType, message, requiresClarification, clarificationQuestion }) {
  if (requiresClarification) {
    return clarificationQuestion || "Tu peux préciser la cible ?";
  }
  if (action === "launch_workspace_cli") {
    return "Je lance le terminal dans l’espace de travail.";
  }
  if (action === "prepare_mission_preflight" || action === "start_bounded_run_after_confirmation") {
    if (/\b(ouvre|ouvrir|open|launch|lance|d[ée]marre|start)\b/i.test(message)) {
      return "Oui. Je prépare l’ouverture.";
    }
    return "Oui. Je m’en occupe.";
  }
  if (action === "inspect_then_answer") {
    return "Je regarde ça.";
  }
  if (action === "generate_structured_response" || intentType === "report_generation") {
    return "Oui. Je prépare ça.";
  }
  if (action === "refuse") {
    return "Je ne peux pas faire cette action. Je peux t’aider sur une version sûre de la demande.";
  }
  return "Je t’écoute.";
}

function sanitizeVisibleReply(reply, context) {
  const text = polishVisibleReply(reply);
  if (!text || containsBannedVisiblePattern(text)) {
    return naturalFallbackReply(context);
  }
  return text;
}

export function defaultVisibleAssistantSystemPrompt() {
  return DEFAULT_VISIBLE_ASSISTANT_SYSTEM_PROMPT;
}

export function buildDeterministicConversationTurn(input = {}) {
  const message = cleanText(input.message ?? input.userMessage ?? "", 1200);
  const lower = message.toLowerCase();
  if (!message) {
    return {
      intentType: "ambiguous",
      action: "ask_clarification",
      reply: "Tu veux que je fasse quoi exactement ?",
      requiresClarification: true,
      clarificationQuestion: "Que veux-tu que Cowork fasse ou inspecte maintenant ?",
      capabilityRequests: [],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: []
    };
  }
  if (outOfScopeIntent(lower)) {
    return {
      intentType: "out_of_scope",
      action: "refuse",
      reply: "Je ne peux pas faire cette action. Je peux t’aider sur une version sûre de la demande.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: ["Sensitive destructive/authentication/publishing intent detected."]
    };
  }
  if (desktopFolderIntent(lower)) {
    return {
      intentType: "safe_inspection",
      action: "inspect_then_answer",
      reply: "Je regarde les dossiers sur ton Bureau.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [{
        id: "inspect_desktop_folders",
        reason: "The user asked which folders are present on the Desktop.",
        parameters: {
          scope: "desktop_top_level_folders"
        }
      }],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: ["Read-only desktop folder listing only; no file content is opened."]
    };
  }
  if (appCatalogIntent(lower) && browserCatalogIntent(lower)) {
    return {
      intentType: "safe_inspection",
      action: "inspect_then_answer",
      reply: "Je regarde les applications et navigateurs disponibles.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [
        { id: "list_installed_applications", reason: "The user asked for available local applications.", parameters: {}, order: 1 },
        { id: "list_installed_browsers", reason: "The user asked for available browsers.", parameters: {}, order: 2 }
      ],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: ["Read-only local application and browser catalogs."]
    };
  }
  if (appCatalogIntent(lower)) {
    return {
      intentType: "safe_inspection",
      action: "inspect_then_answer",
      reply: "Je regarde les applications disponibles.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [{ id: "list_installed_applications", reason: "The user asked for available local applications.", parameters: {} }],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: ["Read-only local application catalog."]
    };
  }
  if (browserCatalogIntent(lower)) {
    return {
      intentType: "safe_inspection",
      action: "inspect_then_answer",
      reply: "Je regarde les navigateurs disponibles.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [{ id: "list_installed_browsers", reason: "The user asked for available browsers.", parameters: {} }],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: ["Read-only browser catalog."]
    };
  }
  if (reportIntent(lower) && !desktopActionIntent(lower)) {
    return {
      intentType: "report_generation",
      action: "generate_structured_response",
      reply: "Oui. Je prépare un aperçu structuré.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [{ id: "generate_report_preview", reason: "The user asked for a report-style response.", parameters: { topic: message } }],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: ["Report preview is generated as controlled UI blocks and a local artifact, not arbitrary inline HTML."]
    };
  }
  if (workspaceCliIntent(lower)) {
    const availableCliAgents = Array.isArray(input.availableCliAgents) ? input.availableCliAgents : [];
    const cliAgent = availableCliAgents.find((a) =>
      /\bcodex\b/i.test(lower) ? a.command === "codex"
      : /\bclaude\b/i.test(lower) ? a.command === "claude"
      : /\bpowershell\b/i.test(lower) ? (a.command === "powershell" || a.command === "pwsh")
      : /\bbash\b/i.test(lower) ? a.command === "bash"
      : false
    ) ?? availableCliAgents[0] ?? null;
    if (cliAgent) {
      return {
        intentType: "workspace_cli",
        action: "launch_workspace_cli",
        reply: `Je lance ${cliAgent.label} dans l’espace de travail.`,
        requiresClarification: false,
        clarificationQuestion: "",
        capabilityRequests: [],
        missionDraft: null,
        workspaceCliRequest: {
          command: cliAgent.command,
          args: [],
          label: cliAgent.label,
          cwd: null,
          autonomyMode: "assisted"
        },
        uiBlocks: [],
        safetyNotes: ["Workspace CLI terminal launched in assisted mode; user approval required for input."]
      };
    }
  }
  if (desktopActionIntent(lower)) {
    return {
      intentType: "desktop_action",
      action: "prepare_mission_preflight",
      reply: "Oui. Je prépare l’action.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [],
      missionDraft: {
        objective: message,
        deliverable: "Résultat vérifié et preuve visible si disponible",
        constraints: [],
        forbiddenActions: ["Ne pas supprimer, publier, soumettre ou utiliser des identifiants."],
        mode: "",
        parameters: {}
      },
      uiBlocks: [],
      safetyNotes: ["Desktop action requires bounded mission preflight and approvals where needed."]
    };
  }
  if (greetingIntent(lower)) {
    return {
      intentType: "simple_conversation",
      action: "answer_directly",
      reply: "Salut. Dis-moi ce que tu veux faire, ou ce que tu veux que je regarde.",
      requiresClarification: false,
      clarificationQuestion: "",
      capabilityRequests: [],
      missionDraft: null,
      uiBlocks: [],
      safetyNotes: []
    };
  }
  return {
    intentType: "simple_conversation",
    action: "answer_directly",
    reply: "Je suis là. Que veux-tu faire ?",
    requiresClarification: false,
    clarificationQuestion: "",
    capabilityRequests: [],
    missionDraft: null,
    uiBlocks: [],
    safetyNotes: []
  };
}

export function validateConversationTurnOutput(output, context = {}) {
  if (!isObject(output)) {
    throw Object.assign(new Error("Conversation turn output must be an object."), {
      category: "malformed_output"
    });
  }
  const intentType = normalizeIntentType(output.intentType);
  const action = normalizeAction(output.action);
  const requiresClarification = Boolean(output.requiresClarification);
  const clarificationQuestion = cleanText(output.clarificationQuestion, 260);
  const reply = sanitizeVisibleReply(output.reply, {
    action,
    intentType,
    message: context.message ?? output.message ?? "",
    requiresClarification,
    clarificationQuestion
  });
  if (!reply) {
    throw Object.assign(new Error("Conversation turn output must contain reply."), {
      category: "malformed_output"
    });
  }
  if (requiresClarification && !clarificationQuestion) {
    throw Object.assign(new Error("Conversation turn output must contain clarificationQuestion when clarification is required."), {
      category: "malformed_output"
    });
  }
  const capabilityRequests = Array.isArray(output.capabilityRequests)
    ? output.capabilityRequests.map(normalizeCapabilityRequest).filter(Boolean).slice(0, 4)
    : [];
  let missionDraft = normalizeMissionDraft(output.missionDraft, context.message ?? output.message ?? "");
  if (["prepare_mission_preflight", "start_bounded_run_after_confirmation"].includes(action) && !missionDraft) {
    missionDraft = normalizeMissionDraft({
      objective: context.message ?? output.message ?? "",
      deliverable: "Résultat vérifié et preuve visible si disponible",
      constraints: [],
      forbiddenActions: ["Ne pas supprimer, publier, soumettre ou utiliser des identifiants."],
      mode: "",
      parameters: {}
    }, context.message ?? output.message ?? "");
  }
  if (["prepare_mission_preflight", "start_bounded_run_after_confirmation"].includes(action) && !missionDraft) {
    throw Object.assign(new Error("Conversation action requires missionDraft."), {
      category: "malformed_output"
    });
  }
  const workspaceCliRequest = action === "launch_workspace_cli"
    ? normalizeWorkspaceCliRequest(output.workspaceCliRequest, Array.isArray(output._availableCliAgents) ? output._availableCliAgents : [])
    : null;

  return {
    intentType,
    action,
    reply,
    requiresClarification,
    clarificationQuestion: requiresClarification ? clarificationQuestion : "",
    capabilityRequests,
    missionDraft,
    workspaceCliRequest,
    uiBlocks: normalizeUiBlocks(output.uiBlocks, { fallbackText: "" }),
    safetyNotes: cleanList(output.safetyNotes, 8, 260),
    confidence: cleanText(output.confidence, 24) || "medium"
  };
}
