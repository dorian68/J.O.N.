# Bounded Real-Surface Validation Harness

## Statut

Implementation reality document.

This document describes the repo-side harness now present for bounded real-surface validation.

It does not claim that real-surface validation has already been completed.

## What exists now

The repository now contains:

- a bounded scenario catalog for real-surface validation
- a script that prepares a validation pack
- a script that records a validation outcome
- JSON output paths under `.runtime-data/validation/real-surfaces`

Main entry points:

- `npm run validation:real:prepare`
- `npm run validation:real:record -- --scenario <id> --result <pass|partial|fail|blocked>`
- `npm run validation:real:summary`

Runtime switching for the two bounded scenarios is controlled by:

- `app/.runtime-data/validation/real-surfaces/real-surface-runtime.local.json`
- or `COWORK_REAL_SURFACE_CONFIG_PATH`

## Current scenario families

The harness currently defines:

- `live_llm_provider_smoke`
- `desktop_shell_local_smoke`
- `bounded_real_web_research`
- `bounded_local_window_observation`

The runtime now supports two honest surface classes for these scenarios:

- `controlled_fixture`
- `allowlisted_real_web`

and two honest local-window classes:

- `controlled_fixture_window`
- `real_local_window`

Example runtime config:

```json
{
  "research": {
    "mode": "allowlisted_real_web",
    "targets": [
      {
        "title": "Example Dot Com",
        "url": "https://example.com/",
        "fieldMap": {
          "companyName": { "css": "h1" }
        },
        "staticValues": {
          "tagline": "Example Domain",
          "riskNote": "Read-only public page."
        }
      },
      {
        "title": "Example Dot Org",
        "url": "https://example.org/",
        "fieldMap": {
          "companyName": { "css": "h1" }
        }
      }
    ]
  },
  "computer": {
    "mode": "real_local_window",
    "windowMatch": {
      "titleIncludes": "PowerShell"
    }
  }
}
```

## What the pack contains

Each scenario captures:

- objective
- preconditions
- commands to run
- required artifacts
- required evidence
- required logs
- explicit pass criteria
- traceability template linking scenario, run, artifacts, evidence, logs, and reasoning outputs

## Why this matters

Before this harness, bounded real-surface validation remained a broad intention.

Now the repository contains a concrete local handoff mechanism that reduces ambiguity around:

- what exactly to validate
- what counts as proof
- which files to inspect
- how to record pass/fail honestly
- how to compile the currently recorded outcomes into one summary gate

## What remains unproven

This harness does not prove real-surface readiness by itself.

It still requires:

- operator execution on explicitly allowlisted surfaces
- manual review
- environment-dependent proof for real provider and real local surface scenarios

The repository can now also compile a machine-readable validation summary for the latest recorded outcomes.

## Truth-first conclusion

The repository now has a real bounded validation harness.

It does not yet have completed bounded real-surface validation results.
