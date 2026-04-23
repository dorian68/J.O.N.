# Browser Control State Awareness v1

## Purpose

JON's browser operator must know enough about its controlled browser session to explain and verify a web run without exposing raw browser profile data, cookies, credentials, or stealth behavior.

This document defines the current minimum state model for governed browser navigation.

## Product Boundary

Browser control is allowed only on authorized surfaces and remains governed by policy, approvals, evidence, and run traces.

JON must not implement or recommend anti-bot bypass, fingerprint evasion, stealth spoofing, CAPTCHA avoidance, or hidden automation. If a site blocks automation, JON should record the blocker, explain it to the user, and request manual continuation or stop cleanly.

## Current State Model

The controlled browser layer tracks ephemeral session state:

- browser session id
- active target / tab id
- allowlisted hosts
- target count
- per-target URL and title
- active target marker
- loading state
- navigation history
- recent actions
- last action
- last result
- last error
- blocker state
- viewport state
- detected interactive element count
- last DOM snapshot summary

This state is kept in memory and attached to page evidence summaries. Raw browser session state is not persisted by default.

## Browser Capability Graph Contract

The capability graph exposes browser-specific primitives as governed tools attached to `skill.browser`:

- `browser.plan_mission`
- `browser.open_session`
- `browser.navigate`
- `browser.read_state`
- `browser.read_dom`
- `browser.query_interactive`
- `browser.click`
- `browser.type`
- `browser.select`
- `browser.wait_state`
- `browser.extract_text`
- `browser.detect_blockers`
- `browser.verify_outcome`
- `browser.capture_evidence`

These are planning and governance descriptors. They map to controlled Playwright/DOM-first operations in `BrowserController`; they are not raw CDP handles exposed directly to the model.

## Browser Planner v1 Contract

Browser Planner v1 turns a natural web mission into a validated bounded run plan before execution. It can use the live LLM through `task.browser_plan@1.0.0`; when the provider is unavailable or blocked by governance, it falls back to a deterministic conservative plan.

The validated plan contains:

- mission summary and intent type;
- start URL and explicit allowlisted hosts;
- ordered DOM-first steps;
- selectors and expected outcomes;
- blocker/manual-handoff rules;
- verification goals;
- expected evidence.

Allowed planner actions are deliberately narrow: open controlled session, navigate, wait, read state, read DOM, query targets, click, type, select, extract text, detect blockers, verify outcome, capture evidence, or stop for manual handoff.

The planner must not propose stealth, anti-bot bypass, fingerprint evasion, CAPTCHA solving, credential entry, payments, purchases, hidden automation, or secret exfiltration. Those conditions are blockers, not tasks to bypass.

## Minimum Web Run Definition

A credible governed web mission must:

- open or attach to a controlled browser session;
- keep navigation inside an allowlist unless policy approves expansion;
- know the active tab and current URL;
- wait for page state before interacting;
- inspect DOM-first when possible;
- detect ambiguous targets before clicking;
- record recent actions and results;
- capture page evidence;
- verify the requested outcome or stop with a clear failure reason.

## Interaction Architecture

The recommended strategy is:

- CDP / Playwright / DOM first for structured navigation, page reads, forms, target discovery, and evidence;
- accessibility and desktop UI automation as a fallback for native browser chrome or surfaces outside DOM reach;
- screenshot / vision / OCR as a verifier and recovery aid, not the primary action substrate;
- mouse/keyboard only for governed fallback actions where structured targeting is unavailable.

## Deferred

- external authenticated site proofs;
- robust recovery across arbitrary real websites;
- vision-first semantic targeting;
- long multi-site browser workflows;
- manual takeover/resume UX;
- production packaging and signed distribution.

## Phase Status

### Phase 1: State Awareness

Implemented:

- in-memory browser session state;
- active target state;
- navigation history;
- recent action trace;
- blocker state;
- browser state embedded into page evidence summaries.

### Phase 2: Capability Normalization

Implemented:

- browser primitives normalized into the capability graph;
- `skill.browser` updated to operational-deep DOM-first workflows;
- graph ranking can select browser DOM/read/extraction/capture capabilities.

### Phase 3: Browser Operator Runtime

Implemented for the controlled operator path:

- controlled research and form runs already use the browser controller;
- browser benchmark smoke proves DOM-first navigation, extraction, form preparation, refusal, blocker detection and verification;
- Browser Planner v1 composes a validated mission-to-web-step plan from LLM output or deterministic fallback;
- `BrowserOperator` executes Browser Planner v1 steps against `BrowserController` and returns step results, extracted data, blockers, browser state, and evidence.

### Phase 4: Production Validation

Partially implemented:

- `npm run smoke:browser-operator` records a controlled browser operator proof bundle;
- `npm run smoke:browser-planner` records a controlled Browser Planner v1 proof bundle;
- real external authorized-site validations, manual takeover/resume, packaging/signing, and long user tests remain external or future work.
