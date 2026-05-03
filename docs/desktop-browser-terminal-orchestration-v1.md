# Desktop / Browser / Terminal Orchestration — v1

## Surfaces as First-Class Abstractions

A "surface" is the I/O channel through which JON interacts with the OS or an app.  
Each surface exposes the same interface contract but has different primitives and proofs.

```
Surface interface:
  observe()  → PerceptionState
  execute(ActionSpec) → ExecutionResult
  verify(expectedOutcome, PerceptionDelta) → VerifyResult
  recover(VerifyResult) → RecoveryAction
```

| Surface | I/O mechanism | Observation | Primitives |
|---|---|---|---|
| desktop | PowerShell + UIA + Win32 | screenshot + UIA tree | focusWindow, typeText, sendHotkey, clickPoint |
| browser | Playwright Chromium | DOM snapshot + screenshot | navigate, click, extract, fill |
| terminal | child_process stdin/stdout | stdout stream + regex | spawnCommand, sendInput, awaitPrompt |

---

## Surface Routing

Surface is chosen at plan-generation time by the LLM, based on mission brief.  
Routing logic (in desktop-plan.js / browser-planner.js):

```
if missionRequiresBrowser(brief):    → surface = browser
elif missionRequiresTerminal(brief): → surface = terminal
else:                                → surface = desktop
```

**Current state:** routing is implicit — plan type determines surface, not a single router.  
**Target:** a `SurfaceRouter` module that reads MissionBrief and returns `{ surface, reason }` deterministically.

### Routing Rules (deterministic, no LLM)

| Condition | Surface |
|---|---|
| brief.includes URL or "browser" or "web" | browser |
| brief.includes "run command" or "terminal" or "script" | terminal |
| default | desktop |
| surface not available (e.g., browser launch fails) | fallback → desktop |

---

## Proofs by Surface

Each surface produces a different proof artifact attached to the step result.

| Surface | Proof type | Format | Stored where |
|---|---|---|---|
| desktop | screenshot + UIA diff | PNG + JSON patch | DB: mission_steps.proof |
| browser | screenshot + DOM diff | PNG + HTML snippet | DB: mission_steps.proof |
| terminal | stdout excerpt | text (last N lines) | DB: mission_steps.proof |

Proof is captured **after verifyOutcome = VERIFIED** only. Failed steps produce a failure artifact (not a proof).

---

## Approvals by Surface

```
approvalGate.check(ActionSpec) → ALLOW | PAUSE | DENY
```

**Current state:** same gate for all surfaces. Surface-specific rules are absent.

**Target surface-aware policy:**

| Surface | Auto-ALLOW | Always PAUSE | DENY |
|---|---|---|---|
| desktop | typeText, sendHotkey (non-destructive) | file delete, registry write | kill process without confirmation |
| browser | navigate (in-scope domain), read/extract | navigate to external domain, fill form with PII | |
| terminal | read-only commands (ls, cat, git status) | commands with sudo, rm -rf, npm publish | |

Approval is checked **before** executePrimitive, never skipped.

---

## Recovery Strategy by Surface

### Desktop

```
windowNotFound:
  1. wait poll 500ms × 10 (5s total)
  2. if still not found → getActiveWindow() as fallback
  3. if activeWindow != expected → PAUSE → ask user

actionFailed (typeText/click):
  1. re-observe (captureWindow + inspectVisibleUi)
  2. LLM replan with fresh perception (replanCount++)
  3. if replanCount >= 2 → PAUSE
```

**Current:** step 2 fallback is implemented. LLM replan on typeText/click failure is absent.

### Browser

```
staleElement / elementNotFound:
  1. re-query DOM with updated selector (same goal)
  2. if not found after 3s → scroll + retry
  3. if still not found → navigate back + replan
  4. if replanCount >= 2 → PAUSE

pageLoadTimeout:
  1. wait up to 10s for DOMContentLoaded
  2. if timeout → screenshot + PAUSE
```

**Current:** basic retry on stale element exists. Re-navigation recovery is absent.

### Terminal

```
promptNotDetected (regex miss):
  1. wait additional 5s, retry regex
  2. if still no prompt → send empty \n, retry
  3. if still no prompt → PAUSE (interactive session suspected)

commandFailed (non-zero exit):
  1. capture stderr
  2. LLM replan with stderr context
  3. if replanCount >= 2 → PAUSE
```

**Current:** additional wait + \n retry is absent. stderr capture exists.

---

## Multi-Surface Missions

A single mission may span surfaces. Example: "search X in browser, then paste result into Notepad."

```
Step 1: surface=browser → navigate → extract text
Step 2: surface=desktop → focusWindow(Notepad) → typeText(extracted)
```

**Orchestration contract:**
- actionLog carries surface tag per step
- PerceptionState is surface-specific (no cross-surface snapshot)
- Surface switch is explicit in ActionSpec: `{ surface: 'desktop', ... }`
- Proof artifact is emitted per step, per surface

**Current state:** multi-surface missions are not tested. The loop handles one surface per plan. Surface switching mid-plan is untested but architecturally possible.

---

## Implementation Status

| Feature | Implemented | Missing |
|---|---|---|
| Surface primitives (all 3) | YES | |
| Surface routing (implicit) | YES | Explicit SurfaceRouter module |
| Surface-aware approval policy | NO | Target policy table above |
| Recovery: desktop windowNotFound | PARTIAL | Configurable poll, LLM replan on action fail |
| Recovery: browser stale element | PARTIAL | Re-navigation recovery |
| Recovery: terminal prompt miss | PARTIAL | Retry with \n signal |
| Proof capture per surface | NO | DB write + format standardized |
| Multi-surface mission orchestration | NO | Tested/wired in loop |
