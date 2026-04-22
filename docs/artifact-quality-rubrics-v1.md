# Artifact Quality Rubrics V1

## Statut

Decision document. This file closes the quality rubric for the artifacts retained in the first prototype.

Related documents:
- [artifact-contracts.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/artifact-contracts.md)
- [workspaces-projets-artefacts.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/workspaces-projets-artefacts.md)
- [prototype-slice-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/prototype-slice-v1.md)
- [benchmark-review-protocol-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/benchmark-review-protocol-v1.md)

## Objective

The prototype is not allowed to “work” only because browser actions execute. It must produce artifacts that are actually useful.

These rubrics define usefulness narrowly enough to review honestly and strictly enough to reject cosmetic outputs.

## Closed decision on prototype artifacts

The prototype retains exactly two artifact classes:

- `Tableau de collecte navigateur`
- `Note de decision`

Other artifact types remain outside prototype scope.

## Artifact 1: Tableau de collecte navigateur

### Purpose

This is the structured intermediate artifact that records what the agent actually collected from browser surfaces.

It exists to make extraction inspectable before or alongside the final decision artifact.

### Minimum required content

The artifact must contain, for each collected item:

- source page label or title;
- source reference or page identifier;
- extracted fact or observation;
- confidence indicator;
- status or interpretation note;
- evidence link.

### Minimum structure

The artifact must be structured, not free-form prose.

Acceptable shapes:

- table;
- list of records;
- grouped fact blocks with stable fields.

Unacceptable:

- loose paragraph summary;
- unordered dump of copied text;
- untraceable bullet list.

### Acceptable quality

The artifact is acceptable if:

- a reviewer can identify where each important fact came from;
- the collected items are materially relevant to the mission;
- duplication is limited;
- uncertainty is marked instead of hidden;
- evidence links let the reviewer check a disputed item quickly.

### Mediocre quality

The artifact is mediocre if:

- it contains mostly true but weakly prioritized observations;
- it is technically structured but hard to scan;
- provenance exists but is incomplete on important items;
- confidence is implied but not stated.

### Misleading quality

The artifact is misleading if:

- facts cannot be traced back to source surfaces;
- copied text is presented as interpreted fact without qualification;
- contradictory source signals are silently flattened;
- the structure makes it appear more certain than the evidence supports.

### Human review criteria

A human reviewer should ask:

- are the collected items the right ones for the mission;
- are any critical items missing;
- does the artifact distinguish observation from interpretation;
- can I verify the important lines with the linked evidence.

### Frequent expected errors

- over-collection of low-value facts;
- duplicate rows from repeated pages;
- weak normalization of page labels;
- mixing source text and inferred meaning without separation.

## Artifact 2: Note de decision

### Purpose

This is the final prototype artifact. It converts browser findings into an operator-usable recommendation.

It is the only final artifact type required for prototype success.

### Minimum required content

The `Note de decision` must contain:

- mission context;
- scope of pages reviewed;
- key findings;
- recommendation or decision-oriented conclusion;
- uncertainties or caveats;
- cited sources or evidence references.

### Minimum structure

The artifact must include these sections:

1. `Objective`
2. `Key findings`
3. `Recommendation`
4. `Uncertainties and limits`
5. `Sources consulted`

This structure is mandatory for the prototype.

### Readability standard

The artifact must be:

- concise enough to review quickly;
- structured enough to skim;
- explicit about uncertainty;
- free of generic filler;
- written for operator action, not model self-explanation.

### Provenance and traceability

The artifact must be traceable to:

- the run that produced it;
- the source references used;
- the intermediate `Tableau de collecte navigateur` when present;
- the evidence items supporting major claims.

### Confidence and validation

The artifact must expose:

- overall confidence level;
- unresolved ambiguities;
- whether the artifact is `draft`, `reviewed`, or `operator-validated`.

### Exportability

For the prototype, exportability means:

- the artifact can be opened outside the run context;
- its structure remains readable;
- source references remain visible or attached.

The export format itself is not the core quality gate; usefulness and traceability are.

### Acceptable quality

The artifact is acceptable if:

- it helps the operator decide or act;
- it reflects the actual browser findings rather than generic summarization;
- it cites the material sources behind important conclusions;
- it names uncertainty where evidence is incomplete;
- it avoids pretending that a recommendation is stronger than the supporting evidence.

### Mediocre quality

The artifact is mediocre if:

- it is readable but generic;
- it repeats page content without decision compression;
- it includes a recommendation but little explanation;
- it cites sources only superficially.

### Misleading quality

The artifact is misleading if:

- it claims a recommendation unsupported by collected evidence;
- it hides missing pages or failed steps;
- it presents uncertain findings as settled fact;
- it looks polished while being operationally useless.

### Human review criteria

A reviewer should ask:

- would this artifact save the operator time on the mission;
- does the recommendation follow from the findings;
- are caveats present where they should be;
- can the major claims be checked from sources and evidence;
- is anything materially missing for the user to trust it.

### Frequent expected errors

- generic recommendation unsupported by evidence;
- omission of caveats after ambiguous browsing results;
- too much copied source language;
- under-specified recommendation with no actionable conclusion.

## Failure criteria across prototype artifacts

An artifact review is a failure if:

- provenance is missing on important content;
- the content is too generic to help the operator;
- evidence links are broken or absent on major claims;
- the artifact hides uncertainty;
- the artifact succeeds visually but fails operationally.

## “Useful” vs “present”

For the prototype, an artifact is useful when it improves operator judgment or reduces manual synthesis work.

An artifact is merely present when:

- it exists as a file or card;
- it contains text;
- it looks organized;
- but it does not materially help the mission.

Presence is not a pass condition.

## Final decision

The artifact quality bar for the prototype is now closed:

- only two artifact classes are in scope;
- the `Note de decision` is the sole required final artifact;
- provenance, uncertainty, and review usefulness are mandatory;
- cosmetic but weak outputs must be graded as failure.

This rubric is sufficiently strict for prototype review and should be used in benchmark and demo evaluation.
