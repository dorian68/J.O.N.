# Mission Entry Contract V1

## Statut

Canonical implementation contract.

This document closes the current mission-entry shape for the local desktop surface.

## Goal

The product must let an operator start a run from a user-written mission, without turning the product into a generic chat UI.

The mission entry layer exists to:

- capture a concrete objective;
- keep the run entry explicit and reviewable;
- bind the request to one bounded execution frame;
- preserve approvals, evidence, artifacts, and run traceability.

## Current V1 shape

The current implementation now exposes a bounded `MissionSpec` entry across:

- a simplified mission-first user home on `/`
- a denser admin console on `/admin`

It is not an open-ended assistant prompt box.

It is a structured run-entry form with:

- `mode` optional
- `objective`
- `deliverable` optional
- `constraints` optional
- `forbiddenActions` optional
- mode-specific parameters for the controlled form path
- optional browser preference for missions that need a bounded local browser-launch step
- bounded starter missions for first-run onboarding

The launch flow is now two-step:

1. mission review / preflight
2. bounded run-plan review
3. explicit confirmation before the run starts

## Execution frames

The run still executes inside one of the already-authorized bounded execution frames:

- `research`
- `form`
- `computer`

The mission entry layer does not add a fourth execution mode.

It lets the operator express the mission in free text before the bounded runtime path starts.

The `mode` may now be omitted entirely on the user home. The cowork then proposes the bounded frame during preflight.

## Boundary rules

- The UI remains `run-centric`, not chat-centric.
- The mission entry layer must not silently widen browser or desktop scope.
- The selected execution frame remains the hard boundary.
- Approvals remain mandatory where already required.
- Existing degraded mode, gateway-first runtime, and token-governance remain in force.

## Current operator UX

The current desktop surface now includes a mission-first landing state for the user home, plus a separate admin console.

The first focal area on the user home is:

1. mission composition
2. starter missions and first-run guidance
3. mission preflight
4. optional mission structuring and lane hinting
5. explicit run confirmation

The deeper workspace then exposes:

1. live run status
2. approvals
3. outputs and evidence
4. diagnostics and benchmark tooling only on the admin console

Quick-start scenario cards remain available for bounded default launches.

The product surface now also includes:

- a first-run onboarding block explaining the three-step flow;
- starter missions that prefill a bounded `MissionSpec`;
- inline feedback after launch, approval, cleanup, and review actions;
- a results-first workspace naming layer instead of diagnostics-first wording.

## Current API surface

The current local operator server now supports:

- `POST /api/projects/:projectId/missions/preflight`
  - structured mission review without starting a run
- `POST /api/projects/:projectId/runs`
  - quick-start scenario launch from `scenarioId`
- `POST /api/projects/:projectId/missions`
  - structured mission launch from `MissionSpec`, optionally with a confirmed preflight

## Mission persistence

The runtime persists:

- the human-readable mission statement used for the run;
- the normalized structured `missionSpec`;
- the confirmed preflight understanding when the run was launched from preflight;
- the execution entry point;
- the requested bounded scenario id.

This keeps the run review surface auditable.

## Mode-specific nuance

### Research

- user text materially frames the research run;
- sources remain bounded by the configured allowlisted or fixture surfaces.

### Form

- user text frames the run;
- the operator can now supply bounded controlled-form values;
- submission remains out of scope.

### Computer

- user text frames the observation run;
- the actual target surface still remains bounded;
- the runtime may now also initiate one supported local browser launch after explicit approval when mission understanding selects that bounded desktop step;
- generalized desktop actuation remains out of scope.

## Explicit non-goals

This contract does not authorize:

- chat as the primary UI paradigm;
- arbitrary autonomous task routing;
- generalized browser or computer control;
- arbitrary local application launching;
- out-of-scope actions such as submit, publish, send, delete, or login workflows.

## Implementation status

Implemented now:

- mission-first bounded landing state on the user home;
- separate admin console for supervision and diagnostics;
- bounded mission-entry form shared by both surfaces;
- conservative internal mode inference when the mission does not provide one explicitly;
- starter missions for demo and first-run clarity;
- inline product feedback for key UI actions;
- mission-entry API route;
- normalized `MissionSpec` validation;
- runtime persistence of structured mission metadata;
- operator review visibility for mission metadata;
- secondary diagnostics surface instead of diagnostics-first landing.

Not introduced here:

- generalized chat UX;
- new execution capabilities;
- broader productization or packaging work.
