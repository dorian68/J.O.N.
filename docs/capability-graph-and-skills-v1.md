# Capability Graph And Skills V1

## Status

Canonical implementation contract for Cowork's internal capability graph.

## Product Decision

Cowork should not let the LLM improvise tools from scratch, and it should not expose a raw MCP/tool catalog directly to the user.

The architecture is:

- MCP-like tool providers expose raw integrations and primitives.
- Adapters normalize these into the internal capability graph.
- The capability graph is the source of truth used by planning prompts.
- Skills describe reliable operating modes over atomic tools.
- Policy remains the final authority before execution.
- Executor performs actions.
- Verifier/evidence proves results.

## Current Scope

Implemented operational-deep built-in skills:

- `Explorer`: local folders/files, listing, reading, creating, writing, copying, renaming, moving and deleting with governance.
- `Notepad`: open a simple editor, type/draft text, capture proof, and use file text primitives where useful.
- `Browser`: open browser, search/navigate, scroll, click visible targets and capture proof.
- `App Launch & Switch`
- `Review, Verify & Capture`
- `Clipboard & Transfer`
- `Terminal Guarded`
- `Forms Basic`

These foundation skills now carry an `operational_deep` contract: supported workflows, state detectors, semantic targets, verifiers, recovery strategies and evidence requirements are defined and validated in-repo. Clipboard transfer still does not provide arbitrary clipboard read access; terminal work remains visible and approval-gated; forms stop before submit/publish unless separately authorized by policy.

Important boundary: `operational_deep` means the skill has a deep governed operating contract and passes the repository validation harness. It does not mean production-grade arbitrary desktop autonomy or proof across long real-user scenarios on every target machine.

Implemented node kinds:

- `skill`
- `tool`
- `surface`

Each capability node stores:

- app/surface or tool identity;
- associated skill;
- operational description;
- risk level;
- approval requirement;
- rollback availability;
- expected evidence;
- known limits;
- affordances;
- simple mission relevance scores.

## Persistence

The graph is persisted in SQLite in `capability_graph_nodes`.

Operator and learning memory are persisted separately:

- `capability_graph_overrides`: operator-edited or LLM-generated labels, descriptions, affordances and known limits.
- `capability_feedback_records`: selected capabilities, skill/tool candidates, execution outcomes, approvals, evidence and rollback counts.

The graph is refreshed from:

- detected local applications;
- detected browsers;
- desktop primitives;
- file primitives;
- built-in skill definitions;
- current autonomy settings.

External MCP-like tool descriptors can now be normalized into capability nodes with provenance, risk defaults, policy hooks and evidence expectations. This is a provider-normalization foundation, not yet a complete external MCP server lifecycle with discovery, trust onboarding and invocation.

Refresh preserves overrides and feedback. A machine scan can change the detected
surfaces, but it does not grant new authority; policy and approvals still decide
whether actions may execute.

## Reasoning Injection

The graph is injected compactly, not dumped raw:

- `conversation_turn` receives top relevant capabilities for the user message.
- `desktop_plan` receives top relevant capabilities for the mission.

This lets the LLM decide with awareness of real available tools without becoming the policy authority.

Feedback influences ranking modestly:

- successful/evidence-backed use slightly increases relevance;
- repeated failures or rollbacks slightly reduce relevance;
- this never overrides hard policy, approvals, or non-bypassable safety floors.

Ranking is now `capability-ranking-v2`:

- each ranked node includes an explanation with relevance, keyword, kind, feedback and risk/policy components;
- operator feedback can mark a capability as a good choice, bad choice or expected choice;
- feedback improves ranking modestly but cannot authorize execution;
- the admin console can run a mission ranking simulation and inspect the scoring breakdown.

The compact prompt view includes only the top relevant capabilities plus short
feedback summaries. It must not dump the full machine graph into every prompt.

## Admin Operations

The admin console exposes a bounded capability-management surface:

- manually scan the machine for available applications and browsers;
- inspect the normalized skills/tools/surfaces currently known to the planner;
- generate concise descriptions with the configured LLM provider;
- edit labels, descriptions, affordances and known limits manually;
- see basic feedback counts for capability usage.
- search/filter capabilities by kind, skill and risk;
- simulate ranking for a mission and record operator feedback;
- inspect skill manifests and save user-defined skill drafts.

Generated descriptions are treated as editable metadata only. They do not create
new tools, bypass policy, or expand desktop control permissions.

User-defined skill drafts are persisted as manifests and remain non-executable until a future validation harness promotes them. They do not bypass policy, do not grant primitives, and do not automatically enter the executable planner context.

## Operational Deep Validation

The repository includes a deterministic operational-deep validation harness. It checks:

- manifest schema;
- `operational_deep` status and depth;
- supported workflow coverage;
- primitive ownership for each workflow;
- policy hooks;
- evidence hooks and evidence requirements;
- verifier coverage;
- recovery strategy coverage.

The admin capability panel surfaces the deep validation status for built-in skills. Validation output intentionally includes `proofLevel: repo_contract_validated` and `productionProof: requires_real_scenario_evidence`.

## Current Limitations

- The relevance model is now explanatory weighted scoring with operator feedback, not learned ranking.
- Skills are explicit and governed; they are not mini-agents and do not bypass policy.
- The executable graph currently covers Explorer, Notepad, Browser, App Launch & Switch, Review/Verify/Capture, Clipboard & Transfer, Terminal Guarded and Forms Basic at `operational_deep` contract depth.
- Feedback is local and lightweight; it is not yet a full learned preference model.
- LLM-generated descriptions improve operator/planner clarity but do not prove an app-specific skill is reliable.
- Complete MCP server ingestion, stronger vision grounding, deep third-party app skills and long real-user multi-app validation remain future lots.
