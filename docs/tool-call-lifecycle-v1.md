# Tool Call Lifecycle v1

## Purpose

Execution Thread needs real tool lifecycle events, not reconstructed guesses after the run.

Every important action should move through:

- `planned`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `blocked`

## Current Implementation

Implemented in `app/src/runtime/tool-call-lifecycle.js`.

The desktop autonomy runtime now emits lifecycle events around desktop primitives. The desktop browser launch/search path also emits lifecycle events.

Event payloads include:

- `toolCallId`
- `runId`
- `stepId`
- `toolName`
- `surface`
- `primitive`
- `reason`
- `status`
- `inputSummary`
- `outputSummary`
- `evidenceIds`
- `startedAt`
- `completedAt`
- `error`
- `durationMs`

## UI Consumption

`ConversationResponsePlanner` now dedupes tool events by `toolCallId`, so planned/running/succeeded does not create fake duplicate tools in the Execution Thread.

## Remaining Gaps

- Some older browser/research/form paths still emit legacy events only.
- There is no dedicated database table for tool calls yet; lifecycle is event-sourced.
