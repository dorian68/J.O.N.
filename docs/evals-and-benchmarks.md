# Evals and benchmarks

## But du document

Définir comment le produit sera évalué plus tard, avant même tout build sérieux. Le but est double :

- éviter de construire un système impossible à juger objectivement,
- transformer les scénarios de référence en logique de validation progressive.

Ce document ne décrit pas un framework d'implémentation. Il décrit une discipline d'évaluation.

## Principes directeurs

- Les evals doivent suivre le produit réel, pas un laboratoire abstrait.
- Les scénarios de référence doivent alimenter directement les benchmarks.
- Une bonne évaluation ne mesure pas seulement la qualité textuelle, mais aussi :
  - le comportement runtime,
  - le respect des permissions,
  - la qualité de supervision,
  - la robustesse des outils,
  - l'utilité réelle des artefacts.
- Les évaluations doivent distinguer les causes d'échec :
  - mauvaise compréhension de mission,
  - mauvais contexte,
  - tool failure,
  - policy failure,
  - artifact failure,
  - UX failure.

## Couches d'évaluation

## 1. Evals produit

Question visée : "le système produit-il un résultat utile pour la mission demandée ?"

### Ce qu'on évalue

- adéquation de l'artefact à l'objectif,
- clarté de la restitution,
- actionnabilité du livrable,
- qualité de la provenance,
- besoin de retravail humain.

### Métriques candidates

- taux d'acceptation d'artefact,
- taux de demande d'affinage,
- temps jusqu'au premier livrable exploitable,
- couverture des critères de mission,
- taux de citations ou de sources correctement reliées.

## 2. Evals runtime

Question visée : "le moteur de run se comporte-t-il correctement ?"

### Ce qu'on évalue

- progression logique du run,
- qualité du plan initial,
- gestion des blocages,
- reprise après interruption,
- cohérence des événements typés.

### Métriques candidates

- taux de complétion de run,
- taux de pause / reprise réussie,
- nombre de révisions de plan utiles,
- taux d'échecs non expliqués,
- qualité de reconstruction d'un run à partir du journal.

## 3. Evals tools

Question visée : "les capacités instrumentées font-elles ce qu'on attend d'elles ?"

### Ce qu'on évalue

- fiabilité lecture fichiers,
- fiabilité extraction web,
- robustesse des actions réversibles,
- qualité de traçabilité des sources,
- stabilité des tools sensibles.

### Métriques candidates

- taux de succès par capacité,
- taux de tool misuse,
- taux d'échec silencieux,
- latence par famille de tools,
- différence entre résultat attendu et résultat réel.

## 4. Evals sécurité / policy

Question visée : "le système agit-il dans les bonnes limites ?"

### Ce qu'on évalue

- respect du périmètre projet,
- déclenchement correct des approvals,
- refus correct des actions interdites,
- résistance aux élargissements implicites de scope,
- robustesse face aux injections de contenu.

### Métriques candidates

- taux de demandes d'approval manquées,
- taux d'approvals inutiles,
- taux d'actions interdites bloquées correctement,
- taux de violations de policy,
- taux de dérives de scope.

## 5. Evals UX opérationnelle

Question visée : "le système est-il supervisable sans surcharge excessive ?"

### Ce qu'on évalue

- lisibilité du plan,
- lisibilité de la timeline,
- interprétabilité des approvals,
- facilité de revue des artefacts,
- compréhension des échecs et reprises.

### Métriques candidates

- temps moyen pour statuer sur une approval,
- taux d'erreurs opérateur sur approvals,
- charge perçue de supervision,
- taux de confusion entre reprendre / relancer / affiner,
- capacité à expliquer a posteriori ce qui s'est passé.

## Jeu de scénarios pour les futurs benchmarks

Les benchmarks doivent être ancrés dans les [scénarios de référence](./scenarios-de-reference.md).

### Noyau benchmark recommandé

| Scénario | Rôle dans le benchmark |
| --- | --- |
| Synthèse exécutive documentaire | cas de base pour artefact textuel et provenance |
| Rapport analytique à partir de CSV/XLSX | test de transformation de données en livrable |
| Enrichissement web borné puis note de décision | test du `browser control` et de la gestion des sources externes |
| Triage et réorganisation de dossier | test des approvals et des écritures réversibles |

### Jeux futurs complémentaires

- workflow web authentifié borné,
- génération de deck de travail,
- cas d'échec délibéré,
- cas d'injection de contenu ou de source trompeuse.

## Structure d'un benchmark de référence

Chaque benchmark doit contenir :

- une mission explicite,
- un projet ou workspace borné,
- des entrées connues,
- une policy d'approbation définie,
- un ou plusieurs artefacts attendus,
- des assertions de comportement,
- des assertions de sécurité,
- des assertions de qualité d'artefact,
- des critères de succès et de défaillance.

## Exemple de grille d'évaluation conceptuelle

| Axe | Question | Résultat attendu |
| --- | --- | --- |
| Compréhension | le système a-t-il compris la mission ? | plan cohérent et proportionné |
| Exécution | a-t-il suivi une progression lisible ? | run traçable et sans dérive majeure |
| Sources | les sources sont-elles bien reliées ? | provenance exploitable |
| Policy | les approvals ont-elles été correctement déclenchées ? | aucune action sensible non approuvée |
| Artefact | le livrable est-il utile ? | acceptabilité métier suffisante |
| Supervision | l'opérateur peut-il comprendre ce qui s'est passé ? | audit et reprise possibles |

## Causes d'échec à distinguer

Un benchmark ne doit pas se conclure par "échec" sans classification. Les catégories minimales recommandées sont :

- `mission_failure` : objectif mal compris,
- `context_failure` : mauvais contexte sélectionné,
- `tool_failure` : capacité outil insuffisante ou instable,
- `policy_failure` : approval manquante, en excès ou incorrecte,
- `artifact_failure` : livrable inexploitable,
- `ux_failure` : supervision ou reprise trop difficiles.

## Critères de réussite initiaux

Avant même de parler de performance avancée, un futur prototype devra démontrer :

- qu'il couvre explicitement quelques scénarios de référence,
- qu'il produit un artefact distinct du simple log,
- qu'il respecte la frontière d'approval prévue,
- qu'il laisse une trace exploitable de ses événements,
- qu'il sait échouer proprement sur un cas hors périmètre.

## Hypothèses fragiles

- La qualité perçue des artefacts pourra varier fortement selon la verticale choisie.
- Le niveau acceptable de supervision dépendra du type de mission.
- Les benchmarks web seront plus fragiles que les benchmarks purement locaux.

Ces hypothèses devront être validées par prototype, pas supposées vraies.

## Ce que ce document décide

- les evals sont une partie du design du produit, pas un sujet de fin de projet,
- les scénarios de référence sont la base des benchmarks,
- les évaluations doivent couvrir produit, runtime, tools, sécurité et UX,
- les causes d'échec doivent être classifiées.

## Liens avec le reste du corpus

- Les scénarios d'entrée sont décrits dans [scenarios-de-reference.md](./scenarios-de-reference.md).
- Les événements exploitables par ces evals sont définis dans [event-taxonomy.md](./event-taxonomy.md).
- Les limites du premier prototype sont dans [prototype-boundary-v1.md](./prototype-boundary-v1.md).
- Les risques de sécurité associés sont traités dans [threat-model.md](./threat-model.md).
