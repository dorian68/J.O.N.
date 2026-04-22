# Minimal Desktop Shell Foundation

## Statut

Implementation reality document.

This document describes the current thin desktop shell foundation that now exists in the repository.

## What exists now

The repository now exposes a local shell wrapper through:

- `desktop/shell-foundation.mjs`
- `desktop/launch-shell.mjs`
- `desktop/build-shell-bundle.mjs`
- `desktop/smoke-shell-bundle.mjs`
- root scripts `desktop:dev` and `desktop:dry-run`
- root scripts `desktop:bundle` and `desktop:smoke`

This shell is intentionally thin and replaceable.

## Current shape

The implementation does not add new product logic.

It:

- launches or reuses the local operator server
- enforces a loopback-only operator URL
- resolves a local Edge/Chrome executable or an explicit `COWORK_DESKTOP_BROWSER_PATH`
- opens the mission-first user home on `/` by default
- keeps the denser review console available on `/admin`
- keeps runtime, policy, approvals, browser control, computer control, and persistence inside the existing local backend

## Safety boundary

The shell foundation currently enforces:

- loopback-only operator URL
- no remote shell target
- no new secret exposure path
- no new business logic in the shell wrapper

## What this is not

This is not yet:

- final packaged native productization
- installer/distribution work
- auto-update infrastructure
- keychain integration
- a final Electron/Tauri release posture

## Why this shape was chosen

For the current repository state, a browser app-mode wrapper is the thinnest credible local shell foundation.

It reduces ambiguity and keeps the wrapper replaceable while preserving the already-working local cowork surface and bounded review workspace.

## Local commands

- `npm run desktop:dry-run`
- `npm run desktop:dev`
- `npm run desktop:bundle`
- `npm run desktop:smoke`

`desktop:dry-run` is the safest verification path because it proves local-only URL handling and launch spec generation without opening a GUI window.

`desktop:bundle` now creates a local desktop-shell bundle layout under `dist/desktop-shell/` with:

- launcher scripts
- a bundle manifest
- a local product icon asset
- a minimal smoke/readme payload

The current bundle metadata now also declares:

- product display name `Cowork Desktop`
- window title `Cowork Desktop | Local pilot`
- support status `local_pilot_only`
- bundle variant `browser_app_wrapper`

This is still a local wrapper bundle, not a signed installable app.

## Remaining gap

The shell foundation now exists.

What still remains deferred is desktop productization and packaging discipline for stronger readiness tiers.
