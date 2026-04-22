# Non-goals and kill criteria

## But du document

Expliciter ce que le produit n'essaie pas de faire au début, et définir les signaux qui indiqueraient qu'une direction est mauvaise.

Ce document complète la [vision produit](./vision-produit-cowork.md) et protège le projet contre les dérives séduisantes mais peu productives.

## Non-goals initiaux

Le produit ne cherche pas, dans sa première phase, à être :

- un assistant conversationnel généraliste,
- un CLI d'agents de code avec habillage desktop,
- un système d'automatisation totale du poste de travail,
- une plateforme multi-agent spectaculaire mais peu lisible,
- un orchestrateur universel de tous les outils de l'utilisateur,
- un système entreprise complet avec sync, administration et collaboration temps réel.

## Anti-objectifs

### 1. Maximiser la sensation d'autonomie au détriment de la supervision

Ce serait séduisant en démonstration, mais contraire au produit visé.

### 2. Étendre trop vite le périmètre d'actions externes

Le produit doit d'abord être bon sur :

- le cadrage,
- la qualité du run,
- la fiabilité des artefacts,
- la gouvernance des approvals.

### 3. Confondre richesse des tools et valeur produit

Un grand catalogue de tools ne compense pas :

- l'absence de scénario fort,
- l'absence d'artefact utile,
- l'absence de provenance,
- l'absence de contrôle.

### 4. Introduire le multi-agent comme raccourci

Le multi-agent est une possible extension. Ce n'est pas un remède aux faiblesses du moteur principal.

### 5. Construire une UX de chat et l'appeler coworker

Si l'utilisateur ne perçoit pas clairement projets, runs, approvals, sources et artefacts, le produit n'est pas dans sa forme cible.

## Signaux d'alerte précoces

Les signaux suivants indiqueraient une dérive probable :

- les démos les plus convaincantes reposent sur des cas très scriptés,
- l'équipe parle surtout de tools et peu des artefacts,
- le navigateur devient un simple fetch amélioré,
- les approvals sont vues comme une nuisance à masquer,
- les artefacts nécessitent presque toujours une réécriture lourde,
- le log du run sert de substitut au produit lui-même.

## Kill criteria structurants

## 1. Trop de friction opérateur

### Signal

L'utilisateur doit intervenir si souvent que le coworker devient plus coûteux à superviser qu'à remplacer manuellement.

### Interprétation

Le design des approvals, la qualité du plan ou la granularité des actions est mauvaise.

### Conséquence

Réduire le périmètre et revoir les flux avant d'élargir les capacités.

## 2. Qualité trop faible des artefacts

### Signal

Les livrables sont trop génériques, insuffisamment traçables ou exigent un retravail massif.

### Interprétation

Le cœur outcome du produit n'est pas encore atteint.

### Conséquence

Stopper l'élargissement de tools tant que le contrat d'artefact n'est pas mieux tenu.

## 3. Coût d'exécution trop élevé

### Signal

Le coût en modèle, supervision ou temps de run devient disproportionné par rapport à la valeur du livrable.

### Interprétation

Le contexte est mal sélectionné, le runtime tourne trop longtemps, ou les scénarios sont trop larges pour la phase.

### Conséquence

Réduire les scénarios, améliorer la sélection de contexte, différer certaines ambitions.

## 4. Complexité multi-agent injustifiée

### Signal

La délégation ajoute plus d'opacité, de coût et de coordination qu'elle n'apporte de valeur.

### Interprétation

Le moteur principal n'est pas encore assez solide pour supporter la complexité supplémentaire.

### Conséquence

Revenir à un mono-agent supervisé tant que les bénéfices ne sont pas démontrés sur des sous-tâches précises.

## 5. Browser control trop fragile

### Signal

Les scénarios web échouent souvent, nécessitent trop de contournements ou deviennent incompréhensibles à auditer.

### Interprétation

La couche navigateur est insuffisamment bornée ou trop ambitieuse.

### Conséquence

Recentrer le périmètre web sur la lecture et la collecte bornée avant d'aller plus loin.

## 6. UX de supervision trop lourde

### Signal

L'opérateur ne comprend plus où en est le run, ce qu'il a autorisé ni ce qui a réellement produit le livrable.

### Interprétation

Le produit a perdu sa lisibilité.

### Conséquence

Revoir les flux, les événements visibles et la hiérarchie des objets avant de continuer.

## Directions séduisantes mais dangereuses

- "Faire du general computer use très tôt"
- "Masquer les approvals pour donner une impression de fluidité"
- "Autoriser plus largement pour réduire la friction"
- "Ajouter des connecteurs pour paraître plus complet"
- "Passer au multi-agent pour compenser un mono-agent faible"

Ces directions peuvent produire de belles démos et un mauvais produit.

## Ce que ce document décide

- le projet assume des non-goals forts au départ,
- certaines directions doivent être stoppées si elles dégradent lisibilité, sûreté ou qualité d'artefact,
- l'élargissement des capacités n'est jamais prioritaire sur la valeur outcome et la supervision.

## Ce qui reste ouvert

- les seuils quantitatifs exacts des kill criteria,
- le niveau acceptable de coût par scénario,
- le moment précis où une capacité post-MVP devient raisonnable.

Ces points dépendront des futurs prototypes et des premières evals.

## Liens avec le reste du corpus

- La frontière du premier prototype est définie dans [prototype-boundary-v1.md](./prototype-boundary-v1.md).
- Les scénarios d'entrée sont dans [scenarios-de-reference.md](./scenarios-de-reference.md).
- Les critères d'évaluation futurs sont détaillés dans [evals-and-benchmarks.md](./evals-and-benchmarks.md).
- Les risques de sécurité qui peuvent justifier un arrêt ou un recentrage sont dans [threat-model.md](./threat-model.md).
