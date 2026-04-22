# Workspaces, projets et artefacts

## 1. Objet du document

Ce document définit les objets métier principaux du futur produit.

Le point important est le suivant :

le produit ne doit pas être pensé comme une simple suite de sessions de chat, mais comme un système persistant de travail délégué.

## 2. Pourquoi ce modèle métier est central

Sans objets métier explicites, le produit retombe en :

- conversation,
- prompts,
- exécutions outillées,
- et logs.

Avec un bon modèle métier, on obtient au contraire :

- continuité de travail,
- réutilisation des sources,
- traçabilité des runs,
- versioning des livrables,
- mémoire de projet,
- et meilleure supervision produit.

## 3. Définitions canoniques

## 3.1 Workspace

Le `workspace` est l'environnement persistant de travail.

Il définit :

- un périmètre de fichiers ou de dossiers,
- des connecteurs autorisés,
- des règles de permission par défaut,
- des instructions persistantes,
- des préférences de comportement,
- des projets associés,
- des index et mémoires locales.

Le workspace est la frontière de confiance primaire.

## 3.2 Projet

Le `projet` est l'unité métier de travail à l'intérieur d'un workspace.

Il représente un sujet, un dossier ou une mission durable, avec :

- un nom,
- une description,
- des objectifs fréquents,
- des sources récurrentes,
- des runs historiques,
- des artefacts produits,
- des skills activées par défaut.

Un workspace peut contenir plusieurs projets.

## 3.3 Run

Le `run` est une exécution agentique complète déclenchée à partir d'une mission donnée.

Le run possède :

- un objectif,
- un plan,
- un état,
- des étapes,
- des tâches,
- des événements,
- des approvals,
- des sources consultées,
- des artefacts produits,
- un statut terminal ou non terminal.

Le run est l'unité principale d'observabilité.

## 3.4 Tâche

La `tâche` est une unité de travail interne à un run.

Elle peut être :

- séquentielle,
- parallèle,
- bloquée,
- relancée,
- attribuée à l'agent principal,
- ou plus tard à un sous-agent spécialisé.

La tâche n'est pas forcément visible comme objet de premier niveau pour l'utilisateur final, mais elle doit exister côté système.

## 3.5 Artefact

L'`artefact` est un livrable produit par le système et destiné à être consommé, validé, exporté ou retravaillé.

Exemples :

- note de synthèse,
- rapport,
- email draft,
- présentation,
- plan d'action,
- tableau,
- dossier restructuré.

Un artefact doit être :

- versionné,
- traçable,
- lié à un run,
- exportable,
- et consultable hors conversation.

## 3.6 Skill

La `skill` est un paquet de capacité opératoire.

Elle ne représente pas une connaissance projet. Elle représente une spécialisation de comportement du système.

Une skill peut contenir :

- des instructions,
- des heuristiques d'exécution,
- des dépendances de contexte,
- des contraintes,
- des outils préférés,
- des formats d'artefacts attendus.

## 3.7 Approval

L'`approval` est une décision utilisateur sur une action sensible ou un groupe d'actions.

Une approval doit être enregistrée avec :

- le contexte,
- la justification,
- la portée,
- la durée,
- la cible,
- et la décision finale.

## 3.8 Source

La `source` est tout élément consulté ou utilisé pendant un run.

Exemples :

- fichier local,
- page web,
- ressource MCP,
- document généré antérieurement,
- donnée issue d'un connecteur,
- entrée utilisateur structurée.

La source doit être distinguée de l'artefact :

- la source alimente le travail,
- l'artefact est le résultat du travail.

## 4. Relations entre objets

| Objet | Appartient à | Contient ou référence | Finalité |
|---|---|---|---|
| Workspace | utilisateur local ou organisation future | projets, permissions, connecteurs, index | périmètre de travail durable |
| Projet | workspace | runs, artefacts, sources, skills par défaut | contexte métier |
| Run | projet | tâches, événements, approvals, artefacts, sources consultées | exécution d'une mission |
| Tâche | run | état, sortie, assignation, dépendances | unité de travail |
| Artefact | projet et run | contenu, version, provenance, statut | livrable réutilisable |
| Skill | registre global ou workspace | instructions, contraintes, métadonnées | capacité opératoire |
| Approval | run ou politique projet | décision, scope, justification | gouvernance d'action |
| Source | projet ou run | métadonnées, contenu ou pointeur | matière d'entrée |

## 5. États minimaux

### 5.1 Run

États minimaux recommandés :

- `draft`
- `planned`
- `running`
- `awaiting_approval`
- `blocked`
- `completed`
- `failed`
- `cancelled`

### 5.2 Tâche

États minimaux recommandés :

- `pending`
- `in_progress`
- `awaiting_input`
- `blocked`
- `completed`
- `failed`
- `skipped`

### 5.3 Artefact

États minimaux recommandés :

- `draft`
- `generated`
- `validated`
- `exported`
- `superseded`

## 6. Modèle de persistance conceptuel

Le système de persistance doit être local-first et scinder clairement plusieurs couches.

### 6.1 Métadonnées

Une base locale doit stocker :

- workspaces,
- projets,
- runs,
- tâches,
- approvals,
- événements,
- index de sources,
- métadonnées d'artefacts,
- activation de skills,
- règles de confiance.

### 6.2 Stockage d'artefacts

Les artefacts doivent être stockés comme fichiers ou bundles exportables, avec :

- chemin stable,
- version,
- format,
- référence au run,
- référence au projet.

### 6.3 Stockage des sources

Les sources peuvent être :

- référencées uniquement,
- copiées dans un cache projet,
- indexées,
- ou résumées.

Le produit ne doit pas forcer la duplication systématique de tout.

### 6.4 Journal d'audit

Le journal d'audit doit être append-only autant que possible pour :

- les tool calls,
- les approvals,
- les erreurs,
- les changements de statut,
- les exports,
- les actions externes.

## 7. Récupération et continuité utilisateur

L'utilisateur doit pouvoir :

- rouvrir un workspace,
- retrouver un projet,
- relire les runs passés,
- inspecter les artefacts produits,
- relancer un run,
- affiner un run terminé,
- reprendre un run interrompu,
- exporter un artefact,
- comprendre d'où vient chaque résultat.

## 8. Différence entre relancer, reprendre et affiner

### Reprendre

Continuer un run interrompu ou suspendu à partir de son état réel.

### Relancer

Exécuter à nouveau une mission à partir d'un même objectif, avec un nouveau run.

### Affiner

Partir d'un run ou d'un artefact existant pour produire une version améliorée ou plus ciblée.

Cette distinction est importante pour la future UX et pour la persistance.

## 9. Hypothèses structurantes

- le couple `workspace -> projet` est plus robuste qu'une simple notion de session,
- le run est l'objet principal de supervision,
- l'artefact est l'objet principal de restitution,
- les approvals et les sources doivent être reliées au run de façon native,
- la mémoire projet ne doit pas être confondue avec l'historique brut des runs.

## 10. Conséquence pour le futur build

Si ces objets sont bien modélisés tôt, le futur développement sera plus simple sur :

- l'interface,
- l'audit,
- la reprise,
- l'export,
- la mémoire,
- et la montée vers le multi-agent.

Voir aussi :

- [artifact-contracts.md](./artifact-contracts.md)
- [operator-ux-flows.md](./operator-ux-flows.md)
- [scenarios-de-reference.md](./scenarios-de-reference.md)
