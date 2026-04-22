# Browser control test fixtures plan

## 1. Purpose and role of the fixtures plan

Ce document définit le plan canonique des `fixtures` et des surfaces de test pour la capacité `browser control`.

Il existe pour éviter trois erreurs classiques :

- construire un moteur navigateur spectaculaire mais non testable,
- dépendre trop tôt de plateformes réelles fragiles ou juridiquement sensibles,
- confondre quelques démos réussies avec une capacité réellement robuste.

### Ce que ce document débloque

- une base commune pour concevoir les premières surfaces de test,
- un langage partagé entre spec, benchmarks, policy et futur prototype,
- un critère d'autorisation ou de refus du démarrage du build navigateur,
- une montée progressive en difficulté sans sauter directement vers LinkedIn, Upwork ou d'autres plateformes sensibles.

### Ce que ce document n'a pas vocation à décider

- le choix exact du driver navigateur,
- l'implémentation technique des harness de test,
- l'infrastructure de CI,
- la forme exacte du runtime de test,
- la validation finale sur des plateformes externes réelles.

### Position dans le corpus

Ce document fait le pont entre :

- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [threat-model.md](./threat-model.md)
- [prototype-boundary-v1.md](./prototype-boundary-v1.md)

Décision prise :

- aucun prototype navigateur ne doit être considéré sérieux s'il n'est pas adossé à un plan de fixtures clair, progressif et suffisamment déterministe.

## 2. Testing philosophy for browser control

Le test du `browser control` doit suivre une philosophie stricte :

1. d'abord la testabilité et le déterminisme,
2. ensuite le réalisme,
3. enfin la robustesse sur surfaces externes.

### Pourquoi ne pas dépendre d'emblée de vraies plateformes fragiles

Parce que les plateformes réelles :

- changent vite,
- sont souvent partiellement non déterministes,
- mélangent contraintes produit et contraintes de plateforme,
- introduisent des questions d'abus, de conformité et de sécurité,
- brouillent le diagnostic quand un test échoue.

Si un moteur échoue sur LinkedIn ou Upwork trop tôt, on ne sait pas encore si le problème vient :

- du DOM strategy,
- des primitives,
- de la policy,
- de la fixture implicite,
- de la plateforme elle-même.

### Les quatre familles d'environnements à distinguer

| Type | Description | Valeur principale | Risque principal |
| --- | --- | --- | --- |
| Pages synthétiques | pages construites pour isoler des comportements DOM et interaction | déterminisme fort | manque de réalisme |
| Sandboxes applicatives contrôlées | mini-workflows web maîtrisés, proches d'applications réelles | bon compromis robustesse/réalisme | faux sentiment de généralité |
| Environnements réalistes internes | surfaces plus riches, toujours contrôlées | validation intermédiaire avant réel | coût de maintenance |
| Plateformes externes réelles | validation limitée sur vraies surfaces | réalisme final | fragilité, sensibilité, bruit |

### Principe de montée progressive

- Les `pages synthétiques` servent à valider la logique élémentaire.
- Les `sandboxes applicatives contrôlées` servent à valider les patterns complets.
- Les `environnements réalistes internes` servent à tester la robustesse sans dépendre d'un tiers.
- Les `plateformes externes réelles` ne doivent intervenir qu'en validation encadrée et limitée.

Décision prise :

- les plateformes externes réelles ne sont pas la base principale des premiers tests du navigateur.

## 3. Fixture tiers

## Tier 0. Unit-like DOM fixtures

**But**

Isoler des comportements DOM élémentaires sans dépendre d'un vrai workflow applicatif.

**Niveau de réalisme**

Faible à moyen.

**Niveau de fragilité**

Faible.

**Risques**

- pages trop propres,
- absence de bruit réel,
- surapprentissage du moteur sur des structures idéales.

**Usages autorisés**

- sélection d'éléments,
- vérification de rôles et labels,
- visibilité, disabled, hidden, overlays,
- re-render simple,
- ambigüités contrôlées.

**Ce qu'on peut valider**

- primitives DOM,
- logique de sélection,
- actionnabilité,
- premiers signaux d'échec.

**Ce qu'on ne doit pas prétendre valider**

- robustesse sur workflow réel,
- gestion sérieuse de session,
- comportement sur surfaces externes.

## Tier 1. Controlled browser pages

**But**

Tester de vraies interactions navigateur sur des pages contrôlées mais complètes.

**Niveau de réalisme**

Moyen.

**Niveau de fragilité**

Faible à moyen.

**Risques**

- encore trop propres si mal conçues,
- sous-représentation des transitions de page réelles.

**Usages autorisés**

- navigation simple,
- scroll,
- modals,
- formulaires simples,
- multi-tab borné,
- uploads/downloads de test.

**Ce qu'on peut valider**

- enchaînement des primitives,
- observabilité,
- approvals de base,
- preuves avant/après.

**Ce qu'on ne doit pas prétendre valider**

- workflows métier réalistes,
- comportements authentifiés complexes.

## Tier 2. Sandbox workflows réalistes

**But**

Tester des patterns complets proches du produit cible, dans un environnement entièrement contrôlé.

**Niveau de réalisme**

Moyen à élevé.

**Niveau de fragilité**

Moyen.

**Risques**

- coût de conception plus élevé,
- dérive vers des mini-apps trop spécifiques.

**Usages autorisés**

- formulaires multi-step,
- tri de listes,
- éditeurs bornés,
- confirmations,
- navigation multi-target,
- collecte d'informations pour artefact.

**Ce qu'on peut valider**

- patterns complets navigateur,
- benchmarks `V1`,
- interaction entre policy, runtime et browser control,
- vérification d'outcome.

**Ce qu'on ne doit pas prétendre valider**

- résistance aux changements externes de plateforme,
- conformité d'usage sur plateformes tierces réelles.

## Tier 3. Authenticated synthetic apps

**But**

Tester les surfaces authentifiées et semi-authentifiées sans dépendre d'applications réelles.

**Niveau de réalisme**

Élevé sur les patterns, moyen sur la complexité réelle.

**Niveau de fragilité**

Moyen.

**Risques**

- simplifier excessivement les workflows d'authentification,
- sous-estimer la sensibilité des sessions.

**Usages autorisés**

- session attachée simulée,
- session expirée,
- zones privées de lecture,
- zones d'édition ou de brouillon,
- permissions variables par compte de test.

**Ce qu'on peut valider**

- policy sur surfaces authentifiées,
- boundaries de session,
- arrêts propres sur surfaces sensibles,
- gestion de permissions variables.

**Ce qu'on ne doit pas prétendre valider**

- compatibilité exacte avec les protections d'une plateforme réelle,
- robustesse contre tous les comportements anti-abus.

## Tier 4. External platform validation

**But**

Valider de façon limitée et supervisée que la capacité tient sur quelques surfaces réelles.

**Niveau de réalisme**

Très élevé.

**Niveau de fragilité**

Très élevé.

**Risques**

- instabilité,
- dépendance à des comptes et états réels,
- bruit externe,
- risque de dérive produit.

**Usages autorisés**

- validation bornée sur lecture, drafting, navigation ou collecte limitée,
- jamais comme base unique du diagnostic moteur.

**Ce qu'on peut valider**

- robustesse finale sur quelques parcours réels,
- écart entre sandbox et réalité.

**Ce qu'on ne doit pas prétendre valider**

- capacité générale du moteur,
- justification d'un design anti-détection ou anti-garde-fou.

## 4. Canonical fixture families

Les familles suivantes sont nécessaires pour couvrir correctement `V1`.

## 1. Navigation simple

**But**

Valider chargement, navigation, redirection simple et vérification d'état de page.

**Comportements à provoquer**

- navigation réussie,
- redirection,
- page en erreur,
- page non stable.

**Primitives concernées**

- `open_tab`
- `focus_tab`
- `navigate`
- `wait_for_page_state`
- `detect_navigation_result`

**Pièges à couvrir**

- URL finale inattendue,
- page visuellement chargée mais DOM incomplet,
- boucle de rechargement.

**Signaux observables attendus**

- target active,
- URL finale,
- titre,
- statut de vérification.

## 2. Navigation multi-tab

**But**

Valider l'identité des targets et le raisonnement inter-onglets.

**Comportements à provoquer**

- ouverture d'onglets,
- changement de focus,
- comparaison de pages,
- nouvel onglet inattendu.

**Primitives concernées**

- `list_targets`
- `open_tab`
- `focus_tab`
- `close_tab`

**Pièges à couvrir**

- mauvaise target active,
- rôle logique mal assigné,
- target orpheline.

**Signaux observables attendus**

- mapping des targets,
- raison du focus,
- lien source -> target.

## 3. Pages longues avec scroll

**But**

Valider le scroll intentionnel et la lecture de contenu long.

**Comportements à provoquer**

- contenu hors viewport,
- sections révélées par scroll,
- sticky header recouvrant une zone.

**Primitives concernées**

- `scroll_viewport`
- `scroll_into_view`
- `capture_dom_snapshot`

**Pièges à couvrir**

- scroll inutile,
- mauvais conteneur,
- élément toujours invisible malgré scroll.

**Signaux observables attendus**

- preuve de scroll,
- position relative de l'élément,
- nouvel état du viewport.

## 4. Lazy loading

**But**

Valider les chargements progressifs et la décision d'arrêter ou de continuer.

**Comportements à provoquer**

- contenu chargé après scroll,
- contenu incomplet,
- infinite scroll borné,
- infinite scroll sans fin.

**Primitives concernées**

- `scroll_viewport`
- `wait_for_page_state`
- `capture_dom_snapshot`
- `extract_structured_content`

**Pièges à couvrir**

- boucle ouverte,
- contenu partiellement chargé mais considéré complet,
- surcharge de collecte.

**Signaux observables attendus**

- nouveaux blocs apparus,
- diagnostic de chargement partiel,
- arrêt justifié.

## 5. Formulaires simples

**But**

Valider compréhension de labels, saisie, sélection et vérification.

**Comportements à provoquer**

- champs texte,
- select,
- checkbox,
- champs requis,
- champ disabled.

**Primitives concernées**

- `inspect_element`
- `focus_element`
- `type_text`
- `select_option`
- `toggle_checkbox`
- `verify_outcome`

**Pièges à couvrir**

- champ mal mappé,
- placeholder trompeur,
- saisie partielle,
- validation locale silencieuse.

**Signaux observables attendus**

- valeur visible après saisie,
- état du champ,
- statut de validation locale.

## 6. Formulaires multi-step

**But**

Valider les transitions d'étapes et la conservation de contexte.

**Comportements à provoquer**

- étape suivante,
- retour arrière,
- erreur intermédiaire,
- progression conditionnelle.

**Primitives concernées**

- `click_element`
- `type_text`
- `wait_for_page_state`
- `verify_outcome`

**Pièges à couvrir**

- perte de contexte entre étapes,
- faux passage d'étape,
- champ requis non détecté.

**Signaux observables attendus**

- état d'étape courant,
- données conservées,
- diagnostic d'échec intermédiaire.

## 7. Listes filtrables / triables

**But**

Valider l'identification d'objets métier répétés et les interactions de tri ou filtre.

**Comportements à provoquer**

- filtrage,
- tri,
- pagination ou résultat dynamique,
- cartes similaires.

**Primitives concernées**

- `query_dom`
- `resolve_interactive_elements`
- `click_element`
- `extract_structured_content`

**Pièges à couvrir**

- objets confondus,
- critères mal appliqués,
- DOM rerendu après filtre.

**Signaux observables attendus**

- nombre d'items,
- critère appliqué,
- liste avant/après.

## 8. Modals et dialogs

**But**

Valider détection, qualification et traitement gouverné des modals.

**Comportements à provoquer**

- modal informative,
- modal bloquante,
- consent dialog,
- confirmation engageante.

**Primitives concernées**

- `detect_blockers`
- `handle_modal`
- `verify_outcome`

**Pièges à couvrir**

- modal recouvrante non détectée,
- fermeture inappropriée,
- acceptation non voulue.

**Signaux observables attendus**

- type de modal,
- action proposée,
- issue de traitement.

## 9. Frames / iframes

**But**

Valider la résolution du bon contexte d'interaction.

**Comportements à provoquer**

- contenu embarqué,
- frame enfant,
- frame cross-origin simulée,
- frame tardive.

**Primitives concernées**

- `resolve_frame_context`
- `capture_dom_snapshot`
- `inspect_element`
- `click_element`

**Pièges à couvrir**

- élément visible mais frame non courante,
- target confondue avec frame,
- contexte perdu après navigation.

**Signaux observables attendus**

- hiérarchie de frames,
- frame active,
- diagnostic en cas d'ambiguïté.

## 10. Éditeurs riches

**But**

Valider les cas minimaux d'édition sur surfaces complexes.

**Comportements à provoquer**

- contenu existant,
- insertion bornée,
- remplacement partiel,
- autoformat,
- bouton publish distinct du draft.

**Primitives concernées**

- `focus_element`
- `type_text`
- `clear_and_type`
- `verify_outcome`

**Pièges à couvrir**

- focus instable,
- DOM peu lisible,
- confusion draft/publish.

**Signaux observables attendus**

- contenu visible avant/après,
- statut brouillon,
- diagnostic d'ambiguïté.

## 11. File upload

**But**

Valider la frontière local -> web.

**Comportements à provoquer**

- upload réussi,
- mauvais type de fichier,
- champ d'upload ambigu,
- upload refusé.

**Primitives concernées**

- `upload_file`
- `verify_outcome`
- `export_page_evidence`

**Pièges à couvrir**

- mauvais fichier,
- cible incorrecte,
- confirmation insuffisante de l'upload.

**Signaux observables attendus**

- nom du fichier attaché,
- état post-upload,
- preuve de sélection correcte.

## 12. Confirmation flows

**But**

Valider la séparation entre préparation d'action et acte final.

**Comportements à provoquer**

- bouton `continue`,
- bouton `confirm`,
- bouton `submit`,
- confirmation secondaire.

**Primitives concernées**

- `click_element`
- `handle_modal`
- `submit_form`
- `verify_outcome`

**Pièges à couvrir**

- confusion entre étape intermédiaire et acte engageant,
- wording trompeur.

**Signaux observables attendus**

- classification du niveau d'engagement,
- approval demandée au bon moment.

## 13. Outcomes success / failure / partial success

**But**

Valider la qualification correcte du résultat.

**Comportements à provoquer**

- succès franc,
- échec franc,
- résultat partiel,
- résultat ambigu.

**Primitives concernées**

- `verify_outcome`
- `detect_navigation_result`
- `export_page_evidence`

**Pièges à couvrir**

- faux succès,
- faux échec,
- ambiguïté non reconnue.

**Signaux observables attendus**

- statut `success / failure / ambiguous / partial`,
- preuve justifiant la classification.

## 14. Pages authentifiées simulées

**But**

Valider les surfaces connectées sans dépendre de plateformes tierces.

**Comportements à provoquer**

- page privée lisible,
- rôle utilisateur variable,
- permission insuffisante,
- session expirée.

**Primitives concernées**

- `attach_to_existing_session`
- `navigate`
- `wait_for_page_state`
- `verify_outcome`

**Pièges à couvrir**

- accès refusé mal qualifié,
- re-login tentée à tort,
- lecture non autorisée.

**Signaux observables attendus**

- statut de session,
- type de surface,
- diagnostic de permission.

## 15. Pages avec DOM dynamique / re-render

**But**

Valider la re-résolution après mutation.

**Comportements à provoquer**

- liste rerendue,
- élément remplacé,
- mise à jour après filtre ou saisie.

**Primitives concernées**

- `capture_dom_snapshot`
- `query_dom`
- `inspect_element`
- `verify_outcome`

**Pièges à couvrir**

- références obsolètes,
- ancienne cible réutilisée,
- action répétée au mauvais endroit.

**Signaux observables attendus**

- mutation détectée,
- re-résolution effectuée,
- diagnostic si l'état change trop.

## 16. Pages ambiguës avec plusieurs cibles similaires

**But**

Tester la prudence du moteur quand plusieurs cibles sont plausibles.

**Comportements à provoquer**

- plusieurs boutons au même texte,
- plusieurs champs proches,
- cartes similaires.

**Primitives concernées**

- `query_dom`
- `resolve_interactive_elements`
- `inspect_element`
- `click_element`

**Pièges à couvrir**

- choix arbitraire,
- absence de discriminant secondaire,
- sur-confiance.

**Signaux observables attendus**

- candidats multiples,
- contrat de sélection raffiné,
- arrêt si ambiguïté persistante.

## 17. Pages à forte densité interactive

**But**

Tester la capacité à isoler la bonne zone d'action dans une page dense.

**Comportements à provoquer**

- nombreux boutons,
- widgets multiples,
- zones concurrentes.

**Primitives concernées**

- `capture_dom_snapshot`
- `query_dom`
- `resolve_interactive_elements`
- `detect_blockers`

**Pièges à couvrir**

- bruit excessif,
- mauvaise région choisie,
- coût de contexte trop grand.

**Signaux observables attendus**

- région cible identifiée,
- réduction explicite de l'espace d'action,
- justification du choix de zone.

## 5. DOM fixture design principles

Les fixtures DOM doivent être conçues pour tester le moteur, pas pour l'aider artificiellement.

### Principes de base

- attributs stables présents quand c'est justifié,
- rôles accessibles explicites,
- labels lisibles,
- texte visible significatif,
- variantes contrôlées d'ambiguïté,
- transitions d'état observables,
- comportements asynchrones bornés mais réels.

### Ce que les fixtures doivent contenir intentionnellement

- éléments désactivés,
- éléments masqués,
- éléments hors viewport,
- overlays et éléments recouverts,
- variantes avec texte similaire,
- re-render après interaction,
- changement d'état visible après action,
- chargements progressifs.

### Cas à couvrir explicitement

#### DOM suffisant

Cas où :

- les rôles et labels sont cohérents,
- la sélection peut être auditée sans ambiguïté,
- l'outcome est visible dans le DOM.

#### DOM ambigu

Cas où :

- plusieurs candidats sont plausibles,
- le voisinage est nécessaire pour décider,
- un discriminant secondaire est indispensable.

#### DOM insuffisant

Cas où :

- surface très custom,
- rendu fortement virtualisé,
- blocage ou état non suffisamment représenté,
- éditeur riche difficile à confirmer.

Dans ces cas, la fixture doit rendre visible pourquoi un fallback visuel serait requis.

### Ce qu'il faut éviter dans la conception des fixtures

- sélecteurs artificiellement parfaits partout,
- DOM irréalistes dépourvus de bruit,
- classes CSS comme seul signal de sélection,
- timings purement arbitraires,
- pages trop propres où aucune ambiguïté n'existe jamais.

Décision prise :

- une bonne fixture DOM doit exposer à la fois des cas "propres" et des cas "adverses mais réalistes".

## 6. Tab, target, and frame fixtures

Cette famille de fixtures prépare la vérification future des primitives liées aux `tabs`, `targets` et `frames`.

### Tabs et targets : cas obligatoires

- tab unique simple,
- plusieurs tabs ouvertes volontairement,
- nouvelle target ouverte par action,
- mauvaise target active,
- fermeture d'une target non critique,
- focus perdu puis retrouvé,
- cible logique principale + cible secondaire.

### Pièges à injecter

- nouvel onglet ouvert sans que l'ancienne target perde son contenu,
- page qui reste identique visuellement mais change de target,
- clic sur un lien ouvrant un popup réel plutôt qu'une modal,
- target enfant non attendue,
- target fermée alors qu'une action suivante la visait.

### Popups modales vs vraie nouvelle target

Les fixtures doivent distinguer :

- modal dans la même page,
- popup de type navigateur ouvrant une nouvelle target,
- dialogue bloquant qui ressemble à une navigation.

Objectif :

- empêcher le moteur de traiter toute nouveauté visuelle comme un simple dialogue.

### Frames et iframes : cas obligatoires

- iframe simple même origine,
- iframe nécessitant changement de contexte,
- iframe chargée tardivement,
- iframe cross-origin simulée ou partiellement opaque,
- page avec plusieurs frames concurrentes.

### Attachement / détachement de targets

Les fixtures doivent permettre de tester :

- attachement initial,
- disparition d'une target,
- target créée pendant le run,
- target devenue non pertinente,
- ambiguïté entre plusieurs targets très proches.

### Ce qu'on veut vérifier plus tard

- aucune action sans target explicite,
- aucun mélange entre frame et target,
- diagnostic clair en cas d'ambiguïté de contexte,
- bonne classification popup vs modal.

## 7. Authenticated and semi-authenticated fixtures

Le produit doit tester des surfaces authentifiées sans se lier trop tôt à des plateformes externes réelles.

### Comptes de test synthétiques

Le plan de fixtures doit prévoir des comptes internes ou synthétiques permettant de simuler :

- rôle basique,
- rôle avancé,
- accès restreint,
- droits de lecture seulement,
- droits d'édition bornés.

### Sessions simulées

Les fixtures doivent permettre :

- session déjà attachée,
- session expirée,
- session partiellement autorisée,
- session conduisant à une zone sensible.

### Frontières à respecter

- re-login automatisé hors scope initial,
- saisie de secrets par le modèle interdite,
- MFA et CAPTCHA hors périmètre de reprise automatique,
- les surfaces authentifiées ne doivent pas devenir la base principale du Tier 0/Tier 1.

### Différence entre sandbox authentifié et plateforme réelle

Une sandbox authentifiée doit tester :

- la logique de session,
- la policy,
- l'arrêt propre,
- les permissions variables.

Elle ne doit pas prétendre reproduire :

- les protections anti-abus réelles,
- les variations de UI d'une plateforme externe,
- la complexité légale et opérationnelle d'un compte réel.

Décision prise :

- les surfaces authentifiées seront d'abord testées sur environnements synthétiques contrôlés avant toute validation limitée sur plateforme réelle.

## 8. Evidence and proof model for fixtures

Une fixture n'est utile que si elle permet d'observer clairement ce qui s'est produit.

### Preuves minimales qu'une fixture doit supporter

- snapshot DOM pertinent,
- état pré-action,
- état post-action,
- trace de l'élément ciblé,
- preuve de scroll si applicable,
- preuve de soumission préparée,
- preuve de résultat obtenu,
- preuve d'échec diagnostiqué,
- raison d'arrêt ou de blocage.

### Ce qui doit être visible pour chaque audience

#### Audit

- target,
- élément ou région,
- action,
- approval éventuelle,
- outcome,
- preuve attachée.

#### UI opérateur

- page active,
- action en cours,
- blocage,
- succès ou ambiguïté,
- preuve résumée.

#### Debug

- contrat de sélection,
- mutation DOM,
- contexte de frame ou target,
- symptôme d'échec,
- stratégie de recovery tentée.

#### Benchmark review

- assertion attendue,
- preuve supportant l'assertion,
- classification claire de succès/échec/ambiguïté.

### Principe de minimisation

Les fixtures doivent aussi être conçues pour permettre de tester la `redaction` :

- ne pas exiger des preuves contenant des secrets,
- ne pas imposer la conservation d'intégralité de page quand un extrait suffit,
- distinguer preuve utile et capture excessive.

## 9. Benchmark alignment

Les fixtures ne sont pas indépendantes des benchmarks. Elles en sont le socle.

### Lecture et synthèse

**Fixtures de base nécessaires**

- navigation simple,
- page longue avec scroll,
- extraction structurée,
- outcome explicite.

**Assertions possibles**

- bonne page lue,
- contenu principal correctement identifié,
- source correctement reliée.

**Limites**

- qualité rédactionnelle finale encore partiellement revue humaine.

### Navigation multi-tab

**Fixtures de base nécessaires**

- multi-target simple,
- nouvelle target inattendue,
- focus ambigu.

**Assertions possibles**

- bonne target active,
- comparaison correctement attribuée.

**Limites**

- certaines subtilités de charge cognitive resteront à revue humaine.

### Collecte sur plusieurs pages

**Fixtures de base nécessaires**

- liste filtrable,
- détails multi-pages,
- schéma d'extraction stable,
- lazy loading contrôlé.

**Assertions possibles**

- collecte bornée,
- provenance explicite,
- absence de dérive de navigation.

### Remplissage partiel de formulaires

**Fixtures de base nécessaires**

- formulaire simple,
- formulaire multi-step,
- champ requis manquant,
- bouton disabled,
- outcome clair avant soumission.

**Assertions possibles**

- bons champs ciblés,
- approvals demandées,
- aucune soumission non approuvée.

### Rédaction assistée avec approval finale

**Fixtures de base nécessaires**

- éditeur riche borné,
- distinction draft/publish,
- confirmation flow.

**Assertions possibles**

- contenu effectivement inséré,
- frontière draft/action finale respectée.

### Ce qui peut être jugé automatiquement

- target correcte,
- événement attendu présent,
- élément correctement qualifié,
- preuve pré/post disponible,
- classification de résultat,
- respect de certaines policy.

### Ce qui doit rester en revue humaine

- qualité réelle d'un draft,
- pertinence métier d'une synthèse,
- lisibilité suffisante de la preuve opérateur,
- niveau d'ambiguïté perçu sur certaines surfaces riches.

## 10. Platform realism boundary

La frontière entre `fixture synthétique`, `sandbox réaliste` et `validation sur plateforme réelle` doit rester explicite.

### Fixture synthétique

Rôle :

- isoler un comportement,
- produire du déterminisme,
- tester une primitive ou une micro-chaîne de primitives.

Ce qu'elle ne doit pas prétendre être :

- une application réaliste complète,
- une preuve de robustesse sur plateforme réelle.

### Sandbox réaliste

Rôle :

- simuler un workflow applicatif crédible,
- tester plusieurs primitives ensemble,
- reproduire des patterns métier sans dépendre d'un tiers externe.

Ce qu'elle ne doit pas prétendre être :

- une copie fidèle d'une plateforme sensible,
- un alibi pour préparer du comportement furtif.

### Validation sur plateforme réelle

Rôle :

- mesurer l'écart entre le moteur validé en sandbox et une surface externe réelle,
- vérifier une robustesse limitée sur quelques parcours autorisés.

Ce qu'elle ne doit pas devenir :

- la base principale du développement initial,
- le support de démos trompeuses,
- un terrain d'expérimentation anti-détection.

### Position explicite sur LinkedIn, Upwork et plateformes sensibles

- LinkedIn, Upwork et surfaces comparables ne doivent pas être la base principale des premiers tests.
- Elles peuvent intervenir plus tard comme validation limitée, supervisée et encadrée.
- Le but n'est pas de concevoir des fixtures pour imiter ou contourner ces plateformes.
- Le but est de mesurer la robustesse du `browser control`, pas de contourner les garde-fous des plateformes.

Décision prise :

- aucun prototype navigateur initial ne doit être autorisé sur la seule base de validations LinkedIn/Upwork.

## 11. Failure injection plan

Les fixtures doivent permettre d'injecter des échecs intentionnels. Sans cela, on ne teste qu'un moteur qui "réussit quand tout va bien".

## 1. Élément introuvable

**Pourquoi**

Tester la re-résolution et l'arrêt propre.

**Symptôme**

- zéro candidat utile.

**Comportement à vérifier**

- diagnostic explicite,
- pas de clic au hasard,
- tentative de recovery bornée.

## 2. Mauvais target

**Pourquoi**

Tester la discipline de focus et d'identité de target.

**Symptôme**

- action préparée sur la mauvaise page.

**Comportement à vérifier**

- détection d'incohérence,
- refocus ou arrêt,
- aucune action silencieuse sur mauvaise target.

## 3. Iframe inattendue

**Pourquoi**

Tester le changement de contexte.

**Symptôme**

- élément visible mais introuvable dans la frame courante.

**Comportement à vérifier**

- diagnostic frame,
- requalification correcte du contexte.

## 4. Session expirée

**Pourquoi**

Tester les surfaces authentifiées et l'arrêt sur login.

**Symptôme**

- redirection login ou contenu privé inaccessible.

**Comportement à vérifier**

- aucune tentative de saisie de secret,
- suspension ou arrêt propre.

## 5. DOM muté

**Pourquoi**

Tester la robustesse face au re-render.

**Symptôme**

- référence obsolète,
- liste rerendue.

**Comportement à vérifier**

- recapture du DOM,
- re-résolution avant action.

## 6. Lazy loading non achevé

**Pourquoi**

Tester l'arrêt avant exploration infinie.

**Symptôme**

- contenu partiellement chargé.

**Comportement à vérifier**

- scroll intentionnel,
- détection de couverture incomplète,
- stop si collecte trop ouverte.

## 7. Modal bloquante

**Pourquoi**

Tester la détection de bloqueur et la policy associée.

**Symptôme**

- overlay ou dialog empêchant toute action.

**Comportement à vérifier**

- qualification correcte,
- approval si nécessaire,
- pas de clic derrière la modal.

## 8. Champ requis manquant

**Pourquoi**

Tester la compréhension formulaire et la non-soumission.

**Symptôme**

- erreur de validation locale.

**Comportement à vérifier**

- diagnostic champ manquant,
- aucune conclusion fausse de succès.

## 9. Bouton disabled

**Pourquoi**

Tester la notion d'actionnabilité réelle.

**Symptôme**

- bouton visible mais désactivé.

**Comportement à vérifier**

- non-interaction,
- recherche de cause,
- pas d'insistance aveugle.

## 10. Résultat ambigu

**Pourquoi**

Tester la différence entre action tentée et action confirmée.

**Symptôme**

- aucun succès clair, aucun échec clair.

**Comportement à vérifier**

- classification `ambiguous`,
- preuve complémentaire ou arrêt.

## 11. Permission refusée

**Pourquoi**

Tester la gouvernance d'action.

**Symptôme**

- approval refusée ou périmètre non autorisé.

**Comportement à vérifier**

- pas de contournement,
- voie alternative sûre ou arrêt.

## 12. Upload échoué

**Pourquoi**

Tester la frontière local -> web et la vérification post-action.

**Symptôme**

- fichier non attaché,
- erreur format/taille,
- champ incorrect.

**Comportement à vérifier**

- diagnostic d'échec,
- aucune soumission ultérieure à partir d'un état invalide.

## 13. Fixture data model (conceptual only)

Chaque fixture doit pouvoir être décrite conceptuellement avec les champs suivants :

| Champ | Rôle |
| --- | --- |
| `id` | identifiant stable de fixture |
| `family` | famille canonique de fixture |
| `purpose` | comportement ou risque principal visé |
| `difficulty` | niveau de difficulté attendu |
| `risk_profile` | niveau de sensibilité ou de danger produit |
| `prerequisites` | état ou préconditions nécessaires |
| `synthetic_vs_realistic` | position sur l'axe synthétique -> réaliste |
| `required_browser_primitives` | primitives qui doivent être sollicitées |
| `expected_evidence` | preuves minimales attendues |
| `benchmark_mapping` | benchmarks que la fixture alimente |
| `approval_sensitivity` | niveau d'approval attendu |
| `known_limitations` | limites reconnues de la fixture |

Décision prise :

- une fixture sans métadonnées explicites ne doit pas entrer dans le corpus de validation canonique.

## 14. Minimal fixture set for prototype authorization

Cette section définit le plus petit ensemble de fixtures sans lequel aucun prototype navigateur ne devrait être autorisé.

## Fixtures indispensables

### 1. Navigation simple avec outcome explicite

Pourquoi :

- sans elle, on ne valide ni navigation ni vérification.

### 2. Fixture DOM ambiguë avec plusieurs cibles similaires

Pourquoi :

- sans elle, on ne teste pas la prudence réelle du moteur.

### 3. Page longue avec scroll et élément hors viewport

Pourquoi :

- sans elle, le moteur peut sembler correct alors qu'il ne sait ni révéler ni vérifier une cible éloignée.

### 4. Formulaire simple sans soumission, avec champ requis et bouton disabled

Pourquoi :

- sans elle, on ne valide pas la compréhension de formulaire ni l'actionnabilité.

### 5. Multi-tab avec mauvaise target active possible

Pourquoi :

- sans elle, le moteur peut agir correctement uniquement sur scénario mono-target idéal.

### 6. Modal bloquante + action gouvernée

Pourquoi :

- sans elle, on ne teste pas les bloqueurs ni la relation à la policy.

### 7. DOM muté après interaction

Pourquoi :

- sans elle, on ne teste pas la re-résolution nécessaire aux pages modernes.

### 8. Outcome ambigu nécessitant vérification stricte

Pourquoi :

- sans elle, le moteur peut déclarer des succès sans preuve.

### 9. Surface authentifiée synthétique avec session expirée

Pourquoi :

- sans elle, le moteur n'est pas testé sur l'arrêt propre en environnement sensible.

## Fixtures fortement utiles

- formulaire multi-step,
- iframe/frames,
- éditeur riche borné,
- upload de fichier,
- confirmation flow explicite,
- lazy loading borné.

## Fixtures facultatives au tout premier prototype

- listes très denses,
- pages très riches visuellement,
- scénarios semi-réalistes multiples par verticale,
- validation limitée sur plateformes externes réelles.

### Position stricte

Si les `fixtures indispensables` ne sont pas prêtes, le prototype navigateur ne doit pas commencer.

## 15. Risks and anti-patterns

### 1. Prototype basé trop tôt sur LinkedIn / Upwork

Risque :

- diagnostic brouillé,
- dépendance excessive au bruit externe,
- dérive produit.

### 2. Fixtures trop propres et non représentatives

Risque :

- succès artificiels,
- impression trompeuse de robustesse.

### 3. Fixtures trop réalistes mais non déterministes

Risque :

- benchmark inutilisable,
- difficulté à localiser la cause d'échec.

### 4. Sélecteurs trop fragiles dans les fixtures elles-mêmes

Risque :

- on encode des dépendances toxiques dans le terrain de test.

### 5. Confusion entre benchmark et démo

Risque :

- les cas choisis servent à impressionner, pas à invalider les faiblesses.

### 6. Preuves insuffisantes

Risque :

- impossible de juger si "ça a vraiment marché".

### 7. Dépendance à des timings arbitraires

Risque :

- succès non reproductibles,
- masquage de vrais problèmes d'état.

### 8. Validation basée sur "ça a l'air d'avoir marché"

Risque :

- faux succès,
- absence de discipline d'outcome.

Décision prise :

- le plan de fixtures doit être conçu pour casser les illusions de réussite facile, pas pour les nourrir.

## 16. Open questions

## Avant prototype

- quel nombre exact de fixtures par famille est suffisant pour autoriser le démarrage,
- jusqu'où pousser Tier 2 avant d'introduire Tier 3,
- quel niveau de preuve DOM doit être considéré minimalement acceptable,
- quelle part des assertions doit être automatisable dès la première phase.

## Avant MVP

- quelle profondeur d'éditeur riche est réellement nécessaire,
- combien de surfaces authentifiées synthétiques différentes faut-il maintenir,
- quel niveau de réalisme interne justifie son coût de maintenance,
- quand introduire une validation limitée sur plateforme réelle.

## Avant production

- comment gouverner durablement les fixtures réalistes et leur maintenance,
- quelle stratégie de données et de redaction sur preuves persistées,
- quel régime de compatibilité entre versions du moteur navigateur et corpus de fixtures,
- comment gérer l'écart entre politiques plateforme changeantes et fixtures internes stables.

## Décisions, hypothèses, dépendances et non-décisions

### Décisions prises

- les fixtures sont une condition d'autorisation du prototype,
- la progression se fait du déterministe vers le réaliste,
- les plateformes externes ne sont pas la base initiale des tests,
- les échecs doivent être injectés intentionnellement,
- le set minimal indispensable est strict.

### Hypothèses

- des sandboxes internes réalistes peuvent couvrir l'essentiel des patterns `V1`,
- les surfaces authentifiées synthétiques suffiront à tester la gouvernance initiale,
- les benchmarks les plus importants peuvent être supportés sans dépendre trop tôt du réel externe.

### Dépendances

- benchmarks navigateur,
- modèle d'approvals,
- modèle de preuves,
- taxonomie des événements,
- frontière du prototype,
- threat model.

### Non-décisions

- outillage exact de création de fixtures,
- format de stockage technique des fixtures,
- orchestration technique des tests,
- stratégie CI/CD.

## Liens avec le reste du corpus

- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- [threat-model.md](./threat-model.md)
- [prototype-boundary-v1.md](./prototype-boundary-v1.md)
