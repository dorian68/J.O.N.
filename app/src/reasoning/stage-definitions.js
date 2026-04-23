import { REASONING_STAGE } from "../config.js";

export const DEFAULT_STAGE_DEFINITIONS = Object.freeze({
  [REASONING_STAGE.MISSION_UNDERSTANDING]: {
    stage: REASONING_STAGE.MISSION_UNDERSTANDING,
    label: "Mission understanding",
    summaryTemplate: "Mission understanding context assembled for conservative run framing.",
    include: {
      sources: 0,
      artifacts: 0,
      evidence: 0,
      events: 4
    },
    policyConstraints: [
      {
        id: "policy.llm.never_approves",
        label: "LLM never approves actions",
        reason: "Reasoning output cannot replace policy or operator approvals."
      },
      {
        id: "policy.scope.no_browser_expansion",
        label: "No browser/computer scope expansion",
        reason: "Reasoning must remain inside the authorized prototype slice."
      }
    ]
  },
  [REASONING_STAGE.PLAN_GENERATION]: {
    stage: REASONING_STAGE.PLAN_GENERATION,
    label: "Plan generation",
    summaryTemplate: "Plan-generation context narrowed to mission framing, active constraints and current run state.",
    include: {
      sources: 1,
      artifacts: 0,
      evidence: 0,
      events: 6
    },
    policyConstraints: [
      {
        id: "policy.execution.browser_first",
        label: "Browser-first / DOM-first",
        reason: "The plan must prefer browser-first, DOM-first execution when the surface is available."
      },
      {
        id: "policy.execution.no_irreversible_write",
        label: "No irreversible write planning",
        reason: "The plan must not imply submit/publish/send/delete flows that are outside the authorized slice."
      }
    ]
  },
  [REASONING_STAGE.RUN_HANDOFF_DECISION]: {
    stage: REASONING_STAGE.RUN_HANDOFF_DECISION,
    label: "Run handoff decision",
    summaryTemplate: "Run-handoff context assembled to decide whether one more bounded step should continue automatically.",
    include: {
      sources: 1,
      artifacts: 1,
      evidence: 2,
      events: 10
    },
    policyConstraints: [
      {
        id: "policy.handoff.single_bounded_next_step",
        label: "At most one bounded next step",
        reason: "Automatic continuation may select at most one already recommended bounded step."
      },
      {
        id: "policy.handoff.no_scope_expansion",
        label: "No scope expansion during handoff",
        reason: "The handoff cannot invent new capabilities or broaden the authorized slice."
      },
      {
        id: "policy.handoff.clarify_when_needed",
        label: "Clarify instead of guessing",
        reason: "If the next step is not credible without one missing detail, the handoff must ask for one short clarification."
      }
    ]
  },
  [REASONING_STAGE.DESKTOP_PLAN]: {
    stage: REASONING_STAGE.DESKTOP_PLAN,
    label: "Desktop plan",
    summaryTemplate: "Desktop-planning context narrowed to mission, discovered local applications, visible windows and policy constraints.",
    include: {
      sources: 0,
      artifacts: 0,
      evidence: 1,
      events: 8
    },
    policyConstraints: [
      {
        id: "policy.desktop.use_discovered_capabilities",
        label: "Use discovered capabilities",
        reason: "The desktop plan may only target applications and windows discovered on the current machine."
      },
      {
        id: "policy.desktop.approval_before_actuation",
        label: "Approval before actuation",
        reason: "Launching apps, typing, clicking, hotkeys and scrolling require explicit approval before execution."
      },
      {
        id: "policy.desktop.no_irreversible_actions",
        label: "No irreversible desktop actions",
        reason: "Submit, send, publish, delete, purchase, install and credential-sensitive actions remain blocked."
      }
    ]
  },
  [REASONING_STAGE.BROWSER_PLAN]: {
    stage: REASONING_STAGE.BROWSER_PLAN,
    label: "Browser plan",
    summaryTemplate: "Browser-planning context narrowed to authorized web mission, controlled browser state, DOM affordances and policy constraints.",
    include: {
      sources: 0,
      artifacts: 0,
      evidence: 1,
      events: 8
    },
    policyConstraints: [
      {
        id: "policy.browser.allowlist_required",
        label: "Allowlisted browser surfaces only",
        reason: "The browser plan must keep navigation inside explicitly authorized hosts unless a future policy expansion approves it."
      },
      {
        id: "policy.browser.dom_first",
        label: "DOM-first interaction",
        reason: "The browser operator should use structured DOM/CDP targeting before any visual or pointer fallback."
      },
      {
        id: "policy.browser.no_stealth_bypass",
        label: "No stealth or anti-bot bypass",
        reason: "Automation blockers must be recorded and surfaced honestly; the planner must not propose evasion."
      }
    ]
  },
  [REASONING_STAGE.DECISION_NOTE_DRAFT]: {
    stage: REASONING_STAGE.DECISION_NOTE_DRAFT,
    label: "Decision note draft",
    summaryTemplate: "Decision-note drafting context narrowed to traceable sources, evidence bands, and artifact quality constraints.",
    include: {
      sources: 5,
      artifacts: 2,
      evidence: 5,
      events: 8
    },
    policyConstraints: [
      {
        id: "policy.artifact.traceability_required",
        label: "Artifact traceability required",
        reason: "Decision notes must remain tied to sources, evidence and run provenance."
      },
      {
        id: "policy.artifact.no_unverified_assertions",
        label: "No unverified assertions",
        reason: "Reasoning must avoid stronger certainty than the collected evidence supports."
      }
    ]
  },
  [REASONING_STAGE.EVALUATION_SUPPORT]: {
    stage: REASONING_STAGE.EVALUATION_SUPPORT,
    label: "Evaluation support",
    summaryTemplate: "Evaluation context narrowed to draft quality, validation gaps and risk posture.",
    include: {
      sources: 5,
      artifacts: 2,
      evidence: 5,
      events: 8
    },
    policyConstraints: [
      {
        id: "policy.evaluation.no_autovalidation",
        label: "No auto-validation",
        reason: "The evaluator can critique and qualify a draft but cannot self-certify it as final truth."
      }
    ]
  },
  [REASONING_STAGE.AMBIGUITY_NOTE]: {
    stage: REASONING_STAGE.AMBIGUITY_NOTE,
    label: "Ambiguity note",
    summaryTemplate: "Ambiguity-note context narrowed to disagreements, weak evidence and unresolved risks.",
    include: {
      sources: 5,
      artifacts: 1,
      evidence: 5,
      events: 6
    },
    policyConstraints: [
      {
        id: "policy.ambiguity.disclose_limits",
        label: "Disclose ambiguity and limits",
        reason: "Ambiguity handling must surface unresolved uncertainty instead of hiding it."
      }
    ]
  }
});

export function getStageDefinition(stage) {
  const definition = DEFAULT_STAGE_DEFINITIONS[stage];
  if (!definition) {
    throw new Error(`Missing stage definition for ${stage}.`);
  }
  return definition;
}
