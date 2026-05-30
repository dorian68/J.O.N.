# Mobile Control Surface v1

## Product Role

Mobile is a companion cockpit, not a compressed admin console.

It should let the user:

- send a natural instruction
- start a mission
- see what JON is doing
- approve or deny gated actions
- answer safe terminal prompts
- inspect results and proof at a glance
- stop a run
- directly remote-control the active JON browser surface when the user wants to take over

## Current Capabilities

Implemented surfaces:

- chat command dispatch
- mission start
- approval approve/deny
- run stop
- terminal prompt answer
- active surface screenshot request
- live run cards with compact Execution Thread
- browser remote control from mobile:
  - open/reuse the JON workspace browser
  - capture the current browser surface
  - tap screenshot coordinates to click
  - type text into the active browser focus
  - press safe keys
  - scroll, back, forward, reload
  - navigate to a URL through the existing browser allowlist policy

## Safety Boundaries

Mobile explicitly blocks:

- arbitrary terminal command execution
- file deletion
- software install
- secret access
- form submission
- server config modification
- script execution

Remote control is authenticated by the paired mobile session and every action is recorded in `mobile_audit_log` as `control.<action>`. It is disabled only when `COWORK_MOBILE_REMOTE_CONTROL=0`.

## Remaining Gaps

- There is no per-command biometric or second-factor confirmation yet.
- Mobile proof review is not yet rich enough for production use.
- Terminal input from mobile still needs stronger contextual safety UX.
- Full desktop input control is not exposed yet; V1 remote control targets the governed workspace browser surface first.
