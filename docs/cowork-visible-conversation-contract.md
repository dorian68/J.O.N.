# Cowork Visible Conversation Contract

## Status

Canonical for the current conversation UX boundary.

## Decision

Cowork has two layers:

- Visible layer: the user-facing assistant voice in the chat.
- Hidden layer: planner, bounded run preparation, safety policies, approvals, tool constraints, verification, traces and logs.

The visible layer must not read like a mission router, compliance checklist, or debug console. It should feel like a natural assistant coordinating an action agent behind the scenes.

## Visible In Chat

- Natural understanding.
- Short answer.
- One clarification question when needed.
- Short action announcement.
- Short confirmation request when approval is needed.
- Brief success, failure, or blocked result.
- Useful widgets only when they improve the answer.

Examples:

- `Oui. J'ouvre ton éditeur de notes.`
- `Oui. J'ai besoin de ton accord pour lancer l'application.`
- `Tu parles de quel éditeur: Bloc-notes, Obsidian, Notion, ou autre chose ?`
- `C'est fait.`
- `Je n'ai pas réussi à l'ouvrir. J'ai trouvé l'application, mais elle ne s'est pas lancée correctement.`

## Hidden From Normal Chat

- Risk scoring.
- Intent taxonomy.
- Lane selection.
- Run preparation details.
- Tool-by-tool plan.
- Forbidden-action lists.
- Internal safety checklist.
- Token governance and degraded-mode labels.
- Raw event names.
- Prompt/schema names.

These remain available through admin diagnostics, traces, run detail and persisted audit records.

## Banned Normal-Reply Patterns

The visible assistant must not use these patterns unless the user explicitly asks for a plan or internal explanation:

- `Before acting`
- `I will qualify this request`
- `What I will do`
- `What I will not do`
- `Forbidden actions`
- `Limitations`
- `This run will not`
- `No stronger bounded signal was detected`
- `Avant d'agir`
- `Je vais qualifier`
- `Ce que je vais faire`
- `Ce que je ne ferai pas`
- `Actions interdites`
- `Limites`
- `Ce run ne`

## Approval UX

Approvals remain explicit. The chat should ask for them compactly:

- `J'ai besoin de ton accord pour lancer l'application.`
- Button/card: `Autoriser`.
- On approval: `Je m'en occupe.`
- On denial: `D'accord, je n'exécute pas cette action.`

The detailed approval category, risk level, policy reason and audit rationale belong in admin.

## Admin Configuration

The admin console exposes:

- conversation system prompt;
- orchestration summary;
- policy/tool-rule summary;
- safety preset;
- verbosity;
- conversation mode;
- debug mode;
- whether internal plans or trace links appear in chat;
- approval-mode settings by action class;
- desktop/browser/file scope labels;
- non-bypassable safety floor.

Settings tune UX and approval posture. They do not disable hard runtime safety.

## Current Implementation

Implemented now:

- `conversation_turn` prompt treats `reply` as the visible assistant voice.
- Runtime sanitizer replaces visible replies containing banned boilerplate.
- Deterministic fallbacks use natural replies.
- User chat no longer renders preflight run-plan blocks by default.
- User chat uses compact confirmation cards for action preflight.
- Conversation events and generation/fallback labels are hidden from normal chat.
- Admin exposes `Agent Configuration` and `Safety & Guardrails`.
- Agent config is persisted in `app_settings`.

Deferred:

- Provider-native token streaming for the visible reply.
- Full enforcement of every guardrail setting against runtime policy. Current hard safety remains enforced by existing runtime policies.
- Rich per-user prompt presets.
