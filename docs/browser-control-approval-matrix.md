# Browser control approval matrix

## But du document

Produire une matrice détaillée d'approbation spécifique aux actions navigateur.

Ce document complète la matrice générale [approval-policy-matrix.md](./approval-policy-matrix.md) avec un niveau de granularité propre au `browser control`.

## Principes directeurs

- La simple lecture navigateur ne doit pas être traitée comme une action engageante.
- La saisie, l'édition et la soumission doivent être clairement distinguées.
- Les actes externes à effet métier doivent rester plus strictement gouvernés que la navigation et l'inspection.
- Les plateformes sensibles comme LinkedIn ou Upwork exigent une posture plus prudente encore.

## Matrice détaillée

| Type d'action | Contexte | Impact | Plateforme | Répétitivité | Réversibilité | Approval V1 | Potentiel auto-approval plus tard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lire le DOM d'une page autorisée | lecture simple | faible | publique ou autorisée | fréquente | n/a | non | oui |
| Scroll / inspection sur page autorisée | lecture simple | faible | publique ou autorisée | fréquente | n/a | non | oui |
| Ouvrir un nouvel onglet sur même domaine autorisé | navigation simple | faible | publique ou autorisée | fréquente | oui | non | oui |
| Naviguer vers un nouveau domaine non prévu | extension de périmètre | moyen | toute plateforme | occasionnelle | oui | oui | rarement |
| Attacher une session existante | surface sensible | élevé | surtout authentifiée | rare | partiellement | oui explicite | très limité |
| Utiliser une session authentifiée sur surface professionnelle | surface sensible | élevé | LinkedIn, Upwork, autres | occasionnelle | partiellement | oui explicite | non en V1 |
| Fermer une modal informative ou cookie non engageante | unblock simple | faible | toute plateforme | occasionnelle | oui | non ou implicite | oui |
| Accepter un consentement de portée non triviale | consentement | moyen à élevé | toute plateforme | rare | non évident | oui | non en V1 |
| Saisir dans un champ non sensible | édition locale à la page | moyen | publique ou authentifiée | occasionnelle | partiellement | oui explicite | peut-être sur surfaces sûres |
| Remplacer un contenu existant | édition | moyen à élevé | toute plateforme | occasionnelle | partiellement | oui | rarement |
| Sélectionner une option ou cocher un toggle sans effet externe immédiat | configuration locale | moyen | toute plateforme | occasionnelle | parfois | oui contextuel | peut-être |
| Upload d'un fichier | transfert local -> web | élevé | surtout professionnelle | rare | non trivial | oui explicite forte | non en V1 |
| Download vers le projet | web -> local | moyen | autorisée | occasionnelle | oui | contextuel | oui sur domaine sûr |
| Sauver un brouillon | édition persistée | moyen à élevé | professionnelle | occasionnelle | partiellement | oui | peut-être plus tard |
| Soumettre un formulaire | action externe | élevé | toute plateforme | rare | souvent non | oui unitaire | non en V1 |
| Publier un post ou contenu | action externe engageante | très élevé | réseaux / plateformes | rare | non | oui unitaire, mais hors V1 par défaut | non |
| Envoyer un message | action externe engageante | très élevé | LinkedIn, autres | rare | non | oui unitaire, mais hors V1 par défaut | non |
| Envoyer une proposition / candidature | action externe engageante | très élevé | Upwork, autres | rare | non | oui unitaire, mais hors V1 par défaut | non |
| Supprimer un contenu web | destructif | très élevé | toute plateforme | rare | non | refus par défaut | non |

## Lecture de la matrice

## 1. Actions généralement non soumises à approval

Dans un périmètre autorisé :

- lecture DOM,
- scroll,
- inspection,
- navigation interne simple,
- fermeture de bloqueur manifestement non engageant.

Condition :

- aucune mutation externe,
- aucun élargissement réel du périmètre,
- traçabilité assurée.

## 2. Actions sensibles mais parfois admissibles

Exemples :

- saisie bornée,
- sélection d'option,
- upload,
- save draft,
- attachement de session existante.

Elles exigent :

- compréhension claire de l'effet,
- cible bien identifiée,
- approval interprétable,
- vérification post-action.

## 3. Actions engageantes non auto-approvables en V1

Exemples :

- soumettre,
- publier,
- envoyer,
- supprimer.

Décision :

- même si une approval explicite existe, ces actions ne doivent pas devenir auto-approvables en `V1`.

## Plateformes et sensibilité

## Plateformes publiques ou documentaires

Surfaces à moindre risque :

- documentation,
- sites corporate,
- FAQ,
- pages produit publiques.

Lecture et navigation y sont les cas principaux.

## Plateformes professionnelles authentifiées

Surfaces à risque plus élevé :

- LinkedIn,
- Upwork,
- outils de messagerie ou d'opportunités,
- back-offices métier.

Les mêmes gestes techniques y portent un impact plus fort.

## Répétitivité et fatigue d'approbation

Le navigateur produit facilement de nombreuses micro-actions.

Pour éviter la fatigue :

- ne pas demander approval pour la lecture,
- regrouper certaines saisies réversibles si le scope est clair,
- distinguer la préparation d'une action de son exécution finale,
- rendre visible la frontière entre "j'édite" et "j'engage".

## Auto-approval futur : principes

Ce qui pourrait devenir auto-approvable plus tard, dans un cadre très borné :

- lecture sur domaines explicitement autorisés,
- navigation interne simple,
- scroll et inspection,
- téléchargement sur domaines sûrs vers zone projet dédiée,
- certaines saisies non sensibles dans un workflow très cadré.

Ce qui ne doit pas devenir auto-approvable dans la v1 :

- attachement de session sensible,
- upload de pièces,
- soumission de formulaire,
- publication,
- envoi de message,
- suppression.

## Décisions prises

- la lecture et l'inspection sont la zone de moindre friction,
- la saisie est déjà une action sensible sur beaucoup de surfaces,
- `submit`, `publish`, `send`, `delete` sont des frontières fortes,
- LinkedIn et Upwork doivent être traités comme plateformes sensibles,
- l'auto-approval navigateur reste volontairement limitée en v1.

## Incertitudes restantes

- quel groupement de saisies pourra devenir acceptable plus tard,
- à quelles conditions un save draft pourrait être moins strictement gouverné,
- si certains uploads bénins sur surfaces très cadrées pourront être assouplis.

## Liens avec le reste du corpus

- Matrice générale : [approval-policy-matrix.md](./approval-policy-matrix.md)
- Boundaries plateformes : [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md)
- Recovery : [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- Prototype boundary : [prototype-boundary-v1.md](./prototype-boundary-v1.md)
