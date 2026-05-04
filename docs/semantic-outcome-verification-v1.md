# Semantic Outcome Verification — v1

## The Three Levels of Completion

There are three distinct levels, and only the third is sufficient for a completed run:

| Level | Meaning | Sufficient? |
|---|---|---|
| **step completed** | Primitive executed without runtime error (typeText returned success) | NO |
| **action verified** | Post-action perception delta confirms the action had visible effect | NO |
| **user objective satisfied** | The actual goal from the user's prompt is demonstrably achieved | YES — required |

**Example:** mission = "Open Notepad and write hello".  
- step completed = `typeText("hello")` returned `{ success: true }` — not enough.  
- action verified = screenshot diff shows characters appeared in window — not enough alone.  
- objective satisfied = screenshot + UIA tree confirm "hello" is in a Notepad body, `verifiedByOutcomes=true` — only then the run may be COMPLETED.

---

## Completion Contract

```
run.status = "completed"  ←→  verifiedByOutcomes === true
run.status = "failed"     ←→  verifiedByOutcomes === false  (any critical check blocked)
```

This is a hard rule enforced in `prototype-agent.js`:
- Desktop path (line ~3235): `if (!desktopSemanticVerification.verifiedByOutcomes) throw Error(...)`
- Browser path (line ~1928): `finalStatus = verifiedByOutcomes ? COMPLETED : FAILED`

A run must never be marked COMPLETED if `SemanticOutcomeVerifier.verify()` returns `verifiedByOutcomes: false`.

---

## Alternative Final Statuses

| Status | Condition | Description |
|---|---|---|
| `completed` | `verifiedByOutcomes=true` | Objective confirmed achieved |
| `failed` | Critical check failed, `verifiedByOutcomes=false` | Irrecoverable failure or no work done |
| `blocked` | `consecutiveFailures >= 3` OR unresolved browser blocker | Loop halted by repeated failure cascade |
| `needs_user` | `requiresUserInput=true` OR pending approval | Agent cannot proceed without human decision |
| `partial` | `verificationVerdict="partial"` (advisory failures > 40% of checks) | Some work done, confidence low — user must confirm |

Note: `partial` does NOT map to `completed`. A partial verdict → run is marked `failed` or left for user review. Only `pass` verdict with `verifiedByOutcomes=true` → COMPLETED.

---

## OutcomeVerificationResult — Full Structure

Returned by `SemanticOutcomeVerifier.verify()`:

```js
{
  verifiedByOutcomes: boolean,        // PRIMARY GATE: must be true for COMPLETED
  objectiveSatisfied: boolean,        // same value as verifiedByOutcomes (v1)
  verificationVerdict: "pass" | "partial" | "fail",
  confidence: "high" | "medium" | "low",

  evidenceUsed: string[],             // IDs of evidence records used in verification
  missingEvidence: string[],          // labels of checks that required evidence but had none
  satisfiedOutcomes: string[],        // labels of passing checks
  unsatisfiedOutcomes: string[],      // labels of failing checks

  failureReason: string | null,       // joined label string of all failed checks
  nextBestAction: string | null,      // suggested recovery string for operator/user
  requiresUserInput: boolean,         // if true, agent should pause and ask user
  userQuestion: string | null,        // question to surface if requiresUserInput

  checks: Array<{                     // ordered list of all checks evaluated
    id: string,                       // machine ID (e.g. "work_executed")
    label: string,                    // human description
    passed: boolean,
    status: "pass" | "fail",
    detail: object                    // check-specific data (counts, lists)
  }>
}
```

---

## LLM vs Deterministic

**SemanticOutcomeVerifier v1 is fully deterministic — no LLM call.**

| Responsibility | Mechanism |
|---|---|
| Check: work was executed | `actionLog.filter(status=completed).length + browserResult.stepResults.length > 0` |
| Check: evidence collected | `evidence.length + browserResult.evidence.length > 0` |
| Check: no critical failures | `actionLog.filter(status=failed && !recoveryAttempted).length === 0` |
| Check: browser fully completed | `browserResult.status === "completed"` |
| Check: keyword-primitive match | regex on `mission` text vs `completedPrimitives[]` |
| Check: browser blocker | `browserResult.blockers.filter(!resolved).length === 0` |
| Verdict aggregation | rule: criticalBlockers.length === 0 → verifiedByOutcomes |

LLM's role in the surrounding loop:
- `decideNextStep`: LLM selects next action
- `verifyOutcome` (per-step): LLM (or perception delta) confirms step effect
- `recoverOrReplan`: LLM generates revised plan

SemanticOutcomeVerifier sits **after** the loop, as a gate, not as a reasoning step.  
A future v2 could pass a structured payload to the LLM for edge-case objectives, but v1 stays deterministic for auditability and zero-token cost.

---

## Critical vs Advisory Checks

```
CRITICAL_CHECK_IDS = {
  "work_executed",         // nothing done → cannot be complete
  "browser_fully_completed", // browser reported partial/failed
  "browser_no_blockers",   // unresolved blockers remain
  "no_critical_failures",  // unrecovered failed primitives
  "no_failure_cascade"     // ≥3 consecutive failures in tracker
}
```

**Critical check failure** → `verifiedByOutcomes=false` → run MUST NOT be COMPLETED.

**Advisory checks** (all others: `launch_primitive_executed`, `type_primitive_executed`, `screenshot_captured`, `browser_search_executed`, `browser_screenshot_captured`, `extraction_delivered`, `evidence_collected`):
- Fired only when mission text matches a keyword pattern
- Failure lowers `confidence` from `high` → `medium` → `low`
- Enough advisory failures (>40% of total checks) → `verificationVerdict="partial"`
- Do NOT block `verifiedByOutcomes`

Advisory check failures produce a `nextBestAction` hint in the result — surfaced to the operator for transparency.
