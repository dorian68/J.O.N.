# Browser control DOM strategy

## But du document

Décrire la stratégie `DOM-first` qui doit gouverner le browser control de Cowork IA.

Ce document précise :

- pourquoi le DOM doit être la couche dominante quand il est exploitable,
- comment le système découvre et qualifie les éléments,
- comment il choisit entre plusieurs candidats,
- comment il décide d'agir, d'attendre, de re-résoudre ou de s'arrêter,
- quand le DOM est suffisant, ambigu ou insuffisant,
- quand un fallback visuel devient acceptable.

## Décision centrale

Décision prise :

- le DOM est la représentation principale de la page pour la lecture, la sélection, l'action et la vérification,
- le fallback visuel ne doit pas être la stratégie par défaut,
- le pixel ne peut pas remplacer une structure explicable tant que le DOM reste exploitable.

## Pourquoi le DOM doit dominer

Le DOM offre plusieurs avantages structurants :

- il expose des rôles, labels et états,
- il permet de distinguer contenu et interaction,
- il rend l'audit d'une sélection possible,
- il facilite la vérification post-action,
- il réduit la dépendance aux heuristiques de position purement visuelles,
- il est plus compatible avec une politique d'approvals interprétable.

Le DOM n'est pas parfait, mais il reste la meilleure base quand le produit veut être :

- explicable,
- supervisable,
- auditable,
- robuste face à la variation raisonnable d'interface.

## Pipeline DOM-first recommandé

## 1. Capture du contexte de page

Le système commence par établir un état minimal de page :

- URL,
- titre,
- target active,
- statut de chargement,
- présence de frames,
- présence éventuelle de bloqueurs,
- snapshot DOM exploitable.

Sans cet état minimal, l'interaction doit être différée.

## 2. Découverte des régions pertinentes

Le moteur ne doit pas chercher un élément isolé dans le vide. Il doit d'abord repérer :

- la région métier principale de la page,
- les conteneurs structurants,
- les listes, formulaires, dialogues, panneaux ou sections dominantes.

Cette étape réduit les faux positifs et améliore la sélection.

## 3. Résolution des candidats

Pour une intention donnée, le système doit construire un ensemble de candidats à partir de signaux comme :

- rôle ou type d'élément,
- nom accessible,
- label de formulaire,
- texte visible,
- attributs sémantiques,
- contexte de voisinage,
- stabilité apparente de l'élément.

## 4. Scoring de pertinence

Chaque candidat doit être évalué selon :

- adéquation à l'intention,
- proximité sémantique avec la consigne,
- actionnabilité réelle,
- cohérence avec la zone courante de la page,
- stabilité probable,
- niveau d'ambiguïté résiduel.

Le système ne doit pas traiter tous les candidats comme équivalents.

## 5. Vérification d'actionnabilité

Avant toute action, le système doit vérifier si l'élément est :

- présent,
- visible,
- non désactivé,
- non recouvert,
- dans le bon contexte de frame,
- dans ou amenable au viewport,
- compatible avec l'action envisagée.

## 6. Interaction gouvernée

L'action ne part qu'une fois le candidat choisi et vérifié.

Le système doit garder une trace de :

- pourquoi cet élément a été choisi,
- quels autres candidats ont été écartés,
- quel niveau d'ambiguïté subsiste.

## 7. Vérification post-action

Après l'interaction, le système doit requalifier l'état :

- le DOM a-t-il changé comme attendu ?
- l'élément a-t-il effectivement reçu la valeur ?
- la navigation attendue a-t-elle eu lieu ?
- un message de succès ou un blocage est-il apparu ?

Si la réponse est ambiguë, l'action doit rester classée comme non confirmée.

## Découverte des éléments

Le système doit privilégier les signaux suivants, du plus robuste au plus fragile.

### 1. Rôles et sémantique

Exemples :

- `button`,
- `link`,
- `textbox`,
- `combobox`,
- `checkbox`,
- `dialog`,
- `form`,
- `list`,
- `menuitem`.

Ces signaux sont particulièrement utiles quand ils sont cohérents avec le nom accessible.

### 2. Labels et attributs accessibles

Sources possibles :

- `label` HTML,
- `aria-label`,
- `aria-labelledby`,
- nom accessible dérivé,
- placeholder quand aucun label plus robuste n'existe.

### 3. Texte visible

Le texte visible est utile, mais ne doit pas être pris isolément.

Il doit être interprété avec :

- le rôle,
- le voisinage,
- le conteneur,
- l'intention utilisateur.

### 4. Attributs stables

Exemples possibles :

- identifiants stables,
- attributs produits ou test-friendly,
- attributs métier cohérents,
- noms de champs récurrents.

Décision :

- les attributs stables sont utiles,
- les classes CSS volatiles ou obfusquées ne doivent pas devenir la base de sélection principale.

### 5. Contexte de voisinage

Le système doit parfois raisonner sur :

- le titre de section,
- le libellé voisin,
- la carte ou ligne de tableau courante,
- l'association entre un bouton et un objet métier visible.

Cette approche est essentielle pour les listes et les vues répétitives.

## Choix entre plusieurs candidats

Quand plusieurs éléments semblent possibles, le système doit :

1. préférer le candidat le plus sémantiquement compatible,
2. privilégier celui situé dans la bonne région de page,
3. éliminer ceux qui sont non actionnables,
4. vérifier si un discriminant explicite existe,
5. refuser de choisir aveuglément si l'ambiguïté persiste.

## Contrat de sélection

Chaque sélection robuste devrait pouvoir être décrite par un petit contrat conceptuel :

- page ou région visée,
- type d'élément recherché,
- nom ou texte attendu,
- discriminant secondaire si nécessaire,
- action visée,
- preuve d'actionnabilité.

Ce contrat doit être plus stable qu'un simple sélecteur technique.

## Vérification d'actionnabilité détaillée

## 1. Élément caché

Le système doit distinguer :

- élément absent,
- élément présent mais caché,
- élément présent mais hors viewport,
- élément présent mais masqué par style ou état.

## 2. Élément désactivé

Un élément désactivé ne doit pas être traité comme cliquable "si on insiste".

Il faut alors chercher :

- condition préalable manquante,
- erreur de formulaire,
- chargement incomplet,
- blocage par modal.

## 3. Élément recouvert

Le système doit détecter quand un overlay, une modal ou un sticky header recouvre la cible.

Dans ce cas :

- il faut traiter le bloqueur,
- ou s'arrêter,
- mais pas cliquer à l'aveugle.

## 4. Élément hors viewport

Le moteur doit distinguer :

- cible scrollable jusqu'au viewport,
- cible dans un conteneur scrollable distinct,
- cible théoriquement résolue mais pratiquement non accessible.

## Gestion des DOM dynamiques et réactifs

Les pages modernes mutent fréquemment :

- rendu incrémental,
- listes virtualisées,
- transitions client-side,
- re-renders après focus ou saisie,
- remplacement complet de nœuds.

Le système doit donc :

- éviter de réutiliser trop longtemps une référence d'élément,
- re-résoudre après interaction significative,
- attendre des conditions d'état plutôt que des délais arbitraires,
- traiter les références obsolètes comme un cas normal de récupération.

## Changements d'état après interaction

Après un clic ou une saisie, les changements possibles incluent :

- mutation locale du DOM,
- validation inline,
- apparition d'une modal,
- transition SPA,
- navigation complète,
- aucun effet visible.

Le système doit savoir distinguer ces cas, sinon il ne peut pas vérifier l'outcome.

## Stratégies de sélection robustes

## Priorité recommandée

| Priorité | Signal | Pourquoi |
| --- | --- | --- |
| 1 | rôle + nom accessible | plus stable et le plus interprétable |
| 2 | label explicite | robuste pour formulaires |
| 3 | texte visible contextualisé | utile si couplé à une région claire |
| 4 | attribut stable | utile si connu comme durable |
| 5 | voisinage et structure | indispensable dans listes/cartes/tableaux |
| 6 | position relative pure | dernier recours, peu robuste |

## Ce qu'on veut éviter

- sélecteurs purement CSS dépendants de classes volatiles,
- chaînes `nth-child` fragiles,
- timing arbitraire de type "attendre 3 secondes et cliquer",
- dépendance à la position écran sans structure DOM,
- heuristiques opaques impossibles à expliquer a posteriori.

## Frontière DOM connu / DOM ambigu / DOM insuffisant

## 1. DOM connu

Situation :

- structure claire,
- éléments correctement résolus,
- actionnabilité vérifiable,
- résultat attendu vérifiable.

Comportement attendu :

- agir via DOM,
- tracer,
- vérifier.

## 2. DOM ambigu

Situation :

- plusieurs candidats plausibles,
- structure peu discriminante,
- état de page instable,
- doute sur la bonne cible.

Comportement attendu :

- raffiner la résolution,
- re-snapshotter,
- demander éventuellement confirmation,
- ne pas cliquer au hasard.

## 3. DOM insuffisant

Situation :

- surface très custom ou canvas,
- éditeur riche peu interprétable,
- blocage visible non bien représenté,
- virtualisation trop forte,
- état visuel dominant non reflété sémantiquement.

Comportement attendu :

- expliciter pourquoi le DOM ne suffit pas,
- décider si un fallback visuel borné est acceptable,
- sinon s'arrêter proprement.

## Besoin de fallback screenshot/vision

Le fallback visuel peut aider à :

- confirmer un bloqueur,
- interpréter une surface très graphique,
- détecter un état visible non capturé proprement par le DOM,
- produire une preuve complémentaire.

Mais il ne doit pas devenir :

- une excuse pour ignorer le DOM,
- un mécanisme par défaut de sélection,
- un substitut à l'audit sémantique.

## Cas spécifiques

## Formulaires

La stratégie DOM-first doit permettre de :

- relier champ et label,
- comprendre type, état et contrainte,
- vérifier la valeur après saisie,
- distinguer saisie et soumission.

## Listes, cartes et tableaux

Le système doit raisonner par objet métier visible :

- ligne de résultat,
- carte de profil,
- offre,
- message,
- proposition.

La sélection d'un bouton ou lien doit être reliée à l'objet qu'il affecte.

## Rich editors

Le DOM peut devenir partiellement insuffisant.

Le système doit alors :

- lire le contenu existant si possible,
- localiser la zone éditable réelle,
- vérifier ce qui a été effectivement inséré,
- s'arrêter si la structure interne n'est pas assez fiable.

## Frames et iframes

La stratégie de sélection doit rester explicite sur le contexte :

- frame courante,
- hiérarchie,
- nature cross-origin ou non,
- lien entre élément ciblé et frame active.

## Décisions prises

- priorité au DOM sémantique et accessible,
- exigence de contrat de sélection explicable,
- re-résolution régulière sur DOM réactif,
- refus des sélecteurs fragiles comme base principale,
- fallback visuel seulement si le DOM est explicitement jugé insuffisant.

## Hypothèses fragiles

- certaines plateformes importantes auront un DOM suffisamment exploitable pour la majorité des tâches `V1`,
- les surfaces riches les plus critiques pourront au moins être traitées en lecture ou en drafting borné,
- les états ambigus pourront être détectés assez tôt pour éviter les erreurs graves.

Ces hypothèses devront être testées par benchmarks et par prototypes ciblés.

## Liens avec le reste du corpus

- Spec générale : [browser-control-spec.md](./browser-control-spec.md)
- Primitives : [browser-control-primitives.md](./browser-control-primitives.md)
- Recovery : [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- Observabilité : [browser-control-observability.md](./browser-control-observability.md)
- Benchmarks : [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
