# Real Mission Acceptance Loop — v1

## Full Loop Diagram

```
ENTRY
  userPrompt
    → missionUnderstanding (LLM) → MissionBrief
    → MissionProgressTracker.init({ runId, mission, plan })
    → surface routing → desktop | browser | terminal

OBSERVE
  observeCurrentState()
    → PerceptionState { screenshot, uiaTree, domState, timestamp }

PLAN
  decideNextStep(MissionBrief, PerceptionState, actionLog)
    → ActionSpec { surface, primitive, args, expectedOutcome }
  checkPolicy(ActionSpec) → ALLOW | PAUSE | DENY
    PAUSE → setWaitingForUser → emit PAUSE event → halt
    DENY  → fail step, recoverOrReplan

ACT
  executePrimitive(ActionSpec)
    → ExecutionResult { success, error, raw }
  missionTracker.recordStepResult(...)

OBSERVE AGAIN
  observeAfterAction()
    → PerceptionState' { screenshot', uiaTree', domState' }
    → PerceptionDelta = diff(PerceptionState, PerceptionState')

VERIFY (per-step)
  verifyOutcome(expectedOutcome, PerceptionDelta)
    → VerifyResult { verified, confidence, reason }
  VERIFIED → missionTracker.markOutcomeCompleted(outcome)
            → loop to next step
  FAILED   → recoverOrReplan

RECOVER
  recoverOrReplan(VerifyResult, actionLog, replanCount)
    consecutiveFailures < 2  → replan (LLM, max MAX_DYNAMIC_DESKTOP_REPLANS=2)
      → missionTracker.recordDynamicReplan()
    consecutiveFailures >= 2 → PAUSE → missionTracker.setWaitingForUser()
    windowNotFound           → waitForVisibleWindow(5s) → retry
    
MISSION-LEVEL VERIFY (after all steps done)
  SemanticOutcomeVerifier.verify({
    mission, planOutcomes, actionLog,
    evidence, artifacts, browserResult, desktopState,
    trackerSnapshot: missionTracker.toSnapshot()
  })
    → OutcomeVerificationResult
  missionTracker.setFinalVerification(result)
  missionTracker.complete({ verifiedByOutcomes: result.verifiedByOutcomes })

TERMINAL STATUS
  verifiedByOutcomes=true  → run.status = COMPLETED
  verifiedByOutcomes=false → run.status = FAILED or BLOCKED
```

---

## Where SemanticOutcomeVerifier Inserts

The verifier runs **once, at the end of the execution loop**, not per-step.

```
prototype-agent.js (desktop path, line ~3196):
  const desktopSemanticVerification = new SemanticOutcomeVerifier().verify({...})
  missionTracker.setFinalVerification(desktopSemanticVerification)
  missionTracker.complete({ verifiedByOutcomes: desktopSemanticVerification.verifiedByOutcomes })
  if (!desktopSemanticVerification.verifiedByOutcomes) throw Error(...)

prototype-agent.js (browser path, line ~1919):
  const browserSemanticVerification = new SemanticOutcomeVerifier().verify({...})
  finalStatus = browserSemanticVerification.verifiedByOutcomes ? COMPLETED : FAILED
```

The per-step `verifyOutcome` (LLM on perception delta) is a **separate mechanism** — it drives the loop control (proceed/recover). SemanticOutcomeVerifier is the **mission-level gate** at the end.

---

## Contract: MissionProgressTracker ↔ SemanticOutcomeVerifier

MissionProgressTracker accumulates runtime state throughout the loop:

```
tracker input → verifier:
  missionTracker.toSnapshot()
    → trackerSnapshot.steps.consecutiveFailures  (used in check: "no_failure_cascade")
    → trackerSnapshot.proof.evidenceIds          (passed as evidence[])
    → trackerSnapshot.outcomes.completed         (context for verdict)
```

Verifier output → tracker:

```
missionTracker.setFinalVerification(verificationResult)
  sets:
    tracker.finalVerification = verificationResult
    tracker.userObjectiveSatisfied = verificationResult.objectiveSatisfied
    tracker.verifiedByOutcomes = verificationResult.verifiedByOutcomes
    tracker.verifiedOutcomes = verificationResult.satisfiedOutcomes
    tracker.verificationVerdict = verificationResult.verificationVerdict
```

After `setFinalVerification`, the tracker's `whatIsVerified()`, `whatDoesJonNeedFromUser()`, and `toSnapshot().semanticVerification` all reflect the verifier output. The tracker is the single source of truth written to the DB.

---

## Injection Points by Surface

### Desktop (prototype-agent.js)

```
1. missionTracker instantiated before plan execution
2. missionTracker.recordStepResult() called for each action in the desktop loop
3. missionTracker.setActiveSurface("desktop", { app }) called at start
4. missionTracker.recordEvidence(evidenceId) called when screenshot captured
5. missionTracker.setWaitingForUser() called on PAUSE (approval gate or replan limit)
6. SemanticOutcomeVerifier.verify({ trackerSnapshot: missionTracker.toSnapshot() }) at end
7. missionTracker.complete({ verifiedByOutcomes }) or missionTracker.fail(reason)
```

### Browser (prototype-agent.js)

```
1. No step-level tracker recording during browser loop (browser has own stepResults[])
2. browserResult passed directly to SemanticOutcomeVerifier as browserResult param
3. browserResult.evidence[] passed as evidence param
4. missionTracker not used in browser path in v1 — tracker integration is a v2 gap
5. SemanticOutcomeVerifier.verify({ browserResult, evidence: result.evidence })
6. finalStatus derived from verifiedByOutcomes, written to DB
```

---

## Decision Flow: pass / partial / fail / blocked

```
SemanticOutcomeVerifier.verify() returns verificationVerdict:

  "pass" + verifiedByOutcomes=true
    → run.status = COMPLETED
    → no user action needed
    → proof stored, completion event emitted

  "partial" + verifiedByOutcomes=true
    (advisory failures ≤ 40% of checks, no critical blocker)
    → run.status = COMPLETED
    → confidence="low" or "medium" surfaced to operator
    → missionTracker.whatDoesJonNeedFromUser() returns review prompt

  "partial" + verifiedByOutcomes=false
    (would require criticalBlockers — not reachable in current logic)

  "fail" + verifiedByOutcomes=false
    → critical check failed
    → run.status = FAILED
    → failureReason surfaced
    → nextBestAction returned for operator/retry

  "blocked" (via tracker: consecutiveFailures ≥ 3 or unresolved browser blockers)
    → "no_failure_cascade" or "browser_no_blockers" critical check fires
    → verifiedByOutcomes=false → run.status = FAILED
    → missionTracker.whatIsBlocking() provides block reason
```

The `needs_user` status is not a verifier output — it is driven by `requiresUserInput=true` in the result or by a pending approval in the tracker. The loop must check `tracker.pendingApprovalId` before attempting the next step.
