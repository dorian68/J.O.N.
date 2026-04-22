# Benchmark Review Protocol V1

## Statut

Decision document. This file closes the human review protocol for prototype benchmarks so benchmark results cannot be overclaimed or interpreted loosely.

Related documents:
- [evals-and-benchmarks.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/evals-and-benchmarks.md)
- [browser-control-benchmark-pack-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-benchmark-pack-v1.md)
- [browser-control-test-fixtures-plan.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/browser-control-test-fixtures-plan.md)
- [artifact-quality-rubrics-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/artifact-quality-rubrics-v1.md)
- [prototype-slice-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/prototype-slice-v1.md)

## Objectif

Le protocole de revue existe pour garantir qu'un benchmark signifie quelque chose de stable, comparable et honnête.

Il doit empêcher :

- qu'une démo soit confondue avec un benchmark réussi ;
- qu'un faux positif soit enregistré comme un succès ;
- que la qualité des artefacts soit ignorée parce que les actions navigateur ont techniquement tourné ;
- que des interventions manuelles hors approval soient invisibilisées.

## Décisions fermées

- Chaque benchmark a deux couches de jugement : assertions automatisées et revue humaine.
- Un benchmark n'est pas `Pass` sans cohérence entre les deux couches.
- La revue humaine est obligatoire pour la qualité d'artefact, la qualité d'approval et la suffisance des preuves.
- Un benchmark sans package de preuves suffisant ne peut pas être compté comme réussite.
- Une démonstration interne ne peut revendiquer la validité du prototype que si l'ensemble minimal de benchmarks a été revu selon ce protocole.

## Rôles de revue

### Vérification automatisée

Vérifie :

- les assertions déterministes de fixture ;
- la présence des événements attendus ;
- la présence des artefacts attendus ;
- le comportement d'approval attendu quand il est mesurable ;
- les conditions d'arrêt attendues ;
- les signaux de vérification d'outcome.

### Reviewer humain

Vérifie :

- si le run a réellement accompli la tâche visée ;
- si les artefacts sont utiles selon [artifact-quality-rubrics-v1.md](/C:/Users/Labry/Documents/CLAUDE_COWORK/PROJET_CLAUDE/docs/artifact-quality-rubrics-v1.md) ;
- si les approvals sont apparues au bon moment avec le bon niveau de détail ;
- si les preuves sont suffisantes et non trompeuses ;
- si le résultat est représentatif ou seulement chanceux.

### Owner de gate

Décide si un benchmark compte réellement pour l'autorisation du prototype.

L'owner de gate doit refuser les lectures optimistes quand les assertions et la revue humaine divergent.

## Protocole de revue

### 1. Vérifier l'identité du benchmark

Le reviewer doit confirmer :

- l'identifiant du benchmark ;
- la fixture utilisée ;
- l'objectif de mission ;
- la policy attendue ;
- l'artefact attendu ;
- le chemin d'approval attendu.

Si un de ces éléments est ambigu, le résultat n'est pas recevable.

### 2. Vérifier les assertions automatisées

Le reviewer confirme si le benchmark satisfait :

- les jalons obligatoires du run ;
- les arrêts ou refus attendus ;
- la création d'artefact attendue ;
- la vérification d'outcome attendue ;
- les contraintes de policy mesurables.

Si les assertions montrent un hard failure, la revue humaine peut documenter le cas, mais ne peut pas le requalifier en `Pass`.

### 3. Vérifier le package de preuves

Package minimal obligatoire :

- résumé de run ;
- événements typés pertinents ;
- approvals quand applicables ;
- références de sources ;
- preuves navigateur sélectionnées ;
- artefact produit ou raison d'arrêt explicite.

Si ce package n'est pas disponible, le benchmark ne peut pas être validé.

### 4. Vérifier la complétion réelle de la tâche

Le reviewer humain doit juger :

- si la tâche visée a réellement été accomplie ;
- si le chemin d'exécution correspond bien au benchmark ;
- si le système s'est correctement arrêté en cas de refus ou de blocage.

### 5. Vérifier la qualité d'artefact

Quand un artefact est attendu :

- appliquer la rubric correspondante ;
- distinguer qualité acceptable, médiocre, trompeuse ou échec ;
- documenter séparément le verdict d'artefact et le verdict de chemin d'exécution.

### 6. Vérifier la qualité d'approval

Quand des approvals sont attendues :

- vérifier qu'elles apparaissent quand nécessaire ;
- vérifier qu'elles n'apparaissent pas de manière fatigante quand elles ne sont pas nécessaires ;
- vérifier que le payload est suffisamment spécifique ;
- vérifier que le refus produit un comportement sûr et intelligible.

### 7. Classifier le résultat

Chaque benchmark doit être classé comme :

- `Real success`
- `Partial success`
- `False positive`
- `Acceptable failure`
- `Blocking failure`

## Définitions de classification

### Real success

Utiliser quand :

- les assertions automatisées passent ;
- la revue humaine confirme la complétion réelle ;
- les preuves sont suffisantes ;
- l'artefact est acceptable quand il existe ;
- aucune intervention cachée ou sur-interprétation n'a eu lieu.

### Partial success

Utiliser quand :

- l'objectif principal est presque atteint ;
- une faiblesse non triviale reste présente ;
- le run est prometteur mais pas encore assez fiable pour compter comme succès propre ;
- aucun comportement trompeur n'est observé.

Un `Partial success` ne compte pas comme benchmark autorisant sauf décision explicite de gate.

### False positive

Utiliser quand :

- les assertions suggèrent un succès ;
- mais la revue humaine montre que la tâche n'a pas réellement été accomplie, ou que l'artefact est trompeur, ou que les preuves sont insuffisantes.

Les faux positifs sont traités comme des échecs graves.

### Acceptable failure

Utiliser quand :

- le run échoue ;
- mais il échoue honnêtement, sûrement et avec un diagnostic exploitable ;
- le système s'arrête au lieu de prétendre réussir.

Ce type d'échec peut être toléré en exploration, mais pas sur les benchmarks obligatoires de gate.

### Blocking failure

Utiliser quand :

- le système agit sur la mauvaise cible ;
- une approval est contournée ou mal déclenchée ;
- les preuves critiques sont absentes ;
- l'artefact est trompeur ;
- le run semble réussir alors qu'il ne devrait pas être considéré comme tel.

## Checklist minimale de revue

Chaque benchmark revu doit répondre à :

- La fixture est-elle bien celle prévue ?
- Le run est-il resté dans le scope et la policy ?
- Les bonnes surfaces navigateur ont-elles été ciblées ?
- Les approvals nécessaires sont-elles apparues, et les inutiles évitées ?
- Le package de preuves est-il suffisant ?
- La vérification d'outcome est-elle crédible ?
- L'artefact est-il utile si applicable ?
- Le résultat est-il représentatif et comparable à d'autres runs ?

## Comparaison entre runs

La comparaison n'est valable que si l'on garde constants :

- l'id du benchmark ;
- la fixture ou sa famille ;
- la policy attendue ;
- l'artefact attendu.

Un run ultérieur n'est meilleur que s'il améliore au moins un de ces axes :

- correction ;
- qualité des approvals ;
- suffisance des preuves ;
- utilité de l'artefact ;
- stabilité.

Un run plus rapide mais moins digne de confiance n'est pas meilleur.

## Benchmark utile vs benchmark cosmétique

### Benchmark utile

Un benchmark est utile s'il :

- teste une propriété réelle du prototype ;
- utilise une fixture représentative ;
- produit des preuves inspectables ;
- peut échouer pour de vraies raisons ;
- aide à décider si le prototype devient réellement meilleur.

### Benchmark cosmétique

Un benchmark est cosmétique s'il :

- est trop facile à réussir par heuristiques fragiles ;
- rejoue surtout un chemin de démo ;
- dit peu de choses sur la confiance, les preuves ou l'utilité de l'artefact ;
- distingue mal un vrai succès d'un faux positif.

Les benchmarks cosmétiques ne comptent pas dans la readiness.

## Erreurs de jugement à éviter

- confondre polish visuel et utilité réelle ;
- compter comme succès un run qui “a presque marché” ;
- tolérer des interventions manuelles hors contrat d'approval ;
- ignorer l'absence de preuves parce que le résultat final paraît plausible ;
- sur-interpréter un unique run réussi.

## Décision finale

Le protocole de revue benchmark du prototype est désormais fermé :

- pas de revendication de succès sans assertions automatisées et revue humaine ;
- pas de `Pass` sans package de preuves suffisant ;
- les faux positifs sont traités comme des échecs graves ;
- les benchmarks obligatoires de gate doivent être relus selon ce protocole.

Ce document est suffisamment fermé pour autoriser la phase prototype.
