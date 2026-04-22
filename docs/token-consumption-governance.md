# Token Consumption Governance

## Status

Normative governance document for the current repository state.

This policy applies to the current gateway-first LLM path, the existing reasoning layer, the bounded evaluator path, degraded mode, the current readiness/pilot orchestration, and operator-visible LLM status.

It does not authorize any new browser, desktop, or connector capability.

## Objectives

- Reduce unnecessary token spend.
- Preserve quality on the stages that matter most.
- Degrade explicitly and safely under budget pressure.
- Keep routing, suppression, reuse, and fallback explainable.
- Keep the whole policy observable, testable, and reviewable.

## Scope

Stages currently in scope:

- `conversation_turn`
- `mission_understanding`
- `plan_generation`
- `decision_note_draft`
- `evaluation_support`
- `ambiguity_note`
- `run_handoff_decision`
- `desktop_plan`

Current runtime reality:

- `conversation_turn` is the user-facing message planner. It decides whether to answer, inspect a safe surface, ask one clarification, generate structured widgets, or prepare mission preflight.
- `mission_understanding` is now a real structured reasoning call when the live provider path is available, with deterministic fallback when needed.
- `plan_generation` and `decision_note_draft` are mandatory high-value stages.
- `evaluation_support` and `ambiguity_note` are optional bounded stages.
- `run_handoff_decision` is a bounded post-run reasoning stage that decides whether one prepared next run should continue automatically.
- `desktop_plan` is a governed desktop-autonomy stage that selects a short sequence of approved primitives from discovered apps/windows.

## Budget Model

### Active budgets enforced now

- Per request: stage-specific token target and hard ceiling.
- Per stage per run: token and USD target.
- Per run: `COWORK_LLM_BUDGET_PER_RUN_TOKENS`, `COWORK_LLM_BUDGET_PER_RUN_USD`.
- Per session: `COWORK_LLM_BUDGET_PER_SESSION_TOKENS`, `COWORK_LLM_BUDGET_PER_SESSION_USD`.

### Deferred budgets

- Per operator budget.
- Per project budget.
- Daily persistence across restarts.

## Stage Policy

### `conversation_turn`

- Priority: core.
- Mandatory: yes.
- Preferred model alias: `utility_structuring`.
- Request token target: `2200`.
- Hard request ceiling: `5200`.
- Stage token budget per turn/run key: `7200`.
- Stage USD budget per turn/run key: `0.09`.
- Deterministic fallback eligible: yes.
- Suppression eligible: no.
- Cache/reuse eligible: yes, exact fingerprint only.
- Live-provider block conditions:
  - request exceeds stage hard ceiling;
  - request would exceed stage token budget;
  - run/session remaining token budget is insufficient;
  - run/session USD budget is already exhausted or estimated to be insufficient when pricing is configured.
- Operator disclosure required: yes.

### `plan_generation`

- Priority: critical.
- Mandatory: yes.
- Preferred model alias: `primary_reasoning`.
- Request token target: `2700`.
- Hard request ceiling: `4600`.
- Stage token budget per run: `5200`.
- Stage USD budget per run: `0.11`.
- Deterministic fallback eligible: yes.
- Suppression eligible: no.
- Cache/reuse eligible: yes, exact fingerprint only.
- Live-provider block conditions:
  - request exceeds stage hard ceiling;
  - request would exceed stage token budget;
  - run/session remaining token budget is insufficient;
  - run/session USD budget is already exhausted or estimated to be insufficient when pricing is configured.
- Operator disclosure required: yes.

### `decision_note_draft`

- Priority: critical.
- Mandatory: yes.
- Preferred model alias: `primary_reasoning`.
- Request token target: `3400`.
- Hard request ceiling: `5200`.
- Stage token budget per run: `5600`.
- Stage USD budget per run: `0.14`.
- Deterministic fallback eligible: yes.
- Suppression eligible: no.
- Cache/reuse eligible: yes, exact fingerprint only.
- Live-provider block conditions:
  - request exceeds stage hard ceiling;
  - request would exceed stage token budget;
  - run/session remaining token budget is insufficient;
  - run/session USD budget is already exhausted or estimated to be insufficient when pricing is configured.
- Operator disclosure required: yes.

### `evaluation_support`

- Priority: important optional.
- Mandatory: no.
- Preferred model alias: `utility_structuring`.
- Request token target: `1700`.
- Hard request ceiling: `2400`.
- Stage token budget per run: `2000`.
- Stage USD budget per run: `0.05`.
- Deterministic fallback eligible: yes.
- Suppression eligible: yes.
- Cache/reuse eligible: yes, exact fingerprint only.
- Suppression conditions:
  - request exceeds stage hard ceiling;
  - request would exceed stage token budget;
  - run/session remaining token budget is insufficient;
  - run/session USD budget is already exhausted or estimated to be insufficient when pricing is configured.
- Operator disclosure required: yes.

### `ambiguity_note`

- Priority: optional.
- Mandatory: no.
- Preferred model alias: `utility_structuring`.
- Request token target: `1200`.
- Hard request ceiling: `1800`.
- Stage token budget per run: `1500`.
- Stage USD budget per run: `0.03`.
- Deterministic fallback eligible: yes.
- Suppression eligible: yes.
- Cache/reuse eligible: yes, exact fingerprint only.
- Suppression conditions:
  - request exceeds stage hard ceiling;
  - request would exceed stage token budget;
  - run/session remaining token budget is insufficient;
  - run/session USD budget is already exhausted or estimated to be insufficient when pricing is configured.
- Operator disclosure required: yes.

### `mission_understanding`

- Priority: core.
- Mandatory: yes.
- Preferred model alias: `utility_structuring`.
- Request token target: `1650`.
- Hard request ceiling: `3400`.
- Stage token budget per run: `3900`.
- Stage USD budget per run: `0.055`.
- Deterministic fallback eligible: yes.
- Suppression eligible: no.
- Cache/reuse eligible: yes, exact fingerprint only.
- Operator disclosure required: yes.
- Current implementation note: this is now a real structured live-provider stage when the live path is available; under budget pressure it falls back through the existing degraded path instead of being silently suppressed.

### `run_handoff_decision`

- Priority: core.
- Mandatory: no, but required when bounded auto-continuation is enabled.
- Preferred model alias: `utility_structuring`.
- Request token target: `1000`.
- Hard request ceiling: `1800`.
- Stage token budget per run: `1800`.
- Stage USD budget per run: `0.025`.
- Deterministic fallback eligible: yes.
- Suppression eligible: no when auto-continuation is active.
- Cache/reuse eligible: yes, exact fingerprint only.
- Operator disclosure required: yes.
- Current implementation note: this stage remains single-step only; it may continue to exactly one precomputed recommendation, stop, or ask one short clarification.

### `desktop_plan`

- Priority: core.
- Mandatory: yes when the current computer run uses `desktop_autonomy`.
- Preferred model alias: `utility_structuring`.
- Request token target: `1600`.
- Hard request ceiling: `2600`.
- Stage token budget per run: `2800`.
- Stage USD budget per run: `0.045`.
- Deterministic fallback eligible: yes.
- Suppression eligible: no.
- Cache/reuse eligible: yes, exact fingerprint only.
- Operator disclosure required: yes.
- Current implementation note: this stage may plan only governed primitives exposed by the runtime. Policy and approvals still decide whether execution is allowed.

## Context Minimization Policy

The runtime must not send the whole run bundle to every LLM call.

Rules enforced now:

- Only stage-relevant context enters the `ReasoningContextSnapshot`.
- Context is narrowed by stage before prompt assembly.
- Duplicates are removed by stable id where possible.
- Oversized stage context is compacted in this order:
  - `events`
  - `evidence`
  - `artifacts`
  - `sources`
- Oversized `records`, `sourceReferences`, `draft`, and `evaluationSupport` inputs are compacted to stable summary fields.
- `missionUnderstanding` is compacted before `plan_generation` so the planner receives the current-run execution summary rather than the full preflight/recommendation payload.
- Every compaction records:
  - whether compaction happened;
  - why it happened;
  - estimated tokens before;
  - estimated tokens after;
  - estimated tokens saved.

Exclusion rules:

- Omitted context is omitted by stage rule, not ad hoc.
- Optional context is removed before mandatory context.
- Traceability to reasoning snapshot ids is preserved.

## Call Avoidance Policy

Rules enforced now:

- Exact same stage fingerprint inside the same run reuses the prior successful output.
- Reuse requires the same stage, effective model alias, prompt refs, and compacted input.
- Reused outputs are logged as reuse, not as fresh live executions.
- Optional stages may be suppressed before any live call.
- Mandatory stages may block the live provider and fall back through the existing degraded path instead of burning tokens on a request already known to be outside budget posture.

Not implemented now:

- Near-duplicate semantic matching.
- Cross-run cache persistence.
- Cross-session cache persistence.

## Routing, Downgrade, Suppression, And Live Blocking

Current routing:

- Critical stages route to `primary_reasoning`.
- Core and optional/supporting stages route to `utility_structuring` when that alias is the stage default.

Current downgrade policy:

- Downgrade is stage-aware and explicit.
- It only applies when the stage policy defines a cheaper alias and budget pressure is present.
- In the current repo, the practical value of downgrade still depends on `utility_structuring` being configured to a genuinely cheaper live model.

Current suppression policy:

- Optional stages may be suppressed before any provider call.
- Suppression is persisted and operator-visible.
- Deterministic fallback remains allowed where the runtime already supports it.

Current live-provider block policy for mandatory stages:

- Mandatory stages are not silently skipped.
- When governance determines that a live request is beyond allowed budget posture, the live provider is blocked explicitly.
- The gateway then continues through the existing degraded path:
  - mock provider if configured and available;
  - otherwise runtime-level deterministic fallback where the slice already allows it.

## Hard Limits And Kill Switches

Constrain in this order:

1. Reuse exact prior output in the same run.
2. Compact context and large inputs.
3. Route optional/supporting stages to their cheaper alias.
4. Suppress optional stages under pressure.
5. Block live-provider use for mandatory stages when hard ceilings or remaining budgets make the request unjustified.
6. Fall back through the already-authorized degraded path.

What gets blocked first:

- Optional low-value stages.
- Oversized requests.
- Live-provider requests that would breach remaining run/session/stage budgets.

What remains allowed:

- Mock provider fallback if enabled.
- Deterministic fallback already present in the slice.
- Readiness/pilot reporting and safe operator review.

## Observability

The implementation now records, where applicable:

- estimated input tokens;
- estimated total tokens;
- estimated request USD when pricing is configured;
- actual provider token usage;
- actual estimated cost returned from the provider;
- budget-pressure reasons;
- request fingerprint;
- reuse decision;
- suppression decision;
- live-provider block decision;
- downgrade decision;
- per-stage policy id;
- reasoning stage and reasoning snapshot id.

Operator-safe summary now includes:

- effective LLM mode;
- provider label;
- whether live provider is configured;
- whether OS secret-store is active;
- whether env fallback is active;
- session token usage;
- governance counters for reuse, suppression, live blocking, and compaction.

Important note:

- USD controls are strongest when pricing overrides are configured.
- Without pricing overrides, token governance still enforces token budgets and reports USD posture only where it can do so honestly.

## Operator UX

Operator surfaces must remain compact and truthful.

Current behavior:

- gateway status remains metadata-only and does not expose secrets;
- status badges surface live configured / not configured, OS secret-store posture, env fallback posture, and governance counters;
- call cards surface `reused`, `suppressed`, `live blocked`, `downgraded`, `fallback`, and `degraded` when relevant;
- the admin console now includes a project-level token/cost dashboard with stage breakdown, recent run trend, and top cost drivers;
- runtime events make stage suppression, live-provider blocking, downgraded calls, and degraded mode visible without flooding the UI.

## Testing

Required tests for the current repo state:

- config validation for provider mode, base URL, models, and secret-source posture;
- secret-resolution precedence;
- context compaction and token estimate reduction;
- reuse for identical in-run fingerprints;
- optional-stage suppression under pressure;
- live-provider blocking for mandatory stages under hard budget pressure;
- no-regression tests for degraded fallback and readiness flows.

## Truth-First Implementation Status

### Implemented now

- stage-aware routing;
- request token targets and hard ceilings;
- per-stage token and USD targets;
- context compaction with token estimates;
- stage-specific compaction of mission-understanding payloads before planning;
- exact-fingerprint reuse within the same run;
- optional-stage suppression under pressure;
- live-provider blocking for mandatory stages, including `mission_understanding`, when the live request is outside current budget posture;
- structured observability for governance decisions;
- operator-safe governance summary.

### Partially implemented now

- downgrade only becomes materially cheaper when `utility_structuring` is configured to a genuinely cheaper live model;
- USD governance before call depends on pricing metadata being configured;
- per-stage governance is enforced in memory for the active runtime, not persisted across restarts.

### Deferred

- per-operator, per-project, and per-day persisted budgets;
- semantic near-duplicate detection;
- cross-run persisted cache;
- more advanced quality-aware summarization beyond the current stable field compaction;
- release-grade multi-user operational governance beyond the current local runtime posture.
