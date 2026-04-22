# ADR-003 - Les événements typés et l'auditabilité sont de première classe

## Statut

Accepté

## Contexte

Le produit doit piloter des actions réelles et produire des livrables auditables. Des logs textuels flous ne suffisent pas pour :

- comprendre une exécution,
- expliquer un échec,
- justifier une action sensible,
- reprendre un run interrompu,
- analyser le comportement du système.

## Décision

Le runtime doit reposer sur des événements typés, persistés et exploitables par :

- l'interface utilisateur,
- le moteur d'audit,
- les mécanismes de reprise,
- les outils d'évaluation,
- les futures capacités de supervision multi-agent.

## Conséquences

- la modélisation des événements arrive tôt dans l'architecture,
- l'audit n'est pas une couche ajoutée après coup,
- les permissions et approvals s'appuient sur le même journal d'événements,
- la dette de debug et de conformité diminue fortement.

## Références

- [runtime-agentique.md](../runtime-agentique.md)
- [permissions-trust-safety.md](../permissions-trust-safety.md)
