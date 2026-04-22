# Next documents before prototype

## But du document

Constater s'il reste encore des documents strictement indispensables avant le prototype, puis lister seulement les prochains documents encore utiles après autorisation.

## Verdict

Il ne reste plus de document strictement indispensable avant le prototype, à condition que le build respecte :

- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)

## Indispensables

Aucun document supplémentaire n'est indispensable avant le prochain run de développement prototype.

Décision prise :

- la phase documentaire pré-build est suffisante pour lancer le prototype étroit autorisé.

## Fortement utiles ensuite

## 1. `runtime-event-payload-contracts.md`

Pourquoi utile :

- fermer les payloads minimaux utiles à l'UI, à l'audit et à la reprise ;
- réduire l'improvisation pendant le build.

Quand :

- utile très tôt pendant le prototype, mais non bloquant avant son démarrage.

## 2. `browser-domain-policy-registry-v1.md`

Pourquoi utile :

- fixer un registre canonique des domaines, types de surfaces et catégories d'actions ;
- préparer proprement l'extension future vers vraies plateformes.

Quand :

- non bloquant avant prototype ;
- utile avant élargissement du scope navigateur.

## 3. `browser-fixture-catalog-v1.md`

Pourquoi utile :

- convertir le plan de fixtures en inventaire opérationnel canonique ;
- aider à maintenir la discipline de benchmark.

Quand :

- utile pendant la première itération prototype ;
- non bloquant avant démarrage.

## 4. `operator-timeline-contract-v1.md`

Pourquoi utile :

- fermer la densité d'information minimale de la timeline opérateur ;
- éviter une timeline soit trop pauvre, soit trop verbeuse.

Quand :

- utile pendant le prototype ;
- plus important avant MVP.

## 5. `browser-external-validation-plan.md`

Pourquoi utile :

- cadrer l'entrée progressive sur plateformes externes sensibles sans court-circuiter les surfaces contrôlées.

Quand :

- non bloquant avant prototype ;
- bloquant avant validation réelle sur LinkedIn, Upwork ou équivalent.

## Facultatifs

## 6. `prototype-demo-review-checklist.md`

Utile pour éviter les démonstrations trompeuses, mais non bloquant si la gate et le protocole benchmark sont suivis strictement.

## 7. `skills-scope-v1.md`

Utile pour clarifier ce qui relève des capabilities noyau et ce qui relève des skills, mais non bloquant avant prototype.

## Conclusion

Le prochain run peut être un run de développement.

La documentation supplémentaire à produire ensuite doit servir à stabiliser l'itération prototype et préparer l'après-prototype, pas à retarder encore le démarrage.
