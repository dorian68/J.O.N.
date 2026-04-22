# Persistence And Local State Decisions

## Statut

Decision document. This file closes the minimum local persistence model required for the first `browser-first` prototype, including bounded `computer control` evidence.

Related documents:
- [workspaces-projets-artefacts.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/workspaces-projets-artefacts.md)
- [permissions-trust-safety.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/permissions-trust-safety.md)
- [browser-control-observability.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-observability.md)
- [prototype-slice-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/prototype-slice-v1.md)

## Objective

The goal of local persistence in the prototype is not completeness. It is controlled continuity.

The system must persist enough state to:

- reopen a project and understand what happened;
- inspect prior runs, approvals, artifacts, and selected evidence;
- recover gracefully from interruption;
- audit why a run succeeded, failed, paused, or was denied.

The system must not persist browser state so broadly that it becomes a silent sensitive-data cache.

## Closed decisions

- Persistence model for the prototype: `local-first`, minimal, explicit, restart-safe.
- Persistence unit of continuity: `project` and `run`.
- Persistence unit of review: `artifact`, `approval`, `source reference`, `evidence manifest`.
- Raw browser session state is not persisted by default.
- Raw desktop session state is not persisted by default.
- Secrets, credentials, cookies, and tokens are not persisted by default.
- Large raw DOM dumps are not persisted by default.
- Temporary extraction state is session-only unless promoted to selected evidence.

## Persistence objectives

The prototype must satisfy five persistence objectives:

1. Preserve run intelligibility after restart.
2. Preserve approval history and rationale.
3. Preserve artifact lineage to sources and evidence.
4. Minimize sensitive data retention.
5. Keep deletion and cleanup tractable.

## Local state model

### Objects that must be persisted

#### Workspace and project metadata

Persist:

- workspace id and project id;
- project name and description;
- allowed source domains for the project or run;
- project-level instructions relevant to the run;
- artifact inventory;
- run inventory.

Reason:

Without this state, restart continuity and operator navigation collapse.

#### Run metadata

Persist:

- run id;
- mission statement;
- run status;
- created / started / paused / completed timestamps;
- current lifecycle stage;
- summary of last stable step;
- plan snapshot used by the run.

Reason:

A resumed or reopened run must be intelligible without replaying the full runtime.

#### Typed event log

Persist:

- event id;
- event type;
- run id;
- timestamp;
- actor category;
- summary payload;
- reference pointers to evidence or approvals when relevant.

Reason:

The prototype must be auditable and diagnosable. The event log is the backbone of that property.

#### Approval records

Persist:

- approval id;
- approval category;
- requested action summary;
- target surface or domain;
- risk level;
- approval decision;
- operator rationale when provided;
- related evidence references;
- resulting action status.

Reason:

Approvals are core product behavior, not transient UI prompts.

#### Source references

Persist:

- source id;
- canonical page or file reference;
- title or label;
- acquisition context;
- trust classification;
- whether the source was actually used in the final artifact.

Reason:

Artifacts must remain traceable without requiring the system to store every raw source body.

#### Artifact metadata and files

Persist:

- artifact id;
- artifact type;
- artifact status;
- linked run id;
- linked source references;
- validation state;
- exportable file or content representation;
- revision lineage.

Reason:

Artifacts are first-class product outputs and must survive restart.

#### Evidence manifests

Persist:

- evidence id;
- evidence type;
- linked run id;
- linked page, target, window, or local surface;
- linked event or approval;
- minimal description;
- storage location of the selected evidence item;
- sensitivity classification.

Reason:

The system needs durable proof pointers, not infinite raw capture.

## Data that must remain session-only

The following data is allowed for runtime execution but must not be persisted by default:

- live browser session handles;
- live desktop window handles or OS-level object references;
- raw CDP target references;
- temporary DOM snapshots not promoted to evidence;
- temporary extraction buffers;
- intermediate candidate rankings for DOM selection;
- internal retry state;
- temporary screenshots taken only for transient diagnosis;
- non-approved draft field values that have not become evidence or artifact content.

Reason:

This data is useful for execution but high-noise, high-volume, or too sensitive to retain by default.

## Data that must not be persisted by default

The following data is out of bounds for default persistence:

- passwords;
- authentication tokens;
- cookies;
- full authenticated session state;
- complete raw page dumps from sensitive authenticated pages;
- generalized browser history unrelated to the run;
- console logs or network logs captured indiscriminately;
- hidden form values unless explicitly required as evidence in a controlled fixture.

Reason:

Persisting these by default would create a silent data retention problem incompatible with the product’s trust posture.

## Granularity of evidence

### Decision

The prototype persists `selected evidence`, not `full raw browsing history`.

### Required evidence granularity

For each important browser action, the system should be able to persist:

- a pre-action contextual pointer;
- the targeted page or target reference;
- the element or logical target summary when relevant;
- a post-action outcome summary;
- a compact evidence object when the action materially affects the run, approval, or artifact.

### What selected evidence can contain

- targeted DOM extract;
- structured element summary;
- selected screenshot or viewport capture;
- outcome verification result;
- refusal reason or blocker diagnosis.

### What selected evidence should avoid

- full-page raw DOM by default;
- unrelated portions of authenticated pages;
- redundant captures when a lighter proof object is sufficient.

## Linking model

The prototype must support these minimum conceptual links:

- `project -> run`
- `run -> event`
- `run -> approval`
- `run -> source`
- `run -> artifact`
- `run -> evidence manifest`
- `approval -> evidence`
- `artifact -> source`
- `artifact -> run`
- `evidence -> source page or target`

Without these links, operator review becomes narrative instead of inspectable.

## Restart behavior

### Must survive restart

- project list and project metadata;
- completed and incomplete runs;
- last stable run status;
- plan snapshot;
- approvals and decisions;
- artifacts;
- selected evidence manifests;
- source references.

### May be reconstructed after restart

- ephemeral browser session state;
- temporary DOM candidate lists;
- transient retry counters;
- runtime-only browser handles.

### Expected restart experience

After restart, the operator must be able to see:

- that a run was interrupted, failed, paused, or completed;
- what step it had reached;
- what approvals were pending or denied;
- what artifacts already exist;
- what evidence supports the current state.

The operator does not need the browser to resume invisibly from the exact internal runtime cursor.

## Cleanup and deletion strategy

### Required cleanup capabilities for prototype

- delete a run and its attached non-shared evidence;
- delete an artifact revision;
- delete selected evidence;
- delete a project and its local artifacts;
- clear temporary runtime state safely.

### Cleanup principles

- deletion must be explicit;
- shared references must be handled carefully;
- cleanup must not silently orphan audit records without marking them deleted;
- temporary files must be easier to remove than persisted artifacts.

## Persistence tiers

### Tier A: durable prototype state

Persist by default:

- project metadata;
- run metadata;
- event summaries;
- approvals;
- source references;
- artifacts;
- selected evidence manifests and files.

### Tier B: temporary runtime state

Session-only by default:

- live browser handles;
- temporary snapshots;
- runtime candidate sets;
- temporary extraction buffers.

### Tier C: forbidden-by-default sensitive state

Do not persist by default:

- credentials;
- cookies;
- tokens;
- hidden sensitive page dumps;
- indiscriminate diagnostic traces.

## Tradeoffs accepted

- Restart will not mean exact low-level browser continuation.
- Some debugging convenience is intentionally sacrificed for safer defaults.
- Evidence review may sometimes require opening compact proof objects instead of full raw captures.

These tradeoffs are acceptable for the prototype.

## Risks

### If persistence is too weak

- runs become opaque after interruption;
- approvals lose their context;
- artifacts look disconnected from their sources.

### If persistence is too broad

- sensitive browser data accumulates silently;
- local storage becomes difficult to reason about;
- audit and debugging become noisy instead of useful.

## Residual open questions

### Non-blocking before prototype

- exact physical storage representation of evidence files;
- exact local schema implementation details;
- optional retention windows for temporary evidence classes.

### Blocking before MVP

- configurable retention policies;
- redaction workflows for persisted evidence;
- support for imported remote storage or sync.

### Blocking before production

- encryption-at-rest policy details;
- enterprise-grade retention and deletion guarantees;
- secure migration and backup behavior.

## Final decision

The persistence model is sufficiently closed for the prototype.

No further persistence decision is blocking before the first development run, provided the implementation respects minimization and does not expand beyond the objects and tiers defined here.
