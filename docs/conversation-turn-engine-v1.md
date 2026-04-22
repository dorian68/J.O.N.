# Conversation Turn Engine V1

## Status

Canonical for the current implementation.

This document defines the conversation layer above the bounded mission runtime. It does not replace the run-centric architecture. It decides how one user message should be handled before a mission preflight or run is launched.

The visible UX boundary is now defined by [cowork-visible-conversation-contract.md](./cowork-visible-conversation-contract.md).

## Product Goal

Cowork must not feel like a scenario launcher with a chat skin. A user can now write a natural message and the system can choose between:

- answering directly;
- inspecting a safe local surface and answering;
- asking one targeted clarification;
- preparing a bounded mission preflight;
- generating controlled structured response widgets;
- refusing an unsafe or out-of-scope request.

## Runtime Boundary

The conversation layer is allowed to make a structured decision, but it is not allowed to execute arbitrary desktop control directly.

Safe conversation capabilities implemented now:

- `inspect_desktop_folders`: read-only listing of top-level Desktop folders, without reading file contents.
- `list_installed_applications`: read-only provider catalog of detected local apps.
- `list_installed_browsers`: read-only provider catalog of detected browsers.
- `generate_report_preview`: controlled local Markdown + sandboxed HTML preview and structured UI blocks.

Actions such as opening a browser, launching an app, typing, clicking, or capturing a screen still route through bounded mission preflight and existing approval-aware runtime flows.

## LLM Contract

The LLM stage is `conversation_turn`.

Important distinction:

- `reply` is the visible assistant response and must be natural, short, and free of runtime plumbing.
- `intentType`, `action`, `capabilityRequests`, `missionDraft`, `preflight`, `safetyNotes`, and raw planning details are internal or admin-facing.
- User chat must not render internal run-plan/checklist blocks by default.

Prompt:

- `task.conversation_turn@1.0.0`

Structured output:

- `intentType`: `simple_conversation`, `local_question`, `safe_inspection`, `desktop_action`, `long_mission`, `report_generation`, `ambiguous`, or `out_of_scope`.
- `action`: `answer_directly`, `inspect_then_answer`, `ask_clarification`, `prepare_mission_preflight`, `start_bounded_run_after_confirmation`, `generate_structured_response`, or `refuse`.
- `reply`: concise natural user-facing text.
- `capabilityRequests`: only safe capability IDs.
- `missionDraft`: required when preparing a bounded mission.
- `uiBlocks`: controlled widget blocks only.
- `safetyNotes`: audit-oriented notes.

If the live provider fails, is blocked, or returns malformed output, the deterministic fallback produces a safe conservative turn.

## UI Blocks

The LLM must not emit raw HTML into chat. It emits controlled `uiBlocks`, rendered by the React app:

- `text`
- `folderList`
- `table`
- `metricCards`
- `chart`
- `reportPreview`
- `artifactCard`
- `approvalCard`
- `actionPlan`
- `evidenceGallery`

React escapes text content and owns rendering. Report previews are persisted as controlled artifacts when needed.

## Conversation Memory And Streaming

Conversation turns outside bounded runs are persisted in a dedicated `conversation_turns` table. The conversation planner receives a compacted recent history so follow-up messages can be interpreted as part of the same conversation instead of isolated one-shot prompts.

The user home uses `POST /api/projects/:projectId/conversation/stream` for progressive response rendering. Current streaming is server-side progressive reveal after the structured LLM turn completes; provider-native token streaming for JSON-mode planning remains deferred.

## Operator Visibility

Conversation-turn LLM calls go through the gateway and token-governance path. They appear in runtime LLM logs and gateway session usage. Full run-level LLM analytics still apply to bounded mission runs.

## Implemented Now

- Conversation endpoint: `POST /api/projects/:projectId/conversation/turn`.
- Conversation stream endpoint: `POST /api/projects/:projectId/conversation/stream`.
- Conversation history endpoint: `GET /api/projects/:projectId/conversation`.
- Agent configuration endpoints: `GET/PUT /api/agent/config`, `POST /api/agent/config/reset`, `POST /api/agent/config/preview`.
- Local artifact endpoint: `GET /api/conversation/artifacts/:artifactId/content`.
- React user home sends messages through the conversation stream endpoint and restores recent persisted conversation turns.
- Safe folder/app/browser/report capabilities are wired.
- Mission/action requests still produce a preflight before launch.
- UI renders structured widgets when useful, but no longer shows preflight/run-plan/checklist blocks in the normal chat by default.
- Report previews render in a sandboxed iframe from controlled server-generated HTML.
- Admin console exposes `Agent Configuration` and `Safety & Guardrails` settings.

## Still Deferred

- General arbitrary desktop action without bounded preflight.
- Provider-native token-by-token streaming for structured LLM JSON responses.
- Rich report authoring beyond the controlled preview template.
