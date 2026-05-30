import { APPROVAL_CATEGORY, APPROVAL_DECISION } from "../config.js";

export const APPROVAL_POLICY_MODE = Object.freeze({
  USER: "user_mode",
  HARNESS: "harness_mode"
});

const POLICY_BLOCKED_CATEGORIES = new Set([
  APPROVAL_CATEGORY.OUT_OF_SCOPE
]);

const USER_REQUIRED_CATEGORIES = new Set([
  APPROVAL_CATEGORY.MANUAL_USER_ACTION
]);

const DESTRUCTIVE_PRIMITIVES = new Set([
  "delete_path",
  "move_path",
  "rename_path",
  "write_text_file",
  "create_text_file",
  "copy_path",
  "send_hotkey",
  "click_point"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function policyFromRun(run = {}, env = process.env) {
  const spec = run?.metadata?.missionSpec ?? {};
  const parameters = spec.parameters ?? {};
  const explicit = parameters.approvalPolicy ?? spec.approvalPolicy ?? {};
  const envMode = clean(env.COWORK_APPROVAL_MODE);
  const benchmarkId = explicit.benchmarkId ?? parameters.acceptanceHarness?.benchmarkId ?? spec.benchmarkId ?? null;
  const mode = explicit.mode
    ?? spec.approvalMode
    ?? (envMode === APPROVAL_POLICY_MODE.HARNESS || envMode === "harness" ? APPROVAL_POLICY_MODE.HARNESS : "")
    ?? "";
  return {
    mode: mode || APPROVAL_POLICY_MODE.USER,
    benchmarkId: benchmarkId === null || benchmarkId === undefined ? null : Number(benchmarkId),
    benchmarkTitle: clean(explicit.benchmarkTitle ?? parameters.acceptanceHarness?.benchmarkTitle ?? spec.benchmarkTitle),
    allowedCategories: Array.isArray(explicit.allowedCategories) ? explicit.allowedCategories.map(clean) : [],
    allowedPrimitives: Array.isArray(explicit.allowedPrimitives) ? explicit.allowedPrimitives.map(clean) : [],
    expectedTools: Array.isArray(explicit.expectedTools) ? explicit.expectedTools.map(clean) : []
  };
}

function primitiveFromRequest(request = {}) {
  return clean(request.metadata?.primitive ?? request.primitive ?? request.metadata?.tool ?? "");
}

function matchesBenchmarkOne(request = {}, policy = {}) {
  const primitive = primitiveFromRequest(request);
  const target = lower(`${request.targetLabel ?? ""} ${request.actionLabel ?? ""} ${request.metadata?.selectedApplicationId ?? ""} ${request.metadata?.targetWindowTitle ?? ""}`);
  if (policy.benchmarkId !== 1) return false;
  if (request.category === APPROVAL_CATEGORY.LOCAL_APP_LAUNCH) {
    return primitive === "launch_application" && /notepad|bloc/.test(target);
  }
  if (request.category === APPROVAL_CATEGORY.LOCAL_DESKTOP_ACTUATION) {
    return ["focus_window", "type_text", "capture_window", "observe_windows"].includes(primitive)
      && /notepad|bloc/.test(target)
      && !DESTRUCTIVE_PRIMITIVES.has(primitive);
  }
  return false;
}

function matchesBenchmarkTwo(request = {}, policy = {}) {
  const target = lower(`${request.targetLabel ?? ""} ${request.actionLabel ?? ""} ${request.metadata?.browserId ?? ""} ${request.metadata?.browserLabel ?? ""}`);
  if (policy.benchmarkId !== 2) return false;
  if (request.category !== APPROVAL_CATEGORY.LOCAL_APP_LAUNCH) return false;
  return /\b(chrome|edge|browser|navigateur|microsoft edge|google chrome)\b/.test(target);
}

function matchesExplicitHarnessPolicy(request = {}, policy = {}) {
  const primitive = primitiveFromRequest(request);
  if (policy.benchmarkId === 1 || policy.benchmarkId === 2) {
    return false;
  }
  if (policy.allowedCategories.length > 0 && !policy.allowedCategories.includes(request.category)) {
    return false;
  }
  if (policy.allowedPrimitives.length > 0 && primitive && !policy.allowedPrimitives.includes(primitive)) {
    return false;
  }
  if (DESTRUCTIVE_PRIMITIVES.has(primitive)) {
    return false;
  }
  if (policy.allowedCategories.length > 0 || policy.allowedPrimitives.length > 0) {
    return true;
  }
  return false;
}

export function resolveApprovalByPolicy({ request = {}, run = null, env = process.env } = {}) {
  const policy = policyFromRun(run, env);
  const primitive = primitiveFromRequest(request);
  const metadata = {
    approvalPolicy: {
      mode: policy.mode,
      benchmarkId: policy.benchmarkId,
      primitive: primitive || null
    }
  };

  if (POLICY_BLOCKED_CATEGORIES.has(request.category)) {
    return {
      decision: APPROVAL_DECISION.BLOCKED,
      rationale: `Approval policy refused auto-resolution for ${request.category}${primitive ? `/${primitive}` : ""}.`,
      auditEventType: "approval.policy_blocked",
      metadata: {
        ...metadata,
        approvalPolicy: {
          ...metadata.approvalPolicy,
          decision: "policy_blocked"
        }
      }
    };
  }

  if (policy.mode !== APPROVAL_POLICY_MODE.HARNESS || USER_REQUIRED_CATEGORIES.has(request.category) || DESTRUCTIVE_PRIMITIVES.has(primitive)) {
    return {
      decision: "user_required",
      rationale: policy.mode === APPROVAL_POLICY_MODE.HARNESS
        ? `Harness policy cannot auto-approve ${request.category}${primitive ? `/${primitive}` : ""}; explicit user approval is required.`
        : "User mode requires explicit operator approval.",
      auditEventType: "approval.user_required",
      metadata: {
        ...metadata,
        approvalPolicy: {
          ...metadata.approvalPolicy,
          decision: "user_required"
        }
      }
    };
  }

  const autoApproved = matchesBenchmarkOne(request, policy)
    || matchesBenchmarkTwo(request, policy)
    || matchesExplicitHarnessPolicy(request, policy);
  if (!autoApproved) {
    return {
      decision: APPROVAL_DECISION.BLOCKED,
      rationale: "Harness mode did not match the benchmark's explicit safe approval envelope.",
      auditEventType: "approval.policy_blocked",
      metadata: {
        ...metadata,
        approvalPolicy: {
          ...metadata.approvalPolicy,
          decision: "policy_blocked"
        }
      }
    };
  }

  return {
    decision: APPROVAL_DECISION.APPROVED_ONCE,
    rationale: `Auto-approved by harness policy for benchmark ${policy.benchmarkId ?? "explicit"}.`,
    auditEventType: "approval.auto_resolved",
    metadata: {
      ...metadata,
      approvalPolicy: {
        ...metadata.approvalPolicy,
        decision: "auto_resolved",
        autoResolved: true
      }
    }
  };
}

export function shouldUseInteractiveApproval(policyResult = {}) {
  return !isObject(policyResult) || policyResult.decision === "user_required";
}
