# ADR-001 - `claw-code` est une inspiration runtime, pas une base produit

## Statut

Accepté

## Contexte

`claw-code` apporte des idées utiles sur le runtime agentique :

- gestion de session,
- exécution d'outils,
- événements typés,
- permissions,
- hooks et extensions,
- récupération après erreur.

Mais le produit cible n'est pas un CLI d'agents de code. C'est un coworker desktop orienté outcomes, projets, approvals, navigateur, fichiers et artefacts.

## Décision

Nous considérons `claw-code` comme une référence de conception pour certaines couches runtime, et non comme un squelette direct du produit.

## Conséquences

- nous réutilisons des principes, pas la forme produit,
- nous évitons de dériver vers un simple harness CLI avec UI,
- les couches absentes chez `claw-code` restent à concevoir explicitement,
- toute inspiration issue de `claw-code` doit être revalidée au regard du produit cible.

## Références

- [analyse-reference-claw-code.md](../analyse-reference-claw-code.md)
- [vision-produit-cowork.md](../vision-produit-cowork.md)
