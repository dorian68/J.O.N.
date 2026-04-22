# Operator Approval UX Contract

## Statut

Decision document. This file closes the approval UX contract for the first prototype so that approval behavior is not improvised during implementation.

Related documents:
- [permissions-trust-safety.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/permissions-trust-safety.md)
- [approval-policy-matrix.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/approval-policy-matrix.md)
- [browser-control-approval-matrix.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-approval-matrix.md)
- [browser-control-observability.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-observability.md)
- [prototype-slice-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/prototype-slice-v1.md)

## Objective

Approvals in the prototype exist to protect the operator from hidden commitment, not to create bureaucratic friction.

The approval UX must:

- surface the right decision at the right moment;
- explain what the system wants to do and why;
- let the operator approve or refuse without guesswork;
- keep the run intelligible after the decision;
- avoid repeated low-value prompts.

## Closed decisions

- Read-only browser activity is auto-approved within the run’s allowlisted surface.
- Read-only computer-control observation on an allowlisted controlled surface may be auto-approved.
- Meaningful write-intent browser activity requires explicit operator approval.
- Meaningful local context switches such as `focus_window` require explicit operator approval in V1.
- Submission, publication, send, delete, login, and credential entry are out of prototype scope and therefore not approvable in V1.
- An approval is a first-class record tied to run, evidence, and later audit review.
- The prototype uses one-shot explicit approvals, not broad “trust everything” modes.

## Approval categories for the prototype

### Category 1: Read

Examples:

- inspect page;
- query DOM;
- capture compact DOM evidence;
- resolve interactive elements;
- scroll;
- open or focus a tab on an allowlisted surface;
- navigate within the current allowlisted surface.

Decision:

Auto-approved in V1.

### Category 2: Navigation expansion

Examples:

- navigate to a new domain not already allowlisted for the run;
- follow a path that exits the known surface.

Decision:

Explicit approval required.

### Category 3: Preparation

Examples:

- focus editable field;
- prepare a controlled edit path;
- open a non-destructive modal or editor surface.

Decision:

Auto-approved only when no data mutation occurs. If preparation is ambiguous or may mutate state, explicit approval is required.

### Category 4: Edit

Examples:

- type text;
- clear and replace field content;
- select an option;
- toggle a checkbox;
- update a form field state.

Decision:

Explicit approval required in V1.

### Category 5: Submission or commitment

Examples:

- submit form;
- publish content;
- send message;
- confirm destructive action;
- save or post externally.

Decision:

Out of scope for the first prototype. Not approvable in V1.

## When the operator must see an approval

The operator must see an approval when all of the following are true:

- the action changes external browser state or could plausibly do so;
- the change matters to the mission, the platform, or the user;
- the action is not safely reversible inside the same run step;
- the system can describe the target and expected effect with enough specificity.

If the system cannot explain the action well enough, it must not present a vague approval. It must stop and surface a blocker instead.

## Minimum approval payload

Every approval shown in the prototype must include:

- action label in plain language;
- action category;
- target page or domain;
- target element or logical destination summary;
- why the system wants to do it;
- expected effect;
- reversibility classification;
- risk level;
- consequence of refusal for the run;
- supporting evidence link.

Optional but desirable:

- current field value summary when non-sensitive;
- proposed new value summary when non-sensitive;
- related artifact or plan step reference.

## Minimum operator choices

Every explicit approval prompt in the prototype must allow:

- `Approve once`
- `Deny`
- `Stop run`

Not allowed in V1:

- blanket trust for all future actions;
- broad project-wide trust escalation;
- hidden default approval through timeout.

## Anti-fatigue rules

The prototype must enforce these rules:

- never ask approval for pure read actions on allowlisted pages;
- do not ask separately for each keystroke;
- do not split one coherent field update into multiple approvals;
- do not re-ask the same denied approval unless the situation materially changed;
- do not ask approval before the system knows the target well enough.

Approval fatigue is treated as a product failure, not as a user training issue.

## Anti-surprise rules

The approval UI must prevent these surprises:

- approving a write without seeing where it will happen;
- approving domain expansion without seeing the destination domain;
- approving a form edit without seeing the field role or label;
- approving an action whose effect is actually submission or publication;
- discovering after the fact that a blocked action already partially executed.

## Link between approval and evidence

Every approval must link to evidence that supports operator judgment.

At minimum, the operator must be able to inspect:

- the current page context;
- the targeted element summary;
- the reason the action is considered relevant;
- the post-action verification result if the approval was granted.

If no useful evidence can be shown, the approval is not mature enough for execution.

## Link between approval and audit

The approval record must persist:

- what was requested;
- when;
- under which run and mission;
- on which surface;
- with what risk classification;
- what the operator decided;
- what happened afterward.

An approval that cannot be reconstructed later is considered operationally invalid.

## Good approval vs dangerous approval

### A good approval

A good approval is:

- specific;
- contextual;
- evidence-backed;
- narrow in scope;
- easy to accept or refuse;
- clearly tied to a consequence.

### A dangerous approval

A dangerous approval is:

- vague about target or effect;
- overly broad in scope;
- repeated mechanically;
- not linked to evidence;
- actually concealing a more engaging action than it claims.

## Case limits for the prototype

### Always auto-approved in V1

- DOM inspection;
- reading;
- scrolling;
- same-surface tab focus;
- same-domain navigation inside the approved run surface;
- active-window detection on an allowlisted controlled surface;
- allowlisted window capture used only for evidence;
- visible-state waiting and verification on a controlled local surface;
- compact evidence export into the run record.

### Explicit approval in V1

- typing into an editable field;
- clearing and replacing a field value;
- selecting or toggling user-visible state;
- handling a modal when it implies preference or consent change;
- leaving the allowlisted domain set;
- focusing a local allowlisted window when the context switch matters to the run.

### Always blocked or out of scope in V1

- login flows;
- credential entry;
- CAPTCHA handling;
- form submission;
- publish;
- send;
- delete;
- file upload;
- desktop click, drag, keyboard input, hotkeys, and native dialog handling;
- stealth or anti-bot countermeasures.

## Errors to avoid

The prototype approval UX fails if it does any of the following:

- shows technical jargon instead of operator-meaningful context;
- hides the exact action behind generic labels like “continue” or “browser action”;
- allows approval without a visible target or evidence pointer;
- asks too late, after side effects already happened;
- asks too early, before the target is known.

## Final contract

The approval UX for the prototype is now closed:

- read activity on allowlisted surfaces is auto-approved;
- meaningful write intent requires explicit one-shot approval;
- commitment actions are excluded from the prototype;
- every approval must be evidence-backed and auditable;
- no hidden or broad trust shortcuts are allowed in V1.

This is sufficiently closed for the prototype and should not be relaxed during implementation.
