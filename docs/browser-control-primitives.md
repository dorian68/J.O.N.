# Browser control primitives

## But du document

Définir la liste canonique des primitives conceptuelles du futur moteur navigateur.

Une primitive n'est pas une API technique. C'est une capacité unitaire, suffisamment précise pour :

- être comprise par le runtime,
- être gouvernée par la policy,
- être tracée par l'audit,
- être testée dans un benchmark,
- rester stable même si le driver change.

## Principes

- Une primitive doit avoir un but clair et borné.
- Une primitive doit préciser ses préconditions et postconditions.
- Une primitive doit signaler ses modes d'échec explicites.
- Une primitive à risque doit avoir une relation claire à l'approval.
- Une primitive doit produire assez de contexte pour l'audit.

## Famille 1. Session et targets

### `open_browser_session`

- **But** : ouvrir une session navigateur contrôlée pour un run.
- **Inputs conceptuels** : contexte de run, profil autorisé, politique de domaines, mode de session.
- **Output conceptuel** : session navigateur attachée et identifiable.
- **Préconditions** : run actif, policy compatible, contexte navigateur autorisé.
- **Postconditions** : session créée, prête à recevoir des actions, audit initial enregistré.
- **Modes d'échec** : navigateur indisponible, session non autorisée, conflit de profil.
- **Niveau de risque** : moyen.
- **Approval** : selon politique de projet ou de session.
- **Importance audit** : élevée.

### `attach_to_existing_session`

- **But** : rattacher le run à une session navigateur déjà ouverte.
- **Inputs conceptuels** : identifiant ou cible de session, policy, justification.
- **Output conceptuel** : session existante attachée au run.
- **Préconditions** : session existante explicitement autorisée.
- **Postconditions** : contexte web vivant récupéré sans recréer l'état.
- **Modes d'échec** : attachement refusé, session invalide, contexte trop ambigu.
- **Niveau de risque** : élevé.
- **Approval** : explicite au départ, surtout sur surface authentifiée.
- **Importance audit** : très élevée.

### `list_targets`

- **But** : lister les pages, onglets ou targets disponibles dans la session.
- **Inputs conceptuels** : session active.
- **Output conceptuel** : inventaire des targets avec métadonnées minimales.
- **Préconditions** : session active.
- **Postconditions** : targets connues du runtime.
- **Modes d'échec** : session perdue, targets inaccessibles.
- **Niveau de risque** : faible.
- **Approval** : non en lecture normale.
- **Importance audit** : moyenne.

### `open_tab`

- **But** : ouvrir un nouvel onglet ou une nouvelle target contrôlée.
- **Inputs conceptuels** : session, URL éventuelle, contexte d'ouverture.
- **Output conceptuel** : nouvelle target identifiée.
- **Préconditions** : session active.
- **Postconditions** : onglet ouvert et rattaché au run.
- **Modes d'échec** : popup bloquée, ouverture refusée, target non détectée.
- **Niveau de risque** : faible à moyen.
- **Approval** : dépend surtout du domaine cible.
- **Importance audit** : moyenne.

### `close_tab`

- **But** : fermer une target non nécessaire.
- **Inputs conceptuels** : target identifiée, raison de fermeture.
- **Output conceptuel** : target fermée.
- **Préconditions** : target connue, pas de perte de contexte critique non acceptée.
- **Postconditions** : contexte nettoyé, focus réassigné.
- **Modes d'échec** : target introuvable, fermeture bloquée, mauvais focus.
- **Niveau de risque** : faible à moyen.
- **Approval** : non en général, sauf si perte potentielle de travail.
- **Importance audit** : moyenne.

### `focus_tab`

- **But** : rendre explicite la target active pour l'action suivante.
- **Inputs conceptuels** : target choisie, justification de focus.
- **Output conceptuel** : target active confirmée.
- **Préconditions** : target listée et session active.
- **Postconditions** : toute action suivante sait où elle s'exécute.
- **Modes d'échec** : focus impossible, target obsolète.
- **Niveau de risque** : faible mais critique pour fiabilité.
- **Approval** : non.
- **Importance audit** : élevée.

## Famille 2. Navigation et état de page

### `navigate`

- **But** : charger une URL ou provoquer une transition volontaire.
- **Inputs conceptuels** : target, destination, politique de domaine, attente de navigation.
- **Output conceptuel** : page atteinte ou transition avérée.
- **Préconditions** : target active, destination autorisée.
- **Postconditions** : URL finale, titre et état de page connus.
- **Modes d'échec** : domaine non autorisé, timeout, redirection inattendue.
- **Niveau de risque** : faible à moyen selon domaine.
- **Approval** : oui si domaine hors périmètre ou surface sensible.
- **Importance audit** : très élevée.

### `reload`

- **But** : recharger une page pour réinitialiser ou confirmer son état.
- **Inputs conceptuels** : target, raison de rechargement.
- **Output conceptuel** : page rechargée avec nouvel état observé.
- **Préconditions** : target active.
- **Postconditions** : nouvel état de chargement connu.
- **Modes d'échec** : perte d'état, session expirée, page cassée.
- **Niveau de risque** : moyen sur surface éditable.
- **Approval** : parfois, si perte possible de brouillon.
- **Importance audit** : élevée.

### `wait_for_page_state`

- **But** : attendre un état de page suffisant pour lire ou agir.
- **Inputs conceptuels** : target, condition attendue, délai max.
- **Output conceptuel** : état stable, ou échec d'attente.
- **Préconditions** : target active, condition formulée.
- **Postconditions** : décision d'agir ou de s'arrêter mieux informée.
- **Modes d'échec** : page jamais stable, condition trop vague, chargement partiel.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : élevée.

### `detect_navigation_result`

- **But** : qualifier l'effet réel d'une navigation ou d'une interaction ayant pu naviguer.
- **Inputs conceptuels** : état avant, état après, attente prévue.
- **Output conceptuel** : navigation réussie, bloquée, redirigée ou ambiguë.
- **Préconditions** : existence d'un état avant/après.
- **Postconditions** : décision de poursuivre, récupérer ou escalader.
- **Modes d'échec** : résultat ambigu, redirection masquée, SPA silencieuse.
- **Niveau de risque** : moyen.
- **Approval** : non en soi.
- **Importance audit** : très élevée.

## Famille 3. Lecture et inspection DOM

### `capture_dom_snapshot`

- **But** : obtenir un snapshot du DOM exploitable par le runtime.
- **Inputs conceptuels** : target, portée du snapshot, niveau de détail.
- **Output conceptuel** : représentation structurée de la page.
- **Préconditions** : target chargée suffisamment.
- **Postconditions** : base de lecture et de sélection disponible.
- **Modes d'échec** : page non prête, DOM trop volumineux, snapshot insuffisant.
- **Niveau de risque** : faible.
- **Approval** : non, sauf surface hautement sensible selon politique.
- **Importance audit** : élevée.

### `query_dom`

- **But** : rechercher des éléments ou régions pertinentes dans le DOM.
- **Inputs conceptuels** : snapshot ou target, contrat de recherche, filtres.
- **Output conceptuel** : ensemble de candidats.
- **Préconditions** : DOM disponible.
- **Postconditions** : candidats identifiés et classables.
- **Modes d'échec** : aucun candidat, trop de candidats, ambiguïté structurelle.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : élevée.

### `resolve_interactive_elements`

- **But** : extraire les éléments potentiellement actionnables.
- **Inputs conceptuels** : snapshot DOM, contexte de tâche, filtres d'action.
- **Output conceptuel** : catalogue d'éléments interactifs pertinents.
- **Préconditions** : DOM disponible.
- **Postconditions** : espace d'action explicite pour le runtime.
- **Modes d'échec** : faux positifs, éléments masqués, page trop non sémantique.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : élevée.

### `inspect_element`

- **But** : inspecter précisément un candidat avant interaction.
- **Inputs conceptuels** : référence d'élément, contexte de page.
- **Output conceptuel** : fiche élément avec rôle, texte, état, visibilité, actionnabilité.
- **Préconditions** : élément candidat résolu.
- **Postconditions** : décision plus sûre d'agir ou non.
- **Modes d'échec** : référence obsolète, élément muté, contexte perdu.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : très élevée.

### `resolve_frame_context`

- **But** : déterminer si l'action doit se dérouler dans une frame particulière.
- **Inputs conceptuels** : target, candidat, hiérarchie de frames.
- **Output conceptuel** : contexte de frame correct ou ambiguïté signalée.
- **Préconditions** : présence possible de frames.
- **Postconditions** : le contexte d'interaction est correctement posé.
- **Modes d'échec** : cross-origin non inspectable, frame introuvable, ambiguïté persistante.
- **Niveau de risque** : moyen.
- **Approval** : non en général.
- **Importance audit** : élevée.

### `extract_structured_content`

- **But** : extraire du contenu structuré utile pour une source ou un artefact.
- **Inputs conceptuels** : target, zone cible, schéma d'extraction.
- **Output conceptuel** : contenu structuré avec provenance.
- **Préconditions** : page lisible, portée définie.
- **Postconditions** : source exploitable par le run.
- **Modes d'échec** : structure insuffisante, contenu partiel, ambiguïté de zone.
- **Niveau de risque** : faible à moyen.
- **Approval** : non en lecture simple.
- **Importance audit** : très élevée.

## Famille 4. Viewport et visibilité

### `scroll_viewport`

- **But** : faire progresser le viewport pour révéler contenu ou déclencher un chargement.
- **Inputs conceptuels** : target, direction, ampleur, intention.
- **Output conceptuel** : nouveau viewport et éventuel nouveau contenu.
- **Préconditions** : page scrollable.
- **Postconditions** : état viewport mis à jour, nouvelles zones disponibles.
- **Modes d'échec** : aucun effet, scroll dans mauvais conteneur, lazy loading non déclenché.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : moyenne.

### `scroll_into_view`

- **But** : amener un élément candidat dans le viewport.
- **Inputs conceptuels** : élément cible, contexte de scrolling.
- **Output conceptuel** : élément visible ou état d'échec explicite.
- **Préconditions** : élément résolu.
- **Postconditions** : vérification d'actionnabilité facilitée.
- **Modes d'échec** : élément disparu, mauvais conteneur, couverture persistante.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : moyenne.

## Famille 5. Interaction élémentaire

### `hover_element`

- **But** : révéler un état secondaire ou un menu contextuel.
- **Inputs conceptuels** : élément cible, intention.
- **Output conceptuel** : état hover confirmé ou non.
- **Préconditions** : élément visible et actionnable.
- **Postconditions** : nouveaux éléments ou états potentiellement disponibles.
- **Modes d'échec** : aucun effet, cible obsolète, menu instable.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : moyenne.

### `focus_element`

- **But** : placer le focus sur l'élément pour lecture ou saisie.
- **Inputs conceptuels** : élément cible.
- **Output conceptuel** : focus confirmé.
- **Préconditions** : élément focalisable.
- **Postconditions** : saisie ou inspection ciblée possible.
- **Modes d'échec** : focus refusé, focus détourné ailleurs.
- **Niveau de risque** : faible.
- **Approval** : non.
- **Importance audit** : moyenne.

### `click_element`

- **But** : déclencher une interaction primaire sur un élément.
- **Inputs conceptuels** : élément cible, intention attendue, niveau de risque.
- **Output conceptuel** : interaction tentée et effet observé.
- **Préconditions** : élément visible, bon target, actionnabilité vérifiée.
- **Postconditions** : changement d'état vérifié ou ambiguïté signalée.
- **Modes d'échec** : élément recouvert, pas d'effet, navigation inattendue, mauvais clic.
- **Niveau de risque** : de faible à élevé selon cible.
- **Approval** : dépend de la nature de l'élément et de l'effet attendu.
- **Importance audit** : très élevée.

### `type_text`

- **But** : saisir du texte dans un champ ou éditeur ciblé.
- **Inputs conceptuels** : élément cible, texte, mode de saisie.
- **Output conceptuel** : valeur saisie ou tentative échouée.
- **Préconditions** : focus correct, champ éditable.
- **Postconditions** : contenu réellement présent ou échec signalé.
- **Modes d'échec** : saisie partielle, auto-format inattendu, champ protégé.
- **Niveau de risque** : moyen.
- **Approval** : oui dès que la saisie devient engageante ou sensible.
- **Importance audit** : élevée.

### `clear_and_type`

- **But** : remplacer explicitement le contenu existant d'un champ.
- **Inputs conceptuels** : élément cible, nouveau texte, justification.
- **Output conceptuel** : champ remplacé avec nouvelle valeur.
- **Préconditions** : contenu actuel connu, remplacement légitime.
- **Postconditions** : ancienne valeur supprimée et nouvelle valeur vérifiée.
- **Modes d'échec** : effacement incomplet, perte de donnée, champ verrouillé.
- **Niveau de risque** : moyen à élevé.
- **Approval** : souvent oui.
- **Importance audit** : très élevée.

### `select_option`

- **But** : choisir une option dans un select ou équivalent.
- **Inputs conceptuels** : élément cible, option voulue.
- **Output conceptuel** : option sélectionnée.
- **Préconditions** : widget identifié et options lisibles.
- **Postconditions** : état sélection mis à jour.
- **Modes d'échec** : option introuvable, widget custom instable.
- **Niveau de risque** : moyen.
- **Approval** : parfois, selon impact métier.
- **Importance audit** : élevée.

### `toggle_checkbox`

- **But** : cocher ou décocher une case ou un toggle.
- **Inputs conceptuels** : élément cible, état voulu.
- **Output conceptuel** : nouvel état confirmé.
- **Préconditions** : élément correctement identifié.
- **Postconditions** : état booléen vérifié.
- **Modes d'échec** : faux état, double bascule, UI non synchronisée.
- **Niveau de risque** : faible à moyen.
- **Approval** : dépend si la bascule a une conséquence métier.
- **Importance audit** : élevée.

## Famille 6. Formulaires et fichiers

### `upload_file`

- **But** : associer un fichier local à un contrôle d'upload.
- **Inputs conceptuels** : champ d'upload, fichier autorisé, justification.
- **Output conceptuel** : fichier sélectionné côté page.
- **Préconditions** : fichier accessible, cible claire, policy compatible.
- **Postconditions** : le bon fichier est associé visiblement.
- **Modes d'échec** : mauvais fichier, upload bloqué, cible erronée.
- **Niveau de risque** : élevé.
- **Approval** : explicite en V1.
- **Importance audit** : très élevée.

### `detect_blockers`

- **But** : détecter les éléments bloquants avant ou après action.
- **Inputs conceptuels** : target, état actuel, contexte de tâche.
- **Output conceptuel** : liste de bloqueurs ou absence de bloqueur.
- **Préconditions** : page observable.
- **Postconditions** : décision d'agir, de fermer ou d'escalader plus sûre.
- **Modes d'échec** : bloqueur non vu, faux positif, contenu masqué.
- **Niveau de risque** : faible à moyen.
- **Approval** : non.
- **Importance audit** : élevée.

### `handle_modal`

- **But** : traiter une modal ou popup bloquante de manière gouvernée.
- **Inputs conceptuels** : modal identifiée, stratégie permise.
- **Output conceptuel** : modal fermée, acceptée, refusée ou escaladée.
- **Préconditions** : modal détectée et qualifiée.
- **Postconditions** : page débloquée ou arrêt explicite.
- **Modes d'échec** : mauvaise interprétation, action engageante involontaire.
- **Niveau de risque** : moyen à élevé.
- **Approval** : oui si la modal emporte consentement ou effet métier.
- **Importance audit** : très élevée.

### `submit_form`

- **But** : soumettre explicitement un formulaire ou déclencher son action finale.
- **Inputs conceptuels** : formulaire préparé, effet attendu, niveau de risque.
- **Output conceptuel** : soumission tentée et résultat qualifié.
- **Préconditions** : données vérifiées, cible comprise, policy compatible.
- **Postconditions** : succès, refus, erreur ou ambiguïté clairement signalés.
- **Modes d'échec** : soumission involontaire, validation serveur, navigation inattendue.
- **Niveau de risque** : élevé à très élevé.
- **Approval** : explicite et unitaire en V1.
- **Importance audit** : critique.

## Famille 7. Vérification et preuve

### `verify_outcome`

- **But** : vérifier qu'une action a produit l'effet attendu.
- **Inputs conceptuels** : attente formulée, état avant/après, indices de succès.
- **Output conceptuel** : succès, échec, résultat ambigu.
- **Préconditions** : action précédente connue.
- **Postconditions** : le run peut poursuivre ou s'arrêter sur un diagnostic clair.
- **Modes d'échec** : résultat indéterminé, faux succès, page en état intermédiaire.
- **Niveau de risque** : faible comme action, critique comme contrôle.
- **Approval** : non.
- **Importance audit** : critique.

### `export_page_evidence`

- **But** : produire une preuve exploitable d'un état de page ou d'une action.
- **Inputs conceptuels** : target, type de preuve, niveau de détail, règle de redaction.
- **Output conceptuel** : paquet de preuve lié au run.
- **Préconditions** : état pertinent identifié.
- **Postconditions** : preuve exportable ou attachable à l'audit.
- **Modes d'échec** : preuve trop pauvre, fuite sensible, contexte incomplet.
- **Niveau de risque** : moyen.
- **Approval** : selon contenu sensible et destination.
- **Importance audit** : critique.

## Primitives transverses attendues plus tard

Certaines primitives ne sont pas forcément cœur `V1`, mais doivent être anticipées conceptuellement :

- `capture_visual_snapshot`
- `resolve_rich_editor_context`
- `persist_browser_session_state`
- `compare_multi_page_state`
- `request_operator_intervention`

Elles restent dépendantes de l'évolution du produit et ne doivent pas brouiller la frontière du prototype initial.

## Ce que ce document décide

- le moteur navigateur sera pensé en primitives stables et auditables,
- `verify_outcome` est une primitive de premier rang, pas une étape optionnelle,
- `submit_form` et `upload_file` sont des primitives à haut risque,
- l'attachement de session et l'usage de surfaces authentifiées sont des surfaces sensibles.

## Ce qui reste ouvert

- la granularité exacte entre certaines primitives de lecture,
- le niveau de détail des preuves exportées par défaut,
- la formalisation future des primitives spécifiques aux éditeurs riches complexes,
- la frontière entre primitive navigateur et orchestration runtime.

## Liens avec le reste du corpus

- Spec principale : [browser-control-spec.md](./browser-control-spec.md)
- Stratégie DOM : [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- Recovery : [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- Observabilité : [browser-control-observability.md](./browser-control-observability.md)
- Approvals : [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
