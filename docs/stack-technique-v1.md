# Stack technique v1

## 1. Position technique recommandée

Pour ce produit, la priorité n'est pas la pureté architecturale. La priorité est :

- fiabilité des outils,
- visibilité du run,
- sécurité des permissions,
- rapidité d'itération,
- qualité des artefacts.

La recommandation v1 est une architecture `desktop + frontend TypeScript + runtime local Python`, avec ponts explicites entre UI, agent runtime et outils système.

## 2. Stack recommandée

## 2.1 Shell desktop

### Recommandation

- `Electron`

### Pourquoi

- écosystème mature,
- très bonne ergonomie pour app desktop agentique,
- intégration simple avec React/TypeScript,
- streaming d'événements et IPC bien compris,
- packaging et debug plus simples pour une v1,
- bonne compatibilité avec un modèle local/hybride.

### Alternative recevable

- `Tauri`

Tauri redevient intéressant si l'objectif principal devient la légèreté du binaire ou si la couche native Rust est un choix assumé dès le départ.

## 2.2 Frontend

### Recommandation

- `React`
- `TypeScript`
- `Vite`
- `Zustand` pour l'état client
- `TanStack Query` si API locale plus riche

### Ce que l'UI doit bien gérer

- timeline en streaming,
- affichage des approbations,
- visualisation des outils,
- consultation d'artefacts,
- reprise de run,
- comparaison avant/après.

## 2.3 Runtime agentique

### Recommandation

- `Python 3.12+`
- `FastAPI` ou service local équivalent
- `WebSocket` ou SSE pour le streaming d'événements

### Pourquoi Python

- excellente ergonomie pour traitements documentaires,
- très bon écosystème d'automatisation Windows,
- intégration naturelle avec OCR, parsing et scripts utilitaires,
- plus simple pour expérimenter sur les couches agentiques et l'évaluation.

### Pattern recommandé

Utiliser un harness maison léger, pas un framework agentique envahissant en v1.

Boucle cible :

1. planner,
2. executor,
3. reviewer,
4. state update,
5. approval checkpoint si nécessaire,
6. continuation ou arrêt.

## 2.4 Outils navigateur

### Recommandation

- `Playwright` pour l'automatisation de haut niveau
- `Chrome DevTools Protocol` pour les besoins bas niveau

### Règle d'usage

- utiliser Playwright pour la majorité des actions robustes,
- descendre au niveau CDP pour l'attachement à une session existante, l'inspection fine, le réseau, les logs console ou certains contournements.

### Besoins à couvrir

- navigation,
- onglets,
- DOM,
- formulaires,
- téléchargements,
- screenshots,
- logs console,
- capture réseau,
- attachement à Chrome existant.

## 2.5 Outils desktop

### Recommandation Windows v1

- `pywinauto`
- `uiautomation` ou API UI Automation Windows
- `mss` pour capture écran

### Stratégie

- privilégier les APIs d'accessibilité ou d'automatisation natives,
- utiliser la vision seulement comme fallback,
- garder le contrôle desktop très borné en v1.

## 2.6 OCR et vision

### Recommandation

- OCR local simple pour extraction rapide,
- screenshots systématiques pour audit,
- compréhension visuelle par modèle uniquement quand le DOM ou l'accessibilité ne suffisent pas.

### Candidats

- `Tesseract` pour OCR basique,
- `PaddleOCR` si meilleure robustesse requise,
- appel vision au modèle via la gateway pour interprétation ciblée.

## 2.7 Documents et artefacts

### Recommandation Python

- `pypdf`
- `python-docx`
- `openpyxl`
- `python-pptx`
- `pandas`

### Rôle

- lecture structurée,
- extraction de tableaux,
- génération contrôlée d'artefacts,
- reformatage de livrables bureautiques.

## 2.8 Base de données et stockage

### Recommandation v1

- `SQLite` pour métadonnées et runs
- `FTS5` pour recherche textuelle locale
- stockage fichiers sur disque par projet

### Pourquoi

- extrêmement simple à embarquer,
- bon fit pour une app desktop mono-utilisateur,
- suffisant pour historique, audit et indexation initiale.

### Évolution possible

- `Postgres` si le produit devient multi-utilisateur ou cloud-native,
- base vectorielle seulement si les besoins de retrieval dépassent FTS + résumés.

## 2.9 Mémoire et contexte

### Recommandation

- mémoire de session en base,
- résumés intermédiaires persistés,
- index documentaire simple,
- récupération ciblée avant chaque étape.

### À éviter

- injecter tout le projet dans le prompt,
- complexifier trop tôt avec une mémoire vectorielle partout,
- laisser le modèle gérer seul le contexte sans stratégie explicite.

## 2.10 Gateway LLM

### Recommandation

Construire une couche interne de routage modèle avec :

- interface fournisseur unifiée,
- journalisation,
- politiques de fallback,
- configuration par tâche,
- masquage des secrets.

### Politique cible

- modèle haut de gamme pour planification, revue et arbitrages complexes,
- modèle moins coûteux pour extraction, classement et reformulation,
- possibilité d'appeler plusieurs fournisseurs selon la tâche.

## 2.11 Intégration Codex CLI

### Position recommandée

Considérer `Codex CLI` comme un outil spécialisé de la couche d'exécution, pas comme le cœur du runtime.

### Usage pertinent

- sous-tâches de code,
- génération de patchs,
- exploration de repository,
- exécution supervisée sur demandes explicites.

### Contraintes

- invocation via tool runner contrôlé,
- permissions explicites,
- journalisation complète,
- périmètre borné aux tâches de code.

## 2.12 Connecteurs et MCP

### Recommandation

Adopter un contrat outil interne compatible avec une logique MCP :

- description structurée des tools,
- permissions associées,
- schéma d'entrée/sortie,
- gestion de l'approbation,
- journal d'appel.

Cela permet de brancher ensuite :

- outils locaux,
- serveurs MCP,
- connecteurs distants,
- plugins métier.

## 2.13 Secrets et sécurité

### Recommandation

- stockage des secrets dans le coffre système quand possible,
- jamais de secret brut dans les prompts,
- approbation obligatoire pour shell, écriture sensible et actions externes,
- journal d'audit non désactivable,
- mode lecture seule disponible.

## 2.14 Observabilité

### Recommandation

- logs structurés JSON,
- event bus interne par run,
- traçage par étape et par tool call,
- coût et latence stockés à chaque appel modèle,
- snapshots avant/après pour les actions risquées.

## 3. Architecture cible

## 3.1 Vue d'ensemble

`Electron UI`

-> envoie une mission

`Runtime agent local (Python)`

-> sélectionne contexte, planifie, exécute, révise

`Tool layer`

-> fichiers, navigateur, shell, desktop, documents, MCP, outils externes

`Storage layer`

-> projets, runs, artefacts, résumés, permissions, audit

`LLM gateway`

-> routage modèle et politiques de fallback

## 3.2 Composants internes minimaux

- `orchestrator`
- `planner`
- `executor`
- `reviewer`
- `context manager`
- `policy engine`
- `approval engine`
- `artifact engine`
- `tool registry`

## 4. Arbitrages recommandés

## 4.1 Electron vs Tauri

Choix recommandé : `Electron`

Raison : meilleure vitesse d'exécution produit pour une v1 orientée expérimentation, observabilité et intégration JS/UI.

## 4.2 Runtime maison vs framework agentique

Choix recommandé : `runtime maison léger`

Raison : meilleure maîtrise des états, des permissions, des logs et des coûts. Les frameworks peuvent accélérer un POC, mais ajoutent souvent de l'opacité.

## 4.3 Mono-agent vs multi-agent

Choix recommandé : `mono-agent supervisé`

Raison : plus simple à débugger, moins coûteux, plus lisible pour l'utilisateur. Le multi-agent arrive ensuite pour des sous-rôles bien délimités.

## 4.4 Local-first vs cloud-first

Choix recommandé : `local-first hybride`

Raison : cohérent avec les fichiers locaux, les apps desktop, la sécurité perçue et les cas d'usage initiaux.

## 5. Évolutions techniques probables

Quand le socle sera stable, les ajouts les plus logiques sont :

- service de jobs durables,
- moteur d'évaluation plus fort,
- profils de permissions avancés,
- exécution cloud optionnelle,
- délégation multi-agent,
- plugins MCP managés,
- analytics produit plus riches.

## 6. Stack v1 synthétique

- Desktop : `Electron`
- Frontend : `React + TypeScript + Vite`
- State UI : `Zustand`
- Runtime agent : `Python + FastAPI/WebSocket`
- Browser : `Playwright + CDP`
- Desktop automation : `pywinauto + UI Automation`
- Documents : `pypdf`, `python-docx`, `openpyxl`, `python-pptx`
- Storage : `SQLite + FTS5`
- Secrets : coffre système
- Tool protocol : contrat interne compatible MCP
- LLM access : gateway multi-fournisseurs
