# Context, mémoire et skills

## 1. Objet du document

Ce document définit la stratégie de contexte du futur produit et clarifie le rôle des skills.

Il répond à trois problèmes :

- éviter l'injection brute de tout le contexte,
- distinguer mémoire utile et stockage,
- distinguer connaissance projet et capacité opératoire.

## 2. Principes directeurs

- `Just-in-time context` : injecter le contexte utile à l'étape courante, pas tout le projet.
- `Progressive memory` : résumer à mesure que le run avance.
- `Project scope` : la mémoire durable est d'abord rattachée au projet.
- `Traceability` : on doit savoir pourquoi un contexte a été injecté.
- `Separation of concerns` : une skill n'est pas une source; une source n'est pas une skill.

## 3. Les couches de mémoire

| Couche | Portée | Durée | Contenu type | Usage |
|---|---|---|---|---|
| Mémoire de travail | étape / run | courte | faits immédiats, résultats de tools, hypothèses actives | exécution en cours |
| Mémoire de run | run | moyenne | plan, résumés intermédiaires, décisions, blocages, approvals | reprise et audit |
| Mémoire de projet | projet | longue | instructions, sources récurrentes, résumés de runs passés, préférences de livrables | continuité de travail |
| Mémoire d'artefact | artefact | longue | provenance, versions, commentaires, liens aux sources | réutilisation et export |
| Préférences utilisateur | utilisateur / workspace | longue | styles, defaults, connecteurs autorisés, politiques | personnalisation contrôlée |

## 4. Règles de sélection du contexte

Avant une étape, le système doit sélectionner seulement ce qui est utile parmi :

- mission initiale,
- plan courant,
- état du run,
- sources déjà consultées,
- résumés intermédiaires,
- instructions projet,
- artefacts liés,
- skills activées,
- contraintes de permission et d'approbation.

La sélection doit être motivée par l'étape en cours, pas par une logique de "tout envoyer".

## 5. Ce qui ne doit pas être injecté automatiquement

- l'intégralité du workspace,
- tous les fichiers attachés bruts,
- tout l'historique de conversation,
- toutes les sources déjà vues,
- toutes les skills installées,
- toutes les préférences locales non pertinentes.

## 6. Pipeline conceptuel de contexte

Le pipeline recommandé est :

1. déterminer le besoin d'information de l'étape,
2. récupérer les instructions persistantes pertinentes,
3. récupérer les sources les plus utiles,
4. injecter les résumés intermédiaires nécessaires,
5. ajouter les contraintes de policy et approvals en cours,
6. ajouter les skills activées,
7. compresser l'ensemble avant appel modèle.

## 7. Rôle des skills

Une `skill` est une capacité opératoire réutilisable.

Elle peut orienter :

- la manière d'analyser,
- la manière de planifier,
- la manière d'exécuter,
- la manière d'évaluer,
- le type de livrable à produire.

Une skill n'est pas :

- une mémoire projet,
- un jeu de sources métier,
- un historique,
- un simple tag marketing.

## 8. Contenu conceptuel d'une skill

Une skill devrait pouvoir embarquer :

- une identité et une version,
- une description d'usage,
- des instructions spécialisées,
- des préconditions,
- des dépendances de contexte,
- des outils préférés ou autorisés,
- des contraintes de sortie,
- des métadonnées de test.

## 9. Découverte et activation des skills

Les modes d'activation à prévoir sont :

- activation manuelle par l'utilisateur,
- activation suggérée par le planner,
- activation automatique sous conditions explicites,
- activation par défaut au niveau projet.

Toute activation doit être traçable.

## 10. Versioning et traçabilité des skills

Pour chaque run, le système doit pouvoir dire :

- quelles skills étaient disponibles,
- lesquelles ont été activées,
- avec quelle version,
- à quel moment,
- pour quelle raison.

Sans cette traçabilité, le comportement du runtime deviendra opaque.

## 11. Connaissance projet vs capacité opératoire

Cette distinction doit rester stricte.

### Connaissance projet

Ce que le système sait sur le contexte métier :

- fichiers,
- instructions,
- décisions passées,
- artefacts existants,
- références utiles.

### Capacité opératoire

La manière spécialisée d'agir :

- stratégie d'analyse,
- stratégie de restitution,
- contraintes de qualité,
- outils à privilégier,
- méthode de travail.

La première relève de la mémoire.

La seconde relève des skills.

## 12. Ce que `claw-code` apporte utilement

`claw-code` rappelle l'importance :

- d'une recherche hiérarchique de skills,
- d'une extensibilité du runtime,
- et d'un contexte produit à construire plutôt qu'à supposer.

Mais son modèle de skill reste encore trop proche d'un chargement d'instructions pour suffire à notre produit.

## 13. Risques à éviter

- transformer la mémoire en dump intégral du projet,
- utiliser trop tôt une base vectorielle partout sans besoin clair,
- confondre skill et source,
- laisser l'activation automatique des skills devenir imprévisible,
- ne pas tracer le contexte réellement injecté.

## 14. Position cible

Le bon modèle pour Cowork IA est :

- mémoire projet durable,
- mémoire de run structurée,
- contexte juste-à-temps,
- skills versionnées et traçables,
- séparation nette entre savoir et manière d'agir.

## 15. Statut d'implémentation actuel

Le dépôt implémente désormais une première matérialisation locale de cette stratégie via une couche de `contextual reasoning`.

Ce qui existe réellement :

- sélection juste-à-temps par `reasoning stage`,
- observations, guidelines, relations et variables résolues,
- snapshots de contexte persistés,
- traçabilité de l'injection de contexte sur les appels LLM du slice.

Ce qui reste partiel :

- activation de vraies `skills` paquetisées,
- mémoire projet plus riche que le périmètre actuel de run/projet,
- stratégie plus large de récupération et compression au-delà du slice autorisé.

Voir aussi :

- [contextual-reasoning-layer-v1.md](./contextual-reasoning-layer-v1.md)
