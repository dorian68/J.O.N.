# Analyse de la référence `claw-code`

## 1. Objet du document

Ce document transforme l'audit de `REFERENCE/claw-code` en référence durable pour le projet Cowork IA.

Le but n'est pas de juger `claw-code` comme produit final, mais d'identifier précisément :

- ce qu'il démontre bien,
- ce qu'il apporte comme inspiration runtime,
- ce qu'il ne couvre pas pour un coworker desktop/browser,
- et ce qu'il serait dangereux de recopier tel quel.

## 2. Périmètre et niveau de vérification

L'analyse a porté sur :

- la documentation racine du dépôt,
- le workspace Rust canonique,
- le workspace Python compagnon,
- les modules runtime, tools, permissions, plugins, MCP, worker boot, sessions,
- les fichiers de parité et de roadmap,
- les tests Python exécutables localement dans cet environnement.

Limites explicites de vérification :

- la partie Rust n'a pas pu être compilée ou testée ici, car `cargo` n'est pas disponible dans l'environnement courant,
- la partie Python a en revanche été exécutée localement et `22` tests ont passé,
- l'analyse de fond repose donc surtout sur lecture structurée du code, de la documentation et des contrats exposés.

## 3. Ce qu'est réellement `claw-code`

`claw-code` est avant tout un **CLI agentique orienté code**, avec un runtime de conversation, une surface de tools large, un système de plugins, des hooks, un support MCP et une logique de sous-agents.

Ce n'est pas un produit desktop orienté livrables métier.

Les points les plus importants :

- le runtime canonique est le workspace Rust,
- le dossier Python est un workspace compagnon de portage, d'audit et de snapshots,
- le produit est pensé comme un **agent harness** et non comme un coworker de bureau,
- l'orientation principale est l'exécution de tâches de code, la coordination d'agents et le contrôle d'un flux CLI.

## 4. Ce que `claw-code` fait bien

### 4.1 Runtime agentique CLI cohérent

Le projet a une vraie boucle d'exécution conversationnelle :

- session persistée,
- prompt système construit dynamiquement,
- appels modèle en streaming,
- exécution d'outils,
- résultats d'outils réinjectés dans la conversation,
- permissions et hooks autour des tools.

Pour un futur Cowork IA, c'est une source d'inspiration crédible pour le cœur runtime.

### 4.2 Discipline de configuration

Le chargeur de configuration hiérarchique est une bonne pratique réutilisable :

- scope utilisateur,
- scope projet,
- scope local,
- fusion cohérente des sections,
- validation des fichiers.

### 4.3 Importance des événements structurés

`claw-code` insiste fortement sur les événements typés, l'observabilité et la lisibilité machine.

C'est une leçon majeure.

### 4.4 Permissions et garde-fous

Le système de permissions est l'une des briques les plus intéressantes du dépôt :

- niveaux d'accès,
- requirements par tool,
- règles allow / deny / ask,
- possibilité de prompting,
- enforcer distinct de la politique.

### 4.5 Plugins, hooks et extensibilité

Le plugin system et les hooks lifecycle montrent une volonté claire d'ouvrir le runtime sans déformer son cœur.

### 4.6 MCP et mode dégradé

La partie MCP est intéressante surtout pour sa philosophie de robustesse :

- gestion du cycle de vie,
- distinction entre serveurs disponibles et dégradés,
- rapport de dégradation structuré,
- capacité à fonctionner partiellement quand tout n'est pas vert.

### 4.7 Harness de parité et scénarios scriptés

Le projet a le bon réflexe de tester le runtime via des scénarios déterministes avec service mock.

Cette pratique est directement réutilisable pour notre projet.

## 5. Matrice de décision vis-à-vis de `claw-code`

| Axe | Lecture | Décision pour Cowork IA |
|---|---|---|
| Runtime conversationnel | Solide et réutilisable conceptuellement | `Reprendre` |
| Configuration hiérarchique | Très utile | `Reprendre` |
| Permissions et enforcer | Bonne base conceptuelle | `Adapter` |
| Événements structurés | Excellent signal | `Reprendre` |
| Plugins / hooks / skills | Intéressant mais à recadrer | `Adapter` |
| MCP runtime | Utile comme inspiration de connectivité | `Adapter` |
| Sous-agents / task/team/cron | Idées utiles mais surface encore approximative | `Adapter fortement` |
| UX CLI / slash commands | Hors cible produit | `Rejeter comme forme produit` |
| WebFetch / WebSearch | Insuffisant pour un vrai navigateur contrôlé | `Rejeter comme couche browser finale` |
| Default `danger-full-access` | Incompatible avec notre cible produit | `Rejeter` |
| Python porting workspace | Utile comme archive et audit | `Ne pas prendre comme base runtime` |

## 6. Ce que nous reprenons

- la séparation nette entre runtime, tools et configuration,
- le couple `session + runtime loop`,
- les événements typés comme contrat transverse,
- le pattern `permission policy -> prompt -> enforcer -> tool execution`,
- le pattern `degraded mode` pour connecteurs et MCP,
- le harness de tests scénarisés.

## 7. Ce que nous adaptons

- sous-agents, tâches, équipes et cron,
- plugins et skills,
- recovery,
- policy engine.

Les concepts sont utiles, mais la forme actuelle est trop orientée code, CLI et contrôle technique.

## 8. Ce que nous rejetons tel quel

- la forme produit CLI-first,
- le cadrage trop code-centric,
- l'équivalence trompeuse `web = WebFetch/WebSearch`,
- le défaut `danger-full-access`,
- la largeur de surface avant la cohérence produit.

## 9. Leçons structurelles

### 9.1 Ne pas confondre surface de commande et maturité produit

Une grande surface de commandes ne garantit ni robustesse ni qualité produit.

### 9.2 Le runtime mérite d'être un produit interne à part entière

Un bon produit agentique ne peut pas reposer sur un runtime improvisé.

### 9.3 Les états explicites valent plus que les heuristiques implicites

Les événements structurés et les state machines sont préférables aux logs ambigus.

### 9.4 Les modes dégradés doivent être assumés

La réalité d'un agent outillé est celle de systèmes partiellement cassés.

## 10. Limites pour un coworker desktop/browser

`claw-code` n'apporte pas encore ce qu'il faut pour notre cible sur :

- un shell desktop produit,
- une vraie couche browser contrôlée,
- une vraie couche computer use,
- un moteur d'artefacts métier,
- un modèle workspace/projet suffisamment orienté produit.

## 11. Position finale

La bonne posture vis-à-vis de `claw-code` est la suivante :

- **référence runtime et harness** : oui,
- **référence produit** : non,
- **squelette direct du futur Cowork IA** : non,
- **source de leçons d'architecture** : oui.

En résumé :

`claw-code` montre comment penser une partie du moteur.

Il ne montre pas encore comment construire le produit que nous voulons.
