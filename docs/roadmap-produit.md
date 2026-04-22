# Roadmap produit

## But du document

Décrire une trajectoire de construction réaliste pour le produit cible, sans sauter directement au multi-agent ou à l'automatisation large. La roadmap doit :

- préserver la cohérence avec la [vision produit](./vision-produit-cowork.md),
- refléter les contraintes de sûreté décrites dans [permissions-trust-safety.md](./permissions-trust-safety.md),
- préparer les choix d'architecture détaillés dans [architecture-cible.md](./architecture-cible.md),
- éviter de lancer trop tôt des couches produit qui ne seraient ni testables ni auditables.

Ce document ne décrit pas un planning calendaire. Il décrit une séquence de maturité produit et technique.

## Principes de séquencement

### 1. Stabiliser le cadre avant d'accélérer l'exécution

Le produit vise des actions réelles sur fichiers, navigateur et potentiellement ordinateur. Sans cadre documentaire et architectural solide, la vitesse de prototypage produit surtout de la dette.

### 2. Construire le mono-agent supervisé avant la délégation multi-agent

Un système multi-agent ne répare pas un agent principal insuffisamment fiable. Il augmente au contraire :

- la difficulté d'observation,
- le coût d'exécution,
- la complexité des permissions,
- la difficulté d'expliquer les erreurs.

### 3. Livrer d'abord une chaîne de valeur restreinte mais complète

La bonne progression n'est pas "plus d'outils le plus vite possible". La bonne progression est :

1. mission claire,
2. contexte pertinent,
3. exécution contrôlée,
4. validation,
5. artefact final exploitable.

### 4. Différer les couches coûteuses tant qu'elles ne sont pas justifiées

Sont à retarder tant qu'un besoin précis n'est pas démontré :

- orchestration multi-agent avancée,
- synchronisation cloud temps réel,
- marketplace de skills,
- automation desktop large et non bornée,
- administration entreprise complexe.

## Vue d'ensemble des phases

| Phase | Finalité | Sortie attendue |
| --- | --- | --- |
| Phase 0 | Documentation structurante | Corpus cohérent, décisions cadrées, inconnues explicites |
| Phase 1 | Architecture et conventions | Architecture cible, interfaces conceptuelles, critères de validation |
| Phase 2 | Prototype technique | Démonstrateur mono-agent sur scénarios bornés |
| Phase 3 | MVP produit | Desktop coworker local-first avec runs, approvals, artefacts |
| Phase 4 | Produit solide | Robustesse, observabilité, connecteurs, reprise longue durée |

## Phase 0. Documentation structurante

### Objectifs

- Fixer le vocabulaire et les objets métier.
- Clarifier la nature exacte du produit cible.
- Transformer l'audit de `claw-code` en référence durable.
- Distinguer clairement décisions, hypothèses et questions ouvertes.

### Livrables

- corpus `docs/` canonique,
- ADRs fondatrices,
- cartographie des dépendances de conception,
- premières hypothèses de roadmap et de périmètre.

### Risques

- documentation trop abstraite pour être exploitable,
- vocabulaire incohérent entre documents,
- confusion persistante entre runtime de code et produit coworker,
- décisions implicites non tracées.

### Critères de sortie

- un lecteur externe peut comprendre le produit cible sans recourir à l'historique du chat,
- les différences entre `chat`, `CLI agent`, `desktop coworker` sont explicites,
- les apports réels de `claw-code` sont documentés sans ambiguïté,
- les grandes zones non tranchées sont listées et priorisées.

## Phase 1. Architecture et conventions

### Objectifs

- Transformer la vision en architecture exploitable.
- Définir les contrats conceptuels entre couches.
- Fixer la stratégie de persistance locale, d'audit et de permissions.
- Préparer les critères d'évaluation d'un futur prototype.

### Livrables

- architecture logique plus détaillée,
- conventions sur événements typés et cycle de vie d'un run,
- modèle conceptuel de stockage local,
- stratégie de contexte, de skills et d'artefacts,
- cadrage des couches navigateur et computer use.

### Risques

- sur-spécification prématurée,
- mélange entre besoins produit et choix de framework,
- sous-estimation de la complexité des approbations,
- oubli des scénarios de reprise et d'annulation.

### Critères de sortie

- les blocs système et leurs interfaces conceptuelles sont clairs,
- la granularité des objets métier est suffisante pour un prototype,
- la taxonomie des permissions est définie,
- le futur build peut démarrer sans redécider les fondations à chaque étape.

## Phase 2. Prototype technique

### Objectifs

- Valider la faisabilité du cœur mono-agent supervisé.
- Tester le couple `planification + exécution + approvals + artefact`.
- Prouver qu'un navigateur contrôlé apporte plus qu'un simple fetch/search.
- Mesurer les premiers points de friction UX et sûreté.

### Périmètre recommandé

Le prototype doit rester étroit :

- un shell desktop minimal,
- un nombre réduit de tools,
- un nombre réduit de types d'artefacts,
- des scénarios de démonstration reproductibles.

### Livrables

- prototype exécutable sur machine locale,
- runs observables avec journal d'événements,
- approvals fonctionnels,
- production d'au moins deux artefacts utiles,
- premières évaluations qualitatives sur scénarios cibles.

### Risques

- prototype trop large et donc peu fiable,
- confusion entre démo impressionnante et boucle produit solide,
- manque de scénarios de test réalistes,
- dette technique forte si les événements et permissions ne sont pas structurés dès le départ.

### Critères de sortie

- au moins un flux complet "objectif -> run -> approval -> artefact" fonctionne,
- le système sait suspendre, reprendre et expliquer un échec simple,
- la différence entre `browser control` et `fetch/search` est démontrée,
- le coût de supervision humaine reste acceptable.

## Phase 3. MVP produit

### Objectifs

- Construire une première version réellement utilisable par une personne seule.
- Stabiliser l'expérience projet/workspace.
- Fournir des livrables réutilisables et exportables.
- Réduire l'écart entre démonstration et usage réel.

### Capacités minimales

- desktop app installable,
- projets et workspaces,
- import de fichiers locaux,
- moteur de run mono-agent supervisé,
- plan visible,
- approvals paramétrables,
- historique de run,
- artefacts versionnés,
- navigateur contrôlé sur périmètre borné.

### Livrables

- MVP utilisable en autonomie sur des cas d'usage précis,
- documentation d'usage,
- corpus de scénarios d'évaluation,
- métriques de base : temps au premier livrable, taux de complétion, taux de reprise.

### Risques

- fatigue d'approbation,
- artefacts trop génériques ou peu exploitables,
- interface trop proche d'un chat,
- absence de citations/sources dans les livrables,
- montée rapide des coûts de modèle si le contexte est mal sélectionné.

### Critères de sortie

- l'utilisateur peut confier une mission claire et récupérer un livrable utile sans bricolage excessif,
- le système garde une trace claire des actions,
- les permissions sont compréhensibles et configurables,
- les artefacts sont retrouvables, relançables et exportables.

## Phase 4. Produit solide

### Objectifs

- Rendre le produit robuste sur missions plus longues et plus variées.
- Ajouter les connecteurs et couches d'observabilité nécessaires à un usage sérieux.
- Commencer à explorer des formes limitées de délégation multi-agent sous supervision.

### Livrables

- reprise longue durée fiable,
- connecteurs supplémentaires bornés,
- moteur d'évaluation plus riche,
- métriques d'usage et de coût par run,
- premières capacités de sous-tâches spécialisées supervisées.

### Risques

- explosion de complexité du fait des connecteurs,
- régression de sécurité lors de l'ouverture de nouvelles actions externes,
- difficultés de cohérence entre plusieurs agents,
- UX opaque si la délégation n'est pas visible.

### Critères de sortie

- le produit reste auditables malgré l'élargissement du périmètre,
- les nouveaux tools s'intègrent dans le même modèle de permissions,
- la qualité des artefacts reste supérieure à celle d'un simple chat,
- les sous-agents éventuels restent optionnels, bornés et traçables.

## Ce qui ne doit pas arriver trop tôt

### Multi-agent généralisé

À retarder tant que le mono-agent principal ne sait pas :

- planifier proprement,
- exécuter avec état,
- demander les bonnes approbations,
- produire un artefact fiable,
- expliquer ce qu'il a fait.

### Computer use non borné

À retarder tant que :

- les garde-fous ne sont pas éprouvés,
- l'audit n'est pas complet,
- les scénarios cibles n'exigent pas réellement une interaction desktop large.

### Cloud sync ambitieux

À retarder tant que :

- le modèle local de projet et de run n'est pas stabilisé,
- les objets métier ne sont pas suffisamment bien définis,
- les contraintes de confidentialité ne sont pas clairement documentées.

## Dépendances entre phases

| Dépendance | Pourquoi elle compte |
| --- | --- |
| Architecture stable avant prototype large | évite de figer trop tôt une mauvaise forme produit |
| Permissions avant tools sensibles | empêche une démo dangereuse ou incohérente |
| Modèle d'artefacts avant UX de run | garantit une orientation outcome plutôt que chat |
| Stratégie de contexte avant extension des connecteurs | contrôle le coût et la qualité des réponses |
| Journal d'événements avant multi-agent | condition minimale d'audit et de débogage |

## Recommandation synthétique

La séquence recommandée est la suivante :

1. consolider la documentation et les ADRs,
2. figer l'architecture conceptuelle et les objets métier,
3. prototyper un mono-agent supervisé sur cas bornés,
4. construire un MVP outcome-centric avec approvals et artefacts,
5. n'ouvrir les connecteurs, la délégation et le computer use qu'après validation des fondations.

Cette roadmap est volontairement conservatrice. Pour ce produit, la discipline d'architecture et de sûreté est un accélérateur, pas un frein.
