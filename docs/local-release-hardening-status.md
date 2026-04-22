# Local Release Hardening Status

## Statut

Implementation reality document.

This document captures the local, repo-feasible hardening now present after the latest implementation lot, with a Windows-first pilot posture.

## What exists now

### 1. OS-backed local secret-store integration

The repository now contains a Windows DPAPI-backed local secret-store path for the live provider key, with explicit fallback to env-only mode when unavailable.

Current implementation:

- `app/src/security/os-secret-store.js`
- `app/src/security/windows-dpapi-secret-store.ps1`
- `app/src/llm/resolve-runtime-env.js`
- `app/src/scripts/manage-llm-secret.js`
- `app/src/scripts/run-secret-store-smoke.js`

### 2. Runtime log redaction

Structured runtime logging now sanitizes common secret-bearing keys and values before writing JSONL logs.

Current implementation:

- `app/src/security/redaction.js`
- `app/src/observability/structured-logger.js`

### 3. Release doctor

A local release doctor now checks:

- LLM runtime config visibility
- secret source visibility
- prompt registry loadability
- desktop shell local-only foundation
- bounded real-surface validation pack presence
- local retention defaults

Current command:

- `npm run release:doctor`

### 4. Readiness report

The repository now generates a machine-readable readiness report combining:

- doctor status
- bounded validation summary
- evidence-based readiness classification

Current command:

- `npm run readiness:report`

The classifier now distinguishes at least:

- `prototype-aligned`
- `stronger-local-build`
- `pilot-credible-local-build`
- `production-candidate`
- `production-ready`

Only evidence can upgrade the build.

### 5. Unified pilot orchestration

The repository now includes an operator-facing pilot orchestration layer:

- `npm run pilot:prepare`
- `npm run pilot:validate`
- `npm run pilot:summary`
- `npm run readiness:execute`

These commands prepare the local bundle, run repo-feasible checks, compile remaining manual steps, and regenerate the readiness summary.

### 6. Runtime prune

A bounded prune command now exists for log/smoke/validation artifacts:

- `npm run runtime:prune -- --days <n>`

This is intentionally narrow. It does not delete runs, evidence, or artifacts from the main persisted prototype state.

### 7. Safer server error exposure

The operator server no longer exposes stack details in API responses by default.

Debug details are only exposed if `COWORK_DEBUG_ERRORS=1`.

## What remains deferred

Still not solved locally in-repo:

- signed native packaging and update policy
- deployment discipline
- pilot or production operational governance
- non-Windows OS secret-store parity

## Truth-first conclusion

The repository now has meaningful local hardening, evidence persistence, and a tighter Windows-first pilot handoff.

It now justifies a stronger local build classification when the stored proofs are green.

It still does not justify pilot or production claims without the external validation pack being executed on the target machine.
