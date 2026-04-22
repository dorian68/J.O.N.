# Runtime agentique

## 1. Objet du document

Ce document décrit le futur moteur d'agent du produit Cowork IA.

Il s'appuie sur ce que `claw-code` montre de pertinent au niveau runtime, mais il le réinterprète pour un produit centré sur :

- les runs,
- les artefacts,
- les approvals,
- le navigateur,
- le poste de travail,
- et la clôture d'une mission utile.

## 2. Ce qu'on garde de `claw-code`

Nous voulons conserver au niveau conceptuel :

- des sessions persistées,
- des événements typés,
- un `tool executor` séparé,
- une configuration hiérarchique,
- des permissions pilotées par policy,
- des hooks, plugins et skills traçables,
- des stratégies de recovery explicites.

## 3. Ce qui manque dans `claw-code` pour notre produit

Pour un coworker IA, les lacunes principales sont :

- un vrai modèle de `run produit`,
- un moteur d'artefacts,
- un vrai cycle d'approval côté UX,
- une couche navigateur contrôlée,
- une couche computer use,
- un modèle workspace/projet/source/artefact,
- une notion produit de mission terminée autre qu'une session de tools.

## 4. Responsabilités du runtime cible

Le runtime agentique doit être responsable de :

- prendre une mission et la transformer en plan exécutable,
- coordonner les outils,
- maintenir l'état canonique du run,
- demander les approvals au bon moment,
- vérifier la qualité du résultat,
- assembler les artefacts,
- clôturer proprement le run,
- et laisser un audit exploitable.

## 5. Composants internes du runtime

### 5.1 Planner

Transformer l'objectif en plan d'action :

- reformulation du but,
- hypothèses,
- étapes,
- dépendances,
- risques et actions sensibles probables.

### 5.2 Executor

Exécuter les étapes décidées :

- choisir les tools appropriés,
- séquencer les actions,
- remonter les résultats,
- réagir aux erreurs normales,
- appeler l'approval coordinator si nécessaire.

### 5.3 Evaluator

Évaluer la qualité de progression :

- décider si une étape est suffisante,
- détecter les sorties incomplètes,
- demander des corrections ou reruns ciblés,
- valider la clôture du run.

### 5.4 State manager

Maintenir l'état canonique du run :

- étapes,
- tâches,
- approvals en attente,
- tools utilisés,
- sources consultées,
- résumés intermédiaires,
- artefacts provisoires et finaux,
- erreurs et recovery.

### 5.5 Context manager

Sélectionner le contexte utile :

- mémoire de travail,
- résumés intermédiaires,
- récupération des sources utiles,
- activation des skills pertinentes,
- contrôle de la taille de contexte.

### 5.6 Approval coordinator

Faire le lien entre runtime, policy layer et utilisateur :

- produire les demandes d'approbation,
- suspendre l'exécution,
- reprendre selon la décision,
- journaliser la décision,
- proposer des alternatives en cas de refus.

### 5.7 Artifact manager

Assembler, versionner et publier les artefacts du run.

## 6. Cycle de vie d'un run

1. `mission_received`
2. `context_bootstrap`
3. `plan_draft`
4. `approval_preflight`
5. `execution_loop`
6. `context_refresh`
7. `evaluation_checkpoint`
8. `artifact_assembly`
9. `run_closeout`
10. `resume_or_refine`

## 7. Taxonomie minimale des événements

Cette section pose une vue minimale côté runtime. La taxonomie canonique de travail se trouve dans [event-taxonomy.md](./event-taxonomy.md).

Le runtime doit publier au minimum :

- `run.lifecycle`
- `run.plan`
- `run.context`
- `run.step`
- `run.tool`
- `run.approval`
- `run.source`
- `run.artifact`
- `run.recovery`
- `run.error`
- `run.complete`

## 8. Permissions et tools dans le runtime

Avant un tool call, le runtime doit connaître :

- le niveau de risque,
- le scope de la cible,
- le besoin éventuel d'approbation,
- l'impact potentiel,
- la stratégie de retour arrière quand elle existe.

Le résultat d'un tool call doit toujours inclure :

- statut,
- sortie structurée,
- erreur normalisée si échec,
- artefacts produits,
- événements associés.

## 9. Hooks, skills et extensions

Le runtime doit distinguer :

- `hook` : logique auxiliaire déclenchée sur événement,
- `skill` : paquet de capacité opératoire,
- `plugin` : extension plus large du système,
- `connector` : passerelle vers un service externe,
- `tool` : capacité exécutable unitaire.

## 10. Recovery et blocages

Le runtime doit reconnaître des familles de blocage propres à notre produit :

- tool indisponible,
- source introuvable,
- navigateur dans un état inattendu,
- approbation refusée,
- contexte insuffisant,
- artefact incomplet,
- permissions incompatibles avec l'objectif,
- run divergent par rapport au but initial.

Le recovery doit être :

- limité,
- traçable,
- compréhensible,
- et s'arrêter avant de produire des effets risqués non validés.

## 11. Ce qu'il faut éviter

- un runtime centré sur la seule session conversationnelle,
- des états implicites cachés dans des logs,
- des tools sans niveau de risque explicite,
- un planner qui fait aussi office d'executor et d'evaluator,
- une reprise qui se contente de relire l'historique brut,
- une accumulation non maîtrisée de contexte.

## 12. Position cible

Le futur runtime de Cowork IA doit être pensé comme :

- un moteur de run produit,
- inspiré par les meilleures briques runtime de `claw-code`,
- mais élargi à la réalité d'un produit desktop/browser orienté outcome.

Voir aussi :

- [event-taxonomy.md](./event-taxonomy.md)
- [approval-policy-matrix.md](./approval-policy-matrix.md)
- [evals-and-benchmarks.md](./evals-and-benchmarks.md)

## 13. Statut d'implémentation actuel

Le dépôt matérialise désormais une partie plus explicite de ce runtime cible sur le slice autorisé.

Présent dans le code :

- un stage explicite de `mission understanding` lié au runtime LLM et aux snapshots de contexte ;
- un `planner` raisonné via snapshots de contexte,
- un `evaluator` borné pour support d'évaluation et notes d'ambiguïté,
- un `context manager` local sous forme de couche de `contextual reasoning`,
- un `artifact manager` capable d'assembler et de relier artefacts, preuves et traces de raisonnement,
- des événements typés liant run, mission understanding, approvals, artefacts, LLM calls et reasoning snapshots.

Encore partiel ou différé :

- packaging desktop produit complet,
- validation bornée sur surfaces réelles,
- posture pilote et exploitation de release.

Voir aussi :

- [contextual-reasoning-layer-v1.md](./contextual-reasoning-layer-v1.md)
- [minimal-desktop-shell-foundation.md](./minimal-desktop-shell-foundation.md)
