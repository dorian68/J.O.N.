# Real Mission Execution Loop — v1

## Loop Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        MISSION ENTRY                            │
│  userPrompt → missionUnderstanding (LLM) → MissionBrief        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  observeCurrentState                                            │
│  captureWindow / getActiveSurface / domSnapshot                 │
│  → PerceptionState { screenshot, uiaTree, domState }           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  decideNextStep                                                 │
│  LLM(MissionBrief + PerceptionState + actionLog) → ActionSpec  │
│  ActionSpec: { surface, primitive, args, expectedOutcome }      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  checkPolicy                                                    │
│  approvalGate.check(ActionSpec) → ALLOW | PAUSE | DENY         │
│  Deterministic: file delete, browser nav outside scope → PAUSE  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ALLOW
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  executePrimitive                                               │
│  Desktop: focusWindow / typeText / sendHotkey / clickPoint      │
│  Browser: navigate / query / extract / click                    │
│  Terminal: spawnCommand / awaitPrompt                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  observeAfterAction                                             │
│  captureWindow / domSnapshot again → PerceptionState'           │
│  diff(PerceptionState, PerceptionState') → PerceptionDelta      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  verifyOutcome                                                  │
│  LLM(expectedOutcome, PerceptionDelta) → VERIFIED | FAILED      │
│  VERIFIED → updateProgress → next step or DONE                 │
│  FAILED → recoverOrReplan                                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ FAILED
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  recoverOrReplan                                                │
│  consecutiveFailures < 2 → replan (LLM, max 2x total)         │
│  consecutiveFailures >= 2 → PAUSE → ask user                   │
│  windowNotFound → waitForVisibleWindow(5s) → retry             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
                      updateProgress
                      actionLog.push(result)
                            │
                      ◄─────┘  loop
```

## Components: Existing vs To Build

| Component | Status | File |
|---|---|---|
| missionUnderstanding | EXISTS | `app/src/mission/mission-understanding.js` |
| observeCurrentState (desktop) | EXISTS | `app/src/computer/computer-control-service.js` (captureWindow, inspectVisibleUi) |
| observeCurrentState (browser) | EXISTS | `app/src/browser/browser-operator.js` (DOM query) |
| decideNextStep (LLM) | EXISTS partial | `app/src/mission/desktop-plan.js` (static plan, not dynamic) |
| checkPolicy / approvalGate | EXISTS | `app/src/service/operator-service.js` |
| executePrimitive (desktop) | EXISTS | PowerShell/UIA calls in computer-control-service |
| executePrimitive (browser) | EXISTS | Playwright in browser-controller.js |
| executePrimitive (terminal) | EXISTS | child_process in terminal-orchestration.js |
| observeAfterAction | EXISTS | captureWindow after each step |
| verifyOutcome (LLM) | PARTIAL | perception delta done, LLM verdict missing |
| recoverOrReplan | PARTIAL | max 2 replans, triggered on desktop watcher only |
| MissionProgressTracker | ABSENT | tracking is actionLog[] in memory only |
| updateProgress (persistent) | ABSENT | no DB write per step |

## Component Contracts

### observeCurrentState
- Input: `{ surface: 'desktop'|'browser'|'terminal', context }` 
- Output: `PerceptionState { screenshot: Buffer, uiaTree: UiaNode[], domState: DomSnapshot, timestamp }`

### decideNextStep
- Input: `MissionBrief, PerceptionState, actionLog[]`
- Output: `ActionSpec { surface, primitive, args, expectedOutcome: string }`
- LLM call — non-deterministic

### checkPolicy
- Input: `ActionSpec, policyRules[]`
- Output: `PolicyDecision { verdict: ALLOW|PAUSE|DENY, reason? }`
- Deterministic — no LLM

### executePrimitive
- Input: `ActionSpec`
- Output: `ExecutionResult { success: boolean, error?, raw }`
- Deterministic — no LLM

### verifyOutcome
- Input: `expectedOutcome: string, PerceptionDelta`
- Output: `VerifyResult { verified: boolean, confidence: 0-1, reason }`
- LLM call — non-deterministic

### recoverOrReplan
- Input: `VerifyResult, actionLog[], replanCount`
- Output: `RecoveryAction { type: 'replan'|'pause'|'retry', newPlan? }`
- LLM call for replan — deterministic for pause threshold

## Mission Completion Criteria

A mission is DONE when all of the following are true:
1. All planned steps have `verified: true` from verifyOutcome
2. A final verifyOutcome call confirms the mission-level goal is met (not just last step)
3. No pending PAUSE awaiting user approval
4. A completion proof is stored: `{ screenshot, timestamp, verifyReason }`

**Not sufficient:** steps executed without outcome verification.

## Static Plan vs Dynamic Reasoning

| Static Plan | Dynamic Reasoning |
|---|---|
| Generated once at mission start by LLM | Loop: LLM called at each step with fresh perception |
| Good for predictable, linear tasks | Good for UI surprises, dialogs, unexpected state |
| Fragile if UI changes mid-mission | Adapts, costs more tokens |
| Current default in desktop-plan.js | Target for v2 — partial via replan trigger |

Current: static plan + up to 2 replans on failure. Full dynamic loop is the v2 target.

## Deterministic vs LLM

| LLM | Deterministic |
|---|---|
| missionUnderstanding | approvalGate policy check |
| decideNextStep | executePrimitive (PowerShell, Playwright, child_process) |
| verifyOutcome | observeAfterAction (screenshot diff) |
| recoverOrReplan (replan path) | pause threshold (consecutive failures count) |
| | windowNotFound timeout (5s hardcoded) |
