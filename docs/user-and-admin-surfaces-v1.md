# User And Admin Surfaces V1

## Statut

Canonical implementation contract.

## Goal

The product must no longer force the user to enter through the same dense surface that operators use for review and diagnostics.

The repository now keeps two distinct surfaces:

- a `user home`
- an `admin console`

This split exists to make the product feel like a real `desktop coworker` without deleting the deeper review power required by the prototype corpus.

## User home

The default landing route is `/`.

This surface must be:

- mission-first
- visually simple
- centered around a single large mission composer
- centered on the main text-to-actions entry
- explicit about bounded execution
- explicit about approvals and proof
- low-noise before a run starts

The user home must let a person immediately understand:

1. what they can ask
2. how to ask it
3. what will happen next
4. what happened in the last run and which next step is recommended
5. whether the agent is currently reviewing, planning, waiting for approval, acting, or verifying

The user home is not the place for:

- benchmark tooling
- LLM diagnostics
- low-level event streams
- dense project administration

## Admin console

The admin route is `/admin`.

This surface keeps the deeper supervision and review power:

- project context
- recent runs
- approval history
- token and cost dashboard
- diagnostics
- benchmark review
- maintenance actions
- advanced shortcuts

The admin console remains product-valid because the corpus is still run-centric and audit-centric.

It must not be the default first-run surface anymore.

## Boundary rules

- The user home must not become an open-ended chat.
- The admin console must not become the default landing page.
- Both surfaces still use the same bounded runtime, approvals, artifacts, proof, and persistence model.
- The split itself does not widen execution scope; any new runtime capability must still be explicitly authorized elsewhere.
- The split is UI/product architecture only; it does not widen execution scope.

## Current implementation shape

Implemented now:

- `/` serves the simplified user home
- the user home now uses a centered, low-noise landing layout with the mission composer as the primary focal point
- `/admin` serves the denser admin console
- both surfaces share the same `MissionSpec`, mission-preflight, and run APIs
- the user home exposes only mission-first progress and results surfaces
- the user home now forces a mission review step before launch
- the user home can now surface one short browser-choice clarification when the mission asks for a local browser launch and several supported browsers are detected
- the user home now surfaces a product-style run outcome summary and next-step handoff
- the user home now includes an `Agent activity` panel that shows product-level reasoning stages and live updates without exposing raw hidden chain-of-thought
- the admin console now exposes a token/cost dashboard above lower-level LLM traces
- diagnostics stay on the admin console

Not introduced here:

- a separate auth model
- separate backends
- generalized multi-user roles
- freeform conversational agent behavior
