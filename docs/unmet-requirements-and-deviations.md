# Unmet Requirements And Deviations

## Statut

Release review document.

This file lists what remains incomplete after comparing the current implementation against the canonical documentation.

Severity vocabulary:

- `low`: visible gap, but not dangerous for the current internal demo posture
- `medium`: limits confidence, operability, or release claims
- `high`: blocks the next readiness tier

## Non-blocking for the authorized slice demo

### 1. Real-provider proof remains environment-dependent beyond local proof

- Description: the live LLM path is now proven locally on a Windows-first machine with OS-backed secret resolution, but that proof still depends on the target operator environment and is not a CI/offline proof.
- Source document: [llm-provider-strategy.md](./llm-provider-strategy.md), [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- Status: partially covered
- Severity: low
- Recommended action: validate the same path against a real provider in a bounded pilot environment, not inside the prototype-only test harness.

### 2. Thin desktop shell exists but remains unproductized

- Description: the repo now has a thin local desktop shell foundation plus a local bundle posture, but not a signed/distributed desktop product posture.
- Source document: [architecture-cible.md](./architecture-cible.md), [development-roadmap-v1.md](./development-roadmap-v1.md)
- Status: partially covered
- Severity: low
- Recommended action: keep the wrapper thin for now, and defer packaging/distribution hardening to a later productization lot.

### 3. OS-backed secret store remains platform-dependent

- Description: a Windows DPAPI-backed local secret-store path now exists and local smoke proof exists, but it remains platform-dependent and still needs target-machine proof before supporting stronger readiness claims.
- Source document: [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- Status: partially covered
- Severity: low
- Recommended action: validate the secret-store path on the target operator machine and use it as the preferred live-provider key source there.

## Blocking for pilot

### 1. Desktop shell remains foundation-plus-bundle, not full productization

- Description: the product target remains `desktop-first`. A thin shell foundation and local wrapper bundle now exist, but desktop productization is still not complete.
- Source document: [architecture-cible.md](./architecture-cible.md), [development-roadmap-v1.md](./development-roadmap-v1.md)
- Status: partially covered
- Severity: high
- Recommended action: keep the current foundation thin, and delay packaging, update policy, and installable product concerns until after bounded real-surface proof.

### 2. Bounded real-surface validation is prepared but not executed

- Description: the repo now contains a bounded validation harness and explicit scenario pack, but no real-world bounded validation result is claimed here.
- Source document: [browser-control-spec.md](./browser-control-spec.md), [computer-control-spec.md](./computer-control-spec.md), [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- Status: partially covered
- Severity: high
- Recommended action: execute the harness on explicitly allowlisted, low-risk real surfaces without widening feature scope.

### 3. Secrets posture is improved but not fully closed

- Description: provider secrets can now resolve from a Windows DPAPI-backed local secret store, but the stronger posture is still platform-dependent and not yet pilot-proven on target machines with a real live-provider path.
- Source document: [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- Status: partially covered
- Severity: high
- Recommended action: use the OS-backed secret-store path on the target operator machine and validate it there before treating the live provider path as pilot-ready.

### 4. Context / memory / skills layer remains limited

- Description: the repo now has a real contextual reasoning layer, but broader project memory and explicit skill activation remain only partially materialized.
- Source document: [context-memory-skills.md](./context-memory-skills.md), [architecture-cible.md](./architecture-cible.md)
- Status: partially covered
- Severity: high
- Recommended action: extend only after bounded real-surface proof demonstrates where the current reasoning layer still falls short.

## Blocking for production

### 1. Current validation surface remains prototype-oriented

- Description: the implementation is still anchored to a controlled prototype slice and not to a production validation perimeter.
- Source document: [final-launch-decision.md](./final-launch-decision.md), [prototype-slice-v1.md](./prototype-slice-v1.md)
- Status: intentionally incomplete for production
- Severity: high
- Recommended action: do not discuss production readiness until pilot validation on bounded real surfaces is complete.

### 2. Release, packaging, and operational posture are not closed

- Description: the codebase has no production packaging, deployment discipline, desktop update policy, or ops runbook.
- Source document: [architecture-cible.md](./architecture-cible.md), [development-guidelines-v1.md](./development-guidelines-v1.md)
- Status: not covered
- Severity: high
- Recommended action: treat this as a distinct productization lot after the thin desktop shell exists.

### 3. Security hardening is still prototype-level

- Description: the threat model and restrictive policies are present, but production-grade hardening is still missing for secret storage, retention/redaction policy enforcement, and operational security review.
- Source document: [threat-model.md](./threat-model.md), [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md), [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- Status: partially covered
- Severity: high
- Recommended action: harden secrets, retention, redaction, and release security before any production claim.

### 4. Real-provider cost and quota governance are local only

- Description: budgets, retries and degraded mode exist inside the runtime, but not yet in a multi-user or release-operational posture.
- Source document: [llm-provider-strategy.md](./llm-provider-strategy.md), [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- Status: partially covered
- Severity: high
- Recommended action: expand from local runtime controls to release-grade operational governance only after pilot proof.

### 5. Workspace browser surface — agent + approval integration partielle

- Description: WorkspaceBrowserProvider est implémenté et branché à operator-service. La primitive `open_workspace_browser` est disponible. L'intégration approval-engine pour URLs hors allowlist n'est pas encore branchée sur WorkspaceBrowserProvider.
- Source document: [workspace-browser-v1.md](./workspace-browser-v1.md)
- Status: partially covered
- Severity: low
- Recommended action: brancher WorkspaceBrowserProvider.navigate sur PolicyEngine pour les URLs hors allowlist dans V2.

### 6. Mobile companion — WebRTC et push notifications natifs hors scope V1

- Description: la mobile gateway V1 (pairing, session, events SSE, commands, PWA) est implémentée. WebRTC screen streaming et push notifications natives (VAPID) sont hors scope V1.
- Source document: [mobile-companion-v1.md](./mobile-companion-v1.md), [remote-control-security-model-v1.md](./remote-control-security-model-v1.md)
- Status: partially covered
- Severity: low
- Recommended action: implémenter WebRTC en V2 après validation du modèle de pairing V1 en conditions réelles.

## Summary

### What is materially complete enough now

- the authorized prototype slice
- a `stronger local build` posture for Windows-first operator use
- the bounded operator review loop
- explicit approvals and cleanup
- browser/control evidence path
- LLM gateway with live-provider contract, fallback policy, and deterministic degraded mode
- contextual reasoning plus bounded evaluator support
- thin desktop shell foundation
- local desktop shell bundle scaffolding
- bounded real-surface validation harness
- validation summary compiler
- local log redaction, retention prune, and release doctor

### What blocks pilot

- bounded real-surface validation not yet executed to `all_passed`
- desktop shell GUI validation not yet recorded on the target operator machine
- partial broader context / memory / skills materialization

### What blocks production

- all pilot blockers above
- no production packaging or release posture
- no production-grade security hardening
- no production-grade real-provider operational proof
