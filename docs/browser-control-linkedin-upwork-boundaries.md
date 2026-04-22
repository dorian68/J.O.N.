# Browser control LinkedIn / Upwork boundaries

## But du document

Documenter les usages autorisés, sensibles et interdits pour des surfaces navigateur de type LinkedIn, Upwork et plateformes comparables.

Ce document protège le produit contre une dérive vers :

- le spam,
- le scraping agressif,
- l'opacité,
- l'évasion de protections plateforme,
- l'automatisation non supervisée d'actes engageants.

## Position produit

Cowork IA n'est pas conçu comme un bot agressif de croissance, de prospection ou d'application en masse.

Position retenue :

- assistance supervisée à des actions légitimes : oui,
- automatisation raisonnable et bornée avec approvals : parfois,
- automatisation opaque, à l'échelle ou orientée contournement : non.

## Principes transverses non négociables

- pas de stealth anti-détection,
- pas de CAPTCHA bypass,
- pas de credential harvesting,
- pas d'exfiltration de données sans contrôle,
- pas d'envoi massif non supervisé,
- pas de contournement explicite des limites ou garde-fous de plateforme,
- pas d'élargissement silencieux du périmètre d'action.

## Catégories d'usage

## 1. Usages autorisés

Usages compatibles avec la posture produit dès lors qu'ils restent supervisés et bornés.

Exemples :

- lire une offre, un profil ou une page d'entreprise,
- comparer plusieurs pages pour produire un artefact,
- collecter des informations nécessaires à une note,
- préparer un brouillon de message ou de réponse,
- pré-remplir certains champs non sensibles avec approval adaptée,
- organiser des informations visibles dans un artefact de travail.

## 2. Usages sensibles

Usages potentiellement légitimes mais nécessitant forte gouvernance.

Exemples :

- attachement à une session authentifiée,
- navigation sur surfaces privées,
- préparation d'une candidature ou d'une réponse dans un éditeur riche,
- upload d'un fichier autorisé,
- préparation d'un envoi ou d'une soumission.

Ils doivent rester :

- explicitement autorisés,
- lisibles pour l'opérateur,
- auditables,
- interrompables avant l'acte final.

## 3. Usages interdits ou non souhaités

Exemples :

- prospection ou candidature de masse,
- envoi automatique de messages en série,
- collecte agressive de données à grande échelle,
- contournement de limitation de plateforme,
- automatisation d'actions finales sans supervision,
- contournement des dispositifs anti-bot ou anti-abus,
- récupération ou stockage abusif d'identifiants ou secrets.

## Boundaries spécifiques LinkedIn

## Tâches acceptables

- ouvrir un profil ou une page entreprise à la demande,
- résumer un profil dans un artefact interne,
- comparer plusieurs profils ou pages,
- préparer un brouillon de message ou de note de prise de contact,
- remplir partiellement un champ de brouillon après approval adaptée,
- aider à relire un post ou un message avant publication ou envoi.

## Tâches sensibles mais potentiellement admissibles plus tard

- préparer une invitation ou un message ciblé sur une seule cible,
- assister une publication unique avec approval finale explicite,
- naviguer dans une session authentifiée déjà ouverte et autorisée.

Ces tâches ne doivent jamais devenir :

- envoi automatique en chaîne,
- approbation implicite par répétition,
- automation de quotas ou de séquences de croissance.

## Tâches non acceptables

- envoi massif d'invitations,
- séquences automatiques de messages,
- scraping agressif de réseaux ou de résultats,
- contournement de limites de visibilité ou de recherche,
- contournement des dispositifs de protection de plateforme.

## Boundaries spécifiques Upwork

## Tâches acceptables

- lire des fiches de mission,
- comparer plusieurs opportunités,
- extraire exigences et contraintes d'un brief,
- préparer une note de qualification,
- préparer un brouillon de proposition,
- pré-remplir partiellement une réponse ou certains champs non finaux sous supervision.

## Tâches sensibles mais potentiellement admissibles plus tard

- utiliser une session authentifiée explicitement autorisée,
- joindre un fichier validé par l'utilisateur,
- préparer une soumission prête à l'envoi, sans l'exécuter automatiquement.

## Tâches non acceptables

- candidature en masse,
- soumission automatique de propositions,
- génération et envoi industrialisés de réponses,
- contournement de limites ou de règles de plateforme,
- harvesting de données sensibles de comptes ou de tiers.

## Typologie des actes navigateur sur plateformes sensibles

| Type d'acte | Exemple | Position produit initiale |
| --- | --- | --- |
| Lecture simple | lire une page d'offre ou un profil | acceptable dans le périmètre autorisé |
| Navigation bornée | ouvrir plusieurs résultats ou détails | acceptable avec observabilité |
| Extraction structurée | produire une synthèse ou un tableau de tri | acceptable |
| Préparation de brouillon | rédiger une réponse ou un message | acceptable sous supervision |
| Pré-remplissage de formulaire | remplir des champs avant validation | sensible, approval explicite |
| Upload | joindre CV, portfolio, pièce | sensible, approval explicite forte |
| Soumission | envoyer proposition, message, post | non automatisable en V1 |
| Action de masse | envoyer à plusieurs cibles | interdit |

## Relation aux approvals

Sur LinkedIn, Upwork et plateformes similaires :

- la lecture reste la zone la plus sûre,
- la saisie et l'édition deviennent rapidement sensibles,
- la soumission, l'envoi et la publication sont des actes engageants,
- les approvals finales doivent être unitaires et explicites,
- l'auto-approval n'est pas adaptée aux actes de portée externe dans la v1.

## Données, preuves et confidentialité

Le système doit éviter :

- de conserver des preuves inutilement sensibles,
- de capturer des données privées non nécessaires,
- d'exposer dans les artefacts des informations qui n'ont pas besoin d'y figurer,
- de transformer des journaux techniques en copie durable de contenus sensibles.

## Signaux de dérive à surveiller

- le produit commence à être décrit comme un outil de croissance ou d'application en masse,
- les demandes portent surtout sur l'échelle et la discrétion, pas sur la qualité de mission,
- l'équipe parle de contourner les protections plutôt que d'améliorer la supervision,
- les approvals finales sont perçues comme un obstacle à supprimer.

## Décisions prises

- pas de stealth,
- pas de CAPTCHA bypass,
- pas de credential harvesting,
- pas d'envoi massif non supervisé,
- pas de soumission finale automatique sur plateformes sensibles en v1,
- assistance ciblée et supervisée possible sur lecture, triage et drafting.

## Incertitudes restantes

- le degré exact de préparation autorisée avant une approval finale,
- la profondeur acceptable de workflows authentifiés sur surfaces professionnelles,
- la quantité de preuve qu'il sera raisonnable de conserver sans excès de sensibilité.

## Liens avec le reste du corpus

- Spec générale : [browser-control-spec.md](./browser-control-spec.md)
- Approval matrix navigateur : [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- Threat model : [threat-model.md](./threat-model.md)
- Non-goals : [non-goals-and-kill-criteria.md](./non-goals-and-kill-criteria.md)
