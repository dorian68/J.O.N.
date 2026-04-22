# LLM Runtime Contract

## Statut

Normative runtime contract.

Ce document definit le contrat entre le runtime produit et la couche LLM.

Documents lies :
- [runtime-agentique.md](./runtime-agentique.md)
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [browser-control-spec.md](./browser-control-spec.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [permissions-trust-safety.md](./permissions-trust-safety.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)

## 1. Decision de base

Le LLM est un `reasoning service` sous contrat.

Il ne pilote pas directement le produit.

Le runtime garde la responsabilite de :
- l'etat du run,
- la policy,
- les approvals,
- l'execution de tools,
- la verification des outcomes,
- la persistance,
- l'audit.

## 2. Ou le LLM intervient

Le LLM peut intervenir dans :

### 2.1 Mission understanding

Il peut :
- reformuler l'objectif,
- expliciter des hypotheses,
- proposer un plan initial.

### 2.2 Context shaping

Il peut :
- resumer des sources ;
- condenser un historique ;
- structurer des observations navigateur ou desktop ;
- preparer un contexte plus compact pour l'etape suivante.

### 2.3 Artifact drafting

Il peut :
- rediger une `Note de decision` ;
- organiser un `Tableau de collecte navigateur` quand une simple transformation deterministe ne suffit pas ;
- proposer une synthese lisible pour l'operateur.

### 2.4 Evaluation support

Il peut :
- critiquer un draft ;
- detecter des trous argumentatifs ;
- proposer des points d'incertitude.

### 2.5 Bounded interpretation

Il peut aider a interpreter :
- un DOM snapshot resume ;
- un evidence manifest ;
- une observation visible bornee ;
- jamais comme seul arbitre quand un check deterministe est possible.

## 3. Ou le LLM ne doit pas intervenir

Le LLM ne doit pas :
- accorder ou refuser une approval ;
- contourner une policy ;
- elargir un domaine allowliste ;
- declencher seul une action browser ou computer control ;
- verifier seul un outcome si le runtime peut le tester de maniere deterministe ;
- manipuler des credentials, cookies, tokens ou secrets ;
- decider de la persistance ;
- reecrire son propre contrat de role en execution.

## 4. Sorties autorisees

Les sorties LLM autorisees sont :
- `plan draft`
- `structured summary`
- `artifact draft`
- `evaluation note`
- `context compression`
- `ambiguity note`

Ces sorties doivent etre traitees comme :
- des propositions ;
- des brouillons ;
- des analyses ;
- jamais comme des autorisations.

## 5. Sorties interdites comme source de verite

Les sorties suivantes ne peuvent pas etre considerees comme suffisantes a elles seules :
- "le formulaire a ete rempli correctement"
- "l'outcome est valide"
- "la navigation est sur la bonne page"
- "cette action est sans risque"
- "cette approval peut etre auto-acceptee"

Pour ces sujets, le runtime doit utiliser :
- les tools,
- les preuves,
- les checks deterministes,
- les policies explicites.

## 6. Relation avec browser control

### Decision

Le browser control reste `DOM-first`.

Le LLM peut :
- raisonner sur des donnees extraites du DOM ;
- proposer un resume ou une priorisation ;
- aider a formuler un artifact a partir de sources deja capturees.

Le LLM ne peut pas :
- remplacer la selection robuste d'elements ;
- remplacer la verification d'actionnabilite ;
- remplacer la verification d'outcome ;
- devenir la voie primaire de ciblage navigateur.

## 7. Relation avec computer control

Le `computer control` du prototype est `observability-first`.

Le LLM peut :
- aider a resumer une observation visible deja capturee ;
- commenter une preuve.

Le LLM ne peut pas :
- devenir l'orchestrateur des actions desktop ;
- valider seul qu'un etat visible est correct ;
- justifier un passage au `computer control` si un chemin DOM existe encore.

## 8. Relation avec policy et approvals

Decision ferme :
- la policy est deterministe et hors modele ;
- les approvals sont humaines ;
- le LLM peut aider a formuler une justification lisible ;
- mais il ne decide jamais a la place de l'operateur ou du policy engine.

## 9. Relation avec les artefacts

Le LLM peut rediger ou ameliorer un artefact.

Mais tout artefact LLM-dependant doit rester lie a :
- ses sources,
- son run,
- ses prompt versions,
- son provider/model alias,
- son statut de validation.

Le LLM ne transforme pas un artefact en livrable final "valide" par lui-meme.

## 10. Garanties requises

Chaque appel LLM doit garantir :
- prompt versions resolues ;
- model alias resolu ;
- contexte borne ;
- output type connu ;
- schema validation si sortie structuree ;
- trace d'audit minimale ;
- categorisation d'erreur si echec.

Chaque integration runtime doit garantir :
- qu'aucun output LLM ne saute la policy ;
- qu'aucune action sensible n'est engagee sans la couche approval ;
- qu'un output non valide ne devient pas une verite de run.

## 11. Garde-fous obligatoires

- validation de schema quand un output structure est attendu ;
- redaction des secrets avant appel ;
- plafond de taille de contexte ;
- fallback explicite et journalise ;
- refus ou arret propre en cas d'output non exploitable ;
- benchmarking des prompts critiques ;
- versioning obligatoire des prompts runtime.

## 12. Failure handling

En cas de sortie invalide, le runtime peut :
1. re-essayer dans les bornes de retry ;
2. tomber sur un modele compatible du meme role ;
3. basculer vers un fallback deterministe explicitement borne si et seulement si ce fallback faisait deja partie du slice autorise ;
4. marquer l'etape comme `blocked` ;
5. demander une reprise ou une intervention operateur.

Il ne doit pas :
- parser librement du texte non conforme et pretendre que le contrat est respecte ;
- cacher le fallback ;
- substituer une heuristique fragile sans trace.

Decision de clarification :

- pour le prototype, `plan_generation` et `decision_note_draft` peuvent degrader vers un chemin deterministe deja present dans le produit ;
- cette degradation doit rester visible dans les evenements, les call records et les metadonnees d'artefact ;
- elle ne donne jamais au LLM ou au runtime un droit d'elargir le scope.

## 13. Reponse normative a la question centrale

Le contrat runtime LLM du produit est :
- `LLM proposes`
- `runtime validates`
- `policy governs`
- `operator approves`
- `tools verify`
- `artifacts remain traceable`

Si une future implementation ne respecte pas cette phrase, elle sort du cadre canonique.
