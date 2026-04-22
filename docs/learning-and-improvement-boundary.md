# Learning And Improvement Boundary

## Statut

Decision document. This file clarifies what “learning” or “auto-improvement” can mean for this project, and what remains out of scope for the prototype.

Related documents:
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)

## Why this document exists

“Auto-learning” is one of the fastest ways to create confusion in an agent project.

It can mean:

- benchmark-driven improvement ;
- runtime tuning ;
- policy refinement ;
- fixture expansion ;
- self-modifying behavior ;
- or uncontrolled online adaptation.

These are not equivalent.

## Decision summary

### Accepted for V1

- improvement through benchmarks and review ;
- improvement through fixtures and failure analysis ;
- improvement through documentation and policy updates ;
- later runtime adjustments made explicitly and versioned ;
- within-run adaptation limited to the current run.

### Not accepted for V1

- autonomous online learning across runs ;
- self-modifying global prompts or policies ;
- automatic broadening of permissions ;
- automatic selector memory promoted globally without review ;
- stealth adaptation against external platforms ;
- any hidden learning loop that changes behavior without explicit review.

## Accepted improvement loops

## 1. Improvement via benchmarks and review

Accepted.

This means:

- run benchmark ;
- inspect evidence ;
- classify result ;
- identify failure mode ;
- update runtime, fixture, policy or documentation later through explicit change.

This is the primary accepted improvement loop of the prototype.

## 2. Improvement via fixtures and failure analysis

Accepted.

This means:

- add or refine fixtures after observed failures ;
- make ambiguities more representative ;
- refine expected evidence ;
- use failures to strengthen validation surfaces.

This is part of product hardening, not online learning.

## 3. Adaptation of policy or documentation

Accepted, but only via explicit reviewed changes.

Examples:

- tightening approval wording ;
- changing what counts as ambiguous outcome ;
- clarifying domain restrictions ;
- improving artifact rubric.

The key rule is:

no silent behavior change.

## 4. Runtime adjustments later

Accepted, if explicit and versioned.

Examples:

- better DOM candidate ranking ;
- stronger outcome verification logic ;
- improved evidence selection ;
- refined retry heuristics.

Again, these are engineered changes, not autonomous learning.

## Within-run adaptation vs cross-run learning

### Within-run adaptation

Accepted.

Examples:

- after a failed click, select a better candidate in the same run ;
- after ambiguous outcome, request more evidence in the same run ;
- after partial page load, wait and retry in the same run.

This is normal runtime behavior.

### Cross-run autonomous learning

Not accepted in V1.

Examples rejected:

- storing successful selectors and automatically trusting them globally next time ;
- mutating policy because prior approvals were often granted ;
- changing artifact structure without explicit versioning ;
- remembering that a platform tolerated a workaround and reusing it automatically.

## Explicitly out of scope for V1

The following forms of “learning” are out of scope:

- model fine-tuning triggered by runtime data ;
- self-editing prompts ;
- self-editing tool policies ;
- self-editing browser strategies from production observations ;
- automatic trust escalation ;
- autonomous adaptation to anti-bot or CAPTCHA defenses.

## Why the boundary is strict

For this prototype, trust matters more than adaptivity.

An opaque system that “learns” silently can easily:

- change its targeting behavior without audit trail ;
- widen risk exposure ;
- make benchmarks incomparable over time ;
- hide regressions inside supposedly adaptive behavior.

## Accepted forms of prototype improvement

For this prototype, acceptable “learning/improvement” means only:

- explicit benchmark-driven iteration ;
- explicit fixture refinement ;
- explicit failure analysis ;
- explicit documentation updates ;
- explicit runtime revisions later.

## Rejected forms of prototype learning

Rejected in V1:

- online self-modification ;
- autonomous cross-run behavior mutation ;
- policy drift without review ;
- stealth improvement against external platforms ;
- global memory of browser workarounds promoted automatically.

## Final decision

The prototype may improve through review, benchmarks, fixtures and explicit engineering changes.

The prototype may not “learn” in the autonomous, cross-run, self-modifying sense.

This boundary is closed for V1.
