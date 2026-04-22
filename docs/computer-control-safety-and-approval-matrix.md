# Computer Control Safety And Approval Matrix

## Statut

Safety and approval decision document.

Ce document produit la matrice spécifique au `computer control`. Il complète le modèle général de permissions avec une posture plus stricte, adaptée aux ambiguïtés du desktop.

Documents liés :
- [permissions-trust-safety.md](./permissions-trust-safety.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-primitives.md](./computer-control-primitives.md)

## 1. Posture retenue

Posture canonique :

- `safe-by-default`
- `observation-first`
- `explicit approval before local actuation`
- `no silent escalation from browser to desktop`

## 2. Classification générale

| Action class | Nature | Réversibilité | Default policy |
| --- | --- | --- | --- |
| Observation | lire l'état visible ou le focus | haute | auto sur surface autorisée |
| Focus change | changer le contexte actif | moyenne | explicite ou session-bounded |
| Pointer actuation | cliquer, drag, menu contextuel | faible à moyenne | interdit dans le premier build |
| Keyboard actuation | taper, hotkeys | faible à moyenne | interdit dans le premier build |
| App or system transition | ouvrir, fermer, changer d'app, dialogues système | faible | interdit dans le premier build |

## 3. Detailed matrix

| Action | Impact | Contexte | Réversibilité | Prototype V1 | Approval V1 | Later policy direction |
| --- | --- | --- | --- | --- | --- | --- |
| Detect active window | faible | allowlisted window/app | haute | autorisé | auto | auto sur surfaces contrôlées |
| List visible windows | faible | allowlisted context | haute | autorisé | auto | auto |
| Capture allowlisted window | faible à moyen | sandbox / controlled surface | haute | autorisé | auto | auto hors surface sensible |
| Capture region | moyen | région ciblée et justifiée | haute | autorisé | explicite si ambigu ou sensible | auto possible sur regions strictement bornées |
| Focus allowlisted window | moyen | changement de contexte visible | moyenne | autorisé | explicite au minimum une fois | session-bounded possible plus tard |
| Wait for visible UI state | faible | read-only verification | haute | autorisé | auto | auto |
| Verify visible outcome | faible à moyen | evidence-backed | haute | autorisé | auto | auto |
| Export action evidence | faible | bundle de preuves | haute | autorisé | auto | auto |
| Scroll desktop surface | moyen | surface non DOM | moyenne | interdit premier build | n/a | explicite |
| Cursor move | moyen | cible visible locale | moyenne | interdit premier build | n/a | explicite |
| Click | élevé | local UI actuation | moyenne à faible | interdit premier build | n/a | explicite forte |
| Double click | élevé | local UI actuation | faible | interdit premier build | n/a | explicite forte |
| Right click | élevé | local UI actuation | faible | interdit premier build | n/a | explicite forte |
| Drag | très élevé | local UI actuation | faible | interdit premier build | n/a | explicite forte |
| Keyboard input | élevé | texte ou commandes locales | faible | interdit premier build | n/a | explicite forte |
| Hotkeys | très élevé | raccourcis système ou applicatifs | faible | interdit premier build | n/a | explicite forte |
| Launch app | très élevé | transition applicative | faible | interdit premier build | n/a | explicite forte |
| Close app/window | très élevé | perte potentielle d'état | faible | interdit premier build | n/a | explicite forte |

## 4. What can stay read-only

Peut rester `read-only` dans la première version si la surface est autorisée :

- identification de fenêtre active ;
- capture d'une fenêtre contrôlée ;
- attente d'un état visible ;
- qualification d'un blocker ;
- vérification d'un outcome visible ;
- export de preuves.

## 5. What can be actionable under approval

Dans le prototype retenu, une seule famille d'action locale est admissible :

- `focus_window` sur fenêtre allowlistée, avec contexte visible et audit.

Toutes les autres actions locales actives restent interdites dans le premier build, même sous approval.

## 6. What stays forbidden

Restent interdits en première version :

- pointer actuation locale ;
- clavier local ;
- hotkeys ;
- ouverture/fermeture d'applications ;
- dialogues système réels ;
- actions irréversibles locales ;
- actions répétitives de masse ;
- extension silencieuse du périmètre de capture ou de contrôle.

## 7. What must never be auto-approved in first version

Ne doivent jamais être auto-approuvés en première version :

- tout clic local ;
- toute saisie clavier locale ;
- tout drag/drop ;
- toute hotkey ;
- tout changement de focus vers une surface non explicitement autorisée ;
- toute capture d'une surface sensible non prévue ;
- toute transition applicative.

## 8. Safety principles

- une surface desktop non qualifiée n'est jamais une cible implicite ;
- un changement de fenêtre est un changement de contexte, pas un détail d'implémentation ;
- l'audit doit permettre de reconstruire le contexte visuel au moment de l'action ;
- une surface sensible vaut toujours plus qu'une optimisation de UX ;
- en cas de doute sur la bonne fenêtre ou la bonne zone, le système stop.

## 9. Decision summary

Décision fermée :

- le `computer control` est officiel au niveau produit ;
- sa première forme prototype est observatoire et focalisée sur la preuve ;
- la première actuation locale admise est le `focus` gouverné ;
- le reste de l'actuation desktop reste interdit tant qu'une nouvelle gate n'est pas ouverte.
