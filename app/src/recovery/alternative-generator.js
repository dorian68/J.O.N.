import { FAILURE_CAUSE } from "./failure-diagnoser.js";
import { createId } from "../utils/ids.js";
import { LLM_CALL_TYPE, LLM_MODEL_ALIAS } from "../config.js";

// Generic alternatives by failure cause — no site-specific logic
const HEURISTIC_MAP = {
  [FAILURE_CAUSE.ANTI_BOT]: [
    {
      id: "public_page_search",
      description: "Navigate to a public search or index URL for the target site that does not require bot verification",
      approach: "navigate_differently",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.55,
      rationale: "Public index/search pages typically have lighter bot protection than authenticated pages."
    },
    {
      id: "web_search_fallback",
      description: "Use a web search engine to retrieve the target information from publicly indexed sources",
      approach: "web_search",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.65,
      rationale: "Search engines index public content and can provide access without triggering site-level anti-bot."
    },
    {
      id: "manual_challenge_resolution",
      description: "Ask the user to solve the challenge manually in the browser, then resume from the cleared session",
      approach: "manual_intervention",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.9,
      rationale: "Human interaction can resolve challenges that automated browsers cannot."
    }
  ],
  [FAILURE_CAUSE.AUTH_REQUIRED]: [
    {
      id: "manual_auth",
      description: "Ask the user to log in manually in the browser, then resume the mission from the authenticated session",
      approach: "manual_intervention",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.85,
      rationale: "User authentication is the appropriate way to access private resources."
    },
    {
      id: "public_alternative",
      description: "Look for the same information from a publicly accessible source that does not require login",
      approach: "public_data_fallback",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.45,
      rationale: "Public equivalents may exist (company website, public profiles, cached results)."
    }
  ],
  [FAILURE_CAUSE.PERMISSION_DENIED]: [
    {
      id: "alternative_source",
      description: "Attempt to reach the same information through a different URL or alternative access path",
      approach: "navigate_differently",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.5,
      rationale: "Some resources are accessible through alternative paths."
    },
    {
      id: "ask_user_permissions",
      description: "Ask the user if they have the necessary access rights or an alternative method to reach this resource",
      approach: "ask_user",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.7,
      rationale: "The user may have credentials or an alternative approach not known to JON."
    }
  ],
  [FAILURE_CAUSE.PROVIDER_TIMEOUT]: [
    {
      id: "deterministic_plan",
      description: "Retry the mission using a pre-built deterministic plan that does not require a new LLM call to generate",
      approach: "deterministic_fallback",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.75,
      rationale: "Deterministic plans bypass LLM planning and run reliably when providers are slow or unavailable."
    },
    {
      id: "retry_after_delay",
      description: "Retry the same mission after a short delay to allow the provider to recover",
      approach: "retry",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.6,
      rationale: "Provider timeouts are often transient."
    }
  ],
  [FAILURE_CAUSE.MALFORMED_LLM_OUTPUT]: [
    {
      id: "deterministic_plan",
      description: "Retry using a pre-built deterministic plan for this mission type, bypassing the LLM planner",
      approach: "deterministic_fallback",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.8,
      rationale: "Deterministic plans are format-safe and independent of LLM output quality."
    },
    {
      id: "retry_simplified",
      description: "Restate the mission in a simpler form and retry with a more constrained structured output prompt",
      approach: "retry_with_constraints",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.65,
      rationale: "Simplified prompts reduce the chance of malformed model output."
    }
  ],
  [FAILURE_CAUSE.SHALLOW_SUCCESS]: [
    {
      id: "replan_targeted",
      description: "Generate a new, more specific plan that directly targets the actual deliverable, not just the initial step",
      approach: "replan",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.7,
      rationale: "A targeted plan avoids stopping at intermediate steps and drives toward the real goal."
    },
    {
      id: "extend_current_session",
      description: "Continue from the current state with additional navigation or execution steps to reach the deliverable",
      approach: "continue",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.65,
      rationale: "Building on the current state avoids repeating already-completed steps."
    },
    {
      id: "ask_user_confirm_scope",
      description: "Ask the user whether the current result partially satisfies their need, or whether to push further",
      approach: "ask_user",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.9,
      rationale: "The user knows best whether partial progress is sufficient."
    }
  ],
  [FAILURE_CAUSE.NAVIGATION_DEAD_END]: [
    {
      id: "search_correct_url",
      description: "Use a search engine to find the correct or updated URL for the target resource",
      approach: "web_search",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.75,
      rationale: "URLs change; a search can locate the current canonical URL."
    },
    {
      id: "ask_user_url",
      description: "Ask the user to confirm or provide the correct URL for the target resource",
      approach: "ask_user",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.9,
      rationale: "The user likely knows the correct destination."
    }
  ],
  [FAILURE_CAUSE.TOOL_LIMITATION]: [
    {
      id: "ask_user_alternative",
      description: "Explain the limitation to the user and ask how they would like to proceed",
      approach: "ask_user",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.8,
      rationale: "The user may have an alternative tool or approach in mind."
    }
  ],
  [FAILURE_CAUSE.INSUFFICIENT_CONTEXT]: [
    {
      id: "ask_user_clarify",
      description: "Ask the user to clarify the objective or provide additional context needed to proceed",
      approach: "ask_user",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.85,
      rationale: "Insufficient context requires user input to determine the correct path."
    }
  ],
  [FAILURE_CAUSE.UNKNOWN]: [
    {
      id: "ask_user_clarify",
      description: "Ask the user to clarify how to proceed or provide additional context",
      approach: "ask_user",
      requiresApproval: false, requiresUserInput: true,
      safetyLevel: "safe", estimatedSuccessProbability: 0.75,
      rationale: "Insufficient information to determine the best recovery path automatically."
    },
    {
      id: "retry_same",
      description: "Retry the same approach in case of a transient failure",
      approach: "retry",
      requiresApproval: false, requiresUserInput: false,
      safetyLevel: "safe", estimatedSuccessProbability: 0.4,
      rationale: "Some failures are transient and a simple retry resolves them."
    }
  ]
};

export function generateHeuristicAlternatives(diagnosis) {
  const base = HEURISTIC_MAP[diagnosis.cause] ?? HEURISTIC_MAP[FAILURE_CAUSE.UNKNOWN];
  // Stamp unique IDs to avoid collisions across recoveries
  return base.map(a => ({ ...a, id: `${a.id}_${createId("alt").slice(-4)}` }));
}

export async function generateAlternatives({ mission, diagnosis, llmGateway, projectId, runId }) {
  const heuristic = generateHeuristicAlternatives(diagnosis);

  if (!llmGateway) return heuristic;

  try {
    const llmResult = await llmGateway.generateStructured({
      runId,
      projectId,
      callType: LLM_CALL_TYPE.RECOVERY_ALTERNATIVE_GENERATION,
      modelAlias: LLM_MODEL_ALIAS.UTILITY_STRUCTURING,
      promptRefs: [{
        promptId: "recovery.alternative_generation",
        version: "1.0.0",
        bindings: {
          mission: String(mission ?? "").slice(0, 2000),
          failureCause: diagnosis.cause,
          whatWasTried: diagnosis.whatWasTried ?? "",
          whatFailed: diagnosis.whatFailed ?? "",
          whyFailed: diagnosis.whyFailed ?? "",
          heuristicAlternatives: JSON.stringify(
            heuristic.map(a => ({ id: a.id, description: a.description, approach: a.approach }))
          )
        }
      }],
      input: {}
    });

    const raw = llmResult?.output ?? llmResult?.rawOutput;
    const parsed = typeof raw === "string" ? safeParse(raw) : raw;

    if (Array.isArray(parsed?.alternatives) && parsed.alternatives.length > 0) {
      return parsed.alternatives.slice(0, 5).map(a => ({
        id: String(a.id ?? createId("alt")),
        description: String(a.description ?? "").slice(0, 400),
        approach: String(a.approach ?? "other"),
        requiresApproval: Boolean(a.requiresApproval),
        requiresUserInput: Boolean(a.requiresUserInput),
        safetyLevel: ["safe", "needs_review", "forbidden"].includes(a.safetyLevel)
          ? a.safetyLevel
          : "needs_review",
        estimatedSuccessProbability: typeof a.estimatedSuccessProbability === "number"
          ? Math.min(1, Math.max(0, a.estimatedSuccessProbability))
          : 0.5,
        rationale: String(a.rationale ?? "").slice(0, 300)
      }));
    }
    return heuristic;
  } catch {
    return heuristic;
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
