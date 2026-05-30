# Live Execution Thread v1

## Purpose

Execution Thread is the right-side operational trace for the user. It should show what JON is doing without turning the chat into logs.

## Model

The Execution Thread exposes:

- mission objective and expected deliverable
- current plan and active step
- tool calls with lifecycle status
- state awareness
- proofs and artifacts
- blockers
- verification verdict

## Current Implementation

The thread model is produced by `ConversationResponsePlanner`.

New improvements:

- tool calls can now come from real lifecycle events using `toolCallId`
- duplicate tool entries are reduced by lifecycle aggregation
- mobile run payloads include a compact execution thread
- approvals are mapped into mobile events as `approval.required`

## Remaining Gaps

- SSE currently carries important state events, but not every runtime event is emitted live to every UI surface.
- Research/browser extraction paths still need first-class lifecycle events.
- A durable `tool_calls` projection would make the thread easier to query.
