# Capability Intelligence V2 Implementation

## Status

Implemented repo contract for the current capability intelligence lot.

## What Changed

JON now has a stronger capability intelligence layer:

- versioned skill manifests for built-in and user-defined draft skills;
- explanatory capability ranking policy `capability-ranking-v2`;
- operator feedback records for good, bad and expected capability choices;
- ranking simulation API for admin/debug use;
- admin capability cockpit with filters, drill-down and feedback actions;
- MCP-like external tool descriptor normalization into governed capability nodes.

## Truth-First Boundary

This lot does not make JON a production-grade arbitrary desktop controller.

It improves how JON knows, ranks and explains available capabilities. It also prepares the skill and MCP extension paths. Execution remains governed by the existing planner, policy engine, approvals, executor and evidence system.

## Skill Manifest Model

Each skill manifest carries:

- identity and version;
- category and surface kind;
- implementation status;
- capability depth;
- operational description;
- affordances;
- primitives;
- inputs and outputs;
- policy hooks;
- evidence hooks;
- rollback support;
- known limits.

Built-in foundation skills are now `operational_deep` graph skills when they pass the repository deep-skill validation harness. The current built-in operational-deep set covers Explorer, Notepad, Browser, App Launch & Switch, Review/Verify/Capture, Clipboard & Transfer, Terminal Guarded and Forms Basic.

User-defined skills are saved as `draft` manifests and must not be treated as executable until a validation harness promotes them.

`operational_deep` is a repo contract status, not a production claim. It means the skill has supported workflows, state detectors, semantic targets, verifiers, recovery strategies and evidence requirements. It still requires real scenario evidence before claiming broad production reliability.

At product level, JON now has an operational-deep readiness report. This treats `operational_deep` as an implementation maturity state for the whole cowork system, not as a user-facing autonomy setting:

```bash
npm run operational:deep:report
```

The report separates implementation contract from field proof.

## Ranking V2

`capability-ranking-v2` scores each node from:

- mission relevance;
- keyword match;
- node kind boost;
- operator/runtime feedback;
- risk, approval and rollback adjustment.

The ranking explanation is included in prompt compaction and admin simulation output. The LLM can use the ranking, but ranking cannot authorize execution.

## Operator Feedback

Operator feedback can mark a capability as:

- `operator_positive`;
- `operator_negative`;
- `expected_selection`.

This feedback is local, lightweight and bounded. It is not learned ranking and not online model training.

## MCP-Like Provider Normalization

External MCP-like tool descriptors can be normalized with:

- server provenance;
- trust level;
- tool name and schema;
- inferred risk;
- approval requirement;
- policy hooks;
- expected evidence;
- known limits.

Complete MCP server lifecycle remains deferred:

- server config UX;
- discovery/refresh transport;
- invocation;
- trust onboarding;
- conflict resolution UI;
- health checks.

## Admin Capability Cockpit

The admin panel now supports:

- search and filters;
- skill manifest review;
- mission ranking simulation;
- ranking score breakdown;
- capability feedback actions;
- user-defined skill draft persistence.

This is intentionally an operator/debug cockpit, not a user-facing chat surface.

## Remaining Gaps

- No learned ranking model.
- No contextual bandit or offline preference learner.
- No automatic activation of user-defined skills.
- No complete external MCP runtime.
- No long real-user desktop validation harness for every deep skill.
- Foundation skills are deep-contract skills, not broad app-specific expert skills: clipboard has no arbitrary clipboard-read primitive, terminal work is visible and approval-gated, and form submission remains policy-controlled.
- No production-grade arbitrary desktop autonomy.

## Next Recommended Lot

Build a skill validation harness:

1. dry-run skill manifest validation;
2. required test scenarios per skill;
3. evidence hook checks;
4. promotion from `draft` to `validated`;
5. planner injection only for validated operational skills.
