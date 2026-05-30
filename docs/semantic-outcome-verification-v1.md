# Semantic Outcome Verification - v1

## Three Different Things

| Level | Meaning | Can complete run? |
|---|---|---|
| Step completed | A primitive returned without throwing. | No |
| Action verified | Post-action observation supports the expected local effect. | No |
| User objective satisfied | Mission-level verifier confirms objective, proof, alignment, artifacts, and blockers. | Yes |

## Hard Contract

`run.status = "completed"` is allowed only when:

- `SemanticOutcomeVerifier.verify().verifiedByOutcomes === true`
- required evidence exists
- requested screenshots/captures exist
- evidence aligns with the requested app/site/surface
- requested extraction/artifacts exist
- no unrecovered critical action failed
- no unresolved browser blocker remains
- no terminal is waiting/blocked/error
- no approval remains unresolved

## Critical Checks

Critical checks now include:

- `work_executed`
- `required_evidence_collected`
- `required_screenshot_captured`
- `desktop_screenshot_captured`
- `no_critical_failures`
- `browser_fully_completed`
- `browser_no_blockers`
- `browser_search_executed`
- `browser_requested_target_observed`
- `launch_primitive_executed`
- `type_primitive_executed`
- `requested_text_verified`
- `extraction_delivered`
- `required_artifact_exists`
- `evidence_aligned_with_mission`
- `no_failure_cascade`
- `no_terminal_blocker`

These checks are not advisory. If any fails, `verifiedByOutcomes=false` and the run must not complete.

## Failure Cascade Check — Adaptive Threshold (updated 2026-05-13)

The `no_failure_cascade` check was previously hardcoded to fail when `consecutiveFailures >= 3`. This created a bias: short missions (3-5 steps) were judged too harshly; long missions (20+ steps) were too lenient.

**New adaptive logic:**

```
cascadeThreshold = max(3, ceil(totalTrackedSteps × 0.25))
```

Fails if:
- `consecutiveFailures >= cascadeThreshold` (25% cascade ratio on any size mission)
- OR: `totalSteps >= 4 AND consecutiveFailures >= 3 AND consecutiveFailures >= 50% of total steps`

This means:
- 4-step mission with 3 consecutive failures → fails (75% cascade rate)
- 20-step mission with 3 consecutive failures → threshold is 5 → passes if isolated
- 20-step mission with 6+ consecutive failures → fails (30%+ cascade rate)

## Evidence Alignment

`EvidenceAlignmentGuard` compares mission target hints against evidence metadata:

- explicit target domains from URL/domain text
- target apps such as Notepad, Edge, Chrome, Firefox, terminal
- evidence URL/title/linked surface/storage path/metadata
- browser final URL/title
- desktop active window

Off-target evidence produces a failed `evidence_aligned_with_mission` check. Example: a mission targeting `nodejs.org` cannot complete with a screenshot from `example.com`.

## Output Shape

The verifier returns:

```js
{
  verifiedByOutcomes,
  objectiveSatisfied,
  verificationVerdict,
  confidence,
  evidenceUsed,
  missingEvidence,
  satisfiedOutcomes,
  unsatisfiedOutcomes,
  failureReason,
  nextBestAction,
  requiresUserInput,
  userQuestion,
  criticalBlockers,
  checks
}
```

## Implementation

- `app/src/runtime/semantic-outcome-verifier.js`
- `app/src/runtime/evidence-alignment-guard.js`
- central false-completion guard: `guardCompletedRunPatch` in `app/src/runtime/prototype-agent.js`
- tests: `semantic-outcome-verifier.test.js`, `evidence-alignment-guard.test.js`, `run-completion-guard.test.js`

The legacy research and form-preparation paths now record `semanticVerification` before they can complete. The runtime also has a central guard: if any path attempts `completed` without `semanticVerification.verifiedByOutcomes === true`, the patch is converted to `failed_false_completion_guard`.

Known gap: the verifier is still heuristic. It blocks many false completions, but it is not a substitute for deeper visual/DOM semantic understanding on every arbitrary desktop/browser surface.
