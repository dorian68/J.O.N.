# LLM Production Path Gap Note

## Statut

Truth-first implementation note.

Ce document ne redessine pas la cible. Il capture l'ecart reel entre le prototype actuel et un chemin LLM plus operable.

Documents lies :
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- [implementation-vs-docs-traceability-matrix.md](./implementation-vs-docs-traceability-matrix.md)
- [release-gate-v1.md](./release-gate-v1.md)

## 1. What already existed before this lot

- internal gateway contract existed in code ;
- prompt registry and versioned prompt assets existed ;
- mock/offline provider existed ;
- OpenAI-compatible provider adapter existed ;
- LLM call records were persisted and reviewable in the operator UI ;
- runtime already used the LLM path for plan generation and decision-note drafting.

## 2. What was still missing

- strict runtime config validation ;
- explicit budget policy ;
- rate-limit-aware and circuit-breaker-aware behavior ;
- real degraded mode beyond a nominal mock fallback ;
- structured operational logs separate from artifact persistence ;
- explicit gateway status showing config issues and effective mode ;
- tests proving timeout, rate-limit, fallback and degraded behavior ;
- clear documentary alignment between the code and the LLM runtime/provider docs.

## 3. What is implemented now

- runtime config parsing and validation for provider mode, budgets, retries, cooldowns and timeout ;
- live provider path remains gateway-governed and backend-only ;
- secrets stay runtime-only and are not exposed in UI, persistence or artifact metadata ;
- gateway enforces retry, fallback and circuit-breaker-style skips ;
- budget exhaustion can skip the live provider and degrade to the bounded deterministic path ;
- structured LLM logs are written as metadata-first JSONL runtime logs ;
- runtime events now expose request id, fallback use, degraded mode activation and failure category ;
- operator UI exposes effective LLM mode, config issues and richer call review ;
- deterministic fallback is now real for the bounded prototype call types when the live path is unavailable ;
- tests cover config validation, retries, rate limits, budget fallback and runtime degraded mode.

## 4. What is explicitly deferred

- keychain / OS secret-store integration ;
- managed external gateway or same-origin relay deployment topology ;
- project-level LLM overrides beyond the bounded runtime config ;
- production-grade quota governance across multiple users or multiple machines ;
- full prompt-family expansion for evaluator / compression / vision roles ;
- proof on real provider traffic in this repository's test environment ;
- pilot-grade real-surface validation.

## 5. Immediate consequence

After this lot, the codebase is materially closer to the canonical LLM strategy, but not production-ready.

It now has :
- a real live-provider path,
- explicit failure policy,
- explicit degraded behavior,
- and better operational traceability.

It still lacks :
- deployment posture,
- real provider operational proof,
- real-surface pilot validation,
- and stronger security / release hardening.
