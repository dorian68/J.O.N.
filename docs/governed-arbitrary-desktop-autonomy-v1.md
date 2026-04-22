# Governed Arbitrary Desktop Autonomy V1

## Status

Canonical product and implementation contract for the current move from fixed desktop scenarios toward broad desktop autonomy.

## Product Decision

Cowork should not be incapable by design. It should be capable of broad desktop work, with the freedom level controlled by operator settings.

The correct posture is therefore:

- broad capability surface;
- explicit autonomy profile;
- policy review for every primitive;
- approval gates based on risk and configuration;
- hard non-bypassable blocks for credentials, payments, secret exfiltration and security bypass;
- full action/evidence audit.

This is not stealth automation and not an ungoverned remote-control agent.

## Autonomy Levels

### `supervised`

Default posture. Cowork can observe, plan, launch apps, type, click, scroll, send allowed hotkeys and capture evidence, but most actuation requires approval. Destructive and sensitive external actions are blocked.

### `expanded`

Allows broader planning and low-risk auto-approval. Sensitive actions such as submit/send/publish/install can be proposed only as explicitly approved actions. Destructive actions remain blocked.

### `operator_trusted`

Allows low- and medium-risk primitives to auto-proceed when approval policy also permits it. Skill overrides can be proposed with policy review. Destructive actions may be approval-gated when the operator explicitly configures that mode.

### `maximum_governed`

Broadest governed mode. The planner may propose any currently implemented desktop primitive across discovered apps/windows, including skill overrides and coordinate clicks. High-risk primitives still require approval. Credentials, payment, security bypass and secret exfiltration remain blocked.

## Configurable Surface

The admin console exposes:

- autonomy level;
- max planned steps;
- low/medium risk auto-approval;
- high-risk confirmation;
- skill override;
- text input, hotkeys, clicks, scroll and capture toggles;
- coordinate click permission;
- system hotkey permission;
- sensitive action mode: `block` or `confirm`;
- destructive action mode: `block` or `confirm`;
- approval modes by action category.

## Runtime Enforcement

The desktop planner receives the effective sandbox/autonomy policy. It can plan broadly when the operator chooses a broader level, but it must still emit structured primitives with risk labels and verification goals.

The executor then evaluates every primitive through `assessDesktopStep` before execution. The evaluator may:

- allow without approval;
- require approval;
- block;
- force checkpoint evidence.

Every executed primitive remains part of the run evidence and action log.

## Hard Floor

These remain blocked in the current implementation:

- credential entry;
- payment or checkout flows;
- security bypass or privilege escalation;
- secret exfiltration;
- stealth/background automation.

The purpose is not to make Cowork weak. The purpose is to prevent a broad-control desktop agent from becoming unreviewable or unsafe.

## Current Implementation Status

Implemented now:

- persisted autonomy settings in `agent.configuration.v1`;
- admin UI for autonomy level and primitive controls;
- planner sandbox enriched with autonomy policy;
- desktop primitive policy that respects autonomy level;
- configurable handling of destructive/sensitive actions;
- low/medium auto-approval support under trusted profiles;
- governed file primitives for list/read/create/write/copy/rename/move/delete;
- rollback manifests and backups for file mutations;
- hard blocks for credentials, payments and security bypass;
- tests for default blocking, maximum governed approval, and trusted auto-approval.

Still not complete:

- production-grade file conflict resolution and automatic rollback execution UI;
- app-specific deep skills;
- production-grade OCR/vision target selection;
- rollback for every destructive action;
- long-running autonomous loops across arbitrary apps;
- signed production packaging.
