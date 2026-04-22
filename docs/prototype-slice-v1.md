# Prototype Slice V1

## Statut

Decision document. This file closes the scope of the first real prototype and replaces broad prototype interpretations with a single buildable slice.

Related documents:
- [vision-produit-cowork.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/vision-produit-cowork.md)
- [prototype-boundary-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/prototype-boundary-v1.md)
- [browser-control-spec.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-spec.md)
- [computer-control-spec.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/computer-control-spec.md)
- [computer-control-prototype-reassessment.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/computer-control-prototype-reassessment.md)
- [browser-control-prototype-gate.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-prototype-gate.md)
- [artifact-quality-rubrics-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/artifact-quality-rubrics-v1.md)
- [operator-approval-ux-contract.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/operator-approval-ux-contract.md)
- [benchmark-review-protocol-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/benchmark-review-protocol-v1.md)
- [multi-agent-reassessment.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/multi-agent-reassessment.md)
- [agent-roles-and-responsibilities-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/agent-roles-and-responsibilities-v1.md)

## Objective of the prototype

The first prototype exists to prove one thing only:

The product can execute a supervised browser-first mission end-to-end, on controlled surfaces, with browser control as the primary path and bounded computer control as an evidence and context layer, and return a usable artifact with traceable evidence and trustworthy approvals.

The prototype does not exist to prove general autonomy, multi-agent orchestration, or production readiness.

## Decision summary

### Closed decisions

- Prototype shape: `desktop coworker`, not chat, not CLI-only tool.
- Agent model: `single supervised agent` with explicit internalized verification, policy, and artifact-review roles.
- Core execution mode: `browser-first`, `DOM-first`.
- Control scope: browser control primary, bounded `computer control` foundation included. No general desktop/computer control, but one bounded browser-launch desktop step is now authorized.
- Browser surfaces for first build: controlled fixtures and controlled sandbox pages only.
- Computer surfaces for first build: controlled windows and controlled local sandbox surfaces only.
- Final artifact required: `Note de decision`.
- Intermediate artifact required: `Tableau de collecte navigateur`.
- Approval model: safe-by-default, explicit approvals for any meaningful write intent.
- Persistence model: local-first, minimal, restart-safe for runs and evidence manifests.
- Internal demo authorization requires benchmark passage on a strict minimum set.

### Explicit non-decisions

- Electron vs Tauri is not blocking for the prototype slice itself.
- Exact future cloud sync strategy is not blocking before prototype.
- No separate verifier or critic agent is retained in V1.
- A future read-only shadow verifier remains a post-prototype option only.

## Value demonstrated by the prototype

If successful, the prototype demonstrates all of the following:

- a user can create a project, launch a mission, and understand what the agent is doing;
- the agent can browse multiple pages, inspect the DOM, navigate between tabs, scroll, extract relevant information, and handle simple blockers;
- the system can qualify the active local window, focus an allowlisted local surface when required, and capture visible evidence without falling back to opaque desktop automation;
- the system can stop before engaging actions and request approval with enough context;
- the system can produce a final artifact that is useful, traceable, and reviewable;
- the run can be reopened after interruption with enough persisted state to remain intelligible.

If one of these properties is missing, the prototype has not validated the right slice.

## Thin but real slice

### Minimal user journey to validate

The prototype must validate one complete operator journey:

1. The operator creates or opens a project.
2. The operator configures one mission on an allowlisted browser surface.
3. The system generates a visible plan.
4. The agent opens a browser session, navigates across two to four pages, and collects relevant evidence.
5. If needed, the system qualifies the active local window, focuses an allowlisted surface, and captures visible evidence tied to the run.
6. The agent may perform a limited editable action on a controlled form surface, but must stop before submission.
7. The operator approves or refuses write-intent actions.
8. The agent verifies intermediate outcomes.
9. The system produces:
   - a `Tableau de collecte navigateur`
   - a `Note de decision`
10. The operator reviews artifacts, sources, approvals, and evidence.
11. The operator exports the final artifact or re-runs the mission.

This is the only mandatory prototype journey.

## Capabilities included

### Agent model

- Single supervised agent.
- Internal role separation for outcome verification, policy checks, and artifact review.
- Visible run lifecycle.
- Visible plan before meaningful execution.
- Typed runtime events and auditable state transitions.

### Browser control V1 exact scope

Included browser primitives:

- `open_browser_session`
- `list_targets`
- `open_tab`
- `focus_tab`
- `close_tab`
- `navigate`
- `wait_for_page_state`
- `capture_dom_snapshot`
- `query_dom`
- `resolve_interactive_elements`
- `inspect_element`
- `scroll_viewport`
- `scroll_into_view`
- `click_element`
- `focus_element`
- `type_text`
- `clear_and_type`
- `select_option`
- `toggle_checkbox`
- `detect_blockers`
- `handle_modal`
- `verify_outcome`
- `export_page_evidence`

Included browser patterns:

- structured information reading;
- multi-tab comparison;
- long-page reading with scrolling;
- partial form preparation without submission;
- blocker detection and stop-or-ask behavior.

### Computer control V1 exact scope

Included computer-control primitives:

- `detect_active_window`
- `list_visible_windows`
- `focus_window`
- `capture_window`
- `capture_region`
- `inspect_visible_ui`
- `wait_for_ui_state`
- `verify_visible_outcome`
- `export_action_evidence`
- `detect_blocking_overlay`
- `launch_supported_browser_after_explicit_approval`

Included computer-control patterns:

- active-window qualification on controlled local surfaces;
- explicit focus shift to an allowlisted window;
- visible-state confirmation tied to run evidence;
- stop behavior on unexpected or non-allowlisted desktop context.
- bounded local browser launch with explicit approval and visible-window verification.

### Artifact scope

Required artifacts:

- `Tableau de collecte navigateur`
  - intermediate, operator-visible;
  - contains collected facts, page references, status, and evidence links.
- `Note de decision`
  - final artifact;
  - summarizes context, findings, recommendation, uncertainties, and cited sources.

### Approval scope

Included approval categories:

- typing or replacing text in an editable field;
- selecting or toggling values that change form state;
- handling a modal when the modal has consent, preference, or state-change implications;
- navigation to a domain not already allowlisted for the run;
- focusing a local window when the context switch is meaningful for the run.

### Persistence scope

The prototype must persist enough local state to survive restart with intelligible run context:

- project metadata;
- run metadata and status;
- plan snapshot;
- source references;
- approval records;
- typed events;
- artifact metadata and files;
- selected browser evidence manifests;
- selected computer-control evidence manifests.

## Capabilities excluded

### Out of scope for the prototype

- Multi-agent execution.
- Separate verifier agent or critic agent.
- External production platforms as primary test surfaces.
- Login orchestration and credential entry.
- Attach-to-existing browser session.
- File upload.
- File download workflows beyond evidence export controlled by the prototype.
- Frames and iframes as required first-slice capability.
- Rich text editors.
- Submission, publication, send, delete, or irreversible actions.
- Mass actions of any kind.
- Stealth behavior, anti-detection tactics, CAPTCHA bypass.
- Background scheduling, teams, cron, or autonomous re-execution.
- Generalized pointer or keyboard-based desktop automation.
- Generalized local application launching from arbitrary user text.
- Desktop click, drag, keyboard input, hotkeys, and native dialog handling.

### Important nuance

The prototype may include fixture coverage for some excluded capabilities in documentation or benchmark planning, but they are not part of the first development slice and cannot be used to claim prototype success.

## Exact prototype scenarios

### Scenario A: Browser reading and decision artifact

Required.

The agent reads multiple controlled pages, compares information, and produces a `Note de decision` backed by a `Tableau de collecte navigateur`.

This is the primary success path.

### Scenario B: Partial form preparation without submission

Required.

The agent navigates on a controlled sandbox page, identifies the correct fields, requests approval for write-intent actions, fills or updates fields, verifies field state, and stops before submission.

This scenario exists to validate the write boundary and approval UX, not to demonstrate end-task completion on external platforms.

### Scenario C: Controlled window awareness and visible evidence

Required.

The system detects the active local window, shifts focus to an allowlisted controlled surface when needed, captures visible evidence, waits for an expected UI state, and verifies the visible outcome without performing generalized local actuation.

## Prototype success criteria

The prototype is considered successful only if all conditions below are met:

- the complete user journey can be executed on controlled browser fixtures without manual intervention inside the browser itself;
- the computer-control support path can qualify and evidence the correct local surface on controlled desktop fixtures;
- the agent uses DOM-first strategies and does not rely on opaque timing hacks as its primary mechanism;
- the agent does not replace a valid DOM path with opportunistic computer control;
- approvals appear only when required, with enough context to make a decision;
- refusal paths are handled cleanly and do not corrupt the run;
- the final `Note de decision` is useful according to [artifact-quality-rubrics-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/artifact-quality-rubrics-v1.md);
- the `Tableau de collecte navigateur` remains traceable to source pages and evidence;
- the run remains intelligible after restart;
- the mandatory benchmark set passes according to [benchmark-review-protocol-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/benchmark-review-protocol-v1.md).

## Prototype kill conditions

The prototype should be stopped or re-scoped if one of the following happens:

- browser control only works on overly clean fixtures and fails on realistic controlled pages;
- approval UX requires operator intervention so often that the run becomes slower than manual execution without providing trust;
- the bounded computer-control layer becomes the dominant execution path instead of a support layer;
- the prototype needs submission or external-platform workflows to appear useful;
- artifacts are formally generated but fail human usefulness review;
- persistence is implemented ad hoc in a way that stores excessive sensitive data by default;
- success can only be shown via hand-picked demos instead of benchmark-backed runs.

## Definition of a successful prototype

A successful prototype is:

- narrow;
- benchmark-backed;
- honest about what it can and cannot do;
- useful on controlled browser tasks with bounded local-context awareness;
- auditable enough to diagnose why it succeeded or failed;
- safe enough that a reviewer would trust continued iteration.

## Definition of a misleading prototype

A misleading prototype is one that:

- relies on one curated demo path instead of a repeatable benchmark set;
- appears autonomous only because approvals, errors, or evidence are hidden;
- uses unsupported external platforms as the main proof of value;
- claims browser automation quality while skipping outcome verification;
- produces a polished artifact whose provenance cannot be checked.

## Dependencies

The prototype depends on:

- the browser control scope defined in [browser-control-spec.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-spec.md);
- the computer control scope defined in [computer-control-spec.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/computer-control-spec.md);
- the DOM-first selection strategy defined in [browser-control-dom-strategy.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-dom-strategy.md);
- the browser/computer boundary defined in [computer-control-vs-browser-control-boundary.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/computer-control-vs-browser-control-boundary.md);
- the approval contract defined in [operator-approval-ux-contract.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/operator-approval-ux-contract.md);
- the local-state decisions defined in [persistence-and-local-state-decisions.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/persistence-and-local-state-decisions.md);
- the fixture plan defined in [browser-control-test-fixtures-plan.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-test-fixtures-plan.md);
- the benchmark pack defined in [browser-control-benchmark-pack-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-benchmark-pack-v1.md);
- the computer-control benchmark pack defined in [computer-control-benchmark-pack-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/computer-control-benchmark-pack-v1.md).

## Risks accepted for prototype

- UI polish may remain limited.
- Some operator review steps may still feel mechanical.
- Scope is intentionally narrower than the eventual product promise.
- Browser capabilities stop before the most commercially tempting actions.
- Computer control is observation- and focus-oriented only.

These are acceptable prototype debts.

## Risks not accepted for prototype

- hidden unsupported actions;
- unsafe default permissions;
- missing audit trail for approvals and evidence;
- inability to explain why a browser action failed;
- inability to explain why a local window qualification or focus change failed;
- broad uncontrolled persistence of sensitive browser or desktop evidence.

## Minimum benchmark gate before internal demo

Before any internal demo that claims the prototype is working, the prototype must pass all of the following benchmark families:

- reading and synthesis on controlled pages;
- multi-tab navigation and comparison;
- multi-page collection into a structured intermediate artifact;
- partial form preparation without submission;
- outcome verification and evidence export;
- refusal or blocker handling on a disallowed action path.
- active-window detection and allowlisted focus handling;
- visible-state waiting and local outcome verification.

If one of these families is not benchmarked, the demo is not authorized as a prototype demonstration. It is only an exploratory build.

## Final decision

This slice is sufficiently closed for prototype development.

Residual open questions remain for MVP and production, but they are not blocking before the first prototype as long as the prototype stays inside the scope defined in this document.

Multi-agent reassessment note:

The prototype remains `mono-agent supervisé` after explicit reassessment. The change is not to the agentic boundary, but to the execution boundary itself: one acting agent, several explicit runtime control roles, browser control as primary path, and bounded computer control as an official but subordinate part of the prototype.
