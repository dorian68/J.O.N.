# Computer Control Prototype Reassessment

## Statut

Decision document.

Ce document réévalue explicitement le prototype autorisé après la réintroduction officielle du `computer control` dans le produit.

Documents liés :
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-primitives.md](./computer-control-primitives.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [final-launch-decision.md](./final-launch-decision.md)

## Question

Le prototype doit-il :

- rester `browser-control only` ;
- ou devenir `browser + computer control` dans une forme bornée.

## Réponse nette

Le prototype ne doit plus rester `browser-control only`.

Il doit devenir :

- `browser-first`
- `DOM-first`
- avec une `computer-control foundation` bornée, observability-first.

## Pourquoi le browser-only n'est plus la bonne ligne

Le `browser-only` était une décision prudente.

Mais il créait une ambiguïté inutile :

- il laissait entendre que le `computer control` était hors produit ou purement lointain ;
- il risquait de repousser trop tard les problèmes de fenêtre, de focus, de preuve visible et d'état réel du poste ;
- il sous-estimait le fait qu'un `desktop coworker` doit déjà avoir une conscience minimale de l'environnement informatique local.

## Forme bornée admissible

Le `computer control` admissible dans le prototype est limité à :

- qualification de fenêtre active ;
- liste de fenêtres visibles utiles ;
- focus d'une fenêtre allowlistée ;
- capture de fenêtre ou région ;
- attente d'un état UI visible ;
- vérification d'outcome visible ;
- export de preuves.

## Ce qui n'entre toujours pas dans le prototype

N'entrent toujours pas dans le prototype :

- souris généralisée ;
- clavier généralisé ;
- hotkeys ;
- dialogues système réels ;
- automation locale multi-app ;
- upload via file picker ;
- actes engageants locaux.

## Effet sur la nature du prototype

Le prototype reste :

- centré navigateur ;
- centré mission et artefacts ;
- benchmarkable ;
- safe-by-default.

Mais il n'est plus défini comme `browser only`.

Il devient :

- `browser-first + bounded computer-control foundation`.

## Effet sur la preuve de valeur

Cette réintroduction apporte une meilleure cohérence produit :

- le prototype prouve déjà qu'on construit bien un coworker d'ordinateur ;
- la capacité est introduite par l'observation et l'audit, pas par la démonstration spectaculaire ;
- on prépare plus tôt la frontière browser/desktop sans tomber dans l'automation généralisée.

## Décision finale

Décision canonique :

- le `computer control` entre dans le prototype autorisé ;
- il y entre sous une forme `très bornée` ;
- le `browser control` reste prioritaire ;
- le premier build ne doit toujours pas implémenter une automation desktop générale.
