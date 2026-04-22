# Event taxonomy

## But du document

Définir la taxonomie des événements typés du futur runtime. Il ne s'agit pas d'un schéma d'implémentation, mais d'un langage système commun entre :

- le runtime,
- l'interface opérateur,
- l'audit,
- l'observabilité,
- les futures evals.

## Principes

- Un événement représente un fait système significatif.
- Un événement n'est pas un log libre.
- Les événements doivent être suffisamment précis pour reconstruire un run.
- Tous les événements n'ont pas la même importance pour l'UI, l'audit et l'observabilité.
- Les noms d'événements doivent rester stables même si l'implémentation évolue.

## Familles d'événements

- `run.*` : cycle de vie global d'un run.
- `plan.*` : production et révision du plan.
- `context.*` : préparation ou mise à jour du contexte.
- `tool.*` : proposition, exécution ou résultat d'un tool.
- `approval.*` : décisions utilisateur sur actions sensibles.
- `source.*` : enregistrement des sources consultées.
- `artifact.*` : production et évolution des artefacts.
- `error.*` : erreurs significatives.
- `recovery.*` : tentatives de reprise ou stratégies de dégradation.

## Taxonomie minimale recommandée

| Événement | Intention | Payload conceptuel minimal | Audit | UI | Observabilité |
| --- | --- | --- | --- | --- | --- |
| `run.created` | créer l'identité d'un run | `run_id`, `project_id`, `mission_spec`, `timestamp` | élevé | élevé | élevé |
| `run.started` | marquer le vrai départ d'exécution | `run_id`, `timestamp`, `operator_context` | moyen | élevé | élevé |
| `context.prepared` | signaler que le contexte initial est prêt | `run_id`, `context_snapshot_id`, `sources_selected`, `timestamp` | moyen | moyen | élevé |
| `plan.generated` | rendre visible le plan initial | `run_id`, `plan_id`, `steps`, `open_questions`, `timestamp` | élevé | élevé | élevé |
| `plan.revised` | signaler une révision substantielle du plan | `run_id`, `plan_id`, `reason`, `diff_summary`, `timestamp` | élevé | élevé | moyen |
| `step.started` | marquer le début d'une étape significative | `run_id`, `step_id`, `step_kind`, `label`, `timestamp` | moyen | élevé | élevé |
| `tool.proposed` | expliciter qu'un tool est envisagé | `run_id`, `step_id`, `tool_kind`, `intent`, `risk_level`, `timestamp` | élevé | moyen | moyen |
| `approval.requested` | bloquer le run sur une action sensible | `run_id`, `approval_id`, `action_summary`, `scope`, `risk_level`, `timestamp` | très élevé | très élevé | élevé |
| `approval.granted` | enregistrer un accord utilisateur | `run_id`, `approval_id`, `scope`, `granted_by`, `timestamp` | très élevé | élevé | moyen |
| `approval.denied` | enregistrer un refus utilisateur | `run_id`, `approval_id`, `reason`, `timestamp` | très élevé | élevé | moyen |
| `tool.executed` | signaler l'exécution d'un tool | `run_id`, `step_id`, `tool_call_id`, `result_summary`, `status`, `timestamp` | élevé | élevé | très élevé |
| `source.recorded` | rattacher une source à l'exécution | `run_id`, `source_id`, `source_type`, `origin`, `role`, `timestamp` | élevé | moyen | moyen |
| `artifact.created` | créer un nouvel artefact | `run_id`, `artifact_id`, `artifact_type`, `status`, `provenance_summary`, `timestamp` | élevé | très élevé | élevé |
| `artifact.revised` | signaler une nouvelle version ou révision | `run_id`, `artifact_id`, `version`, `reason`, `timestamp` | élevé | élevé | moyen |
| `run.paused` | suspendre le run proprement | `run_id`, `reason`, `resume_conditions`, `timestamp` | élevé | élevé | élevé |
| `run.resumed` | reprendre un run suspendu | `run_id`, `resume_source`, `timestamp` | élevé | élevé | moyen |
| `recovery.attempted` | tracer une stratégie de reprise | `run_id`, `failure_context`, `strategy`, `timestamp` | élevé | moyen | élevé |
| `run.failed` | clôturer un run en échec | `run_id`, `failure_class`, `dominant_cause`, `recoverable`, `timestamp` | très élevé | très élevé | très élevé |
| `run.completed` | clôturer un run terminé | `run_id`, `artifact_ids`, `completion_summary`, `timestamp` | élevé | très élevé | élevé |

## Précisions importantes par famille

## 1. Événements de run

Ils servent à répondre à la question : "où en est réellement cette mission ?"

Ils doivent permettre de distinguer :

- création,
- démarrage effectif,
- pause,
- reprise,
- clôture réussie,
- clôture en échec.

## 2. Événements de plan

Ils ne doivent pas être réduits à un seul snapshot textuel. Le système doit pouvoir montrer :

- le plan initial,
- ses révisions significatives,
- la raison d'une révision.

## 3. Événements de tool

La séparation `tool.proposed` / `tool.executed` est utile parce qu'elle permet de distinguer :

- l'intention d'action,
- le contrôle de risque,
- l'exécution réelle,
- son résultat.

Cette distinction est particulièrement importante pour les tools sensibles.

## 4. Événements d'approval

Ils sont indispensables pour relier :

- l'action envisagée,
- la décision humaine,
- la suite du run.

Un système d'approval non événementialisé devient très difficile à auditer.

## 5. Événements d'artefact

Ils sont indispensables pour distinguer :

- création d'un nouveau livrable,
- révision d'un livrable existant,
- statut de validation.

## Règles de qualité

Un événement valable doit être :

- attribuable à un run,
- horodaté,
- contextualisé,
- compréhensible hors du code,
- exploitable par l'UI.

Un événement doit éviter :

- les payloads opaques non interprétables,
- les messages purement textuels sans structure,
- la fusion de plusieurs faits système en un seul événement.

## Questions encore ouvertes

- Faut-il distinguer explicitement `tool.succeeded` et `tool.failed` au lieu d'un seul `tool.executed` avec statut ?
- Faut-il des événements dédiés à la consultation des sources par l'opérateur ?
- À quel niveau formaliser les événements de coût et de latence ?
- Faut-il un événement dédié au passage en mode dégradé ?

## Conséquence pour la suite

Cette taxonomie doit devenir la base de :

- la timeline opérateur,
- la reprise de run,
- les journaux d'audit,
- les benchmarks runtime,
- les futurs tableaux d'observabilité.

## Liens avec le reste du corpus

- Le cycle de vie général du runtime est décrit dans [runtime-agentique.md](./runtime-agentique.md).
- Les objets métier référencés par ces événements sont définis dans [workspaces-projets-artefacts.md](./workspaces-projets-artefacts.md).
- Les flows opérateur qui consomment ces événements sont décrits dans [operator-ux-flows.md](./operator-ux-flows.md).
- Les évaluations associées sont détaillées dans [evals-and-benchmarks.md](./evals-and-benchmarks.md).
