# Browser control observability

## But du document

Définir comment la couche `browser control` doit être observée, comprise, auditée et déboguée.

Le but n'est pas d'accumuler un maximum de logs. Le but est de conserver le bon niveau de détail pour :

- le runtime,
- l'UI opérateur,
- l'audit,
- le debugging,
- les benchmarks futurs.

## Principes directeurs

- Toute action navigateur significative doit laisser une trace structurée.
- Une trace utile doit expliquer ce qui a été visé, fait, observé et vérifié.
- L'observabilité ne doit pas créer une fuite massive de données sensibles.
- La preuve utile est préférable au log verbeux.
- Le navigateur doit être observable au niveau du `run`, de la `target`, de l'élément, de l'action et de l'outcome.

## Objets d'observabilité

- session navigateur,
- target / onglet,
- navigation,
- snapshot DOM,
- élément ciblé,
- action émise,
- bloqueur détecté,
- résultat observé,
- preuve exportée,
- reprise ou arrêt.

## Familles d'événements spécifiques navigateur

| Famille | Rôle principal |
| --- | --- |
| `browser.session.*` | ouvrir, attacher, détacher, fermer une session |
| `browser.target.*` | lister, ouvrir, focaliser, fermer une target |
| `browser.navigation.*` | début, fin, redirection, erreur, ambiguïté |
| `browser.dom.*` | snapshot, requête, résolution d'élément, contexte frame |
| `browser.interaction.*` | click, focus, type, select, toggle, submit |
| `browser.blocker.*` | modal, consent, login expiré, overlay, CAPTCHA détecté |
| `browser.verification.*` | vérification de résultat, succès, ambiguïté, absence d'effet |
| `browser.evidence.*` | capture de preuve, redaction, export |
| `browser.recovery.*` | retry, re-query, re-focus, abandon, escalation |

## Événements navigateur minimaux

| Événement | Ce qu'il doit dire au minimum |
| --- | --- |
| `browser.session.opened` | session, mode d'ouverture, périmètre autorisé |
| `browser.session.attached` | session existante, contexte sensible ou non |
| `browser.target.opened` | target créée, URL initiale, parent éventuel |
| `browser.target.focused` | target active pour l'étape suivante |
| `browser.navigation.started` | source, destination attendue, raison |
| `browser.navigation.completed` | URL finale, titre, état de page |
| `browser.dom.snapshot_captured` | portée, taille logique, moment du run |
| `browser.dom.element_resolved` | contrat de sélection, élément choisi, ambiguïté résiduelle |
| `browser.interaction.performed` | type d'action, cible, risque, résultat immédiat |
| `browser.blocker.detected` | type de bloqueur, impact, stratégie proposée |
| `browser.verification.completed` | attente, résultat observé, statut |
| `browser.evidence.exported` | type de preuve, redaction appliquée, destination |
| `browser.recovery.attempted` | symptôme, stratégie, issue |

## Ce que doit contenir une trace d'action utile

Une trace d'action navigateur utile devrait permettre de répondre à ces questions :

- sur quelle target l'action a-t-elle eu lieu ?
- quel élément ou quelle région était visé ?
- pourquoi cet élément a-t-il été choisi ?
- quelle action exacte a été tentée ?
- quel risque était associé ?
- quelle approval couvrait l'action si nécessaire ?
- quel résultat a été observé ?
- quelle preuve a été conservée ?

## Preuves recommandées

## 1. Preuves de contexte

- URL,
- titre,
- domaine,
- type de surface : publique, authentifiée, sensible,
- horodatage,
- lien avec le run et l'étape.

## 2. Preuves de sélection

- contrat de sélection,
- signaux sémantiques dominants,
- métadonnées élémentaires,
- contexte de frame si nécessaire.

## 3. Preuves d'action

- type d'action,
- avant/après utile,
- résultat immédiat,
- statut de vérification.

## 4. Preuves de résultat

- message de succès,
- changement d'URL,
- nouvelle valeur visible,
- présence d'un nouvel état attendu,
- capture de page ou snapshot pertinent si justifié.

## Snapshots DOM

Le snapshot DOM n'a pas vocation à être conservé intégralement dans tous les cas.

Il faut distinguer :

- snapshot opérationnel de travail,
- snapshot résumé pour audit,
- preuve ciblée liée à un élément ou une région,
- snapshot trop riche pour être conservé durablement.

Principe :

- conserver le niveau minimal suffisant pour expliquer et rejouer conceptuellement le comportement.

## Observabilité pour chaque audience

## 1. Runtime

Le runtime a besoin de :

- transitions d'état fiables,
- références de target,
- contrat de sélection,
- diagnostics d'échec,
- résultats de vérification.

## 2. UI opérateur

L'opérateur a besoin de voir :

- quelle page est consultée,
- quelle action est en cours,
- si une approval est nécessaire,
- si un blocage est apparu,
- si le résultat a été vérifié.

L'UI n'a pas besoin d'exposer tous les détails bruts du DOM.

## 3. Audit

L'audit a besoin de :

- rattacher chaque action à un run et à une target,
- voir les approvals correspondantes,
- comprendre le niveau de risque,
- disposer de preuves suffisantes,
- expliquer un outcome ou un échec.

## 4. Debugging

Le debugging a besoin de :

- raisons d'échec classifiées,
- contrat de sélection,
- état de page avant/après,
- indices sur mutations DOM, bloqueurs, navigations inattendues,
- décisions de recovery.

## Limites et redaction

Le navigateur peut exposer des données sensibles :

- contenus privés,
- messages,
- identités,
- informations de compte,
- pièces jointes,
- tokens ou traces techniques.

L'observabilité doit donc appliquer des principes de minimisation :

- ne pas enregistrer de secrets,
- masquer ou résumer certaines valeurs saisies,
- redacter les preuves exportées si nécessaire,
- distinguer logs internes et preuves montrables à l'opérateur,
- ne pas conserver plus de contenu que nécessaire pour la mission et l'audit.

## Erreurs et raisons d'échec

L'observabilité navigateur doit distinguer au minimum :

- élément introuvable,
- élément ambigu,
- élément non actionnable,
- page non stable,
- navigation inattendue,
- bloqueur détecté,
- surface authentifiée non autorisée,
- résultat non vérifiable,
- surface trop ambiguë pour continuer.

## Reprise et continuité

Le système doit pouvoir tracer :

- ce qui a été fait avant l'échec,
- pourquoi l'action suivante a été bloquée,
- quelle stratégie de recovery a été tentée,
- pourquoi la reprise a réussi ou échoué,
- quand il a fallu s'arrêter proprement.

## Décisions prises

- la couche navigateur doit produire ses propres familles d'événements,
- les preuves ciblées sont plus utiles que des captures massives indiscriminées,
- l'observabilité doit servir à la fois l'opérateur et l'audit,
- la minimisation des fuites sensibles fait partie du design d'observabilité.

## Incertitudes restantes

- niveau exact de conservation des snapshots DOM,
- niveau de redaction par défaut des preuves visuelles,
- quantité de détails que l'UI opérateur doit exposer sans devenir trop technique.

## Liens avec le reste du corpus

- Taxonomie générale : [event-taxonomy.md](./event-taxonomy.md)
- Recovery : [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- Approvals : [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- Benchmarks : [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
