# Browser and computer control

## 1. Objet du document

Ce document clarifie une distinction essentielle pour le futur produit :

- `web fetch/search`,
- `navigateur contrôlé`,
- `computer use`.

Ces trois niveaux n'ont ni les mêmes capacités, ni les mêmes risques, ni les mêmes exigences produit.

Dans le corpus, `computer control` est le terme produit privilégié. `Computer use` peut apparaître comme terme générique du domaine, mais il ne doit pas masquer la frontière de conception.

Ce document reste la vue d'ensemble. Le pack détaillé navigateur se trouve dans :

- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- [browser-control-observability.md](./browser-control-observability.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)

Le pack détaillé `computer control` se trouve désormais dans :

- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-primitives.md](./computer-control-primitives.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)

## 2. Les trois niveaux à distinguer

| Niveau | Ce que c'est | Ce que ça permet | Ce que ça ne permet pas |
|---|---|---|---|
| Web fetch/search | HTTP et scraping léger | récupérer une page, extraire du texte, faire une recherche | interagir avec un site réel ou une session active |
| Navigateur contrôlé | pilotage d'un vrai navigateur | lire DOM, cliquer, remplir, télécharger, suivre l'état web réel | piloter l'ordinateur hors navigateur |
| Computer use | pilotage du poste et des applications | fenêtres, focus, capture, accessibilité, actions locales bornées | garantir à lui seul la compréhension métier d'une page ou d'un système |

## 3. Pourquoi `claw-code` ne suffit pas pour cette couche

`claw-code` propose des surfaces utiles de type `WebFetch` et `WebSearch`, mais cela reste du fetch et du parsing.

Cela ne remplace pas une vraie couche navigateur capable de :

- manipuler des onglets,
- lire le DOM vivant,
- gérer des formulaires,
- suivre les changements de page,
- observer réseau et console,
- attacher une session existante,
- produire des screenshots et prévisualisations de l'état réel.

Il ne fournit pas non plus une vraie couche `computer use` de niveau produit :

- inspection de fenêtres,
- accessibilité UI,
- focus fiable,
- interaction locale bornée,
- coordination avec approvals UX.

Conclusion :

`claw-code` peut inspirer la logique runtime autour des tools.

Il ne couvre pas la couche browser/computer control dont notre produit a besoin.

## 4. Besoins exacts côté navigateur

La future couche navigateur doit couvrir au minimum :

- ouverture et fermeture d'onglets,
- navigation vers URL,
- lecture du DOM et du texte principal,
- sélection d'éléments,
- clic,
- saisie dans les champs,
- soumission de formulaires,
- téléchargement et upload de fichiers,
- screenshots,
- inspection du titre, de l'URL, de l'état de navigation,
- récupération des logs console si nécessaire,
- inspection réseau pour certains cas d'usage,
- attachement à une session Chrome existante si explicitement autorisé.

## 5. Besoins exacts côté computer use

La future couche ordinateur doit couvrir au minimum :

- lister les fenêtres et applications visibles,
- amener une fenêtre au premier plan,
- capturer l'écran ou une fenêtre,
- inspecter l'arbre d'accessibilité si disponible,
- cliquer et saisir sur des cibles identifiées,
- lancer une application autorisée,
- détecter les ambiguïtés de cible avant action.

Le produit ne doit pas commencer par un computer use généralisé.

Il doit commencer par des actions bornées, observables et gouvernables.

## 6. Recommandation d'abstraction

Il faut distinguer trois couches conceptuelles.

### 6.1 Driver bas niveau

Responsable de parler au navigateur ou au système d'exploitation.

### 6.2 Outils d'interaction

Expose des primitives compréhensibles par le runtime :

- `browser.open_page`
- `browser.read_dom`
- `browser.click`
- `browser.type`
- `browser.submit`
- `desktop.list_windows`
- `desktop.capture_screen`
- `desktop.inspect_ui`

### 6.3 Policy et approvals

Décide si l'action a le droit d'être exécutée.

Cette couche ne doit jamais être confondue avec le driver lui-même.

## 7. Risques UX et sécurité

Les risques principaux de cette couche sont :

- agir sur le mauvais onglet ou la mauvaise fenêtre,
- soumettre un formulaire trop tôt,
- perdre le contexte d'une session authentifiée,
- télécharger ou écraser au mauvais endroit,
- déclencher une action métier irréversible,
- sur-solliciter l'utilisateur avec trop d'approvals,
- donner un faux sentiment de contrôle alors que l'état réel a changé.

## 8. Principes de sécurité pour cette couche

- préférer les signaux structurés au pixel guessing,
- demander approval avant toute action de soumission ou publication,
- journaliser les captures avant/après quand le risque le justifie,
- borner les domaines et applications autorisés,
- refuser l'ambiguïté plutôt que cliquer au hasard,
- permettre l'arrêt d'urgence,
- considérer navigateur authentifié et navigateur non authentifié comme deux risques différents.

## 9. Ordre de priorité produit

La bonne séquence de construction n'est pas :

1. tout automatiser partout,
2. puis essayer de rendre ça sûr.

La bonne séquence est :

1. navigateur contrôlé fiable,
2. approvals et audit associés,
3. `computer control` borné d'observation, focus et preuve,
4. seulement ensuite extension prudente du computer use actuatif.

## 10. Décisions non figées

Ce document ne tranche pas encore :

- le toolkit exact de contrôle navigateur,
- le protocole concret d'attachement à Chrome,
- le niveau de vision requis dans la v1,
- la frontière exacte entre browser control et computer use,
- le degré d'automatisation desktop acceptable au MVP.

Mais il fixe déjà une chose :

notre produit a besoin d'une couche spécifique de navigateur et d'ordinateur que `claw-code` ne fournit pas.

Décision révisée :

- le `computer control` fait partie du produit ;
- il revient dans le cadre canonique ;
- il entre dans le prototype sous une forme `browser-first`, bornée et benchmarkable.

Voir aussi :

- [approval-policy-matrix.md](./approval-policy-matrix.md)
- [threat-model.md](./threat-model.md)
- [prototype-boundary-v1.md](./prototype-boundary-v1.md)
