# React conversation home v1

## Intent

The user-facing desktop home is now a conversation-first React surface. It is not the operator console and it must not auto-load historical runs as if they were a fresh conversation.

## Product rules

- The default home opens on a new empty mission.
- Historical runs are secondary and opened from the history panel.
- A user mission is shown immediately as a user bubble.
- Agent preflight, bounded run-plan, approvals, live execution events, proof, and final outcome are shown as conversation messages.
- The admin console remains available at `/admin` for diagnostics, token/cost review, evidence inspection, and maintenance.
- The UI exposes useful agent activity, not hidden chain-of-thought.

## Implementation

- `/` loads the React bundle generated from `app/ui/src/main.jsx`.
- `/admin` continues to load the legacy operator console through `app/ui/app.js`.
- The React app uses the existing gateway-first APIs:
  - `GET /api/dashboard`
  - `GET /api/events`
  - `POST /api/projects/:projectId/missions/preflight`
  - `POST /api/projects/:projectId/missions`
  - `POST /api/approvals/:approvalId/decision`
- Desktop launch rebuilds the React bundle before opening the local shell unless `COWORK_SKIP_UI_BUILD=1` is set.

## Current limits

- The UI is now React-based and event-driven, but it still streams coarse runtime events rather than token-by-token model output.
- Long-lived conversation persistence is not yet a backend object; the durable record remains the run and its evidence.
- The admin console has not been migrated to React.
