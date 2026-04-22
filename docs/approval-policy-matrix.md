# Approval policy matrix

## But du document

Produire une matrice claire des approbations attendues dans le produit. L'objectif est de transformer le modèle de sécurité général en règles opératoires compréhensibles.

Ce document complète :

- [permissions-trust-safety.md](./permissions-trust-safety.md),
- [browser-and-computer-control.md](./browser-and-computer-control.md),
- [threat-model.md](./threat-model.md).

## Principes directeurs

- Une approval doit correspondre à une action interprétable par l'utilisateur.
- Une approval ne doit pas servir à compenser une absence de policy claire.
- Les actions à faible risque et très fréquentes ne doivent pas saturer l'opérateur.
- Certaines actions doivent rester non automatisables au départ, même avec approvals.

## Matrice canonique

| Type d'action | Niveau de risque | Contexte projet | Fréquence attendue | Auto-approval possible ? | Besoin d'escalade ? | Position initiale |
| --- | --- | --- | --- | --- | --- | --- |
| Lire un fichier dans le périmètre projet | lecture seule | projet explicite et borné | très fréquente | oui, par défaut | non | auto-autorisée |
| Lire un fichier hors périmètre projet | écriture nulle mais périmètre élargi | hors scope | occasionnelle | non | oui | approval explicite |
| Écrire un artefact dans la zone dédiée du projet | écriture réversible | projet borné | fréquente | oui, au niveau projet | non | auto-approval possible |
| Renommer ou déplacer un fichier dans le projet | écriture réversible | projet borné | occasionnelle | oui, si lot explicite et réversible | parfois | approval groupée possible |
| Supprimer un fichier | écriture sensible ou destructrice | projet borné ou non | rare | non | oui | refus par défaut |
| Naviguer sur un domaine pré-autorisé en lecture | lecture seule | domaine autorisé | fréquente | oui, session ou projet | non | auto-approval possible |
| Naviguer hors domaines prévus | lecture seule mais périmètre élargi | contexte externe | occasionnelle | non | oui | approval explicite |
| Télécharger un document vers le projet | écriture réversible | projet borné | occasionnelle | oui, selon politique projet | parfois | approval contextuelle |
| Remplir un formulaire sans soumission | écriture sensible potentielle | web externe | occasionnelle | non au départ | oui | approval explicite |
| Soumettre un formulaire ou publier une action web | action externe irréversible | web externe | rare | non | oui | non automatisable initialement |
| Lancer une commande shell lecture seule | variable selon portée | local | occasionnelle | non au départ | oui | approval explicite |
| Lancer une commande shell avec écriture locale | écriture sensible | local | rare | non | oui | refus par défaut hors cadrage très strict |
| Lire via un connecteur externe | lecture seule ou moyenne | connecteur autorisé | occasionnelle | parfois | parfois | après cadrage spécifique |
| Muter un système externe via connecteur | action externe irréversible | système tiers | rare | non | oui | hors périmètre initial |
| Computer control sur interface desktop | élevé | état applicatif ambigu | rare | non | oui | hors prototype initial |
| Saisir un secret ou un identifiant | critique | sensible | rare | non | oui | jamais confié au modèle au départ |

## Interprétation de la matrice

## 1. Actions auto-autorisables

Conditions minimales :

- action fréquente,
- périmètre borné,
- risque faible ou réversible,
- compréhension claire par l'utilisateur,
- traçabilité assurée.

Exemples typiques :

- lecture dans le projet,
- écriture d'artefacts dans l'espace dédié,
- navigation en lecture sur domaine explicitement autorisé.

## 2. Actions à approval explicite

Elles concernent généralement :

- extension du périmètre,
- écriture sur des objets préexistants,
- interaction web avec effets potentiels,
- exécution locale pouvant dépasser la zone sûre.

## 3. Actions non automatisables au départ

Doivent rester hors auto-mode initial :

- suppression destructrice,
- envoi d'email,
- publication,
- transaction financière,
- soumission externe engageante,
- saisie de secrets,
- élargissement large des permissions.

## Fatigue d'approbation

La fatigue d'approbation apparaît quand le système :

- demande validation pour des actions trop fines,
- répète des demandes équivalentes,
- formule mal le scope,
- interrompt le run trop souvent sans valeur claire.

### Symptômes à surveiller

- l'utilisateur clique sans lire,
- l'utilisateur autorise "pour avancer" sans comprendre,
- les refus accidentels se multiplient,
- le produit paraît plus lent qu'un travail manuel.

### Mesures de conception recommandées

- grouper certaines actions réversibles homogènes,
- distinguer `one-shot`, `session` et `projet`,
- ne jamais élargir silencieusement le scope réel d'une approval,
- proposer une alternative sûre lorsqu'un refus est possible.

## Principes pour un futur auto-mode

Ce document ne définit pas un auto-mode, mais il fixe les principes qui devront le borner :

- l'auto-mode ne peut agir que dans un périmètre de confiance explicitement configuré,
- il ne doit pas franchir une frontière de risque supérieure sans nouvelle validation,
- il doit rester interrompable à tout moment,
- il doit produire un audit suffisamment riche pour être rejouable après coup.

## Décisions prises

- lecture projet bornée : auto-autorisable,
- écriture dans la zone d'artefacts : auto-autorisable sous politique projet,
- actions destructrices ou externes irréversibles : non automatisables au départ,
- browser navigation hors périmètre autorisé : approval explicite,
- computer control : hors prototype initial.

## Questions encore ouvertes

- quel niveau exact de groupement d'approvals est acceptable pour les actions réversibles,
- si certaines commandes shell très bornées peuvent entrer dans un mode projet de confiance,
- comment représenter de façon claire les approvals de session versus de projet,
- à partir de quand une navigation web doit être considérée comme périmètre élargi.

## Liens avec le reste du corpus

- Le cadre général de trust et de sécurité est dans [permissions-trust-safety.md](./permissions-trust-safety.md).
- Les risques associés sont détaillés dans [threat-model.md](./threat-model.md).
- Les flows opérateur concernés sont décrits dans [operator-ux-flows.md](./operator-ux-flows.md).
- Le prototype initial est borné dans [prototype-boundary-v1.md](./prototype-boundary-v1.md).
- Le détail navigateur se trouve dans [browser-control-approval-matrix.md](./browser-control-approval-matrix.md).
