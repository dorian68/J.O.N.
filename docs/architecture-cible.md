# Architecture cible

## 1. Objet du document

Ce document décrit l'architecture cible du futur produit Cowork IA.

Il ne fige pas encore une stack d'implémentation définitive. Il décrit les blocs nécessaires, leurs responsabilités et les interfaces conceptuelles qui devront rester stables même si la stack technique évolue.

## 2. Principes d'architecture

- `Product-first` : l'architecture doit servir un desktop coworker orienté livrables, pas un CLI déguisé.
- `Local-first pragmatique` : les fichiers locaux, l'état local et les contrôles poste/navigateur sont des primitives de premier rang.
- `Run-centric` : le système est construit autour du run et de sa traçabilité.
- `Safe by default` : les permissions et approvals sont des composants natifs.
- `Event-native` : tout ce qui compte doit être représentable en événements typés.
- `Composable` : chaque bloc doit pouvoir évoluer sans casser le reste.
- `Degraded but usable` : le système doit continuer à fonctionner quand certains outils ou connecteurs sont absents.

## 3. Vue d'ensemble

```text
Utilisateur
  ->
Desktop Shell / UI
  ->
Orchestrateur produit
  ->
Runtime agentique
  -> Context / Memory
  -> Policy / Approvals / Audit
  -> Tool Layer
       -> Files / Documents
       -> Browser Control
       -> Computer Control
       -> Connecteurs / MCP / outils externes
  -> Artifact Engine

Storage Layer
  -> Workspaces / Projects / Runs / Artifacts / Audit / Indexes

LLM Gateway
  -> Routage modèles / usage / fallback / confidentialité
```

## 4. Blocs principaux

### 4.1 Desktop shell

Responsabilités :

- navigation dans les workspaces et projets,
- saisie de mission,
- visualisation du run,
- gestion des approvals,
- consultation des artefacts,
- reprise et export.

### 4.2 Orchestrateur produit

Responsabilités :

- créer et initialiser le run,
- injecter le bon contexte de projet,
- relier approvals, artefacts et clôture du run,
- piloter les transitions de haut niveau.

### 4.3 Runtime agentique

Responsabilités :

- planification,
- exécution,
- évaluation,
- gestion d'état,
- intégration outils,
- recovery.

### 4.4 Tool layer

Responsabilités :

- standardiser l'accès aux capacités locales et distantes,
- porter les contrats d'entrée/sortie,
- normaliser erreurs, timeouts, niveaux de risque,
- relier exécution et policy layer.

### 4.5 Browser control layer

Responsabilités :

- ouvrir et cibler des pages,
- lire le DOM,
- naviguer entre onglets,
- remplir et soumettre des formulaires,
- gérer téléchargements, screenshots, logs et attachement de session.

### 4.6 Computer control layer

Responsabilités :

- inspection de fenêtres,
- focus,
- captures,
- accessibilité UI,
- vérification d'outcomes visibles,
- actions simples sur applications,
- automatisation locale bornée.

Décision révisée :

- cette couche fait officiellement partie du produit ;
- elle reste subordonnée à la hiérarchie `DOM-first` quand une surface web structurée est disponible ;
- sa première forme prototype est `observability-first`, pas une automation locale générale.

### 4.7 Workspace / project layer

Responsabilités :

- porter le modèle métier persistant,
- relier projets, sources, runs, artefacts, approvals et skills,
- donner au produit sa forme durable.

### 4.8 Context / memory layer

Responsabilités :

- sélectionner le contexte utile,
- gérer mémoire de travail, mémoire projet et résumés,
- injecter du contexte juste-à-temps,
- activer les skills pertinentes.

### 4.9 Skills / artifacts layer

Responsabilités :

- gérer le registre de skills,
- tracer leur activation,
- produire des artefacts versionnés et exportables.

### 4.10 Permissions / policy / audit layer

Responsabilités :

- classifier les actions,
- déclencher les approvals,
- journaliser les décisions,
- appliquer les politiques,
- prouver ce qui a été fait.

### 4.11 LLM gateway

Responsabilités :

- routage,
- fallback,
- gestion des secrets,
- journalisation,
- coûts,
- politiques de confidentialité.

## 5. Interfaces conceptuelles entre blocs

| Interface | Producteur | Consommateur | Contenu attendu | Pourquoi c'est critique |
|---|---|---|---|---|
| `MissionSpec` | UI | Orchestrateur | objectif, contraintes, livrable, sources autorisées, actions interdites | point d'entrée propre du run |
| `RunState` | Orchestrateur / runtime | UI | statut, étape courante, blocages, résumés, métriques | lisibilité produit |
| `RunEventStream` | Runtime | UI, audit, tests | événements typés et horodatés | observabilité unifiée |
| `ContextSnapshot` | Context layer | Runtime | contexte juste-à-temps, résumés, références, skills activées | maîtrise du contexte |
| `ToolCallContract` | Runtime | Tool layer | tool, input structuré, risk level, timeout, provenance | exécution fiable |
| `ApprovalRequest` | Policy layer | UI | action, justification, impact, scope possible | UX de confiance |
| `ApprovalDecision` | UI | Policy layer / runtime | allow, deny, scope, durée | gouvernance des actions |
| `ArtifactBundle` | Artifact layer | UI, storage | contenu, format, provenance, version | livrable produit exploitable |
| `PolicyDecision` | Policy layer | Runtime / tool layer | allow, ask, deny, rationale | sécurité et contrôle |

## 6. Frontières importantes à préserver

- ne pas fusionner UI et runtime,
- ne pas fusionner tools et politiques,
- ne pas fusionner mémoire et stockage brut,
- ne pas fusionner skills et sources.

## 7. Ce que cette architecture suppose

- une forte importance de l'état local,
- une séparation claire entre exécution et supervision,
- une capacité future à brancher plusieurs fournisseurs LLM,
- une capacité future à faire coexister mono-agent et sous-agents supervisés,
- une instrumentation sérieuse du run.

## 8. Ce que cette architecture ne décide pas encore

Ce document ne tranche pas encore :

- le choix exact du shell desktop,
- la langue du runtime principal,
- le toolkit précis de browser control,
- le toolkit précis de computer control,
- la frontière finale entre exécution locale et distante.

Ce document tranche désormais une chose :

- `computer control` est une capacité officielle du produit, même si son premier sous-ensemble prototype reste plus borné que le `browser control`.
