# Agent Roles And Responsibilities V1

## Statut

Decision document. This file defines the admissible agentic roles for the prototype and closes which of them are actually retained in V1.

Related documents:
- [multi-agent-reassessment.md](./multi-agent-reassessment.md)
- [runtime-agentique.md](./runtime-agentique.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)

## Décision de base

Le prototype V1 retient :

- un seul agent modèle : `Primary Browser-First Run Agent`
- plusieurs rôles de contrôle internalisés dans le runtime

Le prototype V1 ne retient pas :

- un `Verifier agent` autonome ;
- un `Critic agent` autonome ;
- une équipe d'agents.

## Rôle 1. Primary Browser-First Run Agent

### Statut

Retenu. C'est le seul agent autonome du prototype.

### Responsabilités

- comprendre la mission ;
- proposer un plan ;
- piloter les primitives navigateur autorisées ;
- piloter les primitives `computer control` explicitement admises ;
- collecter les preuves utiles ;
- produire le `Tableau de collecte navigateur` ;
- produire la `Note de decision` ;
- proposer les actions nécessitant approval.

### Ce qu'il n'a pas le droit de faire

- s'auto-autoriser sur write intent ;
- exécuter des actes engageants hors scope ;
- élargir le domaine ou le scope sans passer par policy et approval ;
- masquer une ambiguïté DOM ou un outcome non vérifié.
- masquer une ambiguïté de fenêtre ou d'état visible local.

## Rôle 2. Outcome Verifier / Evaluator

### Statut

Retenu, mais **non autonome**.

Ce rôle est internalisé dans le runtime.

### Responsabilités

- vérifier qu'une action navigateur a produit l'effet attendu ;
- vérifier qu'une action locale ou un changement de focus a produit l'effet visible attendu ;
- qualifier un outcome comme :
  - validé,
  - ambigu,
  - insuffisant,
  - échoué ;
- demander retry, stop ou escalation interne selon le cas ;
- empêcher la clôture d'un run sur outcome non vérifié.

### Ce qu'il n'a pas le droit de faire

- ouvrir de nouvelles actions navigateur de sa propre initiative ;
- contourner une approval ;
- déclarer un acte engageant autorisé ;
- réécrire seul l'artefact final sans repasser par le flux normal du run.

### Forme retenue en V1

- pas un second agent ;
- un checkpoint explicite du runtime ;
- des événements dédiés ;
- des preuves DOM/outcome obligatoires.

## Rôle 3. Artifact Reviewer

### Statut

Retenu, mais en deux formes distinctes :

- contrôle structurel internalisé dans le runtime ;
- revue humaine explicite pour benchmark et démo.

### Responsabilités

- vérifier que les artefacts requis existent ;
- vérifier que la structure minimale est respectée ;
- vérifier la présence de sources, preuves et caveats ;
- appliquer la rubric de qualité en revue benchmark.

### Ce qu'il n'a pas le droit de faire

- approuver un acte navigateur ;
- servir de substitut à la vérification d'outcome ;
- masquer l'insuffisance des preuves derrière un bon texte.

## Rôle 4. Policy Checker

### Statut

Retenu, **non agentique**.

### Responsabilités

- classer les actions proposées ;
- appliquer la matrice de risque ;
- décider :
  - auto-approval,
  - explicit approval,
  - blocked / out of scope ;
- produire les métadonnées d'approval et de risque.

### Ce qu'il n'a pas le droit de faire

- exécuter des actions navigateur ;
- générer un artefact ;
- accorder une dérogation implicite au scope fermé.

## Rôles explicitement non retenus en V1

### Verifier agent autonome

Non retenu.

Raison :

- coût de coordination trop élevé pour le gain attendu sur surfaces contrôlées ;
- risque de rendre l'audit moins lisible ;
- ajoute une dimension de benchmark non nécessaire au prototype.

### Critic agent autonome

Non retenu.

Raison :

- complexité disproportionnée ;
- risque de transformer le prototype en système de débat entre agents.

### Artifact reviewer autonome

Non retenu.

Raison :

- la revue qualité finale doit rester lisible et reliée à la rubric ;
- au prototype, la revue humaine benchmarkée reste plus utile qu'un second agent critique.

## Modèle final retenu

Le prototype V1 adopte donc un modèle de `role-separated mono-runtime` :

- un seul agent agit ;
- plusieurs rôles de contrôle existent ;
- ces rôles sont explicites dans les événements et les checkpoints ;
- ils ne sont pas implémentés comme agents autonomes séparés.

## Décision finale

Les rôles effectivement retenus pour V1 sont :

- `Primary Browser-First Run Agent`
- `Outcome Verifier / Evaluator` internalisé
- `Artifact Reviewer` internalisé + humain en benchmark
- `Policy Checker` non-agentique

Il n'y a pas de bi-agent autonome dans le prototype.
