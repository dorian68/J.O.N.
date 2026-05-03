import { createHash } from "node:crypto";
import { validateSkillManifest } from "./skill-manifest.js";

const DEFAULT_LIMITS = Object.freeze({
  maxExistingMatches: 6,
  strongMatchScore: 6
});

const INTENT_PROFILES = Object.freeze({
  web_data_adapter: {
    label: "Web data adapter",
    keywords: [
      "browser", "web", "site", "website", "url", "page", "dom", "extract", "scrape", "parser", "parse",
      "list", "lister", "liste", "collect", "collecte", "results", "résultats", "resultats", "jobs", "postes",
      "profiles", "profils", "products", "produits", "table", "csv", "portal", "linkedin", "upwork"
    ],
    primitives: ["browser.read_dom", "browser.extract_text", "browser.verify_outcome", "browser.capture_evidence"],
    policyHooks: ["browser_read", "browser_navigation", "generated_capability_review"],
    evidenceHooks: ["dom_snapshot", "structured_extraction", "page_screenshot", "capability_test_report"],
    outputs: ["structured_extraction", "verified_result_set", "capability_test_report"],
    surfaceKind: "browser"
  },
  desktop_app_adapter: {
    label: "Desktop app adapter",
    keywords: [
      "desktop", "app", "application", "logiciel", "window", "fenetre", "fenêtre", "excel", "word",
      "powerpoint", "notepad", "obsidian", "click", "type", "open", "ouvrir", "launch", "lance"
    ],
    primitives: ["observe_windows", "launch_application", "focus_window", "click_point", "type_text", "capture_window"],
    policyHooks: ["local_app_launch", "desktop_click", "desktop_text_input", "generated_capability_review"],
    evidenceHooks: ["visible_window_snapshot", "before_after_capture", "action_log", "capability_test_report"],
    outputs: ["desktop_action_plan", "verified_visible_state", "capability_test_report"],
    surfaceKind: "application"
  },
  file_transform_adapter: {
    label: "File transform adapter",
    keywords: [
      "file", "folder", "directory", "fichier", "dossier", "csv", "json", "pdf", "xlsx", "convert",
      "transform", "merge", "split", "extract", "read", "write", "rapport"
    ],
    primitives: ["list_directory", "read_text_file", "create_text_file", "write_text_file"],
    policyHooks: ["file_read", "file_write", "generated_capability_review"],
    evidenceHooks: ["text_preview_or_written_file", "rollback_manifest", "capability_test_report"],
    outputs: ["transformed_file", "rollback_manifest", "capability_test_report"],
    surfaceKind: "file_system"
  },
  terminal_workflow_adapter: {
    label: "Terminal workflow adapter",
    keywords: [
      "terminal", "cli", "command", "script", "powershell", "npm", "node", "python", "build", "test",
      "compile", "install", "execute"
    ],
    primitives: ["launch_workspace_cli", "type_text", "send_hotkey", "capture_window"],
    policyHooks: ["shell_command", "generated_capability_review", "approval_required"],
    evidenceHooks: ["command_preview", "captured_output", "capability_test_report"],
    outputs: ["command_plan", "captured_output", "capability_test_report"],
    surfaceKind: "terminal"
  },
  verifier_adapter: {
    label: "Verifier adapter",
    keywords: [
      "verify", "verifier", "vérifier", "validate", "validation", "proof", "preuve", "evidence",
      "check", "assert", "livrable", "completed", "done"
    ],
    primitives: ["capture_window", "browser.verify_outcome", "read_text_file"],
    policyHooks: ["verification", "generated_capability_review"],
    evidenceHooks: ["verification_summary", "proof_artifact", "capability_test_report"],
    outputs: ["verification_summary", "proof_artifact", "capability_test_report"],
    surfaceKind: "verification"
  },
  workflow_orchestrator: {
    label: "Workflow orchestrator",
    keywords: [
      "then", "puis", "ensuite", "workflow", "pipeline", "orchestrate", "enchaîner", "multi",
      "combine", "automate", "de bout en bout"
    ],
    primitives: ["await_manual_action", "browser.plan_mission", "observe_windows", "capture_window"],
    policyHooks: ["workflow_orchestration", "generated_capability_review"],
    evidenceHooks: ["step_plan", "handoff_decision", "capability_test_report"],
    outputs: ["bounded_workflow_plan", "handoff_decision", "capability_test_report"],
    surfaceKind: "workflow"
  }
});

function cleanText(value, maxLength = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeId(value, maxLength = 48) {
  return cleanText(value, maxLength)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength)
    || "capability";
}

function hashId(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 10);
}

function tokensFor(value) {
  return cleanText(value, 4000)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9.:-]+/)
    .filter((token) => token.length >= 3);
}

function textForNode(node = {}) {
  const payload = node.payload ?? {};
  return [
    node.id,
    node.label,
    node.skillId,
    node.sourceKind,
    node.sourceId,
    payload.description,
    ...(payload.affordances ?? []),
    ...(payload.knownLimits ?? []),
    ...(payload.primitives ?? []),
    ...(payload.evidenceExpected ?? [])
  ].map((entry) => Array.isArray(entry) ? entry.join(" ") : entry).join(" ");
}

function scoreProfile(textTokens, profile) {
  const tokenSet = new Set(textTokens);
  return profile.keywords.reduce((score, keyword) => {
    const normalized = tokensFor(keyword)[0] ?? keyword.toLowerCase();
    return score + (tokenSet.has(normalized) ? 1 : 0);
  }, 0);
}

function classifyIntent({ mission = "", desiredOutcome = "", failureContext = null } = {}) {
  const text = [
    mission,
    desiredOutcome,
    failureContext?.summary,
    failureContext?.reason,
    failureContext?.error,
    ...(Array.isArray(failureContext?.failedChecks) ? failureContext.failedChecks : [])
  ].map((entry) => cleanText(entry)).join(" ");
  const textTokens = tokensFor(text);
  const tokenSet = new Set(textTokens);
  const hasWebSurface = [
    "browser", "web", "site", "website", "url", "page", "dom", "portal", "linkedin", "upwork"
  ].some((token) => tokenSet.has(token));
  const hasStructuredExtraction = [
    "extract", "extracted", "collect", "list", "rows", "row", "table", "csv", "json", "metadata",
    "profiles", "profils", "jobs", "products", "produits"
  ].some((token) => tokenSet.has(token));
  const ranked = Object.entries(INTENT_PROFILES)
    .map(([kind, profile]) => ({
      kind,
      label: profile.label,
      score: scoreProfile(textTokens, profile)
        + (kind === "web_data_adapter" && hasWebSurface && hasStructuredExtraction ? 3 : 0)
    }))
    .sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind));
  const top = ranked[0] ?? { kind: "workflow_orchestrator", score: 0 };
  return {
    text,
    tokens: textTokens,
    primaryKind: top.score > 0 ? top.kind : "workflow_orchestrator",
    confidence: top.score >= 4 ? "high" : top.score >= 2 ? "medium" : "low",
    ranked
  };
}

function scoreExistingCapabilities(nodes = [], intent) {
  const missionTokens = new Set(intent.tokens);
  return nodes
    .map((node) => {
      const nodeTokens = new Set(tokensFor(textForNode(node)));
      const directIdentityTokens = new Set(tokensFor([
        node.id,
        node.label,
        node.skillId,
        node.sourceId
      ].join(" ")));
      let score = 0;
      for (const token of missionTokens) {
        if (nodeTokens.has(token)) {
          score += 1;
        }
        if (directIdentityTokens.has(token)) {
          score += 3;
        }
      }
      if (String(node.skillId ?? "").includes("browser") && intent.primaryKind === "web_data_adapter") {
        score += 2;
      }
      if (String(node.skillId ?? "").includes("app_launch") && intent.primaryKind === "desktop_app_adapter") {
        score += 2;
      }
      if (String(node.skillId ?? "").includes("explorer") && intent.primaryKind === "file_transform_adapter") {
        score += 2;
      }
      return {
        id: node.id,
        label: cleanText(node.label ?? node.id, 160),
        skillId: node.skillId ?? null,
        sourceKind: node.sourceKind ?? null,
        score
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

function failureIndicatesGap(failureContext = null) {
  if (!failureContext) {
    return false;
  }
  const status = cleanText(failureContext.status ?? failureContext.outcomeStatus ?? "").toLowerCase();
  const summary = cleanText([
    failureContext.summary,
    failureContext.reason,
    failureContext.error,
    ...(Array.isArray(failureContext.failedChecks) ? failureContext.failedChecks : [])
  ].join(" ")).toLowerCase();
  return ["failed", "fail", "partial", "blocked"].includes(status)
    || /missing|not extracted|non extrait|incomplete|unsupported|no parser|pas de parser|verification failed|livrable/.test(summary);
}

function missionAsksForBuild(intentText) {
  return /\b(build|create|develop|implement|generate|scaffold|adapter|parser|outil|skill|capacit[eé]|d[eé]veloppe|cr[eé]e)\b/i.test(intentText);
}

export function assessCapabilityGap({
  mission = "",
  desiredOutcome = "",
  capabilityGraph = [],
  failureContext = null,
  limits = DEFAULT_LIMITS
} = {}) {
  const intent = classifyIntent({ mission, desiredOutcome, failureContext });
  const existingMatches = scoreExistingCapabilities(capabilityGraph, intent).slice(0, limits.maxExistingMatches);
  const bestScore = existingMatches[0]?.score ?? 0;
  const explicitBuild = missionAsksForBuild(intent.text);
  const failureGap = failureIndicatesGap(failureContext);
  const specializedWebNeed = intent.primaryKind === "web_data_adapter"
    && /\b(site:|linkedin|upwork|portal|table|csv|profiles?|profils?|jobs?|postes?|produits?|products?|result|résultat|resultat)\b/i.test(intent.text);
  const needDetected = Boolean(
    explicitBuild
    || failureGap
    || bestScore < limits.strongMatchScore
    || specializedWebNeed
  );
  const gapType = needDetected
    ? explicitBuild
      ? "explicit_capability_request"
      : failureGap
        ? "failed_or_incomplete_capability"
        : specializedWebNeed
          ? "specialized_adapter_missing"
          : "weak_capability_coverage"
    : "covered_by_existing_capabilities";
  return {
    needDetected,
    confidence: failureGap || explicitBuild ? "high" : intent.confidence,
    gapType,
    capabilityKind: intent.primaryKind,
    intentRanking: intent.ranked,
    existingMatches,
    reasoning: needDetected
      ? "The current capability graph does not provide enough proven coverage for the requested outcome, so JON should propose a draft capability and test plan before pretending the mission is covered."
      : "Existing capabilities appear sufficient; JON should use them before creating a new tool.",
    signals: {
      explicitBuild,
      failureGap,
      specializedWebNeed,
      bestExistingScore: bestScore
    }
  };
}

export const analyzeCapabilityGap = assessCapabilityGap;

function profileFor(kind) {
  return INTENT_PROFILES[kind] ?? INTENT_PROFILES.workflow_orchestrator;
}

function buildSkillManifest({ mission, desiredOutcome, assessment }) {
  const profile = profileFor(assessment.capabilityKind);
  const baseId = safeId(`${assessment.capabilityKind}_${mission || desiredOutcome}`, 38);
  return {
    id: `skill.generated.${baseId}_${hashId(`${mission}\n${desiredOutcome}`)}`,
    label: `Draft ${profile.label}`,
    category: "generated_draft",
    surfaceKind: profile.surfaceKind,
    description: cleanText(`Draft capability proposed for: ${mission || desiredOutcome}. It must remain non-executable until a validation harness proves the workflow and an operator approves activation.`),
    appMatchers: [safeId(mission || desiredOutcome, 40)].filter(Boolean),
    affordances: [
      `Handle missions like: ${cleanText(mission || desiredOutcome, 140)}`,
      "Expose explicit verification criteria before use",
      "Stay disabled until validated"
    ],
    primitives: profile.primitives,
    inputs: ["mission", "observed_state", "expected_outcome"],
    outputs: profile.outputs,
    policyHooks: profile.policyHooks,
    evidenceHooks: profile.evidenceHooks,
    rollbackSupport: "disable_generated_capability",
    missionRelevance: {
      generated_capability: 1,
      [assessment.capabilityKind]: 1
    },
    knownLimits: [
      "Draft only: not executable until a capability harness passes.",
      "Cannot modify runtime core without explicit code review.",
      "Must preserve evidence for every activation."
    ]
  };
}

function implementationPlanFor(assessment) {
  const profile = profileFor(assessment.capabilityKind);
  return [
    {
      id: "scope_capability",
      label: "Scope the missing capability",
      description: "Extract the target surface, inputs, outputs, policy hooks and expected proof from the mission."
    },
    {
      id: "create_candidate_artifact",
      label: "Create a bounded candidate artifact",
      description: `Prepare a ${profile.label.toLowerCase()} artifact in a draft-only write scope.`
    },
    {
      id: "build_validation_harness",
      label: "Build validation harness",
      description: "Run the candidate against fixture, snapshot or explicitly allowlisted real-surface data."
    },
    {
      id: "register_after_proof",
      label: "Register after proof",
      description: "Store the skill manifest and activation evidence only after tests and policy gates pass."
    }
  ];
}

function testPlanFor(assessment) {
  return [
    {
      id: "manifest_schema",
      type: "static",
      successCriteria: ["Skill manifest validates", "Activation status remains draft"]
    },
    {
      id: "fixture_execution",
      type: "fixture",
      successCriteria: ["Candidate handles representative fixture", "Evidence artifact is produced"]
    },
    {
      id: "negative_case",
      type: "safety",
      successCriteria: ["Candidate stops on missing target", "No unapproved mutation occurs"]
    },
    {
      id: "livrable_verification",
      type: "verification",
      successCriteria: ["Expected output is checked against the user deliverable", "Failure is reported as incomplete rather than completed"]
    }
  ].map((entry) => ({
    ...entry,
    capabilityKind: assessment.capabilityKind
  }));
}

export function buildCapabilityBuildProposal({
  mission = "",
  desiredOutcome = "",
  capabilityGraph = [],
  failureContext = null,
  now = new Date().toISOString()
} = {}) {
  const assessment = assessCapabilityGap({
    mission,
    desiredOutcome,
    capabilityGraph,
    failureContext
  });
  const profile = profileFor(assessment.capabilityKind);
  const proposedSkillManifest = assessment.needDetected
    ? buildSkillManifest({ mission, desiredOutcome, assessment })
    : null;
  return {
    id: `capbuild_${hashId(`${mission}\n${desiredOutcome}\n${assessment.gapType}`)}`,
    createdAt: now,
    status: assessment.needDetected ? "draft_proposed" : "use_existing",
    decision: assessment.needDetected ? "propose_capability_build" : "use_existing_capabilities",
    capabilityKind: assessment.capabilityKind,
    title: assessment.needDetected ? `Propose ${profile.label}` : "Use existing capabilities",
    mission: cleanText(mission, 1200),
    desiredOutcome: cleanText(desiredOutcome, 1200),
    assessment,
    problemStatement: assessment.needDetected
      ? cleanText(`JON should not claim this mission is covered until a ${profile.label.toLowerCase()} is created, tested and approved.`)
      : "The current graph has enough matching capabilities for a first attempt.",
    proposedSkillManifest,
    implementationPlan: assessment.needDetected ? implementationPlanFor(assessment) : [],
    testPlan: assessment.needDetected ? testPlanFor(assessment) : [],
    activationGates: assessment.needDetected ? [
      "Manifest validates.",
      "Fixture or snapshot harness passes.",
      "Policy hooks are declared.",
      "Evidence requirements are produced.",
      "Operator approval is recorded before any live activation."
    ] : [],
    safety: {
      generatedCodeExecutableByDefault: false,
      canModifyRuntimeCore: false,
      requiresOperatorApproval: assessment.needDetected,
      allowedWriteScopes: ["generated capability draft directory", "user skill manifest registry"],
      prohibitedActions: [
        "hidden shell execution",
        "runtime core mutation without review",
        "credential use",
        "submit/publish/delete without explicit policy approval"
      ]
    },
    evidenceRequirements: assessment.needDetected
      ? ["capability_gap_assessment", "candidate_manifest", "test_report", "activation_decision"]
      : ["capability_selection_trace"]
  };
}

export function validateCapabilityBuildProposal(proposal = {}) {
  const errors = [];
  if (!proposal.id || !/^capbuild_[a-f0-9]{10}$/.test(String(proposal.id))) {
    errors.push("id must be a capbuild_* identifier");
  }
  if (!["draft_proposed", "use_existing"].includes(proposal.status)) {
    errors.push("status must be draft_proposed or use_existing");
  }
  if (!proposal.assessment || typeof proposal.assessment !== "object") {
    errors.push("assessment is required");
  }
  if (proposal.status === "draft_proposed") {
    if (!proposal.proposedSkillManifest) {
      errors.push("draft proposals require proposedSkillManifest");
    } else {
      const skillValidation = validateSkillManifest(proposal.proposedSkillManifest);
      if (!skillValidation.valid) {
        errors.push(...skillValidation.errors.map((error) => `skill: ${error}`));
      }
    }
    if (!Array.isArray(proposal.testPlan) || proposal.testPlan.length === 0) {
      errors.push("draft proposals require testPlan");
    }
    if (proposal.safety?.generatedCodeExecutableByDefault !== false) {
      errors.push("generated code must not be executable by default");
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
