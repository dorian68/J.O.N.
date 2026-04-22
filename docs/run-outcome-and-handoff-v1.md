# Run Outcome And Handoff V1

## Statut

Canonical implementation contract.

## Goal

After a bounded run finishes, the product must not drop the user into raw logs, artifacts, and proof items without a clear product summary.

The cowork must restate:

- what was done in this run
- what was verified
- what was intentionally not done in this run
- what the best next bounded step is
- what can wait until later

## Current implementation

The repository now builds a product-facing outcome summary from the completed run review model.

This summary is derived from:

- `missionUnderstanding`
- persisted verification summary
- recorded artifact / proof / source counts
- run-level LLM usage

It is shown on both surfaces, with different emphasis:

- the user home shows the outcome as a mission-facing summary and handoff
- the admin console shows the same outcome with deeper audit and diagnostics around it

## What the outcome summary shows

The current outcome summary includes:

- clarified objective
- coverage status for the run that just executed
- what got done now
- what was verified
- what was not done in this run
- recommended next step
- optional later step
- result / proof / source counts
- run-level AI usage summary

## Handoff behavior

When `mission_understanding` produced a structured follow-up recommendation, the user can now:

- load the recommended next step into the mission composer
- immediately ask the cowork to review that next step

When the mission was launched with bounded auto-continuation enabled, the runtime may also:

- run a separate `run_handoff_decision` reasoning stage after the current run completes
- continue to exactly one recommended next bounded run when that decision says `continue_now`
- stop and ask for one short clarification when the next step can no longer start credibly

This keeps the product honest:

- one bounded run still executes at a time
- a future run may be suggested
- a future run may be started automatically only when the user opted in and the later handoff decision remains within the prepared bounded scope

## Boundary rules

- One bounded frame per run remains the hard rule.
- A recommended next step is not automatic execution unless the user explicitly enabled bounded auto-continuation.
- Even with auto-continuation enabled, only one next bounded run may start at a time.
- Approvals, degraded mode, token governance, and structured validation still apply to the next run.
- The handoff must remain traceable through the existing mission/preflight/run chain.

## Not introduced here

- fully autonomous multi-run execution
- hidden chaining of browser and computer capabilities
- chat-style freeform follow-up loops
