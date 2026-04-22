# Tooling and capabilities map

## But du document

Cartographier les capacités nécessaires du produit, séparées de leurs implémentations futures. Une capacité est quelque chose que le produit doit savoir faire. Un tool est un moyen concret de fournir cette capacité.

Cette distinction est importante pour éviter deux erreurs :

- raisonner en inventaire de tools sans logique produit,
- sous-spécifier des capacités critiques en croyant qu'un outil générique suffira.

## Principes de lecture

- `Cœur MVP` : capacité nécessaire à une première boucle produit crédible.
- `Post-MVP` : capacité utile après validation du socle.
- `Spéculative` : capacité potentiellement intéressante, mais encore dangereuse ou non justifiée.

## Vue synthétique

| Domaine | Capacité | Stade | Valeur produit | Risque | Dépendances | Testabilité future |
| --- | --- | --- | --- | --- | --- | --- |
| File tools | lire fichiers du projet | Cœur MVP | accès à la matière de travail | faible | workspace borné, source tracking | élevée |
| File tools | écrire dans une zone d'artefacts dédiée | Cœur MVP | persistance des livrables | moyen | permissions, versioning | élevée |
| File tools | déplacer / renommer de façon réversible | Cœur MVP | réorganisation contrôlée de dossier | moyen à élevé | approvals, journal d'audit | élevée |
| File tools | suppression ou écriture destructrice | Spéculative | faible valeur initiale | très élevé | rollback, policy forte | moyenne |
| Browser control | navigation contrôlée en lecture | Cœur MVP | enrichissement web réel | moyen | policy, source capture | moyenne à élevée |
| Browser control | extraction structurée de contenu consulté | Cœur MVP | provenance web exploitable | moyen | browser state, source model | moyenne |
| Browser control | téléchargement vers le projet | Cœur MVP | intégration d'une source externe | moyen | approvals, périmètre projet | moyenne |
| Browser control | formulaires et authentification simple | Post-MVP | accès à applications utiles | élevé | policy, UX d'approval | faible à moyenne |
| Browser control | soumission / mutation externe | Spéculative | forte valeur mais très risquée | très élevé | validations fortes, audit riche | faible |
| Computer control | interaction desktop bornée | Post-MVP | couvrir des cas hors navigateur | élevé | vision, permissions, audit | faible |
| Computer control | contrôle généraliste multi-app | Spéculative | démonstration séduisante | très élevé | supervision lourde | très faible |
| Connectors | lecture seule de sources métiers | Post-MVP | profondeur produit par verticale | moyen | auth, policy, source mapping | moyenne |
| Connectors | mutation via systèmes externes | Spéculative | automatisation forte | très élevé | trust model avancé | faible |
| Artifact generation | note de synthèse | Cœur MVP | livrable immédiatement utile | faible à moyen | sources, templates, versioning | élevée |
| Artifact generation | rapport analytique | Cœur MVP | forte valeur métier | moyen | données tabulaires, citations | moyenne à élevée |
| Artifact generation | plan d'action / note de décision | Cœur MVP | transforme l'analyse en action | moyen | bon cadrage d'objectif | élevée |
| Artifact generation | deck riche / présentation finalisée | Post-MVP | valeur perçue forte | moyen | structure narrative, export | moyenne |
| Search / retrieval | indexation légère par projet | Cœur MVP | contexte ciblé | faible | stockage, source tracking | élevée |
| Search / retrieval | recherche sémantique / hybride | Cœur MVP | sélection du bon contexte | faible à moyen | index, scoring | élevée |
| Search / retrieval | recherche transversale multi-projets | Post-MVP | productivité accrue | moyen | gouvernance du scope | moyenne |
| Memory / context | mémoire de run structurée | Cœur MVP | reprise et audit | faible | event taxonomy, state model | élevée |
| Memory / context | mémoire de projet | Cœur MVP | continuité de travail | moyen | persistance, curation | moyenne |
| Memory / context | mémoire utilisateur globale | Post-MVP | personnalisation | moyen | gouvernance, confidentialité | moyenne |
| Supervision / audit | journal d'événements typés | Cœur MVP | audit, UI, debug, evals | faible | runtime structuré | élevée |
| Supervision / audit | replay / reconstruction d'un run | Cœur MVP | confiance et diagnostic | moyen | event log cohérent | moyenne |
| Supervision / audit | scoring automatique de run | Post-MVP | observabilité produit | moyen | evals, benchmark data | moyenne |

## Lecture par domaine

## 1. File tools

### Pourquoi ces capacités existent

Le produit traite d'abord des fichiers, documents, exports et artefacts. Les capacités fichier ne sont pas des commodités périphériques; elles sont au cœur du travail délégué.

### Recommandation

Commencer avec :

- lecture bornée,
- écriture dans une zone d'artefacts,
- opérations réversibles de réorganisation.

Différer :

- suppression destructrice,
- réécriture large hors périmètre projet.

## 2. Browser control

### Pourquoi ces capacités existent

Le fetch simple ne couvre pas des missions réelles où le contenu utile dépend :

- de navigation,
- de rendu,
- d'interactions limitées,
- de capture de provenance.

### Recommandation

Le cœur MVP doit inclure un vrai `browser control` en lecture et collecte structurée, mais pas encore une couche de mutation externe large.

## 3. Computer control

### Pourquoi cette capacité est attractive

Elle promet une extension très large du champ d'action produit.

### Pourquoi elle est dangereuse

- état applicatif souvent ambigu,
- audit plus difficile,
- permissions plus délicates,
- démonstrations impressionnantes mais fragiles.

### Recommandation

Ne pas la rendre structurante pour le premier prototype.

## 4. Connectors

### Pourquoi ils comptent

Ils peuvent créer une forte valeur par verticale, mais ils élargissent la surface de sécurité et de support.

### Recommandation

Les considérer comme accélérateurs de profondeur produit après validation du socle local + browser.

## 5. Artifact generation

### Pourquoi cette famille est centrale

Le produit est outcome-centric. Si la génération d'artefacts n'est pas robuste, le reste du système perd sa justification.

### Recommandation

Concentrer le MVP sur peu de types d'artefacts, mais avec un vrai contrat de qualité.

## 6. Search / retrieval

### Pourquoi cette famille est centrale

Un mauvais choix de contexte dégrade à la fois coût, précision et lisibilité du run.

### Recommandation

Faire de la sélection de contexte une capacité fondamentale, pas une optimisation tardive.

## 7. Memory / context tools

### Pourquoi cette famille est nécessaire

Un coworker utile doit se souvenir juste assez pour poursuivre une mission, sans injecter l'intégralité du projet dans chaque étape.

### Recommandation

Priorité à la mémoire de run structurée et à la mémoire de projet bornée.

## 8. Supervision / audit tools

### Pourquoi cette famille est structurante

Sans audit, le produit peut faire des choses impressionnantes mais restera difficile à fiabiliser, à expliquer et à faire évoluer.

### Recommandation

Les capacités d'observation ne sont pas un luxe post-MVP. Elles font partie du cœur.

## Ce que cette carte décide

- le produit doit être décrit en capacités avant d'être décrit en outils concrets,
- `browser control` est cœur MVP,
- `computer control` n'est pas cœur MVP,
- `journal d'événements` et `mémoire de run` sont des capacités de premier rang,
- les mutations externes restent hors du cœur initial.

## Ce que cette carte ne décide pas encore

- l'outil exact derrière chaque capacité,
- la forme finale du catalogue de tools,
- le degré de mutualisation entre capacités et skills,
- l'architecture d'extension des connecteurs.

## Liens avec le reste du corpus

- Les scénarios qui justifient ces capacités sont décrits dans [scenarios-de-reference.md](./scenarios-de-reference.md).
- Le modèle de sécurité associé est détaillé dans [permissions-trust-safety.md](./permissions-trust-safety.md) et [threat-model.md](./threat-model.md).
- La frontière du premier prototype est formalisée dans [prototype-boundary-v1.md](./prototype-boundary-v1.md).
