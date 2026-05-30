# JON Agentic Vision - v1

## Product Definition

JON is a supervised desktop/browser/workspace AI coworker. It is not a chatbot, not a scenario launcher, and not a technical console. The chat remains the main surface, but each mission is handled as a run with observable state, governed actions, verification, recovery, and proof.

## Non-Goals

- No silent completion after merely executing steps.
- No uncontrolled use of the user's browser profile without consent.
- No destructive desktop, filesystem, terminal, or browser action without an approval path.
- No mock/offline fallback treated as proof of real-surface capability.

## Target Loop

1. Understand the user's mission.
2. Observe workspace state.
3. Select useful surfaces: desktop, browser, terminal, files, artifacts.
4. Decide the next bounded action.
5. Check policy and approvals.
6. Execute one primitive.
7. Observe again.
8. Verify the action and the mission outcome.
9. Recover or replan if verification fails.
10. Update user-visible progress.
11. Continue, ask for clarification, pause, fail, or complete.
12. Produce final result with aligned proof.

## Completion Rule

`step completed` means a primitive returned. `action verified` means post-action observation supports the expected local effect. `user objective satisfied` means `SemanticOutcomeVerifier.verifiedByOutcomes === true`.

A run must not be `completed` unless the user objective is satisfied, required evidence exists, evidence aligns with the target, required artifacts exist, no critical blocker remains, and terminal/approval blockers are resolved.

This rule is enforced in the runtime by a central false-completion guard. Any code path that attempts to write `run.status = "completed"` without `semanticVerification.verifiedByOutcomes === true` is converted to `failed_false_completion_guard`.

## Current Brutal Status

JON has meaningful foundations: mission routing, desktop primitives, browser operator, terminal supervision, approvals, audit logs, progress snapshots, semantic verifier, and acceptance harness. It is not yet a fully reliable autonomous desktop/browser/workspace agent because many paths remain bounded prototypes and real-surface coverage is uneven.
