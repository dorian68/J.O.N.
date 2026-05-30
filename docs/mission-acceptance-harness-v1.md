# Mission Acceptance Harness - v1

## Purpose

The harness defines real mission benchmarks for JON. It is not proof by itself; passing in mock mode does not count as real readiness. Real acceptance requires live desktop/browser/terminal surfaces, screenshots/evidence, semantic verification, and no false completion.

## Command

```bash
node app/src/scripts/mission-acceptance-harness.js --list
node app/src/scripts/mission-acceptance-harness.js --id=1
node app/src/scripts/mission-acceptance-harness.js --id=2
```

The script expects the operator server at `COWORK_SERVER` or `http://localhost:41732`.

## Benchmark Schema

Each benchmark defines:

- user prompt
- expected plan
- expected actions
- expected observations
- expected evidence
- expected final answer
- pass/fail criteria
- required approvals
- max retries
- max duration

## Required Benchmarks

| ID | Benchmark | Surface |
|---|---|---|
| 1 | Notepad + text + screenshot | desktop |
| 2 | Chrome/Edge + search + screenshot | browser |
| 3 | Desktop folder inspection | filesystem/desktop |
| 4 | Web search + extraction + table | browser |
| 5 | Browser screenshot + summary artifact | browser |
| 6 | Terminal waiting_for_input | terminal |
| 7 | Terminal safe context injection | terminal |
| 8 | Terminal error recovery | terminal |
| 9 | Off-target evidence guard | verification/browser |
| 10 | Mission requiring approval | desktop |
| 11 | Mission requiring clarification | conversation/routing |
| 12 | Hybrid multi-step mission | browser + filesystem |

## Pass Rule

A benchmark cannot pass if:

- run completed without semantic verification
- requested evidence is missing
- requested screenshot is missing
- sources/evidence are off target
- terminal remains blocked
- approval was required but not surfaced
- an unsafe action was executed
- server crashed on malformed LLM output

## Implementation

Definitions live in `app/src/scripts/mission-acceptance-harness.js`. The script lists all benchmarks without requiring the server; execution requires the server and a project.

Known gap: the harness is now defined for 12 missions, but not all missions are expected to pass today. Terminal and hybrid cases are intentionally included to expose non-functional areas.
