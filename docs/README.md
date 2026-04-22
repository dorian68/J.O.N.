# Documentation stratégique — Cowork IA

Ce dossier contient la base documentaire de référence pour concevoir un produit de type "desktop coworker IA" orienté outcome, livrables, approvals, contrôle navigateur/ordinateur et orchestration agentique.

Le but de cette documentation n'est pas de décrire un POC ou un simple CLI d'agents de code. Le but est de poser un cadre suffisamment solide pour guider plus tard l'architecture, le design produit, puis l'implémentation.

## Ce corpus est canonique

Les documents listés ci-dessous constituent la base de référence actuelle.

Les documents plus anciens présents dans `docs/` restent utiles comme traces d'exploration, mais ne doivent pas être traités comme le cadre final sans recoupement avec ce corpus.

## Ordre de lecture recommandé

1. [vision-produit-cowork.md](./vision-produit-cowork.md)
2. [analyse-reference-claw-code.md](./analyse-reference-claw-code.md)
3. [architecture-cible.md](./architecture-cible.md)
4. [workspaces-projets-artefacts.md](./workspaces-projets-artefacts.md)
5. [runtime-agentique.md](./runtime-agentique.md)
6. [permissions-trust-safety.md](./permissions-trust-safety.md)
7. [threat-model.md](./threat-model.md)
8. [browser-and-computer-control.md](./browser-and-computer-control.md)
9. [browser-control-spec.md](./browser-control-spec.md)
10. [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
11. [browser-control-primitives.md](./browser-control-primitives.md)
12. [browser-control-task-patterns.md](./browser-control-task-patterns.md)
13. [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
14. [browser-control-observability.md](./browser-control-observability.md)
15. [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
16. [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
17. [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
18. [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md)
19. [cahier-des-charges-browser-control.md](./cahier-des-charges-browser-control.md)
20. [computer-control-spec.md](./computer-control-spec.md)
21. [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
22. [computer-control-primitives.md](./computer-control-primitives.md)
23. [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
24. [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
25. [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)
26. [context-memory-skills.md](./context-memory-skills.md)
27. [scenarios-de-reference.md](./scenarios-de-reference.md)
28. [operator-ux-flows.md](./operator-ux-flows.md)
29. [mission-entry-contract-v1.md](./mission-entry-contract-v1.md)
30. [mission-understanding-and-routing-v1.md](./mission-understanding-and-routing-v1.md)
31. [mission-preflight-v1.md](./mission-preflight-v1.md)
32. [bounded-run-plan-v1.md](./bounded-run-plan-v1.md)
33. [mission-chain-orchestration-v1.md](./mission-chain-orchestration-v1.md)
34. [run-outcome-and-handoff-v1.md](./run-outcome-and-handoff-v1.md)
35. [artifact-contracts.md](./artifact-contracts.md)
36. [tooling-and-capabilities-map.md](./tooling-and-capabilities-map.md)
37. [event-taxonomy.md](./event-taxonomy.md)
38. [approval-policy-matrix.md](./approval-policy-matrix.md)
39. [evals-and-benchmarks.md](./evals-and-benchmarks.md)
40. [prototype-boundary-v1.md](./prototype-boundary-v1.md)
41. [prototype-slice-v1.md](./prototype-slice-v1.md)
42. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
43. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
44. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
45. [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
41. [multi-agent-reassessment.md](./multi-agent-reassessment.md)
42. [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md)
43. [agent-supervision-and-evaluation-loop.md](./agent-supervision-and-evaluation-loop.md)
44. [learning-and-improvement-boundary.md](./learning-and-improvement-boundary.md)
45. [claw-code-runtime-inspirations-for-agent-roles.md](./claw-code-runtime-inspirations-for-agent-roles.md)
46. [readiness-to-build-assessment.md](./readiness-to-build-assessment.md)
47. [missing-information-before-build.md](./missing-information-before-build.md)
48. [build-clarity-scorecard.md](./build-clarity-scorecard.md)
49. [next-documents-before-prototype.md](./next-documents-before-prototype.md)
50. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
51. [non-goals-and-kill-criteria.md](./non-goals-and-kill-criteria.md)
52. [final-coherence-and-launch-review.md](./final-coherence-and-launch-review.md)
53. [final-launch-decision.md](./final-launch-decision.md)
54. [development-guidelines-v1.md](./development-guidelines-v1.md)
55. [development-roadmap-v1.md](./development-roadmap-v1.md)
56. [implementation-readiness-checklist.md](./implementation-readiness-checklist.md)
57. [roadmap-produit.md](./roadmap-produit.md)
58. [open-questions.md](./open-questions.md)
59. [adr/ADR-001-reference-claw-code-is-runtime-inspiration-not-product-base.md](./adr/ADR-001-reference-claw-code-is-runtime-inspiration-not-product-base.md)
60. [adr/ADR-002-product-is-desktop-coworker-not-cli-agent.md](./adr/ADR-002-product-is-desktop-coworker-not-cli-agent.md)
61. [adr/ADR-003-typed-events-and-auditability-are-first-class.md](./adr/ADR-003-typed-events-and-auditability-are-first-class.md)
62. [adr/ADR-004-permissions-default-to-safe-not-full-access.md](./adr/ADR-004-permissions-default-to-safe-not-full-access.md)

## Carte des documents

### Vision et cadrage

- [vision-produit-cowork.md](./vision-produit-cowork.md) : nature du produit, promesse, cas d'usage centraux, différenciation, anti-objectifs.
- [analyse-reference-claw-code.md](./analyse-reference-claw-code.md) : ce que `claw-code` apporte réellement, ce qu'il faut reprendre, adapter, rejeter.
- [scenarios-de-reference.md](./scenarios-de-reference.md) : scénarios de vérité terrain pour prototype, evals et périmètre.
- [non-goals-and-kill-criteria.md](./non-goals-and-kill-criteria.md) : anti-objectifs et critères de rejet de mauvaises directions.

### Architecture et runtime

- [architecture-cible.md](./architecture-cible.md) : vue d'ensemble du futur système, blocs fonctionnels et interfaces conceptuelles.
- [runtime-agentique.md](./runtime-agentique.md) : moteur d'agent, cycle de vie d'un run, événements, permissions, recovery, héritage utile de `claw-code`.
- [llm-provider-clarity-audit.md](./llm-provider-clarity-audit.md) : audit ciblé sur le niveau réel de fermeture documentaire du sujet provider.
- [llm-provider-strategy.md](./llm-provider-strategy.md) : stratégie canonique de gateway, rôles modèles, fallback et configuration.
- [llm-runtime-contract.md](./llm-runtime-contract.md) : contrat normatif entre runtime produit et couche LLM.
- [prompt-registry-and-versioning.md](./prompt-registry-and-versioning.md) : gouvernance, versioning et rollback des prompts.
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md) : politique canonique de secrets, coûts, budgets et observabilité LLM.
- [contextual-reasoning-layer-v1.md](./contextual-reasoning-layer-v1.md) : état réel de la couche locale de reasoning contextualisé désormais implémentée.
- [browser-and-computer-control.md](./browser-and-computer-control.md) : besoins exacts de la couche navigateur et computer control.
- [tooling-and-capabilities-map.md](./tooling-and-capabilities-map.md) : carte des capacités produit nécessaires, séparée des outils concrets.
- [event-taxonomy.md](./event-taxonomy.md) : langage système des événements typés.
- [prototype-boundary-v1.md](./prototype-boundary-v1.md) : frontière explicite du premier prototype utile.
- [prototype-slice-v1.md](./prototype-slice-v1.md) : slice exact du prototype autorisé, avec capacités incluses, exclusions, critères d'acceptation et kill conditions.
- [multi-agent-reassessment.md](./multi-agent-reassessment.md) : réévaluation nette du choix mono-agent vs bi-agent pour le prototype.
- [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md) : rôles agentiques admissibles et effectivement retenus.
- [agent-supervision-and-evaluation-loop.md](./agent-supervision-and-evaluation-loop.md) : boucle exacte de supervision et de vérification retenue en V1.

### Browser control decision pack

- [browser-control-spec.md](./browser-control-spec.md) : document canonique principal de la capacité navigateur.
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md) : stratégie `DOM-first`, sélection robuste et frontière vers le fallback visuel.
- [browser-control-primitives.md](./browser-control-primitives.md) : primitives conceptuelles du moteur navigateur.
- [browser-control-task-patterns.md](./browser-control-task-patterns.md) : grands patterns de tâches web à couvrir.
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md) : matrice détaillée des approvals spécifiques au navigateur.
- [browser-control-observability.md](./browser-control-observability.md) : événements, preuves, traces et redaction utile.
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md) : modes d'échec, réponses attendues et règles d'arrêt.
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md) : plan canonique des fixtures et surfaces de test avant tout build navigateur.
- [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md) : limites de posture produit sur plateformes sensibles.
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md) : benchmarks formels pour la future validation.
- [cahier-des-charges-browser-control.md](./cahier-des-charges-browser-control.md) : cahier des charges consolidé quasi contractuel de la capacité.

### Computer control decision pack

- [computer-control-spec.md](./computer-control-spec.md) : document canonique principal de la capacité `computer control`.
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md) : hiérarchie et frontière d'usage entre navigateur et desktop.
- [computer-control-primitives.md](./computer-control-primitives.md) : primitives conceptuelles de la couche desktop.
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md) : garde-fous et approvals spécifiques.
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md) : benchmarks de base de la capacité.
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md) : décision sur la forme exacte du `computer control` dans le prototype.

### Modèle produit et données

- [workspaces-projets-artefacts.md](./workspaces-projets-artefacts.md) : objets métier, relations, persistance conceptuelle, reprise et export.
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md) : décisions fermées de persistance locale pour le prototype.
- [context-memory-skills.md](./context-memory-skills.md) : stratégie de contexte, mémoire de travail, mémoire persistante, skills et traçabilité.
- [contextual-reasoning-layer-v1.md](./contextual-reasoning-layer-v1.md) : matérialisation actuelle du raisonnement contextualisé dans le repo.
- [permissions-trust-safety.md](./permissions-trust-safety.md) : modèle de confiance, niveaux de risque, approvals, audit et garde-fous.
- [artifact-contracts.md](./artifact-contracts.md) : contrat des artefacts finaux, intermédiaires, temporaires et système.
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md) : quality bar fermée des artefacts retenus pour le prototype.
- [approval-policy-matrix.md](./approval-policy-matrix.md) : matrice opératoire des approvals.
- [operator-ux-flows.md](./operator-ux-flows.md) : flux de supervision opérateur et états système.
- [mission-entry-contract-v1.md](./mission-entry-contract-v1.md) : contrat canonique de la saisie de mission bornée actuellement implémentée.
- [mission-understanding-and-routing-v1.md](./mission-understanding-and-routing-v1.md) : compréhension de mission, routage interne conservateur, reconnaissance des missions hybrides et préparation du run courant.
- [mission-preflight-v1.md](./mission-preflight-v1.md) : revue de mission avant lancement, confirmation utilisateur et réutilisation du raisonnement structuré.
- [desktop-action-initiation-v1.md](./desktop-action-initiation-v1.md) : sous-slice canonique d'initiation d'action desktop autorisé pour le lancement d'un navigateur local, la recherche visible et la capture bornée associée.
- [general-desktop-control-cowork-strategy-v1.md](./general-desktop-control-cowork-strategy-v1.md) : stratégie produit et technique pour passer du cowork borné actuel à une autonomie desktop généraliste gouvernée.
- [governed-arbitrary-desktop-autonomy-v1.md](./governed-arbitrary-desktop-autonomy-v1.md) : contrat des niveaux d'autonomie desktop réglables, du mode supervisé au maximum gouverné, avec hard safety floor.
- [capability-graph-and-skills-v1.md](./capability-graph-and-skills-v1.md) : graphe interne persistant des capacités, adapters tool-provider, skills Explorer/Notepad/Browser et injection compacte dans le raisonnement.
- [desktop-autonomy-foundation-v1.md](./desktop-autonomy-foundation-v1.md) : fondation implémentée de contrôle desktop général gouverné, avec discovery d'apps, primitives approuvées, planner LLM et verification.
- [desktop-vision-semantic-action-targeting-v1.md](./desktop-vision-semantic-action-targeting-v1.md) : fondation actuelle de perception desktop, cibles sémantiques, checkpoints, recovery et limites honnêtes de l'OCR/vision.
- [agent-activity-ux-v1.md](./agent-activity-ux-v1.md) : surface UX qui rend visibles les étapes de raisonnement produit, d'action, d'approval et de verification sans exposer la chaîne de pensée brute.
- [conversation-first-cowork-ux-v1.md](./conversation-first-cowork-ux-v1.md) : décision UX canonique plaçant la conversation missionnelle comme surface user principale tout en gardant le runtime borné et auditable.
- [bounded-run-plan-v1.md](./bounded-run-plan-v1.md) : plan borné du run courant, suggestions honnêtes de runs suivants et clarification ciblée.
- [mission-chain-orchestration-v1.md](./mission-chain-orchestration-v1.md) : orchestration multi-run bornée, auto-continuation opt-in et décision de handoff gouvernée par le raisonnement de l'agent.
- [run-outcome-and-handoff-v1.md](./run-outcome-and-handoff-v1.md) : restitution produit du run fini, décision de handoff et préparation honnête du meilleur next step.
- [user-and-admin-surfaces-v1.md](./user-and-admin-surfaces-v1.md) : séparation canonique entre home user mission-first et console admin secondaire.
- [operator-token-dashboard-v1.md](./operator-token-dashboard-v1.md) : cockpit opérateur de consommation token/coût et de gouvernance LLM.
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md) : contrat UX exact des approvals pour le prototype.

### Pilotage du projet

- [threat-model.md](./threat-model.md) : premier modèle de menace du produit.
- [evals-and-benchmarks.md](./evals-and-benchmarks.md) : logique d'évaluation future et benchmarks ancrés dans les scénarios.
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md) : protocole humain canonique pour juger honnêtement les benchmarks prototype.
- [learning-and-improvement-boundary.md](./learning-and-improvement-boundary.md) : frontière explicite des formes d'apprentissage et d'amélioration admissibles.
- [claw-code-runtime-inspirations-for-agent-roles.md](./claw-code-runtime-inspirations-for-agent-roles.md) : traduction ciblée des inspirations runtime de `claw-code` pour l'architecture des rôles.
- [readiness-to-build-assessment.md](./readiness-to-build-assessment.md) : verdict honnête sur le niveau de clarté actuel avant build.
- [missing-information-before-build.md](./missing-information-before-build.md) : liste structurée des manques réels avant prototype.
- [build-clarity-scorecard.md](./build-clarity-scorecard.md) : scorecard exigeante du niveau de clarté par dimension.
- [next-documents-before-prototype.md](./next-documents-before-prototype.md) : liste minimale des prochains documents utiles avant autorisation de build.
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md) : gate formelle d'autorisation ou de refus du prototype navigateur.
- [final-coherence-and-launch-review.md](./final-coherence-and-launch-review.md) : revue finale de cohérence du corpus et des tensions résiduelles.
- [final-launch-decision.md](./final-launch-decision.md) : décision finale d'autorisation ou de refus de lancement du développement.
- [development-guidelines-v1.md](./development-guidelines-v1.md) : règles normatives à suivre pendant le build.
- [development-roadmap-v1.md](./development-roadmap-v1.md) : feuille de route d'exécution du prototype autorisé.
- [implementation-readiness-checklist.md](./implementation-readiness-checklist.md) : checklist go/no-go pré-dev et pré-démo interne.
- [roadmap-produit.md](./roadmap-produit.md) : progression réaliste du projet, phases, risques, critères de sortie.
- [open-questions.md](./open-questions.md) : sujets non tranchés, classés par priorité, avec validations futures à prévoir.
- [adr/](./adr/) : décisions d'architecture déjà stabilisées à ce stade.

## Canonical definitions

- `Artefact` est le terme métier canonique. Le mot `artifact` n'apparaît que dans certains noms de fichiers.
- `Run` est l'unité canonique d'exécution supervisée. Ce n'est ni une simple conversation, ni une simple session technique.
- `Approval` est l'objet canonique de décision utilisateur sur une action sensible.
- `Browser control` désigne le pilotage d'un vrai navigateur et reste distinct de `web fetch/search`.
- `Computer control` est le terme produit privilégié pour une interaction desktop bornée. `Computer use` peut apparaître comme terme générique du domaine, mais il ne doit pas brouiller la frontière produit.

## Lexique minimal

- `Workspace` : environnement persistant de travail, lié à un périmètre de fichiers, de connecteurs, de permissions et de mémoire.
- `Projet` : contexte métier ou dossier de travail à l'intérieur d'un workspace.
- `Run` : exécution agentique complète déclenchée à partir d'un objectif.
- `Tâche` : unité de travail interne à un run, humaine ou agentique.
- `Artefact` : livrable produit par un run, versionné et exportable.
- `Tool` : capacité exécutable du système, locale ou distante.
- `Skill` : paquet de capacité opératoire, composé d'instructions, de ressources, de contraintes et éventuellement d'outils autorisés.
- `Approval` : décision utilisateur sur une action sensible.
- `Source` : élément consulté ou utilisé pendant un run, interne ou externe.
- `Session` : continuité conversationnelle et opérationnelle du runtime; ce n'est pas l'objet métier principal côté produit.

## Documents les plus décisionnels

- [vision-produit-cowork.md](./vision-produit-cowork.md)
- [architecture-cible.md](./architecture-cible.md)
- [runtime-agentique.md](./runtime-agentique.md)
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- [permissions-trust-safety.md](./permissions-trust-safety.md)
- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)
- [scenarios-de-reference.md](./scenarios-de-reference.md)
- [approval-policy-matrix.md](./approval-policy-matrix.md)
- [prototype-boundary-v1.md](./prototype-boundary-v1.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [multi-agent-reassessment.md](./multi-agent-reassessment.md)
- [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md)
- [agent-supervision-and-evaluation-loop.md](./agent-supervision-and-evaluation-loop.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [non-goals-and-kill-criteria.md](./non-goals-and-kill-criteria.md)

## LLM provider strategy

- [llm-provider-clarity-audit.md](./llm-provider-clarity-audit.md) : diagnostic franc de l'état documentaire avant fermeture.
- [llm-provider-strategy.md](./llm-provider-strategy.md) : document canonique principal sur la stratégie provider LLM.
- [llm-runtime-contract.md](./llm-runtime-contract.md) : frontières d'usage du LLM dans le runtime produit.
- [prompt-registry-and-versioning.md](./prompt-registry-and-versioning.md) : registre, versioning, review et rollback des prompts.
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md) : décisions fermées sur secrets, coûts et observabilité.
- [token-consumption-governance.md](./token-consumption-governance.md) : politique canonique de maîtrise de consommation, compaction, reuse, suppression et dégradation par stage.

## Ordre de lecture minimal de la sous-partie LLM provider

1. [llm-provider-clarity-audit.md](./llm-provider-clarity-audit.md)
2. [llm-provider-strategy.md](./llm-provider-strategy.md)
3. [llm-runtime-contract.md](./llm-runtime-contract.md)
4. [prompt-registry-and-versioning.md](./prompt-registry-and-versioning.md)
5. [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
6. [token-consumption-governance.md](./token-consumption-governance.md)
7. [runtime-agentique.md](./runtime-agentique.md)
8. [architecture-cible.md](./architecture-cible.md)

## À lire avant tout prototype

1. [vision-produit-cowork.md](./vision-produit-cowork.md)
2. [architecture-cible.md](./architecture-cible.md)
3. [workspaces-projets-artefacts.md](./workspaces-projets-artefacts.md)
4. [runtime-agentique.md](./runtime-agentique.md)
5. [permissions-trust-safety.md](./permissions-trust-safety.md)
6. [threat-model.md](./threat-model.md)
7. [scenarios-de-reference.md](./scenarios-de-reference.md)
8. [event-taxonomy.md](./event-taxonomy.md)
9. [approval-policy-matrix.md](./approval-policy-matrix.md)
10. [prototype-boundary-v1.md](./prototype-boundary-v1.md)
11. [computer-control-spec.md](./computer-control-spec.md)
12. [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
13. [prototype-slice-v1.md](./prototype-slice-v1.md)
14. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
15. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
16. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
17. [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
18. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)

## Ordre de lecture conseillé pour la sous-partie browser control

1. [browser-and-computer-control.md](./browser-and-computer-control.md)
2. [browser-control-spec.md](./browser-control-spec.md)
3. [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
4. [browser-control-primitives.md](./browser-control-primitives.md)
5. [browser-control-task-patterns.md](./browser-control-task-patterns.md)
6. [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
7. [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md)
8. [browser-control-observability.md](./browser-control-observability.md)
9. [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
10. [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
11. [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
12. [cahier-des-charges-browser-control.md](./cahier-des-charges-browser-control.md)

## Ordre de lecture conseillé pour la sous-partie computer control

1. [browser-and-computer-control.md](./browser-and-computer-control.md)
2. [computer-control-spec.md](./computer-control-spec.md)
3. [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
4. [computer-control-primitives.md](./computer-control-primitives.md)
5. [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
6. [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
7. [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)
8. [prototype-slice-v1.md](./prototype-slice-v1.md)
9. [final-launch-decision.md](./final-launch-decision.md)

## Les plus importants avant un prototype navigateur

- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
- [cahier-des-charges-browser-control.md](./cahier-des-charges-browser-control.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)

## Build readiness

- [readiness-to-build-assessment.md](./readiness-to-build-assessment.md)
- [missing-information-before-build.md](./missing-information-before-build.md)
- [build-clarity-scorecard.md](./build-clarity-scorecard.md)
- [next-documents-before-prototype.md](./next-documents-before-prototype.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

## Launch decision

- [final-coherence-and-launch-review.md](./final-coherence-and-launch-review.md)
- [final-launch-decision.md](./final-launch-decision.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)
- [development-roadmap-v1.md](./development-roadmap-v1.md)
- [implementation-readiness-checklist.md](./implementation-readiness-checklist.md)

## Implementation compliance / release gate

- [contextual-reasoning-layer-v1.md](./contextual-reasoning-layer-v1.md) : couche reasoning effectivement codée, ses frontières et ses reports.
- [minimal-desktop-shell-foundation.md](./minimal-desktop-shell-foundation.md) : réalité de la shell locale actuelle, volontairement fine et remplaçable.
- [bounded-real-surface-validation-harness.md](./bounded-real-surface-validation-harness.md) : harness repo-feasible pour préparer et enregistrer des validations bornées.
- [external-validation-execution-pack.md](./external-validation-execution-pack.md) : pack opérateur exécutable pour les validations externes restantes.
- [local-release-hardening-status.md](./local-release-hardening-status.md) : état réel du hardening repo-feasible maintenant présent.
- [implementation-vs-docs-traceability-matrix.md](./implementation-vs-docs-traceability-matrix.md) : matrice de traçabilité entre exigences canoniques et code réellement présent.
- [unmet-requirements-and-deviations.md](./unmet-requirements-and-deviations.md) : liste des écarts restants, classés par impact de readiness.
- [release-gate-v1.md](./release-gate-v1.md) : gate final du slice autorisé, avec vert/jaune/rouge et verdict de release.
- [final-slice-completion-verdict.md](./final-slice-completion-verdict.md) : verdict honnête sur complétion du slice, respect du corpus et niveaux de readiness.

## Windows-first pilot posture

- Le repo vise maintenant un `stronger local build` côté Windows, pas une simple fermeture de prototype.
- Les commandes opérateur utiles sont :
  - `npm run pilot:prepare`
  - `npm run pilot:validate`
  - `npm run pilot:summary`
  - `npm run readiness:execute`
- La classification courante est stockée dans `app/.runtime-data/release/readiness-report-latest.json`.
- Tant que `live-success` et les validations bornées réelles ne sont pas passées et enregistrées, le build ne doit pas être décrit comme `pilot-credible`.

## Ordre minimal avant décision de release interne

1. [final-launch-decision.md](./final-launch-decision.md)
2. [prototype-slice-v1.md](./prototype-slice-v1.md)
3. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
4. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
5. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
6. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
7. [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
8. [implementation-vs-docs-traceability-matrix.md](./implementation-vs-docs-traceability-matrix.md)
9. [unmet-requirements-and-deviations.md](./unmet-requirements-and-deviations.md)
10. [release-gate-v1.md](./release-gate-v1.md)
11. [final-slice-completion-verdict.md](./final-slice-completion-verdict.md)

## Ordre minimal avant le premier run de dev

1. [final-launch-decision.md](./final-launch-decision.md)
2. [development-guidelines-v1.md](./development-guidelines-v1.md)
3. [implementation-readiness-checklist.md](./implementation-readiness-checklist.md)
4. [prototype-slice-v1.md](./prototype-slice-v1.md)
5. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
6. [computer-control-spec.md](./computer-control-spec.md)
7. [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
8. [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
9. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
10. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
11. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
12. [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
13. [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
14. [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md)
15. [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
16. [development-roadmap-v1.md](./development-roadmap-v1.md)

## Principes directeurs

- Le produit cible est un `desktop coworker`, pas un terminal augmenté.
- La valeur principale est le `travail terminé`, pas la conversation.
- Les `artefacts`, `approvals`, `audit logs` et `runs` sont des primitives produit, pas des détails d'implémentation.
- Le `browser control` et le `computer control` demandent une couche spécifique; ils ne peuvent pas être réduits à du simple fetch HTTP ou à quelques commandes shell.
- Le multi-agent est une évolution possible, mais le système doit rester lisible et utile avec un agent principal très fiable.

## Documents exploratoires antérieurs

Ces documents restent disponibles comme matériau de travail initial :

- [cahier-des-charges-v1.md](./cahier-des-charges-v1.md)
- [stack-technique-v1.md](./stack-technique-v1.md)
- [vision-produit.md](./vision-produit.md)
- [modele-de-permissions.md](./modele-de-permissions.md)
- [spec-outils-browser-desktop.md](./spec-outils-browser-desktop.md)
- [backlog-mvp.md](./backlog-mvp.md)
- [decisions-ouvertes.md](./decisions-ouvertes.md)

Ils doivent être lus comme précurseurs du corpus actuel, pas comme sa source canonique.
