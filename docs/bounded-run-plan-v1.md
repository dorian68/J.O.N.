# Bounded Run Plan V1

## Statut

Canonical implementation contract.

## Goal

After the cowork understands a mission, it must turn that understanding into a bounded run plan that a user can review before launch.

The run plan must not pretend to support full multi-capability orchestration when the runtime still executes one bounded frame per run.

## Current product behavior

The current product now exposes a `bounded run plan` during mission preflight.

This plan explains:

- what the cowork can execute now
- how the current run will proceed
- what will not be covered in this run
- what the cowork will verify before declaring success
- what bounded run should happen next when the mission is hybrid
- whether one targeted clarification is needed before launch

## Current output contract

The current mission-understanding stage now produces, at minimum:

- `missionSummary`
- `clarifiedObjective`
- `chosenExecutionFrame`
- `coverageStatus`
- `coveredNow`
- `notCoveredNow`
- `verificationGoals`
- `runNowPlan`
- `nextRunSuggestion`
- `nextRunRecommendation`
- `maybeLaterSuggestion`
- `maybeLaterRecommendation`
- `unsupportedRequests`
- `ambiguityNote`
- `requiresClarification`
- `clarificationQuestion`

## Hybrid-mission behavior

The current runtime still executes one bounded frame per run.

So the plan must:

- detect hybrid missions
- pick the best first bounded run
- explain what is covered now
- propose the best next bounded run when relevant
- optionally suggest a later run if there is a credible third step

The plan must not silently imply full multi-frame execution in one run.

When the user enables bounded auto-continuation, the plan may prepare one concrete next-step recommendation payload that a later handoff decision can reuse. It still does not authorize that next run by itself.

## Clarification behavior

The current product may ask for one short targeted clarification when:

- the mission is too vague
- two bounded interpretations compete too closely
- the safe subset is unclear enough that the current run would be misleading

The clarification must remain short, actionable, and mission-oriented.

## Boundary rules

- One bounded frame per run remains the hard runtime rule.
- The plan may sequence future bounded runs conceptually and may prepare one concrete next-step payload for later reuse.
- The plan does not itself decide automatic continuation; that decision belongs to the separate handoff stage after a run finishes.
- Approvals, degraded mode, token governance, and structured validation remain in force.
- Unsupported requests must still be surfaced explicitly.

## Non-goals

This contract does not introduce:

- open-ended multi-step autonomous orchestration
- generalized browser plus desktop control in a single run
- a chat-first launch model
- hidden or unreviewable planning
