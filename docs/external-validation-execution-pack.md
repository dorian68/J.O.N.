# External Validation Execution Pack

## Statut

Operator-grade Windows-first execution pack.

This document is the exact handoff for the remaining external/manual proofs. It assumes the repo has already reached a stronger local build and now needs target-machine evidence.

## Recommended execution order

### 1. Run the automated local orchestration

```powershell
npm test
npm run readiness:execute
```

Expected outputs:

- `app/.runtime-data/release/pilot-prepare-latest.json`
- `app/.runtime-data/release/pilot-validate-latest.json`
- `app/.runtime-data/release/pilot-summary-latest.json`
- `app/.runtime-data/release/readiness-report-latest.json`

### 2. Configure Windows secret storage for the live provider

```powershell
$env:COWORK_OPENAI_API_KEY = "<runtime-only-key>"
npm run secret:llm -- set --value-env COWORK_OPENAI_API_KEY
Remove-Item Env:COWORK_OPENAI_API_KEY
npm run secret:llm -- status
npm run secret:llm:smoke
```

Pass criteria:

- `secret:llm:smoke` returns `"status": "pass"`
- `app/.runtime-data/release/secret-store-smoke-latest.json` exists

### 3. Run the live LLM proof sequence

```powershell
$env:COWORK_LLM_PROVIDER_MODE = "openai"
$env:COWORK_LLM_ALLOW_MOCK_FALLBACK = "0"
$env:COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK = "1"
$env:COWORK_LLM_REQUIRE_OS_SECRET_STORE = "1"
$env:COWORK_OPENAI_PROVIDER_LABEL = "OpenAI"
$env:COWORK_OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:COWORK_OPENAI_PRIMARY_MODEL = "<available-model>"
npm run llm:smoke -- live-success
npm run llm:smoke -- provider-unavailable
npm run llm:smoke -- runtime-degraded
```

Pass criteria:

- `live-success` returns `"status": "pass"`
- `live-success.json` shows `providerAlias=openai_compatible`, `providerModel=gpt-4.1-mini` or the configured live model, `secretSource=os_secret_store`, and `fallbackChain=[]`
- `provider-unavailable` returns `"status": "pass"`
- `runtime-degraded` returns `"status": "pass"`
- `app/.runtime-data/logs/llm-runtime.jsonl` contains the matching live-success request record

### 4. Validate the desktop shell locally on the operator machine

```powershell
npm run desktop:dry-run
npm run desktop:smoke
npm run desktop:bundle
npm run desktop:dev
```

Pass criteria:

- `desktop:dry-run` reports a loopback-only `operatorBaseUrl`
- `dist/desktop-shell/desktop-shell-manifest.json` exists
- `dist/desktop-shell-smoke/desktop-shell-manifest.json` exists
- the shell opens the existing operator surface without adding business behavior

### 5. Run the bounded real-surface validations

Prepare:

```powershell
npm run validation:real:prepare
```

Create or update the local runtime selector first:

```powershell
@'
{
  "research": {
    "mode": "allowlisted_real_web",
    "targets": [
      {
        "title": "Example Dot Com",
        "url": "https://example.com/",
        "fieldMap": {
          "companyName": { "css": "h1" }
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
'@ | Set-Content -Path app/.runtime-data/validation/real-surfaces/real-surface-runtime.local.json
```

Rules:

- `allowlisted_real_web` must use explicit `https` targets and must not point to loopback hosts
- `real_local_window` must match one explicit local window rule such as `titleIncludes` or `handleEquals`
- fixture mode remains valid for tests, but does not justify recording the real-surface scenarios as `pass`

Then execute and record each scenario:

```powershell
npm run validation:real:record -- --scenario live_llm_provider_smoke --result <pass|partial|fail|blocked> --notes "<note>" --log-path app/.runtime-data/logs/llm-runtime.jsonl
npm run validation:real:record -- --scenario desktop_shell_local_smoke --result <pass|partial|fail|blocked> --notes "<note>"
npm run validation:real:record -- --scenario bounded_real_web_research --result <pass|partial|fail|blocked> --notes "<note>" --run-id <run_id> --artifact-id <artifact_id> --evidence-id <evidence_id> --llm-call-id <llm_call_id> --reasoning-snapshot-id <snapshot_id> --log-path app/.runtime-data/logs/llm-runtime.jsonl
npm run validation:real:record -- --scenario bounded_local_window_observation --result <pass|partial|fail|blocked> --notes "<note>" --run-id <run_id> --evidence-id <evidence_id> --log-path app/.runtime-data/logs/llm-runtime.jsonl
```

### 6. Compile the final summary

```powershell
npm run validation:real:summary
npm run readiness:report
npm run pilot:summary
```

Outputs to inspect:

- `app/.runtime-data/validation/real-surfaces/validation-summary-latest.json`
- `app/.runtime-data/release/readiness-report-latest.json`
- `app/.runtime-data/release/pilot-summary-latest.md`

## Upgrade rubric

### Upgrades to `pilot-credible local build`

Only if all are true:

- tests pass
- desktop bundle, smoke, and dry-run proofs exist
- secret-store smoke is `pass`
- `live-success`, `provider-unavailable`, and `runtime-degraded` are all `pass`
- validation summary is `all_passed`
- readiness report current level becomes `pilot-credible-local-build`

### Upgrades to `production-candidate`

Not justified by this pack alone.

Still required beyond this repo:

- stronger native packaging/distribution posture
- external release validation
- broader production governance

### Still blocks `production-ready`

- all production-candidate blockers above
- real operations/release proof
- production security/release governance

## Truth-first rule

No pilot or production claim is valid unless the stored artifacts, logs, validation records, and readiness report all support it.
