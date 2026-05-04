# JON Functional Readiness Criteria — v1

Audit date: 2026-05-04  
Definition: JON is "ready" when all criteria below are met on a **real surface** (no mocks).  
Source of truth: `mission-acceptance-harness-v1.md` (10 acceptance missions).

---

## Criterion 1 — Desktop Simple Mission (open + type + screenshot)

**Mission:** "Open Notepad, write 'hello cowork', take a screenshot"  
**Surface:** desktop (PowerShell/UIA)

Pass conditions:
- `focusWindow` or `launch_application` executed and Notepad window appears (UIA tree contains "Notepad")
- `typeText("hello cowork")` executed; post-action UIA diff confirms text in body element
- `captureWindow` produces non-empty PNG
- `SemanticOutcomeVerifier.verify()` → `verifiedByOutcomes=true`, `verificationVerdict="pass"`
- `run.status = COMPLETED` in DB

**Current status: FAIL**  
Blockers:
1. `verifyOutcome` (per-step LLM on perception delta) not wired in desktop loop
2. `waitForVisibleWindow` hardcoded 5s — may miss slow Notepad launch
3. `MissionProgressTracker` step persistence absent (in-memory only)

---

## Criterion 2 — Browser Mission (search + screenshot)

**Mission:** "Search for 'Node.js' on google.com and screenshot the results"  
**Surface:** browser (Playwright Chromium, non-headless)

Pass conditions:
- Playwright launches; `navigate("https://google.com")` succeeds
- Search input filled with "Node.js", form submitted
- Results page DOM contains ≥ 3 result links
- `captureScreenshot` produces non-empty PNG attached as evidence
- `SemanticOutcomeVerifier.verify()` → `verifiedByOutcomes=true`
- `run.status = COMPLETED` in DB
- Evidence record written with `type="page_screenshot"`

**Current status: FAIL**  
Blockers:
1. No mission-level completion check after browser loop — last step success ≠ goal verified
2. `verifyOutcome` absent for per-step browser actions
3. Proof (screenshot path) not surfaced in UI on success

---

## Criterion 3 — Mission with Failure → clean `failed` with reason

**Mission:** any mission where a required primitive cannot succeed (e.g., target window not found)

Pass conditions:
- Run terminates with `run.status = FAILED` (not hung, not COMPLETED)
- `failureReason` field is non-null and human-readable in run record
- `SemanticOutcomeVerifier` returns `verifiedByOutcomes=false`, `verificationVerdict="fail"`
- `nextBestAction` field populated in verification result
- No false positive: run is not marked COMPLETED despite failure

**Current status: PARTIAL**  
- Deterministic fallback errors do propagate to run status
- `SemanticOutcomeVerifier` blocks COMPLETED correctly when `no_critical_failures` check fires
- Missing: structured `failureReason` written to DB (currently thrown as Error message)

---

## Criterion 4 — Partial Mission → `partial`, not false `completed`

**Mission:** multi-step desktop mission where some steps succeed but objective not reached

Pass conditions:
- `verificationVerdict = "partial"` returned by SemanticOutcomeVerifier
- `verifiedByOutcomes = false` if any critical check fails
- Run NOT marked COMPLETED when objective was not confirmed
- User receives `whatDoesJonNeedFromUser()` message explaining partial state

**Current status: PARTIAL**  
- `verificationVerdict="partial"` is returned correctly by verifier when advisory failures > 40%
- However, `partial` with `verifiedByOutcomes=true` still marks run COMPLETED (by design, see semantic-outcome-verification-v1.md)
- Gap: partial-with-low-confidence runs should emit a distinct notification to user, not silently succeed

---

## Criterion 5 — Audit Extraction Functional

**Mission:** any run must produce an extractable audit trail

Pass conditions:
- `auditMissionPlan`, `auditMissionExecution`, `auditBrowserMission`, `auditStepFailure` called at correct lifecycle points
- Audit records queryable from DB (`database.getAuditRecords(runId)`)
- `run-review-model.js` produces a structured review object from a completed run
- SemanticVerification block present in `metadata.semanticVerification` for all completed runs

**Current status: PARTIAL**  
- Audit logger calls exist in prototype-agent.js
- DB audit table exists (`mission_steps`, `audit_log`)
- `run-review-model.js` exists and is called post-run
- Gap: `metadata.semanticVerification` not yet written for all run paths (browser path partial, terminal absent)

---

## Criterion 6 — Token Budget Respected

**Constraint:** ≤ 12,000 tokens per run (known production gap — target is 8,000)

Pass conditions:
- `token-governance.js` `prepareRuntimeReasoningPayload()` enforces budget before each LLM call
- No single run exceeds 12k total tokens (tracked in run metadata)
- Deterministic fallbacks fire when model alias is `fallback_deterministic`

**Current status: PASS (with gap)**  
- `prepareRuntimeReasoningPayload` exists and enforces budget
- Deterministic fallbacks are fully implemented and tested
- Known gap: 12k budget is 50% over the 8k production target
- Long missions (>5 steps with screenshots) may exceed 12k — no hard stop in loop

---

## Criterion 7 — Cross-Session Memory

**Constraint:** a second run on the same project should recall facts from the first run

Pass conditions:
- `project-memory.js` harvests and persists key facts post-run
- `user-memory.js` persists user preferences across sessions
- On second run, `summarizeProjectMemory()` injects relevant past context into LLM prompt

**Current status: FAIL**  
- `project-memory.js` and `user-memory.js` modules exist and have read/write logic
- `harvestProjectRunMemoryRecords()` and `extractUserMemoryRecordsFromRun()` are called post-run
- Gap: memory is stored in `settings` JSON (not vector DB), retrieval is full-scan, no semantic search
- Gap: memory not injected back into `decideNextStep` prompt reliably (wired but untested on real runs)
- This is a documented production gap (see `project-jon-production-gaps.md`)

---

## Summary Table

| Criterion | Status | Blocking gaps |
|---|---|---|
| 1. Desktop mission completed+verified | FAIL | verifyOutcome not wired, proof not persisted |
| 2. Browser mission completed+verified | FAIL | no mission-level completion check, proof not in UI |
| 3. Failure → clean failed + reason | PARTIAL | failureReason not structured in DB |
| 4. Partial → not false completed | PARTIAL | partial-low-confidence silent success |
| 5. Audit extraction functional | PARTIAL | semanticVerification absent from some paths |
| 6. Token budget ≤ 12k | PASS (gap) | budget is 12k not 8k; no hard loop stop |
| 7. Cross-session memory | FAIL | memory write exists, injection unreliable |

**P0 to reach PASS on C1+C2:**
1. Wire `verifyOutcome` (LLM perception delta) per-step in desktop loop
2. Wire `SemanticOutcomeVerifier` call at end of desktop plan execution
3. Persist `MissionProgressTracker` step log to DB per step
4. Emit completion proof (screenshot + timestamp) to UI on COMPLETED

**P1 to reach PASS on C3–C5:**
5. Write structured `failureReason` to DB column on failed runs
6. Emit `partial-completion` event when `verificationVerdict="partial"` and `confidence="low"`
7. Complete `semanticVerification` block in metadata for all run paths (browser, terminal)
