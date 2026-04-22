# Development Guidelines V1

## Statut

Normative development document.

Ce document guide le futur run de développement du prototype autorisé. Il ne décrit pas comment coder une fonctionnalité ligne par ligne. Il fixe la discipline de build.

Documents liés :
- [final-launch-decision.md](./final-launch-decision.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

## 1. Hiérarchie documentaire à respecter

En cas de doute, de conflit ou d'interprétation possible, l'ordre de priorité est :

1. [final-launch-decision.md](./final-launch-decision.md)
2. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
3. [prototype-slice-v1.md](./prototype-slice-v1.md)
4. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
5. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
6. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
7. [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
8. [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
9. [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
10. [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
11. [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
12. [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
13. [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md)
14. le reste du corpus canonique
15. les documents exploratoires antérieurs

Règle simple :

- `le document le plus étroit et le plus récent prime`

## 2. Principes de build

### Build the slice, not the ambition

Le build doit implémenter le slice fermé, pas la promesse long terme du produit.

Le bon comportement n'est pas :

- “tant qu'on y est, ajoutons login”
- “tant qu'on y est, branchons LinkedIn”
- “tant qu'on y est, ajoutons upload”

Le bon comportement est :

- fermer d'abord un flux réel, étroit, benchmarkable.

### Benchmark-first

Aucune capacité ne doit être considérée comme “fonctionnelle” parce qu'elle marche sur une démo unique.

Le build doit être pensé dès le départ pour être jugé sur :

- des fixtures ;
- des scénarios ;
- des preuves ;
- des benchmarks ;
- une revue humaine.

### Evidence-first

Toute action importante doit laisser assez de traces pour répondre plus tard à :

- qu'est-ce qui a été ciblé ;
- pourquoi ;
- quel résultat était attendu ;
- quel résultat a été observé ;
- pourquoi le système a continué, demandé approval ou arrêté.

### Policy-before-action

Une action ne devient pas acceptable parce qu'elle est techniquement faisable.

Le runtime doit passer par :

- classification du risque ;
- vérification du scope ;
- décision d'approval ou de blocage ;
- puis seulement action.

### Read-first, then bounded write

Le développement doit progresser d'abord sur les capacités de lecture, navigation, inspection et vérification.

Les write intents ne viennent qu'après :

- lecture fiable ;
- ciblage fiable ;
- preuves fiables ;
- approvals compréhensibles.

## 3. Principes de sécurité

- Safe-by-default prime sur effet démo.
- Aucune action engageante ne doit être ajoutée “temporairement”.
- Aucune logique de stealth, d'évitement anti-bot ou de contournement de plateforme.
- Aucune récupération ou persistance de credentials.
- Aucun élargissement implicite du domaine d'action.
- Toute ambiguïté majeure doit conduire à un stop, pas à une insistance aveugle.

## 4. Principes de persistance

- Persister le minimum utile pour reprise, audit et review.
- Ne pas persister ce qui n'est utile qu'au pilotage transitoire.
- Les preuves retenues doivent être sélectionnées, pas exhaustives.
- Les secrets, cookies, tokens, états auth et dumps bruts de page ne doivent pas être conservés par défaut.
- Toute nouvelle donnée persistée doit être justifiée par :
  - un besoin de reprise,
  - un besoin d'audit,
  - ou un besoin benchmark clairement identifié.

Règle de refus :

- si la raison réelle est “ça peut toujours servir”, la donnée ne doit pas être persistée.

## 5. Principes de browser control

- `DOM-first` est obligatoire.
- Le visuel ne doit pas devenir la stratégie dominante de contrôle.
- Pas de dépendance primaire à des sélecteurs fragiles ou à des temporisations arbitraires.
- Toute interaction doit être précédée d'une vérification d'actionnabilité suffisante.
- Toute interaction significative doit être suivie d'une vérification d'outcome.
- Le système doit savoir s'arrêter proprement sur :
  - élément ambigu,
  - état non vérifié,
  - modal bloquante,
  - navigation inattendue,
  - surface hors périmètre.

## 5.1. Principes de computer control

- Le `computer control` fait partie du produit, mais pas comme voie primaire.
- Dans ce prototype, le `computer control` est `observability-first`.
- Le `computer control` ne doit jamais remplacer un chemin DOM valide.
- La première fonction du `computer control` est de qualifier le contexte local, de produire des preuves et de vérifier un état visible.
- Le premier build n'a pas le droit d'introduire une automation desktop générale.
- Les primitives desktop actives restent bloquées tant qu'une gate spécifique n'est pas rouverte.

Hiérarchie obligatoire :

1. DOM navigateur
2. fallback navigateur
3. `computer control` borné
4. stop

Dans le premier build, sont admissibles côté desktop :

- détection de fenêtre active ;
- focus de fenêtre allowlistée ;
- capture de fenêtre ou région ;
- attente d'état visible ;
- vérification visible d'outcome ;
- export de preuves.

Dans le premier build, restent interdits côté desktop :

- cursor move ;
- click ;
- double click ;
- right click ;
- drag ;
- keyboard input ;
- hotkeys ;
- dialogues système réels ;
- automation locale multi-app.

## 6. Principes d'approvals

- Une approval doit arriver assez tard pour être concrète, mais avant l'acte risqué.
- Une approval ne doit jamais être une demande vague du type “autoriser la suite ?”.
- Toute approval doit porter sa justification, son impact, sa cible et son evidence link.
- La lecture simple sur surface autorisée ne doit pas générer de fatigue artificielle.
- Un refus doit être respecté sans contournement.
- Les approvals ne doivent pas servir à compenser une incapacité du système à vérifier correctement une action.

## 7. Principes de preuves et d'audit

- Les événements typés doivent être exploitables, pas décoratifs.
- Une preuve utile vaut mieux qu'une grande quantité de logs bruts.
- Le lien entre source, action, outcome, approval et artefact doit rester intelligible.
- L'audit ne doit pas dépendre de la mémoire de l'opérateur.
- Toute “réussite” sans preuve suffisante doit être traitée comme non démontrée.

## 8. Principes benchmark-first

- Les fixtures minimales sont un prérequis pratique du build utile.
- Les benchmarks doivent précéder les revendications de robustesse.
- La revue humaine fait partie du protocole, elle n'est pas un supplément optionnel.
- Les benchmarks doivent couvrir aussi les refus, blocages et arrêts propres.
- Un faux positif est pire qu'un échec honnête.
- Les benchmarks `computer control` doivent juger d'abord l'observation, le focus gouverné et la preuve, pas la démonstration d'actuation locale.

## 9. Principes de non-dérive de scope

Le build n'a pas le droit de dériver vers :

- auth réelle ;
- plateformes sensibles comme terrain principal ;
- soumission ou publication ;
- upload ;
- rich editors ;
- desktop control généralisé ;
- second agent autonome ;
- automatisation de masse.

Règle :

- toute capacité nouvelle hors slice doit être refusée ou faire l'objet d'une réouverture documentaire formelle.

## 10. Anti-patterns de développement à éviter

- construire d'abord la démo au lieu du système testable ;
- ajouter une capacité pour “prouver qu'on sait le faire” sans benchmark associé ;
- masquer les erreurs derrière un artefact bien rédigé ;
- sur-persister les états navigateur pour débugger plus facilement ;
- multiplier les approvals parce que le ciblage DOM est faible ;
- compenser un ciblage fragile par du retry aveugle ou des sleeps ;
- laisser un fallback visuel sauver la majorité des cas ;
- réintroduire un agent autonome supplémentaire pour corriger une architecture mal fermée.

## 11. Quand il faut rouvrir la documentation

Le build doit être stoppé et la documentation rouverte si :

- le slice réel ne suffit plus pour démontrer une valeur minimale ;
- les approvals deviennent inexploitables malgré le contrat actuel ;
- la persistance minimale ne permet pas la reprise utile ;
- le browser control ne tient pas sans capacités actuellement hors scope ;
- les benchmarks montrent que la stratégie `DOM-first` retenue n'est pas viable même sur surfaces contrôlées ;
- l'équipe souhaite réintroduire un agent autonome de vérification.

## 12. Définition d'un bon progrès de build

Un bon progrès de build :

- réduit le risque structurel du prototype ;
- améliore la capacité à réussir un benchmark, pas une démo ;
- rend le run plus intelligible ;
- renforce la qualité des preuves ;
- rapproche le système d'un flux complet autorisé.

Un mauvais progrès de build :

- élargit le scope ;
- complexifie le runtime sans gain benchmarké ;
- améliore l'apparence du résultat sans renforcer sa traçabilité ;
- rend le prototype plus difficile à juger honnêtement.
