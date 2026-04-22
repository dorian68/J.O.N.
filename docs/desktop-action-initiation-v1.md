# Desktop Action Initiation V1

## Statut

Canonical bounded capability contract.

## Goal

Authorize one minimal desktop action-initiation slice that makes the cowork feel like a real desktop product without widening it into general computer automation.

The first authorized action-initiation slice is:

- discover supported local browsers on the current machine
- ask for one short clarification when several safe browser choices exist
- launch one selected browser after explicit approval
- optionally load one requested search page in that browser
- verify that a visible browser window appeared
- persist proof of that launch
- prepare and, when explicitly enabled and still safe, continue to a follow-up bounded capture run

## Why this exists

Without this slice, a natural mission such as "open my browser" remains a dead end:

- the user expresses a desktop intention
- the preflight can understand it
- but no visible desktop action follows

That gap makes the product feel like a planner or a form, not like a desktop cowork.

## Boundary

Authorized now:

- supported browser discovery on the local machine
- one browser-launch approval
- launch of one selected supported browser
- visible-window verification after launch
- evidence export tied to the run

Not authorized here:

- general application launching
- arbitrary executable launching from user text
- desktop clicking, typing, dragging, hotkeys, or native dialog control
- hidden chaining into broader desktop automation
- silent multi-run or multi-capability execution

## Supported local browsers

The current Windows-first implementation recognizes a bounded known set:

- Microsoft Edge
- Google Chrome
- Mozilla Firefox
- Brave

Support remains best-effort and machine-truthful:

- only actually detected installed browsers are surfaced
- if several are detected and the mission does not specify one, the cowork asks one clarification
- if none are detected, the run does not claim success

## Product flow

1. The user writes a natural mission.
2. Mission understanding recognizes that the mission asks for a browser-launch desktop step.
3. The preflight shows:
   - how the request was understood
   - what can be done now
   - what will be verified
   - which browser is selected, or which clarification is needed
4. The operator confirms the run.
5. The runtime requests explicit approval for the local browser launch.
6. The runtime launches the selected browser.
7. If the mission asked for a search step, the runtime loads the requested search page.
8. The runtime verifies that a visible browser window appeared.
9. The run persists evidence and a verification summary.
10. If the original mission also asked for visible capture and bounded auto-continuation is enabled, the cowork may continue to one follow-up capture run after a separate handoff decision.

## Verification rules

The run should only pass when all of the following are true:

- the selected browser was actually available on the machine
- a visible browser window matching that browser appeared after launch
- the browser either became the active context or opened a new visible window
- launch evidence was persisted

## UX rules

- The user should not configure low-level runtime mechanics.
- The browser question is allowed because it is a natural mission clarification, not a debug parameter.
- The user home must keep this lightweight:
  - one short question
  - one or a few browser choices
  - explicit confirmation before launch

## Runtime rules

- This slice remains inside the existing `computer` bounded frame.
- It does not introduce a fourth execution frame.
- It remains approval-aware, traceable, auditable, and subject to degraded mode and token governance.
- The optional follow-up capture remains a separate bounded run, not a hidden extension of the same run.
