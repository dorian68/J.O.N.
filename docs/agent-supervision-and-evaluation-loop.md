# Agent Supervision And Evaluation Loop

## Statut

Decision document. This file formalizes the exact supervision loop retained for the prototype.

Related documents:
- [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md)
- [browser-control-observability.md](./browser-control-observability.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)

## Décision de base

Le prototype ne retient pas de second agent autonome.

En revanche, il retient une boucle de supervision explicite et obligatoire, structurée autour de checkpoints internes.

## Boucle retenue

### 1. Mission and plan checkpoint

Le `Primary Browser-First Run Agent` propose :

- compréhension de mission ;
- plan ;
- surfaces visées ;
- types d'actions probables ;
- artefacts attendus.

Le runtime vérifie :

- cohérence avec le slice ;
- cohérence avec la policy ;
- présence d'un chemin de preuves plausible.

### 2. Pre-action target checkpoint

Avant une action significative, le runtime vérifie :

- cible logique ;
- domaine ;
- type d'action ;
- niveau de risque ;
- suffisance des preuves de ciblage.

Si la cible reste ambiguë :

- pas d'action ;
- retry interne ou stop ;
- approval vague interdite.

### 3. Policy checkpoint

Le `Policy Checker` décide :

- auto-approved ;
- approval required ;
- blocked.

Ce checkpoint peut invalider l'action proposée.

Il ne peut pas l'autoriser seul si elle est hors scope.

### 4. Operator approval checkpoint

Quand requis, l'opérateur reçoit :

- action ;
- cible ;
- effet attendu ;
- risque ;
- lien vers preuves utiles.

Si l'approval est refusée :

- le run doit s'arrêter ou se réorienter proprement ;
- aucune exécution partielle cachée n'est acceptable.

### 5. Execution checkpoint

Le `Primary Browser-First Run Agent` exécute l'action autorisée.

Le runtime journalise :

- action ;
- target ;
- evidence context ;
- résultat brut observable.

### 6. Outcome verification checkpoint

Le `Outcome Verifier / Evaluator` internalisé vérifie :

- changement d'état attendu ;
- absence de changement inattendu ;
- statut final observé ;
- cohérence du contexte fenêtre / surface visible si le `computer control` a été mobilisé ;
- caractère valide, ambigu ou insuffisant du résultat.

### Ce qu'il peut invalider

- action annoncée comme réussie mais non prouvée ;
- DOM state incohérent ;
- outcome ambigu ;
- action ayant ciblé une mauvaise cible ;
- fenêtre ou surface locale mal qualifiée ;
- preuve insuffisante pour conclure.

### Ce qu'il ne peut pas autoriser seul

- write intent ;
- domain expansion ;
- acte engageant ;
- élargissement du scope.

## 7. Evidence checkpoint

Après outcome verification, le runtime décide :

- quelles preuves sont retenues ;
- si elles sont suffisantes pour audit ;
- si elles sont suffisantes pour artefact ou checkpoint suivant.

Si elles ne le sont pas :

- collecte supplémentaire ;
- retry ciblé ;
- ou stop honnête.

## 8. Artifact assembly checkpoint

Quand la collecte est suffisante, le `Primary Browser-First Run Agent` assemble :

- `Tableau de collecte navigateur`
- `Note de decision`

Le runtime vérifie :

- traçabilité ;
- structure minimale ;
- cohérence entre claims et sources ;
- présence des incertitudes.

## 9. Artifact quality checkpoint

Le `Artifact Reviewer` internalisé vérifie :

- structure ;
- provenance ;
- caveats ;
- utilité minimale.

S'il échoue :

- artefact non clos ;
- retour à collecte ou reformulation ;
- impossibilité de déclarer le run réussi.

## 10. Run closeout checkpoint

Le run n'est clos que si :

- les outcomes clés sont vérifiés ;
- les approvals sont correctement journalisées ;
- les artefacts minimaux existent ;
- les preuves sélectionnées sont présentes ;
- aucun blocage non résolu n'est caché.

## Pourquoi cette boucle reste mono-runtime

Cette boucle évite l'opacité inutile parce que :

- elle garde une seule chaîne d'intention ;
- elle garde un seul fil d'événements ;
- elle évite la fabrication artificielle d'un désaccord inter-agent ;
- elle rend les invalidations explicites sans ajouter un deuxième contexte agentique autonome.

## Règle stricte

L'évaluation interne peut :

- invalider ;
- demander retry ;
- demander plus de preuves ;
- empêcher la clôture ;

mais elle ne peut pas :

- auto-approuver ;
- étendre le scope ;
- masquer un résultat ambigu ;
- créer une illusion de vérification indépendante quand elle ne l'est pas.

## Évolution future admissible

Après stabilisation du prototype, une évolution éventuelle est admissible :

- `shadow verifier` read-only ;
- intervention uniquement à des checkpoints de preuves ou d'artefacts ;
- aucune capacité navigateur active ;
- aucune capacité d'approval ;
- aucune autonomie de relance.

Cette évolution n'est pas retenue pour V1.

## Décision finale

La boucle de supervision du prototype V1 est :

- explicite ;
- checkpointée ;
- evidence-backed ;
- internalisée dans un mono-runtime ;
- non multi-agent.
