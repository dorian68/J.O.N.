# Computer Control Primitives

## Statut

Canonical primitives document.

Ce document définit les primitives conceptuelles du `computer control`. Il décrit la capacité générale, pas seulement le sous-ensemble immédiatement retenu dans le prototype.

Documents liés :
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)

## Lecture correcte

Toutes les primitives ci-dessous font partie du vocabulaire conceptuel du produit.

Mais :

- toutes ne sont pas autorisées dans le prototype ;
- toutes ne sont pas du même niveau de risque ;
- leur existence documentaire ne vaut pas autorisation d'implémentation immédiate.

## Primitive catalog

| Primitive | But | Inputs conceptuels | Output conceptuel | Préconditions | Postconditions | Modes d'échec principaux | Risque | Approval | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `detect_active_window` | identifier la fenêtre actuellement active | contexte run, surfaces autorisées | fenêtre active qualifiée ou ambiguë | session locale active | état de focus connu | fenêtre inconnue, surface non allowlistée, détection incomplète | faible à moyen | auto sur surfaces autorisées | critique |
| `list_visible_windows` | lister les fenêtres visibles pertinentes | filtres éventuels, allowlist applicative | liste qualifiée de fenêtres | accès observation disponible | candidat(s) de focus connus | trop de fenêtres, métadonnées pauvres | faible | auto sur surfaces autorisées | utile |
| `focus_window` | amener une fenêtre autorisée au premier plan | identifiant fenêtre, justification, policy context | confirmation de focus ou état ambigu | fenêtre connue et allowlistée | contexte visuel changé de manière traçable | mauvaise fenêtre, focus refusé, focus instable | moyen | explicite ou session-bounded | critique |
| `capture_screen` | capturer l'écran complet | portée capture, redaction policy | capture horodatée | policy compatible | preuve visuelle disponible | capture vide, surface sensible, multi-écrans ambigus | moyen | explicite si surface sensible | critique |
| `capture_window` | capturer une fenêtre spécifique | identifiant fenêtre, redaction policy | capture de fenêtre | fenêtre connue | preuve ciblée disponible | fenêtre occluse, capture impossible, contenu sensible | faible à moyen | auto sur sandbox autorisée, sinon explicite | critique |
| `capture_region` | capturer une zone précise | coordonnées ou zone qualifiée | capture de région | surface visible stable | preuve locale ciblée | coordonnées invalides, zone mauvaise | moyen | explicite si ambigu ou sensible | élevée |
| `inspect_visible_ui` | décrire l'état visible ou accessible d'une surface | cible fenêtre/région, hints | description structurée, éléments visibles, blockers | capture ou a11y disponible | état UI observable qualifié | UI trop dense, vision ambiguë, a11y absente | moyen | auto read-only | critique |
| `wait_for_ui_state` | attendre un état visible attendu | condition visible, timeout, cible | succès, timeout ou ambiguïté | cible observable stable | état attendu validé ou échec propre | spinner persistant, mutation imprévue, état non observable | moyen | auto si read-only | critique |
| `verify_visible_outcome` | vérifier qu'un changement visible a bien eu lieu | état attendu, preuves avant/après | verdict validé / ambigu / échoué | preuves avant/après disponibles | verdict explicite enregistré | preuve insuffisante, changement non concluant | moyen | auto si read-only | critique |
| `export_action_evidence` | exporter les preuves d'une étape computer-control | refs de capture, métadonnées action | bundle de preuves | preuves existantes | audit pack exploitable | fichiers manquants, bundle incomplet | faible | auto | critique |
| `move_cursor` | positionner le curseur | coordonnées ou cible visible | position estimée atteinte | surface stable et ciblage fiable | curseur déplacé | coordonnées fausses, target drift | moyen à élevé | explicite | critique |
| `click` | cliquer sur une cible UI | coordonnées ou cible qualifiée, button | confirmation d'action tentée | cible visible et actionnable | clic émis | mauvaise cible, recouvrement, fenêtre changée | élevé | explicite | critique |
| `double_click` | double-cliquer sur une cible | cible qualifiée | confirmation d'action tentée | comme `click` | double-clic émis | cadence mal interprétée, mauvaise cible | élevé | explicite | critique |
| `right_click` | ouvrir un menu contextuel | cible qualifiée | menu attendu ou état ambigu | cible visible et stable | menu contextuel potentiellement ouvert | clic mauvais endroit, menu inattendu | élevé | explicite | critique |
| `drag` | glisser-déposer ou redimensionner | point de départ, arrivée, cible attendue | tentative de drag documentée | surface stable, path connu | drag tenté | drop au mauvais endroit, focus perdu | très élevé | explicite forte | critique |
| `scroll_surface` | faire défiler une surface locale | delta, direction, cible | nouvelle position visible | fenêtre ciblée | surface déplacée | mauvaise surface, pas de changement, scroll inattendu | moyen | explicite en prototype si hors navigateur | élevée |
| `keyboard_input` | saisir du texte | texte, cible qualifiée, mode remplacement/append | confirmation de saisie tentée | focus correct, cible qualifiée | texte potentiellement injecté | champ erroné, focus perdu, saisie partielle | élevé | explicite forte | critique |
| `send_hotkey` | déclencher une combinaison clavier | combinaison, justification | hotkey émise | contexte focus très fiable | effet attendu ou ambigu | raccourci destructif, fenêtre erronée | très élevé | explicite forte | critique |
| `detect_blocking_overlay` | détecter un overlay ou blocage UI | cible visuelle | blocker qualifié | surface observable | blocker connu | faux négatif, faux positif | faible à moyen | auto | élevée |
| `clear_or_cancel` | annuler proprement une action locale si possible | contexte action, surface | état annulé ou non annulable | action réversible identifiée | rollback tenté | rollback absent, état inconnu | élevé | explicite | élevée |

## Prototype V1 admissibility

### Primitives admises dans le prototype

- `detect_active_window`
- `list_visible_windows`
- `focus_window`
- `capture_window`
- `capture_region`
- `inspect_visible_ui`
- `wait_for_ui_state`
- `verify_visible_outcome`
- `export_action_evidence`
- `detect_blocking_overlay`

### Primitives explicitement hors premier build

- `move_cursor`
- `click`
- `double_click`
- `right_click`
- `drag`
- `scroll_surface`
- `keyboard_input`
- `send_hotkey`
- `clear_or_cancel`

## Décision de design

Décision fermée :

- le prototype réintroduit le `computer control` par l'observation, la qualification de contexte, la mise au focus et la preuve ;
- il ne commence pas par l'actuation locale généralisée ;
- toute primitive actuatrice locale reste documentée mais non autorisée dans le premier build.
