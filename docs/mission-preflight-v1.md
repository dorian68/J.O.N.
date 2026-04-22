# Mission Preflight V1

## Statut

Canonical implementation contract.

## Goal

Before a run starts, the cowork must review the mission and explain the bounded interpretation it is about to execute.

This preflight exists to make the product feel agentic without becoming opaque.

The user should understand:

- how the mission was understood
- what the cowork will cover now
- what it will not do in this run
- what it will verify before declaring success
- what the best next step will be if one run is not enough
- whether the cowork may continue automatically to one next bounded step when that option has been enabled

## Current implementation

The current repo now exposes a distinct mission preflight step before mission launch on both:

- the mission-first user home
- the admin console mission entry

The default user flow is now:

1. write a natural mission
2. ask the cowork to review it
3. inspect the preflight
4. confirm or revise
5. start the run

## What the preflight shows

The current preflight surfaces:

- a short clarified objective
- the bounded execution frame the cowork selected
- how much of the mission can be covered now
- what will be done now
- how the current run will proceed
- what will not be done now
- what the run will verify
- which bounded run should come next when relevant
- the structured next-step recommendation when the runtime can prepare one honestly
- whether a clarification is needed before launch
- any ambiguity or hybrid-mission limitation

This is phrased as product guidance, not as a raw runtime debug panel.

When the user enables bounded auto-continuation, the preflight still focuses on the current run first. It does not promise an opaque chain. It only surfaces that the cowork may continue to one next bounded step if the completed run justifies it later.

## Agentic decision model

The preflight is driven by the runtime `mission_understanding` stage.

That stage uses:

- the current mission text
- optional structured mission fields
- optional preferred lane hint
- current reasoning context
- strict structured-output validation

The cowork is expected to decide conservatively:

- one bounded frame per run
- explicit surfacing of unsupported requests
- explicit surfacing of hybrid or cross-frame missions
- explicit verification goals before launch
- explicit bounded run plan for the current run
- explicit suggestion of the next bounded run when needed
- one short clarification only when a credible run cannot start cleanly

## API surface

The current local operator server now supports:

- `POST /api/projects/:projectId/missions/preflight`
  - returns the agent-reviewed preflight without starting a run
- `POST /api/projects/:projectId/missions`
  - starts the run, optionally reusing the confirmed preflight

## Runtime traceability

When a preflight is confirmed and reused by the run, the runtime persists:

- the confirmed understanding
- the chosen execution frame
- the routing confidence
- the preflight id when available
- the reuse event in the reasoning trace

This keeps the chain `mission -> preflight -> run -> verification` auditable.

## Boundary rules

- The preflight does not create a new execution mode.
- The preflight does not authorize multi-frame execution in one run.
- The preflight does not authorize arbitrary autonomous chaining; any continuation still depends on a later handoff decision.
- The preflight must not hide out-of-scope requests.
- The preflight must remain bounded by existing policy, approvals, degraded mode, and token governance.

## Not introduced here

- open-ended chat launch
- unbounded autonomous task orchestration
- generalized multi-capability execution in a single run
- silent automatic widening of browser or computer scope
