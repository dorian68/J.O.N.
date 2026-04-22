# Agent Activity UX V1

## Statut

Canonical implementation contract.

## Goal

Make the user understand that the cowork is reasoning, planning, asking approvals, acting and verifying while keeping the home mission-first.

The UI must not expose raw hidden chain-of-thought. It exposes product-level reasoning state:

- mission review
- reasoning stage names
- live run updates
- approvals
- tool/action milestones
- verification state
- handoff state

## Current implementation

The user home now shows an `Agent activity` panel under the mission composer when:

- a preflight is running
- a run is starting
- a run is active
- recent live updates exist
- the selected run has LLM calls

The panel shows:

- recent reasoning stages such as `Mission Understanding`, `Desktop Plan`, `Plan Generation`
- live updates from the server event stream
- whether the agent is waiting for approval, continuing a chain, or finishing

## Boundary

This is not a chat transcript and not raw model reasoning.

Allowed:

- concise status
- visible plan/actions
- stage labels
- approval prompts
- verification summaries

Not allowed:

- raw hidden chain-of-thought
- unverifiable claims that an action happened
- implying unbounded autonomy

## UX rule

The user should see:

```text
I wrote a mission.
The agent is reviewing it.
The agent planned a bounded desktop step.
The agent needs approval.
The agent executed a primitive.
The agent verified and saved proof.
```

The user should not need to open the admin console to know that work is happening.
