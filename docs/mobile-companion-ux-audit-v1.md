# Mobile Companion UX Audit v1

## Current State

The mobile app is no longer only a pairing/approval remote. It has:

- chat
- live missions
- approvals
- terminals
- result list
- admin pairing/audit

## Problems Found

- Live mission cards were too thin: status + summary only.
- Mobile could approve or stop, but did not explain where JON was in the mission.
- Tool calls were not visible in a compact cockpit form.
- Verification state was not visible enough.
- Approval events were emitted as `approval.requested`, while mobile expected `approval.required`.

## Changes Implemented

- `/api/mobile/projects/:id/runs` now returns compact execution thread data.
- Mobile Live cards show natural reply, active step, active tool, proof count, artifact count, and verification verdict.
- Mobile event mapping now maps approval runtime events into mobile approval events.

## Remaining Gaps

- Mobile still has no full run detail drill-down.
- Proof opening from mobile remains thin.
- Live tool progression depends on event emission coverage in the runtime.
