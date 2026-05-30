# SurfaceRouter v1

## Purpose

SurfaceRouter is the central routing layer that turns a natural mission into an execution surface before the run is normalized and launched.

JON must not rely only on scenario IDs or UI preflight. A prompt such as `Open Notepad, write hello cowork, take a screenshot` must become a concrete desktop mission with an app target, expected tools, approval posture, and verifier step.

## Inputs

- mission objective, deliverable, constraints, and existing parameters
- installed browsers
- installed desktop applications
- workspace state snapshot when available
- risk policy / approval mode

## Outputs

- `selectedSurface`: `desktop`, `browser`, `terminal`, `files`, `artifact`, `approval`, or `verifier`
- `selectedProvider`: concrete provider hint such as `desktop.notepad` or `browser.chrome`
- `routingReason`
- `requiredApproval`
- `expectedTools`
- `fallbackSurface`
- `confidence`
- `blockers`
- `normalizedParameters`

## Current Implementation

Implemented in `app/src/runtime/surface-router.js` and wired into `OperatorService.startMission`.

Current deterministic routes:

- Notepad/open/write/screenshot prompts -> `computer` + `desktop_autonomy` + `applicationLaunch.notepad`
- Chrome/Edge/browser search prompts -> `computer` + `launch_browser_search` + browser/search URL parameters
- Desktop folder inspection prompts -> `computer` + read-only desktop autonomy path
- terminal/Codex/CLI prompts -> terminal surface marker

## Remaining Gaps

- Router confidence is heuristic, not learned from execution outcomes yet.
- Terminal routing is classified but not yet a complete terminal mission executor.
- File inspection still uses desktop autonomy primitives rather than a dedicated first-class files executor.
