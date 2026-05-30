# Workspace State Awareness - v1

## Purpose

Workspace state is JON's current map of the mission and environment. It must be available to the runtime, API, UI, verifier, and recovery planner.

## Snapshot Contract

`WorkspaceStateSnapshot` exposes:

- active mission/run/project
- desktop visible windows and active window
- browser sessions: URL, title, status, recent capture
- terminal sessions: status, cwd, recent output
- pending approvals
- mission progress and semantic verification
- evidence and artifacts
- blockers
- next recommended action
- user need

## User-Visible State

The UI/API must distinguish:

- mission status
- objective satisfied: yes/no/unknown
- evidence used
- missing evidence
- current blockage
- next action recommended
- what JON needs from the user
- where are we summary

## Guardrail

If semantic verification is absent or failed, UI must not present a confident "mission completed" message. Completed status without `verifiedByOutcomes === true` is a false completion candidate.

## Implementation

Implemented modules:

- `app/src/runtime/workspace-state-snapshot.js`
- `app/src/runtime/mission-progress-tracker.js`
- `/api/projects/:projectId/runs/:runId/progress`
- run audit `missionStatusSurface`

Known gap: snapshot aggregation is not yet the central runtime state store for every mission path. Research/form paths now write semantic verification, but workspace snapshots are still not the single source of truth for all runtime decisions.
