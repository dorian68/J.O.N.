# JON Capability Builder v1

## But

JON doit pouvoir traiter une mission comme un cowork adaptatif : comprendre le résultat attendu, vérifier ses capacités actuelles, détecter un manque, préparer la micro-capacité nécessaire, la tester, puis l'utiliser seulement si elle est prouvée.

Cette capacité ne doit pas transformer JON en système auto-modifiant non contrôlé. Le raisonnement peut être adaptatif, mais l'activation d'un nouvel outil doit rester gouvernée par preuves, permissions et rollback.

## Principe central

Boucle cible :

1. Mission utilisateur.
2. Intention et livrable vérifiable.
3. Sélection des capacités existantes.
4. Détection de gap si les capacités ne couvrent pas le livrable.
5. Proposition de micro-capacité.
6. Génération contrôlée d'un artefact candidat.
7. Tests sur fixture, snapshot ou surface autorisée.
8. Enregistrement en registre de skills/capacités.
9. Exécution uniquement si l'activation est autorisée.
10. Feedback mémoire avec succès, échec, limites et preuves.

## Niveaux de maturité

### v1 - Draft de capacité

JON peut :

- classifier le type de manque ;
- proposer une capacité candidate ;
- générer un manifeste de skill utilisateur en `draft` ;
- produire un plan de tests et des critères d'activation ;
- exposer la proposition via service/API.

JON ne peut pas encore :

- modifier le coeur runtime sans revue ;
- exécuter du code généré ;
- considérer un skill utilisateur comme opérationnel sans harness.

### v2 - Génération d'adaptateurs sûrs

JON pourra générer des artefacts bornés :

- parser DOM ;
- extracteur de tableau ;
- stratégie navigateur ;
- script local en workspace autorisé ;
- validateur de livrable.

Chaque artefact devra avoir :

- scope d'écriture explicite ;
- tests ;
- preuve de succès ;
- rollback ou désactivation ;
- registre de provenance.

### v3 - Activation contrôlée

Une capacité candidate devient utilisable seulement si :

- les tests passent ;
- le manifeste est valide ;
- la politique l'autorise ;
- l'utilisateur ou l'opérateur approuve si la capacité agit sur écran, fichiers, réseau, shell ou données sensibles ;
- un feedback post-run est enregistré.

## Types de gaps

- `web_data_adapter` : extraction de données web, parser de site, stratégie DOM.
- `desktop_app_adapter` : workflow pour application locale spécifique.
- `file_transform_adapter` : transformation locale de fichiers ou documents.
- `terminal_workflow_adapter` : commande ou workflow CLI gouverné.
- `verifier_adapter` : vérification de livrable insuffisante.
- `workflow_orchestrator` : enchaînement multi-outils non couvert.

## Contrat de proposition

Une proposition contient :

- `assessment` : gap détecté, confiance, capacités proches, raison.
- `capabilityKind` : type de micro-capacité.
- `problemStatement` : ce que JON ne sait pas encore faire.
- `proposedSkillManifest` : skill utilisateur brouillon, non exécutable.
- `implementationPlan` : étapes de création.
- `testPlan` : tests requis avant activation.
- `activationGates` : critères de passage.
- `safety` : ce qui est interdit sans approbation.
- `evidenceRequirements` : preuves attendues.

## Politique de sécurité

Par défaut :

- un skill généré est `draft`;
- aucune exécution de code généré n'est autorisée ;
- pas de modification du runtime core ;
- pas de shell caché ;
- pas de contournement des approvals ;
- les capacités créées doivent être désactivables.

## Premier chantier

Le chantier démarre par :

- module `capability-builder`;
- route/service de proposition ;
- tests de classification et de manifeste ;
- intégration avec le registre de skills utilisateur existant.

## Chantier lancé - Candidate workspace

Le premier niveau exécutable borné ajoute :

- un registre persistant de capacités candidates ;
- un dossier d'artefacts candidats sous runtime data ;
- un contrat déclaratif `capability.artifact.v1` ;
- un premier artefact `web_data_adapter.v1` ;
- des fixtures positive/négative générées avec le candidat ;
- un harness de validation fixture ;
- des statuts `candidate`, `validated`, `enabled`, `disabled`, `failed_validation` ;
- un kill switch par désactivation ;
- une exposition dans le graphe de capacités uniquement après validation et activation.

La génération reste volontairement déclarative : aucun JavaScript généré n'est exécuté. Le premier adaptateur web lit une surface DOM/HTML, extrait des lignes structurées et échoue si le nombre de lignes attendu n'est pas atteint.

Routes de contrôle :

- `POST /api/capabilities/candidates` : créer un candidat depuis une mission/gap.
- `GET /api/capabilities/candidates` : lister les candidats.
- `POST /api/capabilities/candidates/:id/validate` : exécuter le harness.
- `POST /api/capabilities/candidates/:id/enable` : activer après validation.
- `POST /api/capabilities/candidates/:id/disable` : désactiver.
- `POST /api/capabilities/candidates/:id/run-html` : exécuter l'adaptateur web sur HTML contrôlé.

Ce niveau rend la capacité utilisable pour des extractions HTML/DOM contrôlées. Il ne suffit pas encore pour une production complète sur sites réels : il faut encore brancher l'exécution live dans le runtime navigateur, ajouter des validations sur captures réelles et mesurer la fiabilité par domaine.

## Boucle de récupération post-run

JON déclenche maintenant une récupération lorsqu'un run échoue avec un livrable incomplet vérifiable, par exemple un navigateur ouvert mais une liste de résultats non extraite.

Boucle implémentée :

1. détecter `failed_incomplete_deliverable` ou une vérification `fail` liée à extraction/liste/résultat ;
2. construire une proposition de capacité depuis la mission et les checks échoués ;
3. générer un candidat `web_data_adapter.v1` ;
4. exécuter le harness de validation ;
5. auto-activer seulement si l'artefact est read-only, déclaratif, et validé par fixture ;
6. enregistrer `orchestrationRecovery` dans le run ;
7. poster un message conversationnel indiquant que la capacité de reprise est prête ;
8. exposer le candidat activé dans le graphe de capacités ;
9. préparer un retry plan `extract_structured_rows`.

Route de reprise manuelle :

- `POST /api/runs/:id/recover` : rejoue la récupération sur un run éligible qui n'a pas encore de récupération.

Les étapes suivantes seront :

- générateur d'artefacts candidats bornés ;
- harness de validation de micro-capacité ;
- mémoire de performance par capacité ;
- activation contrôlée post-validation.
