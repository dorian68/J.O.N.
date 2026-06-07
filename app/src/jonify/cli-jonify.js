// CLI JON-ify — turn a command-line tool (docker, git, npm…) into a manifest of
// tools by introspecting its `--help`. A CLI subcommand IS already a typed tool,
// so this is the most robust way to "JON-ify" dev tools (esp. Electron apps like
// Docker Desktop that expose nothing via UI Automation).

import { GLOBAL_SAFETY_RULES } from "./safety-classifier.js";

const CRITICAL = /^(rm|rmi|remove|prune|delete|destroy|kill|down|stop|uninstall|drop|reset)$/i;
const HIGH = /^(run|build|push|exec|up|start|restart|login|logout|tag|commit|save|load|import|export|publish|deploy|apply|install|update|upgrade|init|create|bake)$/i;
// everything else (ps, ls, list, images, inspect, logs, version, info, search, stats, status, show, get, config, context, top, history, diff, events, help) → low (read-only)

export function cliCommandRisk(name) {
  const n = String(name ?? "").toLowerCase();
  if (CRITICAL.test(n)) return "critical";
  if (HIGH.test(n)) return "high";
  return "low";
}

function cliVerbToType(name) {
  const n = String(name ?? "").toLowerCase();
  if (CRITICAL.test(n)) return n === "stop" || n === "down" || n === "kill" ? "delete" : "delete";
  if (/^(run|exec|up|start|build|bake)$/.test(n)) return "create";
  if (/^(push|publish|deploy|apply|login|logout|tag|commit|save|load|import|export)$/.test(n)) return "send";
  if (/^(install|update|upgrade|init|create)$/.test(n)) return "update";
  if (/^(search|find)$/.test(n)) return "search";
  return "read";
}

// Parse standard `--help` output: lines like "  <name>[*]   <summary>" under a
// "...Commands:" section. Handles docker/git/npm/kubectl-style help.
export function parseCliHelp(helpText) {
  const lines = String(helpText ?? "").split(/\r?\n/);
  const commands = [];
  const seen = new Set();
  let inCommands = false;
  for (const line of lines) {
    if (/commands?:\s*$/i.test(line.trim())) { inCommands = true; continue; }
    if (!line.trim()) { inCommands = inCommands && true; continue; }
    // A non-indented, non-command line ends a command block (e.g. "Options:", "Run 'docker COMMAND --help'…").
    if (inCommands && /^[A-Za-z]/.test(line)) { inCommands = false; }
    if (!inCommands) continue;
    const m = line.match(/^\s{2,}([a-z][a-z0-9][a-z0-9_-]*)\*?\s{2,}(.+?)\s*$/i);
    if (m) {
      const name = m[1].toLowerCase();
      if (seen.has(name) || name === "help") continue;
      seen.add(name);
      commands.push({ name, summary: m[2].trim().slice(0, 160) });
    }
  }
  return commands;
}

export function jonifyCli(binary, helpText, { businessPurpose = null } = {}) {
  const commands = parseCliHelp(helpText);
  const actions = commands.map((c) => {
    const riskLevel = cliCommandRisk(c.name);
    const requiresConfirmation = riskLevel === "high" || riskLevel === "critical";
    return {
      id: `cli-${c.name}`,
      name: `${binary} ${c.name}`,
      type: cliVerbToType(c.name),
      description: c.summary,
      surfaceId: "cli",
      trigger: { type: "cli_run", command: c.name, selector: `${binary} ${c.name}` },
      inputs: [{ name: "args", type: "array", required: false }],
      safety: {
        riskLevel,
        requiresConfirmation,
        reason: riskLevel === "critical" ? "Commande destructrice (suppression/arrêt) — confirmation explicite."
          : riskLevel === "high" ? "Commande engageante (exécution/publication) — confirmation requise."
          : "Commande de lecture/inspection — sans effet de bord."
      },
      successState: { type: "process_exit", description: "Sortie 0 + stdout du processus." },
      confidence: 0.9,
      needsHumanReview: riskLevel === "critical"
    };
  });
  // One single-step workflow per command (so the safe executor can run each tool).
  const workflows = actions.map((a) => ({
    id: `${a.id}-workflow`,
    name: a.name,
    description: a.description,
    steps: [{ actionId: a.id }],
    expectedOutcome: a.successState.description,
    confidence: 0.9,
    needsHumanReview: a.safety.riskLevel === "critical",
    requiredInputs: []
  }));

  const manifest = {
    schemaVersion: "0.1.0",
    generatedBy: "JON",
    generationMode: "auto-assisted",
    confidence: actions.length ? 0.9 : 0,
    app: {
      id: String(binary).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: binary,
      description: `Outil en ligne de commande « ${binary} » cartographié depuis --help (${actions.length} commandes).`,
      baseUrl: null,
      environment: "cli",
      businessPurpose: businessPurpose ?? `Piloter ${binary} via ses sous-commandes.`
    },
    discovery: {
      startedAt: null, completedAt: null, pagesVisited: 1,
      elementsDetected: actions.length, actionsDetected: actions.length, workflowsInferred: workflows.length,
      requiresHumanReview: actions.some((a) => a.needsHumanReview)
    },
    surfaces: [{ id: "cli", name: `${binary} CLI`, urlPattern: null, type: "cli", purpose: `Interface ligne de commande de ${binary}.`, confidence: 0.9, detectedFrom: { title: binary }, keyElements: [] }],
    actions,
    workflows,
    safety: { globalRules: [...GLOBAL_SAFETY_RULES, "CLI: read-only commands only are auto-executed; mutating commands require confirmation AND an allowlist."] },
    humanReview: {
      required: actions.some((a) => a.needsHumanReview),
      questions: actions.filter((a) => a.safety.riskLevel === "critical").slice(0, 6).map((a) => ({ id: `confirm-${a.id}`, question: `« ${a.name} » est-elle destructrice (irréversible) ?`, suggestedAnswer: "oui" }))
    }
  };
  return manifest;
}
