# ADR-004 - Les permissions sont sûres par défaut, pas ouvertes par défaut

## Statut

Accepté

## Contexte

Le produit doit agir sur des fichiers, des applications et potentiellement des systèmes externes. Un mode d'accès large par défaut est incompatible avec :

- la confiance utilisateur,
- la réduction du risque,
- l'auditabilité,
- un usage professionnel durable.

## Décision

Les permissions par défaut sont restrictives :

- lecture bornée par projet ou workspace,
- écriture nécessitant des règles explicites,
- actions externes sensibles soumises à approbation,
- refus par défaut pour les opérations destructrices ou non justifiées.

## Conséquences

- la sûreté structure l'architecture dès le départ,
- la fatigue d'approbation doit être traitée intelligemment,
- la politique de permissions devient un objet produit à part entière,
- le système doit expliquer pourquoi une action est bloquée ou soumise à validation.

## Références

- [permissions-trust-safety.md](../permissions-trust-safety.md)
- [browser-and-computer-control.md](../browser-and-computer-control.md)
