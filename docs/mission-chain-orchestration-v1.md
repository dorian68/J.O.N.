# Mission Chain Orchestration V1

## Statut

Canonical implementation contract.

## Goal

Allow the cowork to continue from one bounded run to the next when that continuation is:

- explicitly enabled by the user
- decided conservatively by the agent
- limited to one already-prepared next bounded step
- still traceable, approval-aware, and reviewable

This document does not authorize unbounded autonomy.

## Current implementation

The current repo now supports bounded multi-run orchestration through an opt-in handoff chain.

The chain works like this:

1. the user writes a natural mission
2. `mission_understanding` produces the first bounded run plan
3. the user reviews and confirms that first run
4. the run executes and records a product-facing outcome summary
5. a second structured reasoning stage, `run_handoff_decision`, decides whether the cowork should:
   - stop here
   - continue to exactly one recommended next bounded run
   - request one short clarification before any continuation
6. if continuation is allowed and no clarification is needed, the cowork previews the next bounded run internally and starts it automatically
7. any new approvals required by that next run still stop execution explicitly

## Agentic decision model

The current handoff is not a UI-only rule or a static if/else router.

The runtime uses a structured LLM stage, `run_handoff_decision`, with:

- the original mission
- the current run mission
- the outcome summary of the completed run
- the current chain context
- available local browsers when relevant

This stage decides:

- whether to continue now
- whether to stop
- whether one short clarification is required
- which existing recommendation payload to use

The runtime then applies strict reconciliation and fallback rules so the product remains bounded even when the live provider is unavailable or a malformed output appears.

## Boundary rules

- One bounded frame still executes per run.
- The chain may continue to one additional recommended run at a time.
- Auto-continuation is opt-in, not the hidden default.
- The chain cannot expand scope beyond the already-bounded recommendations produced by mission understanding.
- The chain must stop when:
  - the configured max auto-run limit is reached
  - the next bounded run now needs clarification
  - the next step falls outside policy or runtime support

## Traceability

The current runtime records:

- chain ids
- root run ids
- parent/child run links
- run indices
- the selected handoff decision
- whether auto-continuation was requested
- which recommendation slot was used
- events such as:
  - `run.chain.decided`
  - `run.chain.blocked`
  - `run.chain.continued`
  - `run.chain.error`

This keeps the chain auditable without turning the product into a freeform conversation loop.

## Current supported chain shape

The current implementation is strongest on honest two-step chains such as:

- launch a browser or open a browser search page
- then capture visible proof from that browser window

The runtime can also prepare other bounded next-run recommendations, but it does not yet claim generalized multi-capability autonomy.

## Not introduced here

- open-ended autonomous multi-run planning
- arbitrary fan-out or branching execution
- generalized desktop control across applications
- silent continuation across many runs
