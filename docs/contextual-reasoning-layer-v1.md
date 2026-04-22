# Contextual Reasoning Layer V1

## Statut

Implementation reality document.

This document describes what the repository now implements for run-centric contextual reasoning. It does not redefine the target architecture.

Linked documents:
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [context-memory-skills.md](./context-memory-skills.md)
- [runtime-agentique.md](./runtime-agentique.md)
- [implementation-vs-docs-traceability-matrix.md](./implementation-vs-docs-traceability-matrix.md)

## What exists now

The codebase now contains a local reasoning subsystem under `app/src/reasoning/` with:

- observation matching
- guideline matching
- relationship conflict resolution
- variable resolution
- stage-specific context narrowing
- persisted reasoning context snapshots
- reasoning trace metadata linked to LLM calls, runtime events, artifacts, and run review

## Supported reasoning stages

The current implementation supports:

- `mission_understanding`
- `plan_generation`
- `decision_note_draft`
- `evaluation_support`
- `ambiguity_note`

These stages are integrated into the existing mono-agent runtime. They do not create new autonomous agents.

## Snapshot model

Before each relevant LLM call, the runtime creates a `ReasoningContextSnapshot` containing narrowed context only:

- selected sources
- selected artifacts
- selected evidence
- matched observations
- matched guidelines
- resolved variables
- policy constraints
- inclusion and exclusion reasons

The snapshot is persisted in `reasoning_context_snapshots` and linked back from LLM calls and artifacts.

## What is traceable

For each reasoned LLM call, the runtime now records at least:

- `reasoningStage`
- `contextSnapshotId`
- `matchedObservationIds`
- `matchedGuidelineIds`
- `resolvedVariableIds`
- `sourceIdsUsed`
- `artifactIdsUsed`
- `evidenceIdsUsed`
- `policyConstraintIds`
- `injectionReasonsSummary`

This is visible through the run review model and the operator surface.

## Runtime impact

The runtime no longer stuffs context ad hoc into individual prompt call sites for the main reasoning path.

Instead:

- mission understanding goes through the contextual reasoning path
- plan generation goes through the contextual reasoning path
- decision note draft goes through the contextual reasoning path
- evaluator support goes through the contextual reasoning path
- ambiguity note generation goes through the contextual reasoning path

When the LLM path degrades, the degraded output still carries reasoning-stage and snapshot traceability.

## Tests and regression coverage

The repository now includes:

- deterministic reasoning-layer tests
- evaluator tests
- runtime reasoning integration tests
- reasoning benchmark suite

These prove local mechanics, not pilot-level truth on external surfaces.

## What remains deferred

Still deferred relative to the broader product target:

- explicit skill packages activated dynamically at runtime
- richer project memory beyond the current run/project selection layer
- broader context selection across non-prototype workloads
- pilot validation on real surfaces

## Truth-first conclusion

The repository now has a real run-centric contextual reasoning layer.

It is materially stronger than the previous prompt-only or provider-only state.

It is still a bounded local implementation, not yet the full long-term context/memory/skills target described by the wider corpus.
