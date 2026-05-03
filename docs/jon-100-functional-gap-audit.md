# JON 100% Functional Gap Audit

Audit date: 2026-05-03  
Scope: what is missing to call JON production-ready for real missions.

---

## Global Component Table

| Composant | État actuel | Gap | Priorité |
|---|---|---|---|
| missionUnderstanding | EXISTS, LLM call real | No structured validation of output schema | P2 |
| desktop-plan (static) | EXISTS | Plan is static, no dynamic re-observation per step | P1 |
| dynamic loop (observe→verify per step) | ABSENT | Full agentic loop not wired end-to-end | P0 |
| verifyOutcome (LLM) | ABSENT | perception delta exists, LLM verdict missing | P0 |
| MissionProgressTracker | ABSENT | actionLog[] in memory, no persistence | P1 |
| approvalGate | EXISTS | Works, but surface-unaware (same policy for all) | P2 |
| recoverOrReplan | PARTIAL | Max 2x, desktop watcher trigger only | P1 |
| windowNotFound recovery | PARTIAL | 5s timeout + fallback active window, no retry loop | P1 |
| terminal state detection | PARTIAL | Regex heuristic only, no prompt-ready signal | P1 |
| completion proof storage | ABSENT | No screenshot+timestamp committed to DB on success | P1 |
| token governance | EXISTS | Works, fallbacks deterministic | OK |
| LLM provider (openai-compat) | EXISTS | Real, tested with mocks — real surface untested | P2 |

---

## By Surface

### Desktop

**Verdict: PARTIEL**

| Item | État | Gap |
|---|---|---|
| listVisibleWindows | REAL (PowerShell/UIA) | None |
| focusWindow | REAL | windowNotFound recovery is basic |
| typeText | REAL | No verification that text was accepted |
| sendHotkey | REAL | No outcome verification |
| clickPoint | REAL | No verification click hit intended target |
| captureWindow (screenshot) | REAL | None |
| inspectVisibleUi (UIA tree) | REAL | Tree can be stale; no change-wait |
| verifyOutcome after action | ABSENT | LLM verdict on perception delta missing |
| waitForVisibleWindow | PARTIAL | 5s hardcoded, no configurable poll interval |

**Blocking for "Open Notepad, write hello, screenshot":**
- verifyOutcome missing: can execute steps but cannot confirm "hello" appeared in Notepad
- windowNotFound recovery: if Notepad launch is slow, 5s timeout may fail silently

---

### Browser

**Verdict: PARTIEL**

| Item | État | Gap |
|---|---|---|
| Playwright Chromium (non-headless) | REAL | None |
| navigate | REAL | None |
| DOM query / extract | REAL | None |
| click (DOM element) | REAL | No post-click outcome verification |
| screenshot | REAL | None |
| DOM retry on stale element | EXISTS | Limited: no exponential backoff |
| verifyOutcome (LLM on DOM delta) | ABSENT | Same gap as desktop |
| browser session persistence across steps | PARTIAL | Single page context, no tab management |

**Blocking for "Open browser, search X, screenshot":**
- verifyOutcome missing: cannot confirm search results appeared
- No check that the right page loaded after navigate (only DOM available)

---

### Terminal

**Verdict: PARTIEL**

| Item | État | Gap |
|---|---|---|
| spawn child_process | REAL | None |
| send stdin | REAL | None |
| read stdout/stderr | REAL | None |
| detect prompt ready | PARTIAL | Regex heuristic ($ / > / %) — fragile for custom prompts |
| awaitPrompt timeout | PARTIAL | Hardcoded, no signal from shell |
| verify command output | ABSENT | No LLM verdict on stdout content |
| interactive command support (vim, python REPL) | ABSENT | Not handled |

---

### Execution Loop

**Verdict: BLOQUANT**

| Item | État | Gap |
|---|---|---|
| observe → act | EXISTS | Works per step |
| act → verify | ABSENT | No verifyOutcome wired |
| verify → recover | PARTIAL | Only on desktop watcher diff, not per step |
| mission-level completion check | ABSENT | No final goal verification |
| persistent actionLog (DB) | ABSENT | In-memory only, lost on crash |
| replan > 2x | BLOQUANT | Hard cap; no escalation path except PAUSE |

---

### UX / Approvals

**Verdict: PARTIEL**

| Item | État | Gap |
|---|---|---|
| approvalGate (consecutive failure pause) | EXISTS | Real |
| surface-aware approval policy | ABSENT | Same gate for desktop/browser/terminal |
| user clarification flow | EXISTS | Wired in conversation-turn.js |
| completion notification | ABSENT | No event emitted when mission DONE |
| proof delivered to user | ABSENT | Screenshot not surfaced in UI on success |

---

### Tests / Benchmarks

**Verdict: BLOQUANT**

| Item | État | Gap |
|---|---|---|
| Unit tests | EXISTS | Run in mock_offline — not proof of real capability |
| Real-surface tests | PARTIAL | real-surface-harness exists, catalog partial |
| Acceptance benchmark (10 missions) | ABSENT | No harness for pass/fail on real missions |
| CI real-surface run | ABSENT | Not set up |

---

## Missions Bloquantes

### "Open Notepad, write hello, screenshot"
Bloqué par:
1. verifyOutcome absent → cannot confirm typeText landed
2. MissionProgressTracker absent → no proof stored
3. windowNotFound recovery fragile if Notepad slow

### "Open browser, search X, screenshot"
Bloqué par:
1. verifyOutcome absent → cannot confirm search results page loaded
2. No mission-level completion check (last step ≠ goal achieved)
3. proof not surfaced to user

---

## Priority Order (P0 → deliver first)

1. **P0** — Wire verifyOutcome (LLM on perception delta) into execution loop
2. **P0** — Mission-level completion check (final verify after all steps)
3. **P1** — MissionProgressTracker: persist actionLog to DB per step
4. **P1** — windowNotFound: configurable poll interval + retry count
5. **P1** — recoverOrReplan: trigger on any FAILED verifyOutcome (not just desktop watcher)
6. **P1** — completion proof: screenshot + timestamp → DB → emit to UI
7. **P2** — surface-aware approval policy
8. **P2** — real-surface CI acceptance harness (10 missions)
