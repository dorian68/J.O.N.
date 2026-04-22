import { normalizeUiBlocks } from "./ui-blocks.js";
import { DEFAULT_VISIBLE_ASSISTANT_SYSTEM_PROMPT } from "./agent-config.js";

export const CONVERSATION_INTENT_TYPES = Object.freeze([
  "simple_conversation",
  "local_question",
  "safe_inspection",
  "desktop_action",
  "long_mission",
  "report_generation",
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
  "refuse"
]);

export const SAFE_CAPABILITY_IDS = Object.freeze([
  "inspect_desktop_folders",
  "list_installed_applications",
  "list_installed_browsers",
  "generate_report_preview"
]);

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
    mode: cleanText(value.mode, 40),
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
    /\b(quelles?|liste|list|show)\b[\s\S]{0,80}\b(applications?|apps?|logiciels?)\b/i
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

function naturalFallbackReply({ action, intentType, message, requiresClarification, clarificationQuestion }) {
  if (requiresClarification) {
    return clarificationQuestion || "Tu peux préciser la cible ?";
  }
  if (action === "prepare_mission_preflight" || action === "start_bounded_run_after_confirmation") {
    if (/\b(ouvre|ouvrir|open|launch|lance|d[ée]marre|start)\b/i.test(message)) {
      return "Oui. J’ai besoin de ton accord pour lancer cette action.";
    }
    return "Oui. Je peux m’en occuper avec ton accord.";
  }
  if (action === "inspect_then_answer") {
    return "Je regarde ça.";
  }
  if (action === "generate_structured_response" || intentType === "report_generation") {
    return "Oui. Je prépare ça.";
  }
  if (action === "refuse") {
    return "Je ne peux pas faire ça tel quel. Il me faut une confirmation explicite ou une demande moins risquée.";
  }
  return "Je suis là. Que veux-tu faire ?";
}

function sanitizeVisibleReply(reply, context) {
  const text = cleanText(reply, 1800);
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
      reply: "Je ne peux pas faire ça tel quel. Il me faut une demande plus précise et une confirmation explicite.",
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
  if (desktopActionIntent(lower)) {
    return {
      intentType: "desktop_action",
      action: "prepare_mission_preflight",
      reply: "Oui. J’ai besoin de ton accord pour lancer cette action.",
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
  const missionDraft = normalizeMissionDraft(output.missionDraft, context.message ?? output.message ?? "");
  if (["prepare_mission_preflight", "start_bounded_run_after_confirmation"].includes(action) && !missionDraft) {
    throw Object.assign(new Error("Conversation action requires missionDraft."), {
      category: "malformed_output"
    });
  }
  return {
    intentType,
    action,
    reply,
    requiresClarification,
    clarificationQuestion: requiresClarification ? clarificationQuestion : "",
    capabilityRequests,
    missionDraft,
    uiBlocks: normalizeUiBlocks(output.uiBlocks, { fallbackText: "" }),
    safetyNotes: cleanList(output.safetyNotes, 8, 260),
    confidence: cleanText(output.confidence, 24) || "medium"
  };
}
