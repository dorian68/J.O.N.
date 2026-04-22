# Operator Token Dashboard V1

## Statut

Canonical implementation contract.

## Goal

The admin console must show where the cowork spends reasoning budget, where token governance saves spend, and where degraded behavior appears.

This is an operator cockpit, not decorative analytics.

## Current implementation

The admin console now exposes a dedicated token and cost dashboard backed by persisted LLM call records plus the active gateway status.

The dashboard summarizes project-level recent history, not just the currently open run.

## What it shows now

- total input / output / total tokens
- estimated total cost
- average cost per instrumented run
- average tokens per instrumented run
- total LLM call count
- reuse / suppression / blocked / downgraded counts
- fallback / degraded / compaction counts
- cost by reasoning stage
- recent run trend
- top cost drivers
- selected-run usage snapshot when a run is open

## Data honesty rules

- Costs may combine provider-reported values with governance estimates when pricing data is incomplete.
- Token totals may combine provider-reported usage with governance estimates when exact usage is unavailable.
- The UI must make that explicit instead of pretending every number is exact.

## Stage visibility

The current dashboard surfaces the main stages already present in the repo, including:

- `mission_understanding`
- `plan_generation`
- `decision_note_draft`
- `evaluation_support`
- `ambiguity_note`

## Boundary rules

- The dashboard must stay secret-safe.
- It must not expose raw API keys or sensitive provider credentials.
- It must reflect bounded runtime behavior only; it does not authorize any new capability.
- It must remain secondary to the user home and primary only inside the admin console.

## Not introduced here

- billing-grade exact accounting
- per-user or per-day persistent spend controls
- external telemetry SaaS
- cloud analytics pipeline
