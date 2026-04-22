# Computer Control Vs Browser Control Boundary

## Statut

Decision boundary document.

Ce document fixe la frontière entre `browser control` et `computer control`. Il formalise la hiérarchie des modes d'action et empêche une dérive vers un système `vision-first` opaque quand le DOM est disponible.

Documents liés :
- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)

## 1. Hiérarchie retenue

Hiérarchie canonique :

1. `DOM-first browser control`
2. `browser fallback` sans perdre l'identité navigateur
3. `computer-control fallback`
4. `stop`

Le système ne choisit pas librement entre ces modes.

Il doit respecter cette hiérarchie.

## 2. Pourquoi cette hiérarchie existe

Le DOM et les signaux navigateur donnent généralement :

- une meilleure identité de cible ;
- une meilleure traçabilité ;
- une meilleure auditabilité ;
- une meilleure vérification d'outcome ;
- moins d'ambiguïté qu'un pilotage purement visuel.

Le `computer control` reste nécessaire, mais il doit être subordonné à cette logique quand on est encore sur une surface web structurée.

## 3. Quand il faut rester DOM-first

Le système doit rester en `browser control DOM-first` si :

- la cible est dans une page web active ;
- le DOM est accessible ;
- l'élément ou l'état attendu peut être qualifié de manière suffisamment robuste ;
- l'outcome peut être vérifié à partir de signaux navigateur.

Le système n'a pas le droit de basculer en `computer control` juste parce que :

- c'est plus facile à implémenter ;
- un sélecteur robuste n'a pas encore été construit ;
- un screenshot “a l'air plus simple” ;
- une démo serait plus impressionnante.

## 4. Ce que couvre le browser fallback

Le `browser fallback` reste encore une logique navigateur.

Il peut inclure :

- capture de page ou de zone depuis le navigateur ;
- bounding boxes issues du navigateur ;
- signaux d'accessibilité ou de layout liés à la page ;
- vérification visuelle d'un résultat dans le contexte de l'onglet ciblé.

Le `browser fallback` est préféré au `computer control` tant que :

- l'identité de l'onglet et de la target est conservée ;
- la preuve reste liée au navigateur ;
- l'ambiguïté est plus faible qu'au niveau desktop.

## 5. Quand le computer control est autorisé

Le `computer control` devient admissible si au moins une de ces conditions est vraie :

- la cible n'est plus dans une surface DOM utile ;
- l'action vise une fenêtre ou un contexte applicatif, pas un élément DOM ;
- il faut vérifier l'état visible réel d'une fenêtre locale ;
- il faut gérer un changement de focus applicatif ou de target hors DOM ;
- le navigateur ne fournit pas une preuve suffisante mais la policy autorise une preuve visible locale.

## 6. Quand le système doit s'arrêter

Le système doit s'arrêter si :

- le DOM est insuffisant mais le `computer control` n'est pas explicitement autorisé ;
- plusieurs fenêtres ou surfaces restent ambiguës ;
- la cible visible ne peut pas être qualifiée avec assez de confiance ;
- le passage en `computer control` transformerait une lecture en action risquée ;
- la preuve disponible n'est pas suffisante pour vérifier un outcome.

## 7. Approval implications

### Pas d'approbation spécifique supplémentaire

Le basculement n'a pas besoin d'une approval spécifique si :

- il reste purement observatoire ;
- il se fait sur une surface allowlistée ;
- il ne change pas l'état de l'application ;
- il sert uniquement à produire ou confirmer une preuve.

### Approval spécifique requise

Le basculement demande une approval spécifique si :

- il change la fenêtre active ;
- il peut exposer une autre surface que celle attendue ;
- il s'approche d'une action locale potentiellement engageante ;
- il augmente le périmètre d'observation au-delà du contexte prévu.

## 8. Règle de priorité opérationnelle

Règle fermée :

- `si le DOM suffit, le systeme doit rester dans le navigateur`

Règle complémentaire :

- `si le DOM ne suffit pas, le systeme doit d'abord chercher un fallback navigateur avant de descendre au niveau computer control`

Règle d'arrêt :

- `si ni le navigateur ni le computer control borné ne permettent une action ou une vérification propre, le systeme doit stop`

## 9. Forme retenue dans le prototype

Dans le prototype autorisé :

- le `browser control` reste la voie principale ;
- le `computer control` n'intervient qu'en support :
  - qualification de fenêtre active,
  - focus,
  - capture,
  - attente d'état visible,
  - vérification visible,
  - preuve.

Le prototype ne doit pas devenir un système piloté principalement par souris/clavier sur écran.

## 10. Décision finale

Décision canonique :

- `DOM-first` reste obligatoire ;
- `computer control` est officiel mais subordonné à une hiérarchie stricte ;
- `computer control` ne devient pas la voie par défaut quand le DOM existe ;
- en cas d'ambiguïté persistante, le bon comportement reste `stop`, pas `vision-first improvisé`.
