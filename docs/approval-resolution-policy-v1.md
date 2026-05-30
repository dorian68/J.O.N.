# Approval Resolution Policy v1

## Purpose

Approvals must behave differently in real user mode and in acceptance harness mode.

JON must never hang forever in `approval_pending` during a safe benchmark, but it must also never auto-approve sensitive real user actions.

## Modes

- `user_mode`: approval is visible and waits for the user.
- `harness_mode`: safe benchmark approvals can be auto-resolved only inside the benchmark envelope.
- unsafe actions: always blocked or user-required.

## Current Implementation

Implemented in `app/src/policy/approval-resolution-policy.js` and wired through `PolicyEngine` via `OperatorService.create`.

Harness auto-approval currently covers:

- Mission 1: Notepad launch, focus of the Notepad window, safe text input, and capture/observation primitives for the expected benchmark.
- Mission 2: Chrome/Edge local browser launch for the expected benchmark.

Never auto-approved:

- manual user actions
- out-of-scope actions
- destructive primitives such as delete/move/rename/write file
- arbitrary shell execution

Important nuance: risky or destructive actions are not auto-approved, but in `user_mode` they should be surfaced to the approval broker instead of being silently blocked before the user can decide. In `harness_mode`, actions outside the explicit benchmark envelope stay blocked.

## Audit Events

The runtime now records:

- `approval.requested`
- `approval.user_required`
- `approval.auto_resolved`
- `approval.policy_blocked`
- `approval.granted`
- `approval.denied`

## Remaining Gaps

- The policy is benchmark-aware but not yet backed by a richer declarative policy DSL.
- Real user approvals still depend on the existing UI broker flow.
