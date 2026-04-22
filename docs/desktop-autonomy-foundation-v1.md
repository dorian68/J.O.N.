# Desktop Autonomy Foundation V1

## Statut

Canonical implementation contract.

## Goal

Move the product from fixed desktop scenarios toward governed general desktop autonomy.

The user may express a natural desktop mission. The agent may discover local capabilities, plan a short sequence of desktop primitives, request approvals, execute, verify and persist proof.

This is not unbounded machine control.

## Current implementation

The repository now implements a first `desktop_autonomy` path inside the existing `computer_observation` frame.

Implemented now:

- installed application discovery
- visible window discovery
- active window detection
- governed application launch
- governed text input
- governed hotkey input
- governed click point
- governed scroll
- window capture
- governed file listing, text read, create, write, copy, rename, move and delete primitives
- rollback manifests and backups for file mutations
- before/after proof
- action log
- verification summary
- accessibility tree extraction when available
- perception snapshots after primitives
- basic recovery to the active window when the explicit target becomes unavailable
- token/cost observability through the existing LLM gateway

The execution remains run-centric and approval-aware.

## Configurable autonomy update

The desktop autonomy layer now supports operator-selectable autonomy profiles:

- `supervised`
- `expanded`
- `operator_trusted`
- `maximum_governed`

These profiles make the system more capable without removing governance. They tune max planned steps, low/medium risk auto-approval, skill override, coordinate click permission, sensitive action handling, and destructive action handling.

The broadest profile is still `maximum_governed`, not ungoverned. Credentials, payment/checkout, security bypass, secret exfiltration and stealth behavior remain non-bypassable blocks.

See [governed-arbitrary-desktop-autonomy-v1.md](./governed-arbitrary-desktop-autonomy-v1.md).

## Agentic planning

Desktop autonomy uses a dedicated structured LLM stage:

- `desktop_plan`

Input:

- natural mission
- mission understanding output
- installed applications
- visible windows
- active window

Output:

- mission summary
- selected application
- clarification need
- ordered primitive steps
- verification goals
- unsupported requests
- safety notes

The fallback path is deterministic and conservative, but the intended decision center is the LLM stage.

## Authorized primitives

Current primitives:

- `observe_windows`
- `launch_application`
- `focus_window`
- `type_text`
- `send_hotkey`
- `click_point`
- `scroll_window`
- `capture_window`
- `list_directory`
- `read_text_file`
- `create_text_file`
- `write_text_file`
- `copy_path`
- `rename_path`
- `move_path`
- `delete_path`
- `stop`

Each primitive is executed one at a time and recorded.

## Approval policy

Auto-approved:

- window/app observation
- capture as evidence when scoped to the current run

Approval required:

- application launch
- text input
- hotkeys
- clicks
- scrolling
- focus changes when target context is ambiguous or sensitive

Still blocked:

- credential, payment, security bypass and secret exfiltration flows
- submit/send/publish/install/delete flows unless the operator switches the governed autonomy profile and corresponding action mode to explicit confirmation
- credential entry
- arbitrary background automation
- stealth behavior
- bypassing system or app security

## Verification

Every desktop autonomy run must persist:

- initial visible windows
- active window before action
- accessibility snapshot before action when available
- desktop plan
- action log
- perception after each primitive when available
- active/visible state after action
- accessibility snapshot after action when available
- final capture when possible
- verification summary

The run should fail rather than claim success when verification cannot be produced.

## Difference from prior browser-only slice

Before this foundation, the desktop path primarily supported:

- browser launch
- browser search launch
- browser-window capture
- allowlisted window observation

Now it can plan and execute a short sequence over discovered local applications through governed desktop primitives.

## Current limitations

- This is a foundation, not production-ready arbitrary autonomy.
- UI Automation / accessibility tree integration is not yet complete.
- OCR/vision grounding is not yet complete.
- App-specific skills are not yet implemented.
- Robust recovery from arbitrary UI divergence is still limited.
- Dangerous actions remain blocked by design.

## Next required maturity step

The next step is `desktop perception and recovery`:

- accessibility tree extraction
- OCR/vision fallback
- semantic element targeting
- action retry/recovery
- richer verification per app and per primitive
