# Mission Understanding And Routing V1

## Statut

Canonical implementation contract.

## Goal

The user should be able to express a natural mission without having to think in internal runtime frames first.

The runtime still keeps bounded execution frames, but it now treats them as internal routing mechanics rather than the primary product concept.

## Current implementation

The repository now implements a first explicit `mission understanding` stage in the runtime.

This stage is responsible for:

- clarifying the mission in conservative language
- selecting or qualifying the bounded execution frame already in use
- surfacing unsupported or out-of-scope requests
- defining verification goals before execution
- defining the bounded run plan for the current run
- proposing the best next bounded run when the mission is hybrid
- producing a structured recommendation payload for that next bounded run when possible
- producing a later bounded recommendation when a credible third step exists
- asking for one targeted clarification when needed
- reasoning over available local browsers when the mission explicitly asks for a browser-launch desktop step
- reasoning over browser-launch plus search plus capture requests as hybrid missions
- leaving a traceable record of the interpretation

This stage is now also surfaced through a user-facing preflight before a run starts.

The current runtime also compacts the resulting `mission_understanding` payload before `plan_generation` so the planner receives a stable current-run summary instead of the full preflight narrative and follow-up recommendation object graph.

## Routing model

The current product still executes one bounded frame per run:

- `research`
- `form_preparation`
- `computer_observation`

At the API/service layer:

- `mode` can still be provided explicitly
- `mode` can now also be omitted
- when omitted, the system lets mission understanding choose the bounded lane conservatively during preflight
- when the user enables bounded auto-continuation, mission understanding still chooses only the current run; follow-up continuation is decided later by a separate handoff stage

The inference is not treated as magic. The normalized `missionSpec` now persists:

- whether the mode was provided or inferred
- the inferred mode
- the routing confidence
- the routing reason
- any cross-frame notice

## Runtime traceability

For a mission-started run, the runtime now records:

- a `mission_understanding` LLM stage
- the linked reasoning snapshot
- the chosen execution frame
- the routing confidence
- requested outcomes
- verification goals
- unsupported requests, when present
- structured next-step recommendations when they exist

`mission_understanding` is now treated as a core stage for governance purposes. It can still degrade safely, but it is no longer treated as a silently suppressible optional helper.

These outputs are attached to the run plan and to run events.

For bounded desktop browser-launch requests, mission understanding now also persists:

- the selected browser when one safe choice is clear
- browser clarification options when more than one supported browser is detected
- whether the current computer run is an observation step or a browser-launch step

When the user confirms the preflight, the run reuses that reviewed interpretation instead of silently recomputing a different one.

The same reviewed interpretation also seeds the later `run_handoff_decision` stage so the chain stays consistent with the original mission and the verified outcome of the current run.

## Verification link

Mission understanding is now tied to post-execution verification.

Each bounded scenario records a verification summary with:

- scenario type
- requested outcomes
- verification goals
- boundary notices
- explicit pass/fail checks

This does not widen the product scope.

It makes the chain `mission -> plan -> action -> verification` more explicit and more auditable.

## Boundary rules

- The runtime still executes only one bounded frame per run.
- The system must not silently widen the scope because a mission is phrased naturally.
- Out-of-scope requests must be surfaced explicitly.
- Mission understanding may guide the run, but it does not override policy, approvals, or deterministic verification.

## What is still not introduced

- open-ended chat orchestration
- arbitrary multi-frame execution in one run
- generalized multi-run autonomy across many steps
- generalized desktop actuation
- unbounded autonomous task routing
