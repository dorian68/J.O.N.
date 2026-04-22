# Browser control prototype gate

## But du document

Formaliser noir sur blanc la porte d'entrée du prototype navigateur.

Ce document sert à autoriser ou refuser objectivement la première ligne de code `browser control`.

Il ne décrit pas le moteur. Il fixe la condition d'autorisation, les garde-fous obligatoires et les motifs de refus ou d'arrêt.

Related documents:
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [multi-agent-reassessment.md](./multi-agent-reassessment.md)
- [agent-supervision-and-evaluation-loop.md](./agent-supervision-and-evaluation-loop.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)

## Statut actuel

Statut d'architecte :

- `authorized under strict conditions`

Ce n'est pas un feu vert général au produit. C'est un feu vert borné au slice défini dans [prototype-slice-v1.md](./prototype-slice-v1.md).

Note révisée :

- le slice n'est plus `browser only` ;
- il reste `browser-first` ;
- une fondation bornée de `computer control` est désormais officielle dans le prototype, sans changer la nature prioritaire de cette gate.

## Règle générale

Le prototype navigateur est autorisé uniquement si :

- le slice prototype reste gelé ;
- les fixtures minimales existent ;
- les benchmarks minimaux sont prêts ;
- les approvals suivent le contrat UX défini ;
- la persistance reste minimale et locale ;
- les revendications de succès passent par la revue benchmark définie.

Si l'une de ces conditions est violée pendant le build, la gate doit être reconsidérée.

## Prérequis documentaires obligatoires

Les documents suivants doivent exister et être traités comme canoniques avant tout build navigateur :

- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [prototype-boundary-v1.md](./prototype-boundary-v1.md)
- [threat-model.md](./threat-model.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

Décision prise :

- ces prérequis sont maintenant satisfaits.

## Décisions qui doivent rester fermées pendant le build

Les décisions suivantes ne doivent pas être rouvertes implicitement pendant le prototype :

- mono-agent supervisé avec boucle d'évaluation internalisée ;
- browser control prioritaire, avec `computer control` borné d'observation, focus et preuve ;
- pas de computer control généralisé ;
- pas de second agent autonome vérificateur ou critique ;
- pas de login, pas de credential entry, pas de submission, pas de publication ;
- artefacts prototype limités au `Tableau de collecte navigateur` et à la `Note de decision` ;
- approvals explicites pour tout write intent ;
- persistance locale minimale ;
- pas de plateforme externe sensible comme terrain principal de preuve.

## Fixtures obligatoires prêtes

Le build navigateur n'est autorisé que si le set minimal suivant est prêt ou préparé en amont immédiat :

- `navigation simple avec outcome explicite`
- `DOM ambigu avec cibles similaires`
- `page longue avec scroll et élément hors viewport`
- `formulaire simple avec champ requis et bouton disabled`
- `multi-tab avec mauvaise target possible`
- `modal bloquante`
- `DOM muté après interaction`
- `outcome ambigu`
- `surface authentifiée synthétique avec session expirée`

Décision prise :

- ce set reste obligatoire même si le premier slice n'exploite pas encore toutes les familles de façon égale.

## Benchmarks minimum obligatoires

Avant toute démo interne revendiquant un prototype valide, les familles suivantes doivent être couvertes et revues :

- lecture et synthèse sur pages contrôlées ;
- navigation multi-onglets et comparaison ;
- collecte structurée multi-pages ;
- remplissage partiel de formulaire sans soumission ;
- vérification d'outcome et export de preuves ;
- arrêt propre sur chemin refusé ou surface non acceptable.
- détection de fenêtre active et focus allowlisté ;
- attente d'état visible et vérification d'outcome local.

La rédaction assistée avec approval finale n'est pas obligatoire pour le premier feu vert.

## Approvals minimum à respecter

Le build doit respecter au minimum :

- lecture et inspection sans friction excessive sur surface autorisée ;
- approval explicite pour toute saisie ou modification de champ ;
- approval explicite pour sortie du périmètre autorisé ;
- aucun contournement après refus ;
- aucun acte engageant dans le slice.

## Limites de scope du prototype

Le prototype doit rester dans ces bornes :

- surfaces contrôlées seulement ;
- workflows read-and-prepare seulement ;
- DOM-first ;
- evidence-backed ;
- benchmark-backed ;
- stop-friendly ;
- safe-by-default.

Tout élargissement à :

- plateformes externes sensibles comme terrain principal,
- workflows authentifiés réels,
- actes engageants,
- fallback visuel dominant,

doit être refusé à ce stade.

## Conditions de stop

Le chantier doit être stoppé ou re-scopé si :

- les approvals deviennent trop nombreuses ou incompréhensibles ;
- les artefacts sont structurellement faibles malgré plusieurs itérations ;
- la couche navigateur dérive vers des heuristiques opaques ;
- la couche desktop bornée dérive vers une actuation générale ;
- les fixtures minimales ne suffisent plus à diagnostiquer les échecs ;
- le fallback visuel devient une béquille permanente ;
- les progrès revendiqués ne sont pas vérifiables par benchmark.

## Raisons explicites de refuser ou suspendre le build

Le développement doit être refusé ou suspendu si l'un de ces cas survient :

- le slice prototype n'est plus respecté ;
- les fixtures minimales ne sont pas prêtes ;
- les benchmarks obligatoires ne sont pas maintenus ;
- la persistance locale s'élargit de façon opportuniste ;
- l'UX d'approval dérive hors contrat ;
- des surfaces ou actes hors périmètre sont ajoutés pour servir une démo.

## Décision finale de gate

Le prototype navigateur est autorisé pour le prochain run de développement, sous conditions strictes :

- respecter [prototype-slice-v1.md](./prototype-slice-v1.md) sans élargissement ;
- appliquer [operator-approval-ux-contract.md](./operator-approval-ux-contract.md) sans raccourci ;
- appliquer [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md) sans persistance opportuniste ;
- juger les résultats avec [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md) ;
- ne pas réintroduire un second agent autonome dans le prototype sans rouvrir formellement la gate ;
- ne pas utiliser LinkedIn, Upwork ou une autre plateforme sensible comme terrain principal de la première itération.

Conclusion :

- `yes, under strict conditions`
