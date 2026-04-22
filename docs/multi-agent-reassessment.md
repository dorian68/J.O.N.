# Multi-Agent Reassessment

## Statut

Decision document. This file reopens and closes the prototype-level decision on `mono-agent supervisé` versus `bi-agent strictement borné`.

Related documents:
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [runtime-agentique.md](./runtime-agentique.md)
- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [browser-control-observability.md](./browser-control-observability.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [claw-code-runtime-inspirations-for-agent-roles.md](./claw-code-runtime-inspirations-for-agent-roles.md)

## Question réouverte

Pour ce prototype précis, faut-il :

- rester sur un `mono-agent supervisé`,
- ou passer à un `primary agent + verifier/evaluator agent`,
- ou aller plus loin vers une boucle `primary + critic + operator gate`.

La question n'est pas abstraite. Elle porte sur un prototype désormais `browser-first`, `DOM-first`, avec une fondation bornée de `computer control`, à preuves fortes, sur surfaces contrôlées.

## Critères de décision retenus

La décision est jugée selon :

- valeur réelle sur le ciblage DOM ambigu ;
- valeur réelle sur la vérification d'outcome ;
- valeur réelle sur la vérification d'état visible local ;
- valeur réelle sur la qualité des preuves ;
- impact sur les approvals ;
- impact sur l'auditabilité ;
- impact sur les benchmarks ;
- complexité runtime ajoutée ;
- risque d'opacité ;
- compatibilité avec le slice prototype déjà fermé.

## Option A. Mono-agent supervisé avec rôles internalisés

### Description

Un seul agent modèle pilote le run.

Les fonctions de vérification, policy checking et revue d'artefact existent, mais restent internalisées dans le même runtime et le même journal d'événements.

Avec `computer control`, cette option implique aussi :

- une vérification internalisée d'état visible local ;
- des checkpoints explicites de contexte fenêtre / surface active ;
- une séparation claire entre observation locale et action locale.

### Bénéfices

- une seule chaîne d'intention et d'action ;
- audit plus simple ;
- benchmark plus simple à interpréter ;
- coût modèle et latence plus faibles ;
- moins de packaging de contexte ;
- moins de risques de désaccord artificiel entre agents.

### Coûts

- la critique n'est pas véritablement indépendante ;
- le même agent peut se tromper puis mal s'auto-évaluer ;
- certaines ambiguïtés DOM ou d'état visible local peuvent échapper à une seule boucle raisonnement/exécution.

### Impact runtime

Faible à modéré.

Le runtime doit structurer explicitement :

- checkpoints de vérification ;
- policy gates ;
- artefact review gates ;
- retry / stop decisions.

Mais il n'a pas à gérer une seconde session agentique autonome.

### Impact auditabilité

Très bon.

Tout reste :

- dans le même run ;
- dans le même fil d'événements ;
- dans la même chaîne approval -> action -> evidence -> outcome.

### Impact approvals

Simple.

L'agent propose, la policy classe, l'opérateur approuve ou refuse. Aucun arbitrage inter-agent n'est exposé à l'opérateur.

### Impact benchmarks

Très bon.

Le benchmark juge :

- un seul système ;
- un seul flux d'intention ;
- un seul producteur d'artefact.

### Risques d'opacité

Relativement faibles, si la boucle de vérification est rendue explicite dans les événements et les preuves.

### Compatibilité avec le prototype slice

Excellente.

Cette option respecte entièrement le slice déjà fermé.

## Option B. Primary agent + verifier/evaluator agent

### Description

Un agent principal pilote le navigateur et, désormais, une petite couche de `computer control` borné.

Un second agent, borné et idéalement read-only, relit les preuves, outcomes et artefacts à des checkpoints précis.

### Bénéfices

- critique plus indépendante ;
- meilleure chance de détecter :
  - outcome mal vérifié,
  - preuve insuffisante,
  - artefact trop affirmatif,
  - DOM ambigu mal résolu,
  - contexte fenêtre ou surface active mal qualifié ;
- séparation plus nette entre production et contrôle qualité.

### Coûts

- deuxième contexte à construire et maintenir ;
- deuxième session ou sous-session à tracer ;
- logique d'arbitrage entre agent principal et vérificateur ;
- ambiguïté potentielle sur :
  - qui a raison,
  - qui relance,
  - qui bloque,
  - qui parle à l'opérateur.

### Impact runtime

Élevé pour un prototype.

Il faut ajouter :

- orchestration de rôle ;
- packaging de preuves pour le vérificateur ;
- politique de désaccord ;
- journal croisé ;
- coût et latence supplémentaires.

### Impact auditabilité

Ambivalent.

Mieux si la séparation est parfaite.

Pire si :

- les deux agents n'ont pas le même contexte ;
- les verdicts divergent sans politique claire ;
- l'opérateur ne comprend plus qui a proposé, exécuté ou refusé.

### Impact approvals

Plus complexe.

Questions à résoudre :

- le vérificateur peut-il exiger une approval supplémentaire ;
- le principal peut-il réessayer sans repasser par l'opérateur ;
- le vérificateur peut-il bloquer un artifact sans bloquer le run ;
- quel message voit l'opérateur en cas de désaccord.

### Impact benchmarks

Plus fragile.

Un échec peut venir de :

- l'agent principal ;
- le vérificateur ;
- le packaging des preuves ;
- l'arbitrage entre les deux.

Le benchmark mesure alors aussi la coordination, pas seulement le browser control.

### Risques d'opacité

Réels.

Le système peut devenir plus difficile à expliquer qu'à améliorer.

### Compatibilité avec le prototype slice

Partielle seulement.

Cette option peut être conçue proprement, mais elle ajoute une couche de complexité qui n'est pas nécessaire pour prouver le slice V1.

## Option C. Primary agent + critic agent + operator UI gate

### Description

Un agent agit, un autre critique, l'opérateur arbitre.

### Bénéfices

- très forte séparation des rôles en théorie ;
- possibilité de débats structurés sur cas ambigus.

### Coûts

- complexité disproportionnée ;
- beaucoup plus de contexte à transporter ;
- surcharge cognitive pour l'opérateur ;
- risque de transformer le prototype en démonstrateur de coordination plutôt qu'en preuve produit.

### Impact runtime

Très élevé.

### Impact auditabilité

Mauvais pour un prototype.

Le système devient rapidement plus difficile à lire que le problème qu'il essaye de résoudre.

### Impact approvals

Mauvais.

L'opérateur peut se retrouver à arbitrer des désaccords entre agents au lieu de valider des actes sensibles.

### Impact benchmarks

Mauvais.

Les résultats deviennent difficiles à comparer.

### Risques d'opacité

Très élevés.

### Compatibilité avec le prototype slice

Faible.

Option rejetée.

## Option D. Multi-agent libre ou équipe d'agents

Option explicitement rejetée pour le prototype.

Elle contredit :

- la lisibilité ;
- l'auditabilité ;
- la benchmarkabilité ;
- la discipline de scope du slice V1.

## Ce que le browser control change réellement dans la décision

Le `browser control` `DOM-first` et le `computer control` borné pourraient faire penser qu'un second agent est nécessaire, parce que :

- les pages sont dynamiques ;
- les cibles peuvent être ambiguës ;
- l'outcome d'une action peut être trompeur ;
- l'état visible local peut être ambigu ou partiellement concluant ;
- les artefacts peuvent paraître crédibles même si la collecte est insuffisante.

Mais, pour ce prototype précis, la bonne réponse architecturale n'est toujours pas un second agent autonome.

Les difficultés dominantes du slice V1 sont surtout :

- la robustesse des primitives ;
- la qualité de la sélection DOM ;
- la vérification d'outcome ;
- la qualification du bon contexte fenêtre ;
- la vérification d'état visible local ;
- la qualité et la minimisation des preuves ;
- la discipline de benchmark.

Ces difficultés sont mieux traitées, à ce stade, par :

- des checkpoints explicites ;
- des vérifications déterministes et evidence-backed ;
- une policy claire ;
- une revue humaine benchmarkée ;
- un runtime lisible.

Autrement dit :

sur un prototype de surfaces contrôlées, les gains d'un second agent sont moins importants que les coûts de coordination qu'il ajoute.

## Ce que `claw-code` apporte à cette réévaluation

`claw-code` montre des choses utiles :

- spécialisation de sous-agents par type ;
- restriction d'outils par rôle ;
- sessions et forks ;
- événements typés ;
- recovery explicite ;
- trust gates ;
- hooks et plugins.

Il apporte aussi une leçon utile pour `computer control` :

- les transitions de contexte risqué doivent passer par des états explicites, des événements explicites et une politique de recovery claire, pas par des heuristiques implicites.

Mais sa leçon la plus utile ici n'est pas “mettre plusieurs agents”.

Sa leçon utile est :

si l'on sépare des rôles, il faut le faire avec :

- un contrôle strict ;
- des outils bornés ;
- des événements explicites ;
- un recovery clair ;
- une responsabilité lisible.

Pour notre prototype, cette leçon plaide d'abord pour une séparation de rôles dans le runtime, pas pour deux agents autonomes dès la première ligne de code.

## Recommandation nette

Pour ce prototype précis, il faut **rester sur un mono-agent supervisé**.

### Forme exacte retenue

- un seul agent modèle pilote le run ;
- la vérification d'outcome, le policy checking et la revue d'artefact sont des rôles internalisés et explicités ;
- la vérification d'état visible local est ajoutée au rôle internalisé d'évaluation ;
- aucun second agent autonome n'est retenu dans le prototype V1 ;
- un éventuel `verifier agent` futur n'est admissible qu'après stabilisation du slice, et seulement sous forme `read-only`, checkpointée, non autorisante.

## Décision finale

La décision prototype devient :

- `mono-agent supervisé maintenu`
- `rôles internalisés renforcés`
- `pas de bi-agent autonome en V1`

Ce choix reste le plus juste pour :

- la clarté du prototype ;
- la qualité de l'audit ;
- la discipline de benchmark ;
- la maîtrise du passage `browser -> computer control` ;
- et la maîtrise de la complexité runtime.
