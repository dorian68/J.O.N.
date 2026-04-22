# Prompt Registry And Versioning

## Statut

Normative governance document.

Ce document ferme la gouvernance des prompts, roles et templates LLM du produit.

Documents lies :
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [evals-and-benchmarks.md](./evals-and-benchmarks.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

## 1. Decision de base

Les prompts sont des assets gouvernes.

Ils ne sont pas :
- des chaines inline opportunistes dans le code ;
- des ajustements locaux invisibles ;
- des variantes non tracees selon la machine ou le dev.

## 2. Types de prompts a gouverner

Les familles minimales sont :

### 2.1 System / role prompts

Exemples :
- prompt de role `primary_reasoning`
- prompt de role `evaluator`
- prompt de role `artifact_drafter`

### 2.2 Task prompts

Exemples :
- plan generation
- context compression
- artifact drafting
- evidence summarization

### 2.3 Structured output prompts

Prompts ou templates qui imposent :
- un schema,
- des champs obligatoires,
- une grammaire ou un format strict.

### 2.4 Review prompts

Prompts destines a :
- critique,
- comparaison,
- evaluation de qualite,
- detection d'incertitudes.

### 2.5 Vision prompts

Prompts lies a une interpretation visuelle bornee.

Decision :
- ces prompts sont distincts ;
- ils ne doivent pas reutiliser implicitement les memes versions que les prompts texte.

## 3. Prompt registry contract

Chaque prompt gouverne doit avoir au minimum :
- `prompt_id`
- `family`
- `purpose`
- `owner`
- `status`
- `version`
- `compatible_model_aliases`
- `input_contract`
- `output_contract`
- `benchmark_links`
- `change_notes`

## 4. Versioning policy

Decision :
- versioning semantique `major.minor.patch`.

Regles :
- `major` : changement de comportement attendu ou de contrat d'entree/sortie ;
- `minor` : amelioration de formulation susceptible d'impacter les outputs, sans changer le contrat ;
- `patch` : correction editoriale ou clarifications reputees sans impact de contrat.

Regle importante :
- si un benchmark critique peut raisonnablement bouger, ce n'est pas un `patch`.

## 5. Immutable release rule

Une version publiee dans le registre est immuable.

Interdit :
- modifier le texte d'une version deja referencee dans un run ;
- corriger "vite fait" un prompt sans nouvelle version ;
- laisser un override local non trace.

## 6. Environment model

Les prompts peuvent exister dans trois statuts :
- `draft`
- `released`
- `deprecated`

Et dans trois environnements :
- `test`
- `prototype`
- `production` plus tard

Decision :
- un prompt `draft` ne doit pas etre utilise pour des benchmarks canoniques ;
- un prompt `released` est requis pour tout benchmark de reference ou toute demo interne serieuse ;
- un prompt `deprecated` reste lisible pour audit et rollback.

## 7. Review and approval workflow

Tout changement de prompt critique doit etre accompagne de :
- justification du changement ;
- impact attendu ;
- benchmarks affectes ;
- plan de rollback ;
- reviewer humain identifie.

Les prompts critiques incluent :
- plan generation
- artifact drafting
- evaluator
- context compression
- toute interpretation visuelle

## 8. Rollback policy

Chaque prompt `released` doit avoir :
- une version precedente de reference ;
- une note de compatibilite ;
- un chemin de revert simple.

Decision :
- le rollback de prompt est un outil normal de stabilisation ;
- il ne doit pas etre traite comme un incident exceptionnel.

## 9. Run traceability

Chaque run LLM-dependant doit conserver :
- les `prompt_ids`
- les `prompt_versions`
- les `model_aliases`
- le `provider_alias`

Cela est requis pour :
- audit,
- regression analysis,
- benchmark comparability,
- blame isolation.

## 10. Benchmark linkage

Un prompt critique sans lien benchmark n'est pas gouverne correctement.

Chaque prompt critique doit reference au moins :
- un benchmark ou scenario de reference ;
- une rubrique qualitative associee ;
- le reviewer protocol pertinent.

## 11. Forbidden practices

- prompts inline non versionnes dans le runtime produit ;
- edition manuelle en urgence sans nouvelle version ;
- prompt different entre dev machines sans trace ;
- changement de prompt et de modele dans le meme lot sans attribution claire ;
- logging systematique des prompts complets sur des runs reels sensibles.

## 12. Decision finale

Le produit adopte un `prompt registry` explicite, versionne, benchmarke et rollbackable.

Sans ce registre, les comportements LLM ne sont pas auditablement governables.
