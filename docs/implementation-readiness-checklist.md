# Implementation Readiness Checklist

## Statut

Go / no-go checklist document.

Ce document sert à vérifier si le premier run de développement peut commencer et si la suite du prototype reste dans une zone autorisée.

Documents liés :
- [final-launch-decision.md](./final-launch-decision.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)
- [development-roadmap-v1.md](./development-roadmap-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)

## Mode d'emploi

La checklist a deux usages :

- `Pré-dev` : autoriser ou non le premier run de développement.
- `Pré-démo interne` : autoriser ou non une revendication de prototype fonctionnel.

Une case `Non` sur un item obligatoire `Pré-dev` bloque le lancement du développement.

Une case `Non` sur un item obligatoire `Pré-démo interne` n'empêche pas de continuer le build, mais interdit de présenter le prototype comme validé.

## A. Checklist pré-dev

### A1. Documents normatifs présents

- [ ] [final-coherence-and-launch-review.md](./final-coherence-and-launch-review.md) lu et accepté
- [ ] [final-launch-decision.md](./final-launch-decision.md) lu et accepté
- [ ] [development-guidelines-v1.md](./development-guidelines-v1.md) lu et accepté
- [ ] [development-roadmap-v1.md](./development-roadmap-v1.md) lu et accepté
- [ ] [prototype-slice-v1.md](./prototype-slice-v1.md) lu et accepté
- [ ] [browser-control-prototype-gate.md](./browser-control-prototype-gate.md) lu et accepté

### A2. Décisions fermées

- [ ] prototype fermé comme `mono-agent supervisé`
- [ ] pas de second agent autonome dans V1
- [ ] `browser-first` avec `computer control` borné
- [ ] surfaces contrôlées seulement au départ
- [ ] pas de login, upload, submit, publish, send, delete
- [ ] pas d'actuation desktop générale dans le premier build
- [ ] artefacts V1 limités au `Tableau de collecte navigateur` et à la `Note de decision`
- [ ] approvals V1 limitées au contrat fermé
- [ ] persistance locale minimale fermée

### A3. Contrats critiques présents

- [ ] [operator-approval-ux-contract.md](./operator-approval-ux-contract.md) fait foi
- [ ] [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md) fait foi
- [ ] [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md) fait foi
- [ ] [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md) fait foi
- [ ] [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md) fait foi

### A4. Stratégie browser control figée

- [ ] [browser-control-spec.md](./browser-control-spec.md) utilisé comme spec large
- [ ] [browser-control-dom-strategy.md](./browser-control-dom-strategy.md) retenu comme stratégie dominante
- [ ] [browser-control-primitives.md](./browser-control-primitives.md) retenu comme vocabulaire des primitives
- [ ] [browser-control-failure-recovery.md](./browser-control-failure-recovery.md) retenu comme base des arrêts et recovery
- [ ] [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md) retenu comme limite produit
- [ ] [computer-control-spec.md](./computer-control-spec.md) retenu comme capability document
- [ ] [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md) retenu comme frontière d'usage
- [ ] [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md) retenu comme garde-fou desktop

### A5. Discipline de validation acceptée

- [ ] [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md) est traité comme plan de lot 1
- [ ] [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md) est traité comme benchmark minimum
- [ ] [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md) est traité comme benchmark minimum desktop
- [ ] aucune revendication de succès sans revue benchmark
- [ ] les causes de retrait d'autorisation sont connues et acceptées

### Verdict pré-dev

Règle :

- si un item obligatoire de A1 à A5 est `Non`, le premier run de dev est `No-Go`.

## B. Checklist pré-démo interne

### B1. Fixtures minimales matérialisées

- [ ] navigation simple avec outcome explicite
- [ ] DOM ambigu avec cibles similaires
- [ ] page longue avec scroll et élément hors viewport
- [ ] formulaire simple avec champ requis et bouton disabled
- [ ] multi-tab avec mauvaise target possible
- [ ] modal bloquante
- [ ] DOM muté après interaction
- [ ] outcome ambigu
- [ ] surface authentifiée synthétique avec session expirée

### B2. Benchmarks minimum couverts

- [ ] lecture et synthèse sur pages contrôlées
- [ ] navigation multi-onglets et comparaison
- [ ] collecte structurée multi-pages
- [ ] remplissage partiel de formulaire sans soumission
- [ ] vérification d'outcome et export de preuves
- [ ] arrêt propre sur chemin refusé ou surface non acceptable
- [ ] détection de fenêtre active et focus allowlisté
- [ ] attente d'état visible et vérification d'outcome local

### B3. Preuves minimales disponibles

- [ ] événements typés utiles
- [ ] preuves DOM / outcome consultables
- [ ] approvals auditables
- [ ] rattachement source -> preuve -> artefact disponible
- [ ] raisons d'échec relisibles

### B4. Qualité de sortie

- [ ] `Tableau de collecte navigateur` utile et traçable
- [ ] `Note de decision` utile selon la rubric
- [ ] aucun succès benchmark revendiqué sans preuves suffisantes
- [ ] aucun faux positif critique non traité

### Verdict pré-démo interne

Règle :

- si un item obligatoire de B1 à B4 est `Non`, la démo interne comme “prototype valide” est `No-Go`.

## C. Causes de no-go immédiat

- un développement hors slice commence ;
- une capacité hors scope est ajoutée pour une démo ;
- les approvals sont contournées ;
- la persistance s'élargit sans justification canonique ;
- les benchmarks sont remplacés par un scénario de démonstration ;
- un second agent autonome est réintroduit ;
- une plateforme sensible devient le terrain principal sans réouverture de gate.

## Décision d'usage après ce run documentaire

État documentaire visé après ce run :

- `Pré-dev` : `Go`, sous conditions finales strictes
- `Pré-démo interne` : `Not yet`, dépend de la matérialisation des fixtures, des benchmarks et des preuves pendant le développement
