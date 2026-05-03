# Implementation Vs Docs Traceability Matrix

## Statut

Release review document.

This file maps the current implementation to the canonical documentation set and makes the current compliance level explicit.

Status vocabulary:

- `covered`: implemented and materially validated
- `partially covered`: implemented in substance but still incomplete, weakly validated, or still environment-dependent
- `not covered`: required by the corpus, absent in the implementation
- `deferred`: intentionally postponed and not claimed as complete

Primary source documents:

- [final-launch-decision.md](./final-launch-decision.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)

## Matrix

| Area | Source document | Requirement / decision | Status | Implementation files | Tests / benchmarks | Notes / reservations |
| --- | --- | --- | --- | --- | --- | --- |
| Prototype shape | `prototype-slice-v1.md` | Single supervised agent, no second autonomous verifier | covered | `app/src/runtime/prototype-agent.js`, `app/src/runtime/create-prototype-runtime.js` | `npm test` | The retained model remains mono-agent with internalized checks only. |
| Scope discipline | `final-launch-decision.md` | No login, upload, submit, publish, send, delete, rich editors, generalized desktop actuation | covered | `app/src/runtime/prototype-agent.js`, `app/src/policy/policy-engine.js`, `app/src/service/operator-service.js` | `npm test`; benchmark suites | No out-of-scope feature was added. |
| Browser-first / DOM-first | `prototype-slice-v1.md`, `browser-control-spec.md`, `browser-control-dom-strategy.md` | Browser-first, DOM-first on controlled surfaces | covered | `app/src/browser/browser-controller.js`, `app/src/browser/dom-strategy.js`, `app/src/runtime/prototype-agent.js` | `browser-benchmarks` | Controlled fixtures only, as required by the authorized slice. |
| Browser primitives V1 | `prototype-slice-v1.md`, `browser-control-primitives.md` | Tabs, navigation, wait, DOM query/inspect, scroll, click/focus/type/select/toggle, blocker handling, outcome verification, evidence export | covered | `app/src/browser/browser-controller.js`, `app/src/browser/dom-strategy.js` | `browser-benchmarks` | Covered only on the controlled fixture families. |
| Controlled browser scenarios | `prototype-slice-v1.md` | Research flow and partial form preparation without submission | covered | `app/src/runtime/prototype-agent.js`, `app/src/service/operator-service.js`, `app/src/fixtures/fixture-server.js` | `browser-benchmarks`, `operator-service.test.js` | Both prototype browser scenarios remain reviewable from the operator surface. |
| Bounded computer control scope | `computer-control-prototype-reassessment.md`, `prototype-slice-v1.md` | Observation, allowlisted focus, capture, wait, verify, evidence only | covered | `app/src/computer/computer-control-service.js`, `app/src/computer/fake-window-provider.js`, `app/src/computer/powershell-window-provider.js` | `computer-benchmarks`, `computer-control-service.test.js` | The implementation stays inside the bounded slice. |
| Real Windows provider runtime path | `computer-control-spec.md`, `computer-control-benchmark-pack-v1.md` | Real provider should remain visible, diagnosable, and bounded | partially covered | `app/src/computer/powershell-window-provider.js`, `app/src/benchmarks/windows-provider-diagnostics.js`, `app/src/computer/windows-control.ps1` | `computer-benchmarks` | The bounded path is implemented and the async contract is fixed, but validation remains environment-dependent. |
| User and admin surfaces | `prototype-slice-v1.md`, `operator-ux-flows.md`, `mission-entry-contract-v1.md`, `user-and-admin-surfaces-v1.md` | Default landing must feel like a mission-first cowork surface while deeper supervision stays available on a secondary console | covered | `app/src/server/operator-server.js`, `app/src/service/operator-service.js`, `app/src/service/mission-entry.js`, `app/ui/index.html`, `app/ui/admin.html`, `app/ui/app.js`, `app/ui/styles.css` | `operator-server.test.js`, `operator-service.test.js`, `mission-entry.test.js` | `/` now serves the simplified user home and `/admin` serves the denser console. Diagnostics and shortcuts are no longer in the default first-run surface. |
| Approval UX contract | `operator-approval-ux-contract.md` | Explicit approvals with action type, risk, reason, expected effect, refusal consequence, traceability | covered | `app/src/policy/policy-engine.js`, `app/src/runtime/approval-broker.js`, `app/src/service/operator-service.js`, `app/ui/app.js` | `policy.test.js`, `operator-service.test.js`, `operator-server.test.js` | Payload quality matches the closed contract for the prototype slice. |
| Approval refusal / stop path | `operator-approval-ux-contract.md`, `browser-control-prototype-gate.md` | Refusal or stop should remain safe, intelligible, and benchmarked | covered | `app/src/runtime/approval-broker.js`, `app/src/runtime/create-prototype-runtime.js`, `app/src/benchmarks/browser-benchmarks.js` | `browser-benchmarks` | The refusal path is now explicitly benchmarked and reviewable. |
| Persistence minimization | `persistence-and-local-state-decisions.md` | Local-first, minimal, restart-safe, no cookies/tokens/secrets/raw browser session state by default | covered | `app/src/storage/database.js`, `app/src/config.js`, `app/src/runtime/prototype-agent.js` | `storage.test.js`; manual audit of `.runtime-data` | The persisted model stays within the required minimal objects. |
| Cleanup and deletion | `persistence-and-local-state-decisions.md` | Explicit deletion of runs, evidence, artifact revisions, projects, and temp state | covered | `app/src/service/operator-service.js`, `app/src/storage/database.js`, `app/src/utils/files.js` | `operator-cleanup.test.js`, `operator-service.test.js` | Cleanup is implemented and bounded to authorized local roots. |
| Run restart intelligibility | `persistence-and-local-state-decisions.md`, `prototype-slice-v1.md` | Run, approvals, events, sources, artifacts, evidence, and LLM calls remain intelligible after restart | covered | `app/src/storage/database.js`, `app/src/service/run-review-model.js`, `app/src/service/operator-service.js` | `storage.test.js`, `operator-service.test.js` | Run review stays readable after restart on the persisted local state. |
| Evidence linking model | `persistence-and-local-state-decisions.md`, `browser-control-observability.md` | Project/run/source/event/evidence/artifact links must be inspectable | covered | `app/src/service/run-review-model.js`, `app/src/storage/database.js`, `app/ui/app.js` | `operator-service.test.js` | Evidence is cross-linked to source, event, approval, artifact, and LLM call metadata where relevant. |
| Artifact class restriction | `prototype-slice-v1.md`, `artifact-quality-rubrics-v1.md` | Only `Tableau de collecte navigateur` and `Note de decision` are in scope | covered | `app/src/artifacts/builders.js`, `app/src/runtime/prototype-agent.js` | `artifact-builders.test.js`, `browser-benchmarks` | No out-of-scope artifact type is produced. |
| Collection artifact rubric | `artifact-quality-rubrics-v1.md` | Render source reference, fact, confidence, note, evidence link and traceability | covered | `app/src/artifacts/builders.js` | `artifact-builders.test.js`, `browser-benchmarks` | The rendered table now includes source reference and evidence reference explicitly. |
| Decision note rubric | `artifact-quality-rubrics-v1.md` | Mandatory sections plus confidence level and validation state in content | covered | `app/src/artifacts/builders.js` | `artifact-builders.test.js`, `browser-benchmarks` | The rendered note now includes confidence, validation state and traceability sections. |
| Fixture plan coverage | `browser-control-test-fixtures-plan.md`, `browser-control-prototype-gate.md` | Minimal fixture set should exist or be prepared | covered | `app/fixtures/browser/*`, `app/src/fixtures/fixture-server.js` | `browser-benchmarks` | The benchmarked families cover the authorized slice and refusal flow. |
| Benchmark gating families | `prototype-slice-v1.md`, `browser-control-prototype-gate.md` | Mandatory browser and bounded desktop families are covered | covered | `app/src/benchmarks/browser-benchmarks.js`, `app/src/benchmarks/computer-benchmarks.js`, `app/src/benchmarks/windows-provider-diagnostics.js` | `browser-benchmarks`, `computer-benchmarks` | The prototype gate families are materially implemented for the authorized slice. |
| Human benchmark review protocol | `benchmark-review-protocol-v1.md` | Benchmarks require automated assertions plus human review classification | covered | `app/src/service/benchmark-review-model.js`, `app/src/service/benchmark-service.js`, `app/ui/app.js` | `benchmark-review-model.test.js`, `benchmark-service.test.js` | The product now supports explicit review classification and persistence. |
| Security / policy posture | `final-launch-decision.md`, `permissions-trust-safety.md`, `threat-model.md` | Safe-by-default, no stealth, no credential harvesting, no mass automation | covered | `app/src/policy/policy-engine.js`, `app/src/runtime/prototype-agent.js`, `app/src/service/operator-service.js` | `policy.test.js`; manual audit | The implementation respects the restrictive interpretation of the launch decision. |
| LLM gateway topology | `llm-provider-strategy.md` | Provider usage must be gateway-governed and alias-based | covered | `app/src/llm/gateway.js`, `app/src/llm/create-default-llm-gateway.js`, `app/src/llm/providers/*` | `llm-gateway.test.js`, `llm-gateway-resilience.test.js` | No runtime/UI module calls the provider directly. |
| Prompt registry and versioning | `prompt-registry-and-versioning.md` | Versioned prompt assets, no inline opportunistic runtime prompts | covered | `app/src/llm/prompt-registry.js`, `app/prompts/*`, `app/src/runtime/prototype-agent.js` | `llm-prompt-registry.test.js`, `runtime-llm-integration.test.js` | Runtime calls reference prompt ids and versions only. |
| LLM runtime contract | `llm-runtime-contract.md` | LLM proposes, runtime validates, policy governs, tools verify | covered | `app/src/runtime/prototype-agent.js`, `app/src/llm/gateway.js` | `llm-gateway.test.js`, `runtime-llm-integration.test.js`, `runtime-llm-degraded-mode.test.js` | Structured outputs are validated and no LLM output bypasses policy or deterministic checks. |
| LLM degraded mode | `llm-provider-strategy.md`, `llm-runtime-contract.md` | Live-provider failure must degrade explicitly and keep the bounded prototype usable | covered | `app/src/llm/gateway.js`, `app/src/runtime/prototype-agent.js`, `app/src/llm/deterministic-fallbacks.js`, `app/ui/app.js` | `llm-gateway-resilience.test.js`, `runtime-llm-degraded-mode.test.js` | The slice now degrades visibly to mock or deterministic fallback without silent continuation. |
| Contextual reasoning layer | `llm-runtime-contract.md`, `context-memory-skills.md`, `runtime-agentique.md` | Context must be narrowed per reasoning stage and remain traceable | covered | `app/src/reasoning/*`, `app/src/runtime/prototype-agent.js`, `app/src/storage/database.js` | `reasoning-layer.test.js`, `reasoning-benchmarks.test.js`, `runtime-reasoning-integration.test.js` | Observations, guidelines, relationships, variables and persisted reasoning snapshots are now implemented for the authorized stages. |
| Mission understanding and routing | `vision-produit-cowork.md`, `runtime-agentique.md`, `mission-entry-contract-v1.md`, `mission-understanding-and-routing-v1.md` | Natural mission should be clarified into a bounded internal route, with verification goals and surfaced limits | covered | `app/src/mission/mission-understanding.js`, `app/src/service/mission-entry.js`, `app/src/runtime/prototype-agent.js`, `app/prompts/task.mission_understanding.1.0.0.json` | `mission-understanding.test.js`, `mission-entry.test.js`, `runtime-llm-integration.test.js`, `runtime-llm-degraded-mode.test.js` | The product still executes one bounded frame per run, but frame selection can now be inferred conservatively and is recorded as part of run understanding rather than left as an implicit UI requirement. |
| Internal evaluator support | `runtime-agentique.md`, `agent-supervision-and-evaluation-loop.md` | Evaluator remains bounded, traceable, and internal to the mono-agent runtime | covered | `app/src/reasoning/evaluator.js`, `app/src/runtime/prototype-agent.js`, `app/src/artifacts/builders.js` | `evaluator.test.js`, `runtime-reasoning-integration.test.js`, `runtime-llm-degraded-mode.test.js` | Evaluation support and ambiguity note generation are integrated without adding a second autonomous agent. |
| Runtime-only secrets posture | `llm-secrets-costs-and-observability.md` | Provider secrets stay backend-only and out of persistence/UI | partially covered | `app/src/llm/runtime-config.js`, `app/src/llm/resolve-runtime-env.js`, `app/src/security/os-secret-store.js`, `app/src/llm/providers/openai-compatible-provider.js` | `llm-runtime-config.test.js`, `os-secret-store.test.js`, `secret:llm:smoke` | A Windows DPAPI-backed local secret-store path now exists, but the stronger posture is still OS-dependent and not yet pilot-proven. |
| LLM budgets, retries, circuit breaking, observability | `llm-provider-strategy.md`, `llm-secrets-costs-and-observability.md` | Explicit budgets, retry/fallback policy, structured logs, normalized error categories | covered | `app/src/llm/runtime-config.js`, `app/src/llm/gateway.js`, `app/src/observability/structured-logger.js` | `llm-runtime-config.test.js`, `llm-gateway-resilience.test.js` | Implemented at runtime scope; not yet proven under real provider traffic. |
| Target architecture desktop shell | `architecture-cible.md`, `development-roadmap-v1.md` | Product-first desktop shell / UI layer | partially covered | `desktop/shell-foundation.mjs`, `desktop/launch-shell.mjs`, `desktop/build-shell-bundle.mjs`, `desktop/smoke-shell-bundle.mjs`, `package.json`, `app/src/scripts/start-operator-server.js` | `desktop-shell-foundation.test.js`, `desktop-bundle.test.js`; `npm run desktop:dry-run`; `npm run desktop:smoke` | A thin shell plus a local bundle path now exist, but native packaging/signing/distribution are still deferred. |
| Bounded real-surface validation harness | `development-roadmap-v1.md`, `release-gate-v1.md`, `browser-control-spec.md`, `computer-control-spec.md` | Real-surface validation must become explicit, reviewable, and traceable | partially covered | `app/src/validation/*`, `app/src/scripts/prepare-real-surface-validation.js`, `app/src/scripts/record-real-surface-validation.js`, `app/src/scripts/compile-real-surface-validation-summary.js` | `real-surface-validation.test.js`, `real-surface-summary.test.js`; `npm run validation:real:prepare`; `npm run validation:real:summary` | The harness now records real bounded passes locally, but the broader release posture still remains below production and the latest readiness classifier is not yet at a higher tier. |
| Local release/security hardening | `threat-model.md`, `llm-secrets-costs-and-observability.md`, `development-guidelines-v1.md` | Repo-feasible hardening should tighten logs, server error exposure, retention, and release self-checks | partially covered | `app/src/security/redaction.js`, `app/src/security/os-secret-store.js`, `app/src/observability/runtime-retention.js`, `app/src/release/release-doctor.js`, `app/src/release/readiness-report.js`, `app/src/server/operator-server.js` | `redaction.test.js`, `runtime-retention.test.js`, `release-doctor.test.js`, `readiness-report.test.js`; `npm run release:doctor`; `npm run readiness:report` | Meaningful local hardening now exists, including a machine-readable readiness report, but pilot/prod posture still depends on external proof and packaging discipline. |
| Context / memory / skills layer | `context-memory-skills.md`, `architecture-cible.md` | Just-in-time context shaping, structured run/project memory, skill traceability | partially covered | `app/src/reasoning/*`, `app/src/runtime/prototype-agent.js`, `app/src/storage/database.js`, `app/src/llm/prompt-registry.js` | `reasoning-layer.test.js`, `reasoning-benchmarks.test.js`, `runtime-reasoning-integration.test.js` | The just-in-time context layer now exists for the authorized stages, but explicit skill activation and broader project memory remain limited. |
| Workspace browser surface | `workspace-browser-v1.md` | BROWSER_MODE, BrowserSessionTracker, WorkspaceBrowserProvider, SSE events, DB persistence, UI panel, agent primitive | partially covered | `app/src/browser/browser-mode.js`, `app/src/browser/workspace-browser-provider.js`, `app/src/browser/browser-controller.js`, `app/src/storage/database.js`, `app/src/service/operator-service.js`, `app/src/server/operator-server.js`, `app/ui/src/main.jsx`, `app/ui/styles.css` | `browser-mode.test.js` | Implémenté V1. Approval-engine hookup pour URLs hors allowlist reporté V2. |
| Token dashboard | `operator-token-dashboard-v1.md` | Session + run token usage live, color-coded, status bar | covered | `app/src/service/operator-service.js`, `app/src/server/operator-server.js`, `app/ui/src/main.jsx`, `app/ui/styles.css` | `operator-service.test.js` | Status bar 1.5rem en bas du workspace, couleur green/amber/red selon budget. |
| Workspace CLI orchestration | `workspace-ai-cli-orchestration-v1.md` | launch_workspace_cli primitive, CliTerminalSupervisor, PtyTerminalSupervisor, terminal panel | partially covered | `app/src/workspace/cli-terminal-supervisor.js`, `app/src/workspace/pty-terminal-supervisor.js`, `app/src/runtime/prototype-agent.js`, `app/ui/src/main.jsx` | `cli-terminal-supervisor.test.js`, `workspace-terminal-orchestration.test.js` | Terminaux lancés et supervisés. PTY intégré. conversationId non propagé mid-run (gap connu). |
| Mobile companion gateway | `mobile-companion-v1.md`, `remote-control-security-model-v1.md` | Pairing, session token, mobile event stream, mobile commands, PWA, terminal alerts, screen preview | partially covered | `app/src/mobile/mobile-device-registry.js`, `app/src/mobile/mobile-gateway.js`, `app/src/mobile/mobile-event-stream.js`, `app/src/server/operator-server.js`, `app/ui/mobile/` | `mobile-gateway.test.js` | V1 LAN + SSE + PWA implémentés. WebRTC, push natif, relay hors-LAN reportés V2. |

## Summary

### Strongly covered

- authorized slice scope and safety
- browser-first controlled execution
- bounded computer-control observation path
- operator review surface
- approvals, evidence, artifacts and cleanup
- LLM gateway contract, prompt registry, degraded mode and metadata-first observability
- contextual reasoning snapshots and bounded evaluator support
- explicit mission understanding with routing and verification goals

### Still partial or deferred

- real-provider validation under real traffic
- desktop shell productization beyond the thin foundation
- bounded real-surface validation execution
- broader context / memory / skills layer beyond the current reasoning layer
- stronger secret-store and operational hardening beyond env-based local runtime config

### Release interpretation

The implementation now respects the canonical prototype corpus materially and is much closer to the canonical LLM strategy than before.

It should still be described as:

- `slice complete`
- `internally demoable`
- `credible local cowork pilot surface, but still below production posture`
- `not production ready`
