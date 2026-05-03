import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

export const APP_ROOT = appRoot;
export const REPO_ROOT = repoRoot;
export const DATA_ROOT = path.join(appRoot, ".runtime-data");
export const DB_PATH = path.join(DATA_ROOT, "cowork-prototype.sqlite");
export const RUNS_ROOT = path.join(DATA_ROOT, "runs");
export const LOGS_ROOT = path.join(DATA_ROOT, "logs");
export const VALIDATION_ROOT = path.join(DATA_ROOT, "validation");
export const REAL_SURFACE_VALIDATION_ROOT = path.join(VALIDATION_ROOT, "real-surfaces");
export const SECRETS_ROOT = path.join(DATA_ROOT, "secrets");
export const RELEASE_ROOT = path.join(DATA_ROOT, "release");
export const DIST_ROOT = path.join(repoRoot, "dist");
export const TEMP_RUNTIME_ROOT = path.join(os.tmpdir(), "cowork-prototype");
export const PROMPTS_ROOT = path.join(APP_ROOT, "prompts");
export const DEFAULT_SERVER_PORT = 41731;
export const DEFAULT_OPERATOR_PORT = 41732;
export const DEFAULT_BROWSER_CHANNEL = process.env.COWORK_BROWSER_CHANNEL || "bundled";
export const DEFAULT_HEADLESS = process.env.COWORK_HEADLESS !== "0";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;
export const DEFAULT_LLM_PROVIDER_MODE = process.env.COWORK_LLM_PROVIDER_MODE || "openai_compatible";
export const DEFAULT_PROMPT_ENVIRONMENT = process.env.COWORK_PROMPT_ENVIRONMENT || "prototype";
export const DEFAULT_RUNTIME_RETENTION_DAYS = Number.parseInt(process.env.COWORK_RUNTIME_RETENTION_DAYS || "30", 10);
export const DEFAULT_LLM_BUDGETS = Object.freeze({
  perRunTokens: 50_000,
  perSessionTokens: 250_000,
  perRunUsd: 0.5,
  perSessionUsd: 2
});

export const EVENT_ACTOR = {
  SYSTEM: "system",
  AGENT: "agent",
  BROWSER: "browser",
  COMPUTER: "computer",
  POLICY: "policy",
  OPERATOR: "operator",
  ARTIFACT: "artifact"
};

export const APPROVAL_CATEGORY = {
  READ: "read",
  NAVIGATION_EXPANSION: "navigation_expansion",
  PREPARATION: "preparation",
  EDIT: "edit",
  LOCAL_FOCUS: "local_focus",
  LOCAL_APP_LAUNCH: "local_app_launch",
  LOCAL_DESKTOP_ACTUATION: "local_desktop_actuation",
  OUT_OF_SCOPE: "out_of_scope",
  MANUAL_USER_ACTION: "manual_user_action"
};

export const APPROVAL_DECISION = {
  AUTO_APPROVED: "auto_approved",
  APPROVED_ONCE: "approved_once",
  DENIED: "denied",
  STOP_RUN: "stop_run",
  BLOCKED: "blocked"
};

export const RUN_STATUS = {
  CREATED: "created",
  PLANNED: "planned",
  RUNNING: "running",
  PAUSED: "paused",
  FAILED: "failed",
  COMPLETED: "completed",
  STOPPED: "stopped"
};

export const ARTIFACT_TYPE = {
  COLLECTION_TABLE: "tableau_collecte_navigateur",
  DECISION_NOTE: "note_de_decision"
};

export const EVIDENCE_TYPE = {
  DOM_SNAPSHOT: "dom_snapshot",
  PAGE_SCREENSHOT: "page_screenshot",
  WINDOW_CAPTURE: "window_capture",
  REGION_CAPTURE: "region_capture",
  OUTCOME_VERIFICATION: "outcome_verification",
  ACTION_SUMMARY: "action_summary"
};

export const LLM_PROVIDER_ALIAS = Object.freeze({
  MOCK_OFFLINE: "mock_offline",
  OPENAI: "openai",
  OPENAI_COMPATIBLE: "openai_compatible"
});

export const LLM_MODEL_ALIAS = Object.freeze({
  PRIMARY_REASONING: "primary_reasoning",
  UTILITY_STRUCTURING: "utility_structuring",
  VISION_FALLBACK: "vision_fallback",
  MOCK_OFFLINE: "mock_offline"
});

export const LLM_CALL_TYPE = Object.freeze({
  CONVERSATION_TURN: "conversation_turn",
  CAPABILITY_DESCRIPTION: "capability_description",
  MISSION_UNDERSTANDING: "mission_understanding",
  RUN_HANDOFF_DECISION: "run_handoff_decision",
  DESKTOP_PLAN: "desktop_plan",
  BROWSER_PLAN: "browser_plan",
  BROWSER_REPLAN: "browser_replan",
  PLAN_GENERATION: "plan_generation",
  DECISION_NOTE_DRAFT: "decision_note_draft",
  EVALUATION_SUPPORT: "evaluation_support",
  AMBIGUITY_NOTE: "ambiguity_note",
  WINDOW_DESCRIPTION: "window_description",
  WORKSPACE_TERMINAL_REASONING: "workspace_terminal_reasoning"
});

export const LLM_RESULT_STATUS = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed"
});

export const REASONING_STAGE = Object.freeze({
  CONVERSATION_TURN: "conversation_turn",
  CAPABILITY_DESCRIPTION: "capability_description",
  MISSION_UNDERSTANDING: "mission_understanding",
  RUN_HANDOFF_DECISION: "run_handoff_decision",
  DESKTOP_PLAN: "desktop_plan",
  BROWSER_PLAN: "browser_plan",
  BROWSER_REPLAN: "browser_replan",
  PLAN_GENERATION: "plan_generation",
  DECISION_NOTE_DRAFT: "decision_note_draft",
  EVALUATION_SUPPORT: "evaluation_support",
  AMBIGUITY_NOTE: "ambiguity_note",
  WINDOW_DESCRIPTION: "window_description",
  WORKSPACE_TERMINAL_REASONING: "workspace_terminal_reasoning"
});

export const BENCHMARK_REVIEW_CLASSIFICATION = Object.freeze({
  REAL_SUCCESS: "real_success",
  PARTIAL_SUCCESS: "partial_success",
  FALSE_POSITIVE: "false_positive",
  ACCEPTABLE_FAILURE: "acceptable_failure",
  BLOCKING_FAILURE: "blocking_failure"
});
