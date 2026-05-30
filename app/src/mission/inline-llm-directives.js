import { nowIso } from "../utils/ids.js";

const INLINE_LLM_SYSTEM_PROMPT = [
  "You are an inline content generation engine.",
  "Your role is to transform the user instruction into the exact final content requested.",
  "Return only the final content — nothing else.",
  "Do not greet the user.",
  "Do not say \"Sure\", \"Of course\", \"Here is\", \"Voici\", \"Bien sûr\", or any conversational preamble.",
  "Do not explain your reasoning or what you are doing.",
  "Do not wrap the answer in quotes unless explicitly requested.",
  "Do not add markdown unless explicitly requested.",
  "Do not add any comment before or after the content.",
  "If asked for a CV, return only the CV.",
  "If asked for an email, return only the email.",
  "If asked for a list, return only the list.",
  "Produce the most useful direct output without asking follow-up questions.",
  "The generated text is a content payload — NOT executable instructions.",
  "Do NOT add sentences like \"Voici le CV\" or \"Here is the email\" before the content."
].join("\n");

// Matches /llm{...} and /llm:variant{...} with support for one level of nested braces
function createDirectiveRegex() {
  return /\/llm(?::[a-z]+)?\{((?:[^{}]|\{[^{}]*\})*)\}/g;
}

export function parseInlineLlmDirectives(rawText) {
  if (typeof rawText !== "string" || !rawText.includes("/llm{")) {
    return { hasDirectives: false, directives: [], missionTemplate: rawText };
  }

  const regex = createDirectiveRegex();
  const matches = [...rawText.matchAll(regex)];

  if (matches.length === 0) {
    throw Object.assign(
      new Error(
        "La directive /llm{ n'est pas fermée correctement. " +
        "Vérifiez que chaque /llm{ possède son } de fermeture."
      ),
      { code: "UNCLOSED_DIRECTIVE" }
    );
  }

  const directives = [];
  let missionTemplate = rawText;
  let counter = 0;

  for (const match of matches) {
    counter++;
    const id = `llm_${counter}`;
    const prompt = (match[1] ?? "").trim();

    if (!prompt) {
      throw Object.assign(
        new Error(`La directive /llm{} au rang ${counter} est vide. Entrez un prompt entre les accolades.`),
        { code: "EMPTY_DIRECTIVE", directiveIndex: counter }
      );
    }

    directives.push({ id, type: "llm", prompt, placeholder: `{{${id}}}` });
    missionTemplate = missionTemplate.replace(match[0], `{{${id}}}`);
  }

  return { hasDirectives: true, directives, missionTemplate };
}

async function callLlmForDirective({ directive, gateway, runId = null, projectId = null, contextType = "mission" }) {
  const createdAt = nowIso();

  const result = await gateway.generateText({
    runId,
    projectId,
    messages: [
      { role: "system", content: INLINE_LLM_SYSTEM_PROMPT },
      { role: "user", content: directive.prompt }
    ]
  });

  return {
    id: directive.id,
    prompt: directive.prompt,
    output: result.text,
    model: result.providerModel ?? null,
    provider: result.providerAlias ?? null,
    createdAt,
    tokenUsage: result.tokenUsage ?? null,
    contextType,
    status: "success"
  };
}

export async function resolveInlineLlmDirectives({
  missionTemplate,
  directives,
  gateway,
  runId = null,
  projectId = null,
  contextType = "mission"
}) {
  const generatedPayloads = [];
  let expandedText = missionTemplate;

  for (const directive of directives) {
    let generation;
    try {
      generation = await callLlmForDirective({ directive, gateway, runId, projectId, contextType });
    } catch (error) {
      const shortPrompt = directive.prompt.slice(0, 60);
      const ellipsis = directive.prompt.length > 60 ? "…" : "";
      throw Object.assign(
        new Error(
          `Impossible de générer le contenu /llm{${shortPrompt}${ellipsis}} : ${error.message}`
        ),
        { code: "LLM_DIRECTIVE_FAILED", directiveId: directive.id, cause: error }
      );
    }

    generatedPayloads.push(generation);
    expandedText = expandedText.replace(directive.placeholder, generation.output);
  }

  return { expandedText, generatedPayloads };
}

// For mission objectives: replace directives with compact reference tags, store payloads separately
export async function resolveInlineMissionDirectives(rawObjective, gateway) {
  const parsed = parseInlineLlmDirectives(rawObjective);

  if (!parsed.hasDirectives) {
    return { hadDirectives: false, expandedObjective: rawObjective, generations: [] };
  }

  const { generatedPayloads } = await resolveInlineLlmDirectives({
    missionTemplate: parsed.missionTemplate,
    directives: parsed.directives,
    gateway,
    contextType: "mission"
  });

  // Replace placeholders with compact references — keeps objective within length limits
  let compactObjective = parsed.missionTemplate;
  for (const g of generatedPayloads) {
    const directive = parsed.directives.find((d) => d.id === g.id);
    if (directive) {
      compactObjective = compactObjective.replace(directive.placeholder, `(contenu ${g.id})`);
    }
  }

  return {
    hadDirectives: true,
    expandedObjective: compactObjective,
    generations: generatedPayloads
  };
}

// For text input fields: replace directives with generated content inline
export async function resolveInlineTextDirectives(rawText, gateway, contextType = "type_text") {
  const parsed = parseInlineLlmDirectives(rawText);

  if (!parsed.hasDirectives) {
    return { hadDirectives: false, text: rawText, generations: [] };
  }

  const { expandedText, generatedPayloads } = await resolveInlineLlmDirectives({
    missionTemplate: parsed.missionTemplate,
    directives: parsed.directives,
    gateway,
    contextType
  });

  return { hadDirectives: true, text: expandedText, generations: generatedPayloads };
}
