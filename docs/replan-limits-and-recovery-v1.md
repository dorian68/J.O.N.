# Replan Limits and Recovery — v1

## Problem

Browser missions use dynamic replanning: after interactive steps (click, type, select), the planner may generate new steps based on what changed in the DOM/URL. Without limits, a bad replan loop could run indefinitely.

## Implemented Limits

**File:** `app/src/browser/browser-operator.js`

| Limit | Default | Config input key | Description |
|---|---|---|---|
| `maxReplans` | 2 | `input.maxBrowserReplans` | Max number of replan cycles per run |
| `maxSteps` | 60 | `input.maxBrowserSteps` | Max total steps executed before hard stop |

### Replan limit (`maxReplans`)

- Only triggered after interactive steps: `click`, `type`, `select`
- Only triggered when `selectReplanTriggerChange()` detects a significant browser state change
- Counter increments after each successful replan
- When `replanCount >= maxReplans`, the watcher change is consumed but replanning is skipped

### Step limit (`maxSteps`)

- Checked at the top of the `while (stepIdx < executionSteps.length)` loop
- If `stepIdx >= maxSteps`, the run is immediately set to `"failed"` status
- A `"max_steps_exceeded"` error is pushed to `execution.errors`
- A `browser.run_limit_exceeded` event is emitted with `reason`, `maxSteps`, and `stepsExecuted`

## Recovery Behavior

When a limit is reached:
- `execution.status = "failed"` (not "partial", not "completed")
- `execution.errors` contains the reason
- `SemanticOutcomeVerifier` will see `browser_fully_completed = false` and fail verification
- `nextBestAction` suggests retrying or replanning with a narrower scope
- The browser session is closed cleanly in `finally {}`

## Configuring Limits

Pass via `input` to `BrowserOperator.runMission()`:

```javascript
await operator.runMission({
  mission: "...",
  maxBrowserReplans: 3,   // allow more replans for complex tasks
  maxBrowserSteps: 40     // tighter step budget
});
```

Or set via `browserAutonomy` parameters in the mission spec.
