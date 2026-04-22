# Browser control spec

## But du document

Devenir le document canonique principal de la capacité `browser control` pour Cowork IA.

Ce document définit :

- ce que le produit entend exactement par `browser control`,
- ce qui distingue cette capacité d'un simple `web fetch/search`,
- ce qui la distingue du `computer control`,
- quelles sont les capacités minimales `V1`,
- quelles extensions deviennent pertinentes en `V2`,
- quelles sont les décisions déjà prises, les hypothèses encore fragiles et les dépendances futures.

## Statut dans le corpus

Ce document complète et approfondit [browser-and-computer-control.md](./browser-and-computer-control.md), qui reste la vue d'ensemble de haut niveau.

Pour le navigateur, ce document est désormais la référence principale.

## Position produit

Dans Cowork IA, le `browser control` n'est pas un gadget de scraping. C'est une capacité cœur du produit parce qu'elle permet :

- d'exécuter des missions réelles dans un environnement web vivant,
- d'utiliser des sessions et des états de page réels,
- d'observer ce qui est effectivement visible et interactif,
- de produire des artefacts à partir d'actions web supervisées,
- de rattacher le comportement navigateur à un `run`, à des `approvals` et à un `audit`.

Cette capacité doit rester :

- supervisée,
- explicable,
- auditable,
- bornée,
- orientée mission et outcome,
- non conçue pour l'opacité ou l'agressivité.

## Distinctions fondamentales

### 1. Web fetch/search

Le `web fetch/search` sert à :

- récupérer du HTML ou du texte,
- lancer une recherche,
- analyser des pages statiques,
- compléter un contexte documentaire.

Il ne suffit pas quand il faut :

- manipuler une session authentifiée,
- suivre un état de page dynamique,
- interagir avec des éléments réels,
- gérer des formulaires,
- vérifier le résultat d'une action.

### 2. Navigateur contrôlé via une couche de type CDP

Le `browser control` vise le pilotage d'un vrai navigateur, avec accès à des capacités de type :

- session navigateur vivante,
- onglets et fenêtres,
- DOM réel,
- état de navigation,
- interactions sur éléments,
- téléchargements et uploads,
- captures de preuves,
- attachement à une session existante si autorisé.

Le choix exact du driver reste ouvert, mais la capacité cible suppose un niveau de contrôle comparable à ce qu'autorise une interface de type CDP.

### 3. Computer control

Le `computer control` désigne le pilotage d'applications ou de surfaces desktop hors navigateur.

Il reste distinct pour trois raisons :

- l'état applicatif y est plus ambigu,
- la compréhension métier y dépend davantage de la vision ou de l'accessibilité,
- le risque et le coût de supervision y sont plus élevés.

Décision prise :

- `browser control` est cœur prototype/MVP,
- `computer control` n'est pas cœur prototype.

## Décisions fondatrices

- La stratégie dominante est `DOM-first`.
- Le navigateur doit être gouverné par les mêmes primitives produit que le reste du système : `run`, `approval`, `source`, `artefact`, `audit`.
- Une action navigateur n'est pas valide tant que son résultat n'a pas été vérifié.
- Les surfaces authentifiées, engageantes ou publiantes sont plus sensibles que la simple lecture.
- Le système doit préférer l'arrêt propre à l'insistance aveugle lorsque l'état devient ambigu.

## Capacités minimales V1

`V1` désigne ici la première version sérieuse de la capacité, suffisante pour un prototype utile et un MVP navigateur borné.

| Domaine | Attendu en V1 |
| --- | --- |
| Session navigateur | ouvrir ou attacher une session explicitement autorisée |
| Onglets / targets | lister, ouvrir, fermer, focaliser, associer chaque action à une target claire |
| Navigation | charger une URL, revenir à un état stable, détecter redirection et échec évident |
| DOM inspection | capturer un snapshot DOM utile, résoudre des éléments interactifs, inspecter un élément candidat |
| DOM interaction | clic, focus, saisie, sélection, checkbox, soumission préparée |
| Scroll | scroll viewport, scroll jusqu'à l'élément, gérer lazy loading simple |
| Formulaires | lecture des champs, remplissage partiel, vérification avant soumission |
| Rich text | édition simple ou assistée sur surfaces riches lorsque la structure DOM reste exploitable |
| Upload / download | upload de fichier explicitement autorisé, téléchargement vers zone bornée |
| Frames / iframes | détection et changement de contexte de frame lorsqu'il est nécessaire et explicable |
| Modals / popups | détection des bloqueurs et fermeture/acceptation non engageante |
| Vérification | vérification explicite du résultat d'action, pas seulement exécution |
| Preuves | captures utiles pour audit : URL, titre, snapshot DOM, élément ciblé, preuve avant/après si nécessaire |

## Capacités visées en V2

`V2` élargit la profondeur, pas seulement le nombre d'actions.

| Domaine | Extension visée en V2 |
| --- | --- |
| Multi-tab orchestration | comparaison robuste entre plusieurs pages, reprise plus riche de contexte inter-onglets |
| Surfaces authentifiées | workflows de lecture et d'édition bornés sur applications web professionnelles |
| Rich editors complexes | meilleure prise en charge des éditeurs riches et des structures non triviales |
| Navigation complexe | attentes plus fines sur réseau, transitions SPA, états réactifs complexes |
| Drafting assisté | rédaction assistée plus robuste avant publication sous approval |
| Vérification | contrôle plus sophistiqué de l'outcome, y compris changements d'état applicatif |
| Evidence | meilleure exportabilité des preuves de page et des résumés de parcours |
| Fallback visuel | usage plus encadré du screenshot/vision pour surfaces DOM insuffisantes |

## Fondement : DOM-first

Le produit doit privilégier le DOM chaque fois qu'il offre une représentation exploitable de la page.

Pourquoi :

- le DOM est plus structuré que le pixel,
- il permet des sélections auditables,
- il offre des attributs sémantiques et accessibles,
- il rend la vérification post-action plus fiable,
- il limite la dépendance aux heuristiques opaques.

Conséquence :

- le système doit d'abord raisonner sur le DOM,
- puis seulement, en cas d'insuffisance, utiliser une stratégie de secours visuelle ou hybride.

La stratégie détaillée est décrite dans [browser-control-dom-strategy.md](./browser-control-dom-strategy.md).

## Couches du browser control

## 1. Session navigateur

La session navigateur est l'entité de continuité qui permet :

- de conserver l'état d'authentification,
- de gérer plusieurs targets,
- de lier actions et preuves à un même contexte,
- de reprendre une mission sans repartir d'un navigateur abstrait.

Exigences :

- identité de session explicite,
- rattachement au `run`,
- statut d'attachement clair,
- séparation entre session autorisée et session non autorisée.

Hypothèse :

La possibilité d'attacher une session existante est utile, mais doit rester explicite et sensible.

## 2. Fenêtres, onglets et targets

Le moteur doit distinguer :

- fenêtre navigateur,
- onglet,
- target/page active,
- éventuelle target enfant.

Exigences :

- aucune action ne doit partir sans target résolue,
- l'UI doit rendre visible l'onglet ciblé,
- le runtime doit savoir quand une navigation ouvre une nouvelle target,
- un mauvais focus doit être traité comme risque, pas comme détail.

## 3. Navigation

La navigation n'est pas seulement "aller à une URL". Elle comprend :

- chargement initial,
- redirections,
- transitions client-side,
- navigation imprévue,
- retour à un état stable suffisant pour agir.

Exigences :

- distinguer chargement apparent et page réellement prête,
- expliciter domaine et URL finale,
- détecter changements de contexte significatifs,
- ne pas agir avant un état vérifié.

## 4. DOM inspection

La couche d'inspection doit permettre :

- de capturer un snapshot utile,
- d'identifier les régions importantes,
- de distinguer contenu informatif et éléments interactifs,
- de repérer labels, rôles, états et contraintes.

Exigences :

- snapshots traçables,
- résolution des éléments actionnables,
- capacité à inspecter précisément un candidat avant action.

## 5. DOM interaction

La couche d'interaction couvre :

- click,
- focus,
- hover,
- saisie,
- sélection,
- toggle,
- soumission,
- vérification d'effet.

Exigences :

- vérifier l'actionnabilité avant interaction,
- ne pas "cliquer pour voir",
- réévaluer l'état après interaction,
- rattacher l'élément ciblé à une trace lisible.

## 6. Scroll

Le scroll est une capacité à part entière, pas un simple geste technique.

Il sert à :

- amener une zone dans le viewport,
- déclencher un chargement paresseux,
- lire un contenu long,
- vérifier la présence réelle d'un élément.

Exigences :

- différencier scroll viewport et scroll vers élément,
- éviter les scrolls arbitraires sans objectif,
- savoir quand le scroll n'apporte plus d'information.

## 7. Forms

La prise en charge des formulaires doit distinguer :

- lecture de la structure du formulaire,
- saisie non engageante,
- validation locale,
- soumission engageante.

Exigences :

- comprendre labels, types et contraintes,
- vérifier les valeurs avant soumission,
- traiter la soumission comme action plus sensible que la simple saisie.

## 8. Rich text editors

Les éditeurs riches sont une zone sensible parce que :

- leur structure DOM est souvent plus complexe,
- les raccourcis clavier et états internes peuvent être fragiles,
- la différence entre brouillon et publication y est parfois subtile.

Exigences minimales V1 :

- lire le contenu existant,
- injecter ou remplacer du texte de manière bornée,
- vérifier le résultat visible,
- s'arrêter si la structure est trop ambiguë.

V2 pourra élargir cette capacité, mais pas au prix d'une perte d'auditabilité.

## 9. Uploads / downloads

Ces capacités relient le navigateur au `workspace`.

### Upload

Exige :

- un fichier source explicitement autorisé,
- une cible de formulaire claire,
- une vérification que le fichier sélectionné est le bon,
- une traçabilité du lien fichier local -> action web.

### Download

Exige :

- un dossier de réception borné,
- une vérification du fichier attendu,
- une politique d'approval claire selon contexte.

## 10. Frames / iframes

Les frames sont une source classique d'erreur.

Exigences :

- détecter explicitement le changement de contexte,
- indiquer sur quelle frame l'action est menée,
- ne pas supposer que l'élément visible appartient à la frame courante,
- traiter les frames cross-origin comme surfaces plus délicates.

## 11. Popups / modals

Le système doit distinguer :

- modal informative,
- consent modal,
- popup bloquante,
- dialogue engageant.

Exigences :

- détection explicite,
- politique claire de fermeture ou d'acceptation,
- approval si la modal implique une conséquence métier ou juridique non triviale.

## 12. Authentication-sensitive surfaces

Le navigateur authentifié n'est pas un navigateur ordinaire.

Exigences :

- distinguer lecture sur surface publique et lecture sur surface authentifiée,
- ne jamais confier la saisie de secrets au modèle au départ,
- traiter les surfaces de login expiré, MFA, consentement et confirmation comme points de friction forte,
- demander approval avant d'utiliser une session authentifiée sur une plateforme sensible si le périmètre n'était pas déjà acté.

## 13. Fallback visuel

Le fallback visuel n'est pas la stratégie normale. C'est une stratégie de secours.

Il devient pertinent quand :

- le DOM ne décrit pas bien la cible,
- la surface est fortement canvas-based ou virtualisée,
- un blocage visuel n'est pas suffisamment compréhensible via le DOM,
- l'éditeur riche ou la page réactive rendent l'état DOM insuffisant pour décider.

Exigences :

- le fallback doit être explicite,
- il doit laisser une trace de pourquoi le DOM ne suffisait pas,
- il ne doit pas devenir un prétexte à agir sans structure,
- il doit être stoppé si l'ambiguïté persiste.

## Quand agir via DOM et quand basculer

| Situation | Stratégie prioritaire | Pourquoi |
| --- | --- | --- |
| page structurée, éléments accessibles, rôles clairs | DOM-first pur | meilleure robustesse et audit |
| page dynamique mais DOM encore interprétable | DOM-first avec vérification renforcée | garde la structure tout en gérant la réactivité |
| élément visible mais ambigu côté DOM | DOM-first + confirmation via evidence ou contexte visuel | évite un pixel-first trop tôt |
| surface riche, virtualisée ou canvas-like | DOM si possible, sinon fallback visuel borné | le DOM peut être insuffisant |
| état de page incohérent ou résultat non vérifiable | arrêt ou approval de reprise | agir davantage serait dangereux |

Décision prise :

- le système ne doit pas basculer en stratégie visuelle simplement par commodité,
- il doit documenter pourquoi le DOM est jugé insuffisant.

## Vérification de résultat

Une action navigateur ne doit pas être considérée réussie parce qu'un clic ou une saisie a été émis.

Le système doit vérifier au moins un des éléments suivants :

- changement d'URL attendu,
- changement d'état DOM attendu,
- message de succès,
- valeur réellement saisie,
- fichier réellement uploadé ou téléchargé,
- artefact ou preuve d'aboutissement visible.

Sans vérification, l'action reste seulement "tentée".

## Relation avec approvals et artefacts

Le `browser control` ne vit pas isolément.

Il doit pouvoir :

- demander une `approval` quand une action devient engageante,
- produire des `sources` web traçables,
- alimenter un `artefact`,
- rattacher les étapes web au `run`,
- exporter des preuves de navigation quand le risque ou la valeur métier le justifie.

## Hors périmètre volontaire V1

- stealth anti-détection,
- contournement de CAPTCHA,
- contournement explicite de garde-fous de plateforme,
- credential harvesting,
- envois massifs ou publications de masse,
- automation non supervisée d'actes engageants,
- `computer control` généralisé.

## Risques structurants

- mauvais ciblage d'élément,
- action sur mauvais onglet,
- soumission involontaire,
- DOM dynamique rendant une sélection obsolète,
- confusion entre lecture simple et surface authentifiée,
- fuite de données via preuves ou artefacts,
- dérive progressive vers un browser bot opaque.

## Dépendances

- modèle de `run` et d'`approval`,
- taxonomie d'événements,
- stratégie de contexte,
- policy de domaines et de plateformes,
- modèle d'artefacts et de preuves,
- UI de supervision opérateur.

## Incertitudes encore ouvertes

- le niveau exact d'attachement à une session existante dans la v1,
- le seuil à partir duquel le fallback visuel devient acceptable,
- la prise en charge initiale des éditeurs riches complexes,
- la profondeur des workflows authentifiés dans la première boucle produit,
- la granularité idéale des approvals navigateur répétitives.

## Liens avec le reste du corpus

- Vue d'ensemble : [browser-and-computer-control.md](./browser-and-computer-control.md)
- Stratégie DOM : [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- Primitives : [browser-control-primitives.md](./browser-control-primitives.md)
- Patterns de tâches : [browser-control-task-patterns.md](./browser-control-task-patterns.md)
- Approvals navigateur : [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- Observabilité : [browser-control-observability.md](./browser-control-observability.md)
- Recovery : [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- Plan de fixtures : [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- Benchmarks : [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- Cahier des charges consolidé : [cahier-des-charges-browser-control.md](./cahier-des-charges-browser-control.md)
