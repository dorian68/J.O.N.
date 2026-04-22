# Claw-Code Runtime Inspirations For Agent Roles

## Statut

Translation document. This file explains what `claw-code` can concretely inspire for agent-role architecture in this project.

Related documents:
- [analyse-reference-claw-code.md](./analyse-reference-claw-code.md)
- [multi-agent-reassessment.md](./multi-agent-reassessment.md)
- [runtime-agentique.md](./runtime-agentique.md)

Reference surfaces:
- [worker_boot.rs](../REFERENCE/claw-code/rust/crates/runtime/src/worker_boot.rs)
- [session.rs](../REFERENCE/claw-code/rust/crates/runtime/src/session.rs)
- [conversation.rs](../REFERENCE/claw-code/rust/crates/runtime/src/conversation.rs)
- [trust_resolver.rs](../REFERENCE/claw-code/rust/crates/runtime/src/trust_resolver.rs)
- [config.rs](../REFERENCE/claw-code/rust/crates/runtime/src/config.rs)
- [lib.rs](../REFERENCE/claw-code/rust/crates/tools/src/lib.rs)

## 1. What `claw-code` really contributes here

`claw-code` does not tell us to build a browser coworker as a swarm of agents.

What it does contribute is a set of control-plane lessons:

- sessions should be explicit and durable ;
- role boundaries should be enforced, not implied ;
- events should be typed ;
- trust and permission decisions should be surfaced as first-class runtime concepts ;
- recovery should be modeled explicitly ;
- role specialization should be backed by restricted tool surfaces.

## 2. What is conceptually reusable

## A. Session lineage and isolation

Useful inspiration:

- session persistence ;
- session fork lineage ;
- workspace-bound session isolation.

Why it matters for us:

- if we ever introduce a verifier role later, it needs clear lineage ;
- even in mono-runtime V1, run continuity and review state benefit from explicit session thinking.

Adaptation needed:

- our canonical object remains the `Run`, not the conversation session.

## B. Typed worker lifecycle and recovery

Useful inspiration from [worker_boot.rs](../REFERENCE/claw-code/rust/crates/runtime/src/worker_boot.rs):

- explicit statuses ;
- typed failure kinds ;
- recovery arming ;
- prompt misdelivery detection ;
- restart and termination semantics.

Why it matters for us:

- browser runs also need explicit blocked / ready / failed / resumed states ;
- verification checkpoints should emit typed events, not hidden logs.

Adaptation needed:

- our failures are browser, approval, evidence and artifact failures, not only terminal worker failures.

## C. Restricted tool surfaces by role

Useful inspiration from [lib.rs](../REFERENCE/claw-code/rust/crates/tools/src/lib.rs):

- subagent type normalization ;
- role-specific system prompt framing ;
- role-specific allowed tool sets ;
- explicit refusal when a tool is not enabled for a role.

Why it matters for us:

- if we ever create a verifier role later, it should be read-only and evidence-focused ;
- even in V1, this is a strong argument for internal role separation with explicit permissions.

Adaptation needed:

- our verifier, if added later, must not inherit code-agent assumptions like `bash` or generic repo exploration.

## D. Permission and trust resolution

Useful inspiration from [trust_resolver.rs](../REFERENCE/claw-code/rust/crates/runtime/src/trust_resolver.rs) and [conversation.rs](../REFERENCE/claw-code/rust/crates/runtime/src/conversation.rs):

- permission as a runtime gate ;
- trust prompts as first-class events ;
- deny / allow / approval-needed distinctions.

Why it matters for us:

- approvals in browser control need the same explicitness ;
- policy checker must remain separate from the acting role.

Adaptation needed:

- our approval object is richer and operator-facing ;
- our browser surface and evidence model are product primitives, not just tool-call wrappers.

## E. Hooks and plugins

Useful inspiration from [config.rs](../REFERENCE/claw-code/rust/crates/runtime/src/config.rs) and [plugins](../REFERENCE/claw-code/rust/crates/plugins/src/lib.rs):

- layered config ;
- lifecycle hooks ;
- tool hooks ;
- plugin enable / disable state.

Why it matters for us:

- not to build a plugin marketplace now ;
- but to preserve a clean place for future policy hooks, evidence processors or audit enrichers.

Adaptation needed:

- the product must stay outcome-oriented, not plugin-first.

## 3. What must be adapted, not copied

## A. Sub-agent concept

`claw-code` uses sub-agents as generic delegated workers.

For us, if a second role ever exists, it must be:

- narrowly scoped ;
- read-only or near read-only ;
- evidence-based ;
- unable to self-authorize or browse freely.

So the concept is reusable, but the operational shape must be much stricter.

## B. Review / verification pattern

`claw-code` shows that “verification” can be a distinct role name.

What we adapt:

- verification is valuable as a role boundary.

What we do not copy:

- a second agent by default in the first prototype.

For our V1, verification becomes an internal role and checkpoint, not a second autonomous worker.

## C. Recovery discipline

`claw-code` is strong on explicit recovery.

We should adapt that spirit to:

- wrong DOM target ;
- ambiguous outcome ;
- blocked modal ;
- insufficient evidence ;
- operator refusal.

The lesson is not “more agents recover better”.

The lesson is “explicit state machines recover better”.

## 4. What still does not fit our product

The following parts of `claw-code` still do not fit our product direction:

- default `danger-full-access` posture ;
- CLI-first UX ;
- coding-task-oriented verification role ;
- broad agent spawning as a normal flow ;
- teams / cron / task registries for the first prototype ;
- autonomous software-development philosophy as the product center.

Our product center remains:

- browser tasks ;
- approvals ;
- artifacts ;
- operator trust ;
- mission completion.

## 5. Architectural translation for this project

The right translation is:

- keep `claw-code`'s discipline of role separation ;
- keep its discipline of typed events and recovery ;
- keep its discipline of role-scoped permissions ;
- reject its default move toward broad delegated multi-agent work for this prototype.

In practice, that means:

- one acting agent in V1 ;
- internal verifier, policy and artifact-review roles ;
- future possibility of a read-only shadow verifier later ;
- no generic sub-agent surface in the prototype slice.

## 6. Final conclusion

`claw-code` strengthens the case for:

- explicit roles ;
- explicit control plane ;
- explicit recovery ;
- explicit permission boundaries.

It does **not** justify introducing a second autonomous verifier agent into this prototype.

Its most useful lesson is not “add more agents”.

Its most useful lesson is “separate responsibilities rigorously before you separate processes”.
