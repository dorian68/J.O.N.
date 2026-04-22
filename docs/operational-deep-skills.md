# Operational Deep Skills

## Status

Canonical contract for JON built-in skill depth.

## Definition

`operational_deep` means a built-in skill has a governed operating contract that is rich enough for the planner, executor and verifier to reason about it as a real capability.

For JON, `operational_deep` is not a user-facing autonomy parameter. It is a product implementation maturity level. The user can configure autonomy/approval strictness, but JON itself should be implemented as an operational-deep cowork: skills, planning, execution, verification and evidence must all be modeled deeply enough to be testable.

It requires:

- supported workflows;
- state detectors;
- semantic targets;
- verifiers;
- recovery strategies;
- evidence requirements;
- explicit policy hooks;
- explicit known failure modes;
- deterministic repository validation.

It does not mean unconstrained desktop control, hidden tool execution, or production proof across every target machine.

## Current Operational-Deep Skills

- `Explorer`: directory inspection, text artifacts, governed path mutation with rollback evidence.
- `Notepad`: launch/focus/type/capture, text artifact persistence, focus recovery.
- `Browser`: launch/search/navigate/capture, visible target interaction, navigation recovery.
- `App Launch & Switch`: app detection, launch verification, focus existing windows.
- `Review, Verify & Capture`: active-window capture, before/after proof, failure capture.
- `Clipboard & Transfer`: approved text transfer through visible UI primitives; no arbitrary clipboard read.
- `Terminal Guarded`: visible terminal staging/execution with approval and output capture.
- `Forms Basic`: approved field entry, field-state verification, stop before submit/publish.

## Validation Harness

The repository validation harness checks each built-in skill for:

- valid manifest schema;
- `operational_deep` implementation status and capability depth;
- workflow coverage;
- primitive ownership for every workflow;
- policy hooks;
- evidence hooks and evidence requirements;
- verifier coverage;
- recovery strategy coverage.

Validation output is intentionally truth-first:

- `proofLevel: repo_contract_validated`;
- `productionProof: requires_real_scenario_evidence`.

This prevents confusing a strong in-repo skill contract with full production reliability.

## Product-Level Operational Deep

The repo now also produces a product-level operational-deep readiness report:

```bash
npm run operational:deep:report
```

The report separates:

- `implementationStatus`: whether JON is implemented as an operational-deep system at contract level;
- `fieldProofStatus`: whether long real-surface evidence proves those contracts on target machines.

Expected current interpretation:

- `operational_deep_contract`: built-in foundation skills pass the deterministic deep-skill harness;
- `fieldProofStatus: partial` or `missing`: real long-scenario evidence is not yet complete enough for production reliability claims.

## Policy Boundary

Policy remains authoritative. The LLM can propose a skill, but it cannot authorize execution.

Sensitive actions still require policy review and approval where applicable:

- credential entry or extraction;
- payments or purchases;
- destructive file actions;
- hidden shell execution;
- form submit/publish;
- security bypass;
- stealth automation.

## Promotion Rules

A built-in skill can be labelled `operational_deep` only when it passes the repository harness.

A user-defined skill remains `draft` until a future promotion harness proves:

- schema validity;
- safe primitive set;
- policy hooks;
- evidence hooks;
- scenario coverage;
- verifier coverage;
- rollback or explicit no-rollback posture;
- operator approval for activation.

## Remaining Production Gap

The current harness proves the contract, not field reliability. Before production claims, JON still needs long real-user validation across target machines with screenshots, logs, evidence bundles and failure/recovery reports.
