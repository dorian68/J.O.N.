# Approval Policy — v1

## Architecture

Approvals are centralized through `PolicyEngine` (`app/src/policy/policy-engine.js`).

Every action requiring user consent calls `policy.authorize(action)` which:
1. Evaluates the action category (auto-approve reads, block out-of-scope, require approval for writes/launches)
2. Checks the dedup cache for identical approvals already granted in this run
3. If not cached: requests approval from the operator via `approvalResolver`
4. Caches approved decisions for dedup

## Categories

| Category | Default Decision |
|---|---|
| `READ` | Auto-approved (no user prompt) |
| `OUT_OF_SCOPE` | Blocked (cannot override) |
| `EDIT` | Requires approval |
| `LOCAL_APP_LAUNCH` | Requires approval (unless in `trustedApplications`) |
| `LOCAL_DESKTOP_ACTUATION` | Requires approval (unless trusted) |
| `MANUAL_USER_ACTION` | Requires approval |
| Browser navigation | Via allowlist (separate from approval policy) |

## Dedup (Approval Fatigue Reduction)

**Added 2026-05-13.**

Within a single run, if the same action (same category + actionLabel + targetLabel) has already been approved, the approval is reused silently — the operator is not asked again.

Dedup key: `{runId}|{category}|{actionLabel.toLowerCase()}|{targetLabel.toLowerCase()}`

Only `APPROVED_ONCE` decisions are cached. Denied/stopped decisions are not cached (operator must explicitly re-deny if the action recurs).

The cache is keyed by `runId` and can be cleared via `policy.clearRunCache(runId)` between runs.

## Trusted Applications

Operators can configure `trustedApplications` (app IDs) and `trustedBrowserIds` in the agent config (Settings modal ⚙). Actions targeting trusted apps/browsers bypass the approval prompt.

## Run-level Approval Flow

1. Agent reaches a step requiring approval
2. `policy.authorize()` checks dedup cache → if hit, returns cached result
3. If miss: pauses the run, emits `approval.requested` event
4. UI shows approval card to operator
5. Operator approves or denies
6. `resolveApproval()` is called with the decision
7. Run resumes or stops based on decision
8. Approved decisions are cached for this run

## Invariants

- `verifiedByOutcomes = true` is never set while an approval is pending
- A run with `STOP_RUN` decision cannot complete — `MissionProgressTracker.stop()` is called
- Approval records are persisted in the audit log regardless of the decision
