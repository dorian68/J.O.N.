# ADR-002 - Le produit est un desktop coworker, pas un agent CLI

## Statut

Accepté

## Contexte

Une ambiguïté structurante existe entre trois formes de produit :

- assistant conversationnel,
- agent CLI orienté développement logiciel,
- coworker desktop orienté livrables et délégation de travail.

Le projet vise explicitement la troisième catégorie.

## Décision

Le produit sera conçu autour de :

- projets et workspaces,
- runs supervisés,
- approvals,
- artefacts versionnés,
- contrôle du navigateur et des fichiers,
- orientation outcome plutôt que conversationnelle.

## Conséquences

- l'UX ne doit pas dériver vers un simple chat,
- les artefacts sont des objets de première classe,
- le navigateur et les approvals sont des couches structurantes,
- les choix techniques seront évalués selon leur contribution à cette forme produit.

## Références

- [vision-produit-cowork.md](../vision-produit-cowork.md)
- [architecture-cible.md](../architecture-cible.md)
