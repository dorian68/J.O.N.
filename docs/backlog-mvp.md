# Backlog MVP

## 1. Objectif

Construire un MVP crédible du coworker IA, centré sur une boucle simple :

1. recevoir une mission,
2. construire un plan,
3. agir avec des outils réels,
4. demander validation au bon moment,
5. produire un livrable exportable.

## 2. Priorisation

Priorité proposée :

- `P0` indispensable au MVP
- `P1` très important juste après
- `P2` utile mais non bloquant

## 3. Épics MVP

### Epic A - Shell desktop et app lifecycle

#### P0

- créer l'application desktop
- gérer fenêtres, navigation interne et cycle de vie
- persister les préférences locales
- afficher l'état de connexion aux services locaux

#### Critères d'acceptation

- l'app se lance proprement sur Windows
- l'UI peut dialoguer avec le runtime local
- les préférences persistent entre deux sessions

### Epic B - Projet et workspace

#### P0

- créer un projet
- éditer le nom, la description et les instructions projet
- associer un dossier workspace
- lister les fichiers attachés
- afficher les runs et artefacts du projet

#### Critères d'acceptation

- un projet peut être créé, rouvert et supprimé logiquement
- les fichiers du projet sont visibles dans l'UI
- l'historique du projet est persistant

### Epic C - Saisie de mission et planification

#### P0

- saisir un objectif libre
- choisir un type de livrable
- préciser contraintes et actions interdites
- générer un plan initial visible
- marquer les étapes nécessitant approbation

#### Critères d'acceptation

- un run démarre avec une mission claire
- le plan est lisible avant l'exécution complète
- les hypothèses sont visibles

### Epic D - Runtime agentique

#### P0

- orchestrateur principal
- planner
- executor
- reviewer
- state manager
- boucle de run avec événements structurés

#### Critères d'acceptation

- un run progresse étape par étape
- le runtime peut suspendre, reprendre et terminer
- chaque étape produit un état exploitable en UI

### Epic E - Outils fichiers et documents

#### P0

- lire répertoires et fichiers texte
- lire PDF
- lire XLSX/CSV
- écrire des artefacts dans le projet

#### P1

- lecture DOCX/PPTX
- génération DOCX/PPTX structurée

#### Critères d'acceptation

- l'agent peut analyser un dossier documentaire standard
- les sorties peuvent être persistées comme artefacts

### Epic F - Outils navigateur

#### P0

- ouvrir une page
- lire le DOM
- cliquer
- remplir un champ
- capturer un screenshot

#### P1

- téléchargements
- attachement à Chrome existant
- logs console et réseau

#### Critères d'acceptation

- l'agent peut compléter un dossier avec des informations web
- les actions navigateur sont visibles dans la timeline

### Epic G - Approvals et policy engine

#### P0

- classer chaque action par niveau de risque
- déclencher les demandes d'approbation
- supporter one-shot, session et projet
- journaliser les décisions

#### Critères d'acceptation

- aucune action sensible n'est lancée sans décision utilisateur
- l'utilisateur comprend clairement ce qu'il autorise

### Epic H - Timeline, logs et audit

#### P0

- timeline de run
- logs par étape
- affichage des tools calls
- affichage des refus/approbations
- résumé final du run

#### Critères d'acceptation

- après un run, on peut reconstituer ce qui s'est passé
- l'utilisateur voit les sources et actions importantes

### Epic I - Artefacts

#### P0

- note de synthèse
- email draft
- document de travail markdown ou html

#### P1

- deck de travail
- versioning artefact
- régénération partielle

#### Critères d'acceptation

- un artefact final est consultable dans l'app
- il peut être exporté

### Epic J - Skills

#### P0

- registre local de skills
- activation manuelle
- activation automatique simple
- logs d'activation

#### P1

- tests par skill
- versioning plus riche

#### Skills MVP

- analyse documentaire
- reporting Excel/PDF
- synthèse business
- rédaction d'email
- structuration de dossier

### Epic K - Mémoire et contexte

#### P0

- mémoire de session
- résumés intermédiaires
- citations de sources
- index texte simple

#### P1

- rappel par projet
- recherche plus fine sur historique

#### Critères d'acceptation

- le runtime ne réinjecte pas tout le contexte brut
- l'agent sait citer les sources majeures de son livrable

## 4. Stories fondatrices du MVP

### Story 1

En tant qu'utilisateur, je veux créer un projet avec mes fichiers pour lancer une mission dans un contexte borné.

### Story 2

En tant qu'utilisateur, je veux donner un objectif et voir un plan avant que l'agent agisse fortement.

### Story 3

En tant qu'utilisateur, je veux que l'agent lise mes documents et me rende une synthèse exploitable.

### Story 4

En tant qu'utilisateur, je veux que l'agent puisse compléter ses analyses via le navigateur.

### Story 5

En tant qu'utilisateur, je veux approuver ou refuser les actions sensibles avec une bonne compréhension de l'impact.

### Story 6

En tant qu'utilisateur, je veux un historique clair du run pour vérifier le travail réalisé.

## 5. Hors MVP

- multi-agent généralisé
- marketplace publique
- administration entreprise avancée
- collaboration temps réel
- automation desktop lourde non bornée
- autonomie forte sans approvals

## 6. Découpage en lots recommandé

### Lot 1

- shell desktop
- projet/workspace
- saisie de mission
- runtime minimal

### Lot 2

- outils fichiers/document
- artefact note de synthèse
- timeline et logs

### Lot 3

- navigateur contrôlé
- approvals
- citations et sources

### Lot 4

- skills MVP
- email draft
- export

### Lot 5

- deck de travail
- mémoire projet
- outillage d'évaluation

## 7. Critères de sortie MVP

Le MVP est prêt s'il sait faire de manière répétable :

- prendre un dossier projet,
- recevoir une mission claire,
- bâtir un plan,
- lire les sources utiles,
- compléter si besoin via le navigateur,
- demander validation sur les actions à risque,
- produire un livrable exportable,
- conserver un audit lisible du run.

## 8. Prochain backlog après MVP

- attachement à Chrome existant
- contrôle desktop plus riche
- Codex CLI comme outil spécialisé
- meilleure reprise après interruption
- évaluateur plus robuste
- règles de permissions plus fines
- artefacts bureautiques plus avancés
