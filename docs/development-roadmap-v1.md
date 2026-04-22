# Development Roadmap V1

## Statut

Execution roadmap for the authorized prototype.

Cette roadmap ne décrit pas le produit complet. Elle découpe le développement du prototype autorisé en lots ordonnés, avec critères de validation et critères de stop.

Documents liés :
- [final-launch-decision.md](./final-launch-decision.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

## Principes de découpage

La roadmap suit l'ordre le plus sûr :

1. rendre le prototype testable ;
2. rendre le runtime intelligible ;
3. rendre le navigateur fiable en lecture ;
4. introduire un `computer control` borné d'observation et de preuve ;
5. rendre les artefacts utiles ;
6. ajouter un write boundary navigateur très borné ;
7. fermer la validation benchmarkée.

L'ordre n'est pas cosmétique. Il est structurel.

## Lot 1. Fixtures et base de validation

### Objectif

Matérialiser les surfaces contrôlées minimales, navigateur et desktop borné, et l'ossature benchmark nécessaire pour que le reste du build soit jugeable.

### Dépendances

- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

### Livrables attendus

- set minimal de fixtures prioritaires matérialisé ;
- mapping clair entre fixtures et benchmarks minimum ;
- critères d'assertion associés aux familles de benchmark ;
- structure de preuves attendues par fixture.

### Critères de validation

- les fixtures minimales obligatoires existent réellement ;
- les cas d'échec injectés sont représentables ;
- aucune fixture critique ne dépend d'une plateforme sensible ;
- la revue benchmark peut être effectuée sans interprétation improvisée.

### Critères de stop

- les fixtures deviennent trop proches d'un scraping bot réel ;
- elles sont trop fragiles ou trop non déterministes ;
- elles n'exercent pas les ambiguïtés DOM réellement visées.

## Lot 2. Spine runtime et état local minimal

### Objectif

Établir l'ossature du prototype : projet, run, plan, approvals, événements, artefacts, evidence manifests, reprise locale minimale.

### Dépendances

- Lot 1
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [event-taxonomy.md](./event-taxonomy.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)

### Livrables attendus

- structure locale de projet et run ;
- cycle de vie de run intelligible ;
- journal d'événements typés minimal ;
- enregistrement des approvals ;
- rattachement des sources, preuves et artefacts ;
- reprise après redémarrage sur état minimal autorisé.

### Critères de validation

- un run interrompu reste lisible après redémarrage ;
- une approval et son contexte restent auditables ;
- aucune donnée interdite n'est persistée par défaut ;
- la structure de preuve est reliée au run et aux artefacts.

### Critères de stop

- la persistance devient opportuniste ;
- le runtime produit un état illisible ou trop implicite ;
- l'audit nécessite des logs bruts non prévus pour comprendre un run.

## Lot 3. Browser control read-only fiable

### Objectif

Fermer la boucle sûre de navigation, tabs, DOM inspection, scroll, extraction et outcome verification sur surfaces contrôlées, sans write intent.

### Dépendances

- Lot 1
- Lot 2
- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)

### Livrables attendus

- gestion de session navigateur autorisée ;
- navigation et multi-tabs bornées ;
- capture et interrogation DOM ;
- ciblage d'éléments lisible ;
- scroll et lecture de pages longues ;
- vérification d'outcome sur actions read-path ;
- export de preuves utiles.

### Critères de validation

- les benchmarks read-path passent sur surfaces contrôlées ;
- le ciblage DOM n'est pas dominé par des heuristiques opaques ;
- les erreurs sont qualifiées et arrêtables ;
- les preuves rendent les actions relisibles.

### Critères de stop

- le système dépend principalement de temporisations arbitraires ;
- le fallback visuel devient la solution principale ;
- le multi-tab reste ambigu ou non auditable.

## Lot 4. Computer control foundation

### Objectif

Introduire la fondation `computer control` du prototype : conscience de fenêtre active, focus gouverné, capture, attente d'état visible et preuve locale.

### Dépendances

- Lot 1
- Lot 2
- Lot 3
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-primitives.md](./computer-control-primitives.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)

### Livrables attendus

- qualification de fenêtre active ;
- focus vers fenêtre allowlistée ;
- capture de fenêtre ou de région ;
- attente d'état visible ;
- vérification d'outcome visible ;
- export de preuves locales liées au run.

### Critères de validation

- la couche desktop reste subordonnée au `DOM-first` ;
- aucune actuation locale générale n'est introduite ;
- les benchmarks minimum de `computer control` passent sur surfaces contrôlées ;
- les preuves locales sont reliées au run, aux approvals et à l'audit.

### Critères de stop

- le `computer control` devient la voie principale au lieu d'une couche de support ;
- l'équipe introduit pointer ou keyboard actuation pour “aller plus vite” ;
- la couche locale produit plus d'ambiguïté qu'elle n'en résout.

## Lot 5. Collecte structurée et artefacts utiles

### Objectif

Transformer la navigation fiable en sortie utile : `Tableau de collecte navigateur` puis `Note de decision`.

### Dépendances

- Lot 3
- Lot 4
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [artifact-contracts.md](./artifact-contracts.md)

### Livrables attendus

- génération de l'artefact intermédiaire ;
- génération de l'artefact final ;
- liens entre artefacts, sources et preuves ;
- état de validation et niveau de confiance visibles.

### Critères de validation

- la `Note de decision` est utile selon la rubric ;
- le `Tableau de collecte navigateur` reste traçable ;
- l'artefact n'invente pas une confiance supérieure aux preuves disponibles ;
- la revue humaine peut juger rapidement l'utilité réelle.

### Critères de stop

- les artefacts deviennent bien rédigés mais peu utiles ;
- la provenance est trop pauvre ;
- la qualité dépend de prompts opportunistes plus que du flux structuré.

## Lot 6. Approvals et write boundary borné

### Objectif

Ajouter le flux de write intent minimal : champs simples, modifications bornées, arrêt avant soumission.

### Dépendances

- Lot 3
- Lot 4
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)

### Livrables attendus

- demandes d'approval claires ;
- exécution de write intents autorisés dans le slice ;
- gestion du refus ;
- vérification de l'état post-modification ;
- arrêt systématique avant soumission.

### Critères de validation

- l'operator comprend pourquoi il approuve ou refuse ;
- le refus ne casse pas le run ;
- aucune action engageante n'est franchie ;
- les preuves post-action confirment le bon état de champ.

### Critères de stop

- l'UX d'approvals devient fatigante ou opaque ;
- le système pousse vers submit/publish pour “terminer la tâche” ;
- le write boundary repose sur des exceptions manuelles non durables.

## Lot 7. Fermeture benchmarkée et autorisation de démo interne

### Objectif

Passer les familles minimales de benchmark et autoriser une démonstration interne honnête du prototype.

### Dépendances

- Lots 1 à 6
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)

### Livrables attendus

- exécution des benchmarks minimum ;
- dossier de preuves et revue humaine ;
- qualification des résultats par benchmark ;
- décision explicite de démo interne ou non.

### Critères de validation

- les familles obligatoires sont couvertes ;
- les résultats sont classés proprement ;
- aucun faux positif majeur n'est toléré ;
- la démonstration éventuelle reste dans le scope autorisé.

### Critères de stop

- la démo repose sur un scénario non benchmarké ;
- des échecs bloquants sont maquillés en succès partiels ;
- l'équipe commence à vendre une robustesse non démontrée.

## Résumé exécutable

Ordre obligatoire :

1. Lot 1
2. Lot 2
3. Lot 3
4. Lot 4
5. Lot 5
6. Lot 6
7. Lot 7

Le build ne doit pas sauter directement au write flow ou aux plateformes réelles.

Le premier lot est volontairement le plus sûr et le plus structurant :

- rendre le prototype testable avant de le rendre spectaculaire.
