import fs from "node:fs/promises";
import path from "node:path";
import { PROMPTS_ROOT, DEFAULT_PROMPT_ENVIRONMENT } from "../config.js";

const REQUIRED_FIELDS = [
  "prompt_id",
  "family",
  "purpose",
  "owner",
  "status",
  "version",
  "compatible_model_aliases",
  "input_contract",
  "output_contract",
  "benchmark_links",
  "change_notes"
];

async function walkJsonFiles(rootDir) {
  const entries = await fs.readdir(rootDir, {
    withFileTypes: true
  });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      results.push(fullPath);
    }
  }

  return results;
}

function assertPromptShape(definition, filePath) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in definition)) {
      throw new Error(`Prompt definition ${filePath} is missing required field ${field}.`);
    }
  }
  if (!Array.isArray(definition.compatible_model_aliases)) {
    throw new Error(`Prompt definition ${filePath} has invalid compatible_model_aliases.`);
  }
  if (!Array.isArray(definition.messages) || definition.messages.length === 0) {
    throw new Error(`Prompt definition ${filePath} must define at least one message.`);
  }
}

function renderScalar(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function renderTemplate(template, bindings) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    return renderScalar(bindings[key]);
  });
}

function normalizePrompt(definition, filePath) {
  return {
    promptId: definition.prompt_id,
    family: definition.family,
    purpose: definition.purpose,
    owner: definition.owner,
    status: definition.status,
    environment: definition.environment ?? "prototype",
    version: definition.version,
    compatibleModelAliases: definition.compatible_model_aliases,
    inputContract: definition.input_contract,
    outputContract: definition.output_contract,
    benchmarkLinks: definition.benchmark_links,
    changeNotes: definition.change_notes,
    messages: definition.messages,
    filePath
  };
}

export class PromptRegistry {
  constructor({
    rootDir = PROMPTS_ROOT,
    environment = DEFAULT_PROMPT_ENVIRONMENT
  } = {}) {
    this.rootDir = rootDir;
    this.environment = environment;
    this.prompts = new Map();
  }

  async load() {
    const files = await walkJsonFiles(this.rootDir);
    for (const filePath of files) {
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      assertPromptShape(raw, filePath);
      const prompt = normalizePrompt(raw, filePath);
      const key = this.#key(prompt.promptId, prompt.version);
      this.prompts.set(key, prompt);
    }
    return this;
  }

  listPrompts() {
    return Array.from(this.prompts.values());
  }

  resolvePrompt(promptId, version) {
    const prompt = this.prompts.get(this.#key(promptId, version));
    if (!prompt) {
      throw new Error(`Unknown prompt ${promptId}@${version}.`);
    }
    if (prompt.environment !== this.environment && prompt.environment !== "shared") {
      throw new Error(`Prompt ${promptId}@${version} is not valid for environment ${this.environment}.`);
    }
    return prompt;
  }

  resolvePromptRefs(promptRefs = []) {
    return promptRefs.map((ref) => {
      const prompt = this.resolvePrompt(ref.promptId, ref.version);
      return {
        promptId: prompt.promptId,
        version: prompt.version,
        family: prompt.family,
        purpose: prompt.purpose,
        outputContract: prompt.outputContract,
        benchmarkLinks: prompt.benchmarkLinks,
        messages: prompt.messages.map((message) => ({
          role: message.role,
          content: renderTemplate(message.content, ref.bindings ?? {})
        }))
      };
    });
  }

  #key(promptId, version) {
    return `${promptId}@${version}`;
  }
}
