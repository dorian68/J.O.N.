# Conversation-first Cowork UX V1

## Product decision

The primary user surface is now a mission conversation, not a dashboard. The user writes a natural mission, sees the agent respond in the same flow, approves sensitive actions inline, and reviews results/proof from the conversation.

This does not make the product a freeform opaque chatbot. The runtime remains:
- run-centric;
- bounded;
- approval-aware;
- evidence-backed;
- auditable;
- diagnostics-capable.

## What the user sees

The user home should feel like:

1. User states a mission in a clean composer.
2. Cowork replies with product-level understanding and bounded preflight.
3. Cowork starts the run only after confirmation.
4. Live run events appear as chat bubbles.
5. Approvals appear inline as action cards.
6. Tool actions, checkpoints, recovery, evidence, and results appear in the flow.
7. Heavy diagnostics stay available in the admin console.

## What must not be exposed

The conversation may show:
- visible reasoning stages;
- plan summary;
- verification goals;
- action status;
- approval rationale;
- recovery state;
- proof links;
- final outcome.

The conversation must not expose raw hidden chain-of-thought. It shows a product-level reasoning trace only.

## Current implementation status

Implemented now:
- User home renders a chat-style transcript as the primary surface.
- User messages now go through the conversation-turn endpoint before mission preflight.
- User messages now render through the streaming conversation endpoint, with progressive assistant text in the primary chat flow.
- Recent out-of-run conversation turns are restored from the dedicated conversation history table.
- Cowork can answer directly, inspect safe local surfaces, ask one clarification, generate structured widgets, or prepare a bounded preflight.
- Mission/action planning remains internal when a bounded run is needed.
- Preflight appears in the user chat as a compact confirmation card, not a long run-plan/checklist.
- Live events and run events appear as assistant/tool bubbles.
- Pending approvals appear inline with approve/deny/stop controls.
- Final outcome appears as a result bubble when available.
- Controlled `uiBlocks` render folder lists, tables, metric cards, charts, report previews, artifact cards, action plans, and evidence galleries.
- Conversation events are no longer displayed as raw debug bubbles in the user transcript.
- Generation modes, fallback labels, intent taxonomy and raw event names are hidden from normal chat.
- The composer is sticky within the chat surface so focusing or scrolling the transcript does not push it out of view.
- Admin console remains reachable but secondary.
- Admin console exposes the effective visible conversation prompt and guardrail settings.

Still rough:
- Streaming is progressive from the server, but provider-native token streaming for structured planning is still deferred.
- Long chain visualization is compact and not yet a full timeline replay.
- The user cannot yet revise via an inline correction bubble; revision still uses the composer/details controls.
