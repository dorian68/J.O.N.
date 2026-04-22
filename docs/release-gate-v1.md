# Release Gate V1

## Statut

Release decision document for the currently authorized prototype slice.

This gate does not answer whether the product is ready in general.

It answers whether the current implementation can be treated as:

- internally reviewable,
- internally demoable,
- slice-complete,
- pilot-ready,

without overstating what the code actually proves.

## Gate vocabulary

- `green`: must be true
- `yellow`: acceptable only if openly disclosed and kept outside stronger release claims
- `red`: incompatible with the targeted readiness level

## Gate target for this review

Primary target:

- `internal disciplined demo of the authorized prototype slice`

This gate is not a pilot gate and not a production gate.

Current evidence-based local classification:

- `stronger local build`

## What must be green

### Scope and safety

- No out-of-scope capabilities added
- Browser-first / DOM-first posture preserved
- No stealth, no sensitive-platform dependence, no irreversible actions

Status:

- `green`

### Core code health

- test suite passes
- no evidence of uncontrolled scope expansion in implementation

Status:

- `green`

Observed evidence:

- `npm test` passes

### Authorized browser slice

- controlled research flow implemented
- bounded form-preparation flow implemented
- tabs, DOM inspection, blockers, refusal path, outcome verification and evidence export present

Status:

- `green`

### Bounded computer slice

- active-window qualification exists
- allowlisted focus exists
- visible evidence path exists
- bounded computer gating suite passes

Status:

- `green`

### Operator review surface

- projects and runs visible
- lifecycle state visible
- approvals visible and actionable
- sources, evidence, artifacts, LLM calls and benchmark reports visible

Status:

- `green`

### Approval contract

- approvals explicit
- action type, risk, reason, expected effect and refusal consequence visible
- decision history persisted

Status:

- `green`

### Persistence minimization

- restart-safe local state exists
- no cookies, tokens or broad raw browser session persistence found
- bounded cleanup / deletion exists

Status:

- `green`

### Artifact rubric closure

- collection artifact renders source reference and evidence reference
- decision note renders confidence and validation state

Status:

- `green`

### Benchmark review closure

- benchmark assertions are structured
- human review classification flow exists in-product
- refusal path is benchmarked

Status:

- `green`

### LLM runtime path for the prototype

- provider usage is gateway-governed
- prompt versions are traceable
- live-provider config is validated
- fallback and degraded mode are explicit
- the bounded deterministic experience remains usable when live LLM is unavailable

Status:

- `green`

### Contextual reasoning path

- relevant LLM stages use narrowed reasoning context
- reasoning snapshots are persisted and reviewable
- evaluation support and ambiguity note generation remain bounded

Status:

- `green`

## What may remain yellow for an internal demo

### Local live provider proof

- the live-provider path now has a recorded local `live-success` proof
- the proof uses `openai_compatible` with `gpt-4.1-mini`
- the proof resolves the key from the Windows OS-backed secret store
- the proof shows an empty fallback chain

Status:

- `green`

Interpretation:

- acceptable as local proof for the stronger-local-build posture
- still not sufficient for pilot claims without bounded real-surface execution

### Real Windows provider diagnostic

- the bounded real provider path exists
- but its proof remains environment-dependent

Status:

- `yellow`

Interpretation:

- acceptable for internal demo if presented as environment-dependent
- not acceptable if the demo claims generalized real-desktop readiness

### Desktop shell productization

- the product now has a thin local desktop shell foundation
- plus a local wrapper bundle build path
- but it is not yet a signed or distributed desktop product posture

Status:

- `yellow`

Interpretation:

- acceptable for internal demo of the slice
- not acceptable for pilot or production claims

### Bounded real-surface validation execution

- the repository now contains an explicit bounded validation harness and manual traceability pack
- the repository can also compile a machine-readable validation summary
- but this review does not claim completed real-surface execution

Status:

- `yellow`

Interpretation:

- acceptable for internal demo if no real-surface success is overstated
- not acceptable for pilot claims

## What cannot remain red

For the internal demo target, the following areas cannot be red:

- browser gating benchmarks
- bounded computer gating benchmarks
- scope/safety posture
- approval visibility
- run/evidence/artifact/LLM review visibility
- persistence minimization and cleanup
- LLM degraded-mode correctness

Current status:

- no `red` item in these categories

## What is currently red for stronger readiness tiers

### Pilot gate red items

- desktop shell remains foundation-only
- bounded real-surface validation is not yet executed
- stronger secret-store posture is not yet proven on the target operator machine
- no real-provider proof in a pilot environment yet
- broader context / memory / skills layer still partial beyond the current reasoning layer

### Production gate red items

- all pilot blockers above
- no production packaging / release posture
- no production-grade security hardening
- no production-grade operational governance for real providers

## Final gate verdict

### Internal disciplined demo

- `pass`

Conditions:

1. present the slice as a bounded prototype, not as a pilot
2. do not claim real-provider or real-desktop validation beyond what the environment actually proved

### Slice completion claim

- `pass`

Interpretation:

- the authorized slice is now closed enough to be treated as complete
- this does not imply pilot or production readiness

### Pilot gate

- `fail`

### Production gate

- `fail`

### Stronger local build

- `pass`

Interpretation:

- tests, desktop bundle posture, shell smoke, dry-run proof, secret-store smoke proof, live-provider proof, provider-unavailable smoke, and runtime-degraded smoke are now present
- this is stronger than a mere prototype-aligned code drop
- it still falls short of pilot because bounded real-surface execution is not yet fully green
