# Threat model

## But du document

Produire un premier modèle de menace du produit cible. L'objectif n'est pas de lister tous les dangers imaginables, mais de cadrer les surfaces d'attaque réellement importantes pour un coworker desktop/browser orienté actions, sources et artefacts.

## Hypothèse de base

Le système est dangereux par nature si l'on ne borne pas explicitement :

- ce qu'il peut lire,
- ce qu'il peut écrire,
- ce qu'il peut exécuter,
- ce qu'il peut publier,
- ce qu'il peut interpréter comme fiable.

Le bon modèle n'est donc pas "assistant inoffensif", mais "système opérant à surveiller".

## Frontières de confiance

Les frontières minimales sont :

- l'utilisateur humain,
- le runtime,
- les tools locaux,
- le navigateur contrôlé,
- les sources web et fichiers entrants,
- les connecteurs externes,
- le stockage local,
- les artefacts et exports,
- les logs et traces.

Chaque passage d'une frontière à l'autre doit être considéré comme potentiellement dangereux.

## Menaces principales

| Menace | Surface d'attaque | Impact | Garde-fous conceptuels | À tester plus tard |
| --- | --- | --- | --- | --- |
| Exécution d'actions non voulues | tools locaux, navigateur, computer control | modification non désirée, perte de confiance | policy stricte, approvals, périmètre borné, journal d'audit | oui |
| Fuite de données | logs, artefacts, exports, connecteurs | exposition de données sensibles | minimisation du contexte, séparation des secrets, export contrôlé | oui |
| Tool misuse | mauvaise sélection ou utilisation d'un tool | résultats faux ou dangereux | tool contracts, risk labeling, evaluator, refus par défaut | oui |
| Browser abuse | navigation hors périmètre, soumission cachée, téléchargements non voulus | élargissement de surface, exfiltration ou mutation externe | domains autorisés, approvals explicites, distinction lecture / mutation | oui |
| Escalade de permissions | enchaînement d'actions autorisées pour contourner la policy | accès excessif | scopes explicites, absence d'élargissement silencieux, audit | oui |
| Prompt injection via web ou fichier | contenu hostile dans pages, docs, notes | comportement dévié, outils mal utilisés, données exfiltrées | hiérarchie d'instructions, marquage des sources non fiables, evaluator | oui |
| Confusion sur la fiabilité des sources | mélange de sources sûres et faibles | artefact trompeur, décisions erronées | provenance explicite, signalement de confiance, citations | oui |
| Exfiltration via artefacts ou logs | données reprises dans livrables ou traces | fuite silencieuse de contenu sensible | politique de redaction, contrôle d'export, revue de provenance | oui |
| Mauvaise reprise d'un run | état corrompu ou incomplet | actions répétées, résultat incohérent | événements typés, state model robuste, reprise explicite | oui |
| Mauvaise interprétation d'une approval | consentement mal compris | action sensible validée par erreur | demandes concrètes, scope lisible, refus clair | oui |

## Menaces détaillées

## 1. Exécution d'actions non voulues

### Description

Le système effectue une action qui dépasse l'intention utilisateur réelle.

### Causes probables

- objectif ambigu,
- plan mal interprété,
- action mal classée en termes de risque,
- approval trop vague,
- tool mal borné.

### Position retenue

Ce risque justifie la priorité donnée aux approvals, à l'audit et à la séparation lecture / écriture / action externe.

## 2. Prompt injection

### Description

Un contenu entrant tente de redéfinir les priorités du système ou de le pousser à utiliser des tools hors intention.

### Surfaces typiques

- page web,
- document local,
- texte collé dans une note,
- contenu récupéré via connecteur.

### Position retenue

Toute source externe ou importée doit être considérée comme potentiellement hostile. Elle ne peut jamais devenir instruction de plus haut niveau que la mission, la policy ou les réglages explicites de l'utilisateur.

## 3. Exfiltration par artefact ou log

### Description

Le système ne "sort" pas forcément par un connecteur explicite. Il peut aussi divulguer des données dans :

- un rapport,
- un brouillon,
- un export,
- un journal,
- une citation trop détaillée.

### Position retenue

Les artefacts et journaux ne sont pas neutres. Ils font partie de la surface de sécurité.

## 4. Browser abuse

### Description

Le navigateur contrôlé devient un vecteur d'abus :

- navigation sur des domaines non prévus,
- interaction avec du contenu trompeur,
- soumission involontaire,
- téléchargement ou upload non maîtrisé.

### Position retenue

Le `browser control` est utile, mais il doit rester explicitement gouverné. Il ne doit pas être traité comme un simple outil de scraping.

## 5. Escalade de permissions

### Description

Le système profite d'une suite d'actions apparemment bénignes pour étendre progressivement ses droits réels.

### Position retenue

Une approval ne vaut que pour son scope explicite. Toute extension de périmètre doit déclencher une nouvelle décision.

## Garde-fous conceptuels minimaux

- périmètre projet explicite,
- séparation stricte entre lecture seule, écriture réversible, écriture sensible et action externe irréversible,
- approvals compréhensibles,
- journal d'événements typés,
- traçabilité des sources,
- provenance des artefacts,
- refus par défaut des opérations destructrices ou externes engageantes,
- traitement des contenus entrants comme potentiellement non fiables.

## Zones à tester prioritairement plus tard

- injections dans documents locaux et pages web,
- contournements de policy via enchaînement d'actions réversibles,
- mauvaise classification de domaines web,
- erreurs d'approval en situation de fatigue opérateur,
- fuite de contenu sensible dans les artefacts intermédiaires,
- divergence entre état du navigateur et compréhension du runtime.

## Ce que ce document décide

- la sécurité fait partie du design produit dès maintenant,
- le navigateur, les artefacts et les logs sont des surfaces de sécurité,
- le contenu entrant est considéré comme potentiellement hostile,
- l'exfiltration ne se limite pas aux connecteurs explicites.

## Ce que ce document ne décide pas encore

- les mécanismes techniques détaillés de sandbox,
- la stratégie exacte de gestion des secrets,
- la profondeur du redaction system pour artefacts et logs,
- la défense opérationnelle exacte contre chaque forme d'injection.

## Liens avec le reste du corpus

- Le cadre général des permissions est dans [permissions-trust-safety.md](./permissions-trust-safety.md).
- Les politiques d'approbation sont détaillées dans [approval-policy-matrix.md](./approval-policy-matrix.md).
- Les capacités à risque sont cartographiées dans [tooling-and-capabilities-map.md](./tooling-and-capabilities-map.md).
- La frontière du premier prototype est définie dans [prototype-boundary-v1.md](./prototype-boundary-v1.md).
- Les limites propres aux plateformes sensibles sont précisées dans [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md).
