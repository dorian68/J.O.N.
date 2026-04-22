# Final Coherence And Launch Review

## Statut

Decision review document.

Ce document clôt la revue de cohérence globale du corpus avant lancement du développement. Il ne remplace pas les documents canoniques existants. Il dit si, pris ensemble, ils forment une base suffisamment cohérente pour autoriser un prototype.

Documents liés :
- [README.md](./README.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)
- [development-roadmap-v1.md](./development-roadmap-v1.md)
- [implementation-readiness-checklist.md](./implementation-readiness-checklist.md)

## Réponse courte

### 1. Est-ce que l'ensemble est cohérent ?

Oui, `sous conditions`.

Le corpus est cohérent si la hiérarchie canonique est respectée. Il ne l'est pas si tous les `.md` sont lus comme équivalents ou si les documents exploratoires et les documents canoniques sont mélangés sans priorité explicite.

### 2. Est-ce que tout cela fait sens comme produit et comme prototype ?

Oui.

Le produit fait sens comme `desktop coworker` orienté `runs`, `approvals`, `artefacts`, `preuves` et `browser control`. Le prototype fait sens parce qu'il ne cherche plus à prouver l'autonomie générale, mais un slice réel, borné et benchmarkable.

### 3. Est-ce qu'on peut maintenant lancer la phase de développement ?

Oui, `sous conditions finales strictes`.

Le périmètre autorisé reste celui de [prototype-slice-v1.md](./prototype-slice-v1.md). Tout élargissement implicite retire l'autorisation.

## Verdict global

Verdict d'architecte :

- `cohérent sous conditions`

Ce verdict signifie :

- la base documentaire est suffisamment claire pour lancer un prototype borné ;
- les tensions restantes sont connues et contrôlables ;
- les risques principaux viennent maintenant d'une dérive de build, pas d'un manque majeur de vision ;
- le succès dépend de la discipline de mise en oeuvre, pas d'un nouveau chantier de cadrage général.

## Lecture correcte du corpus

Le corpus ne doit pas être lu comme un ensemble plat.

Ordre de force documentaire :

1. [final-launch-decision.md](./final-launch-decision.md)
2. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
3. [prototype-slice-v1.md](./prototype-slice-v1.md)
4. [development-guidelines-v1.md](./development-guidelines-v1.md)
5. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md)
6. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
7. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md)
8. [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)
9. [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md)
10. [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
11. [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md)
12. le reste du corpus canonique
13. les documents exploratoires antérieurs

Si cette hiérarchie n'est pas respectée, des contradictions apparentes réapparaîtront.

## Revue par dimension

| Dimension | Verdict | Ce qui est solide | Tension résiduelle | Risque si on build mal |
| --- | --- | --- | --- | --- |
| Produit | Clair | Positionnement `desktop coworker`, pas chat, pas CLI d'agents | Tentation de dériver vers un navigateur autonome plus large | Prototype trompeur, hors promesse réelle |
| Prototype V1 | Clair | Slice étroit, utile, benchmarkable, `browser-first` avec `computer control` borné | Tentation d'ajouter auth, upload, submit, actuation desktop générale ou plateformes réelles trop tôt | Mauvaise V1, scope creep |
| Runtime | Suffisamment clair | `run`, événements typés, approvals, rôles internalisés, recovery | Payloads précis encore non contractés au niveau champ par champ | Implémentation hétérogène si l'équipe improvise |
| Browser control | Clair pour V1 | `DOM-first`, surfaces contrôlées, outcome verification, evidence | Les docs browser couvrent plus large que le slice autorisé | Débordement vers capacités non autorisées |
| Computer control | Clair pour V1 | Officiel dans le produit, borné dans le prototype, orienté focus/preuve | Risque de redevenir une voie primaire par facilité | Opaque desktop automation |
| Approvals | Clair pour V1 | Contrat UX net, safe-by-default, write intent gouverné | Risque de granularité trop fine ou trop pauvre | Fatigue, surprise opérateur, perte de confiance |
| Artefacts | Clair pour V1 | Deux artefacts fermés, rubrics explicites | Le corpus global parle d'une taxonomie plus large | Confusion entre produit cible et prototype |
| Persistance | Suffisamment claire | Minimisation, restart-safe, interdictions explicites | Niveau exact de certains manifests encore à préciser au build | Fuite de données, état opaque |
| Benchmarks et fixtures | Fort | Philosophy, tiers, fixture families, review protocol | Les fixtures doivent encore être matérialisées en dev | Démo non testable, succès cosmétique |
| Sécurité / policy | Fort | Menaces connues, limites plateformes, non-goals clairs | Registre de policy par domaine encore implicite | Violations de posture produit |
| Modèle agentique | Fermé pour V1 | Mono-agent supervisé, rôles internalisés, pas de second agent | Tentation de rouvrir le bi-agent pendant le build | Opacité runtime, benchmarks plus flous |

## Cohérence produit

Le corpus raconte désormais la même histoire produit dans presque tous les documents canoniques :

- le système n'est pas un simple assistant conversationnel ;
- le système n'est pas un simple CLI de code ;
- le produit cible délivre un travail supervisé, traçable, orienté outcome ;
- le navigateur est une capacité centrale, mais pas un prétexte à construire un bot opaque ;
- le `computer control` fait partie du produit, mais reste hiérarchiquement subordonné au `DOM-first` quand le DOM est disponible.

Cette cohérence est réelle.

Le principal risque n'est plus doctrinal. Il est opérationnel : chercher à montrer trop tôt des usages séduisants mais hors du slice.

## Cohérence runtime

La cohérence runtime est suffisante pour un prototype :

- un `run` est bien défini comme unité centrale ;
- l'approval est bien un objet de décision produit, pas juste une boîte de dialogue ;
- les événements typés, la vérification d'outcome, la reprise et l'audit ont une place claire ;
- la réévaluation `mono-agent vs bi-agent` a refermé une ambiguïté importante.

Ce qui manque encore n'empêche pas le prototype :

- un contrat détaillé de payload par type d'événement ;
- une formalisation encore plus fine de la timeline opérateur.

Ces points sont `non bloquants avant prototype`, mais `bloquants avant MVP sérieux`.

## Cohérence browser control

La sous-architecture navigateur est le bloc le plus détaillé du corpus. C'est une force.

La cohérence tient parce que :

- [browser-control-spec.md](./browser-control-spec.md) décrit la capacité générale ;
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md) ferme la logique `DOM-first` ;
- [browser-control-primitives.md](./browser-control-primitives.md) définit les primitives conceptuelles ;
- [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md) évite le piège d'un prototype non testable ;
- [prototype-slice-v1.md](./prototype-slice-v1.md) réduit explicitement cette surface à un sous-ensemble.

Tension acceptable mais réelle :

- le pack browser documente plus large que ce qui est autorisé dans le prototype.

Cette tension n'est pas une contradiction tant que la règle suivante est respectée :

- `le slice fermé prime sur la spec large`

## Cohérence approvals

Le corpus est cohérent sur le fond :

- safe-by-default ;
- lecture simple sur surface autorisée sans friction excessive ;
- write intent sous approval explicite ;
- actes engageants hors scope prototype.

La cohérence dépend toutefois d'une règle de précédence :

- [operator-approval-ux-contract.md](./operator-approval-ux-contract.md) prime sur les matrices plus générales si une ambiguïté subsiste.

Sans cette règle, il serait facile d'élargir silencieusement ce qui devient auto-approuvable.

## Cohérence artefacts

La cohérence artefact est bonne à deux niveaux :

- niveau produit : taxonomie plus large d'artefacts possibles ;
- niveau prototype : deux artefacts seulement, avec rubrics fermées.

Tension acceptable :

- [artifact-contracts.md](./artifact-contracts.md) décrit un univers plus vaste ;
- [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md) ferme les attentes V1.

Il faut préserver cette hiérarchie. Sinon le prototype dérivera vers des livrables décoratifs.

## Cohérence persistance

Le corpus est suffisamment cohérent sur la persistance, et plutôt mature pour un prototype :

- minimisation par défaut ;
- persistence locale utile ;
- séparation entre ce qui survit au redémarrage et ce qui reste session-only ;
- interdiction explicite de conserver secrets, cookies, sessions auth et dumps bruts excessifs.

Angle mort résiduel :

- la granularité finale des manifests de preuves peut encore être mal exécutée si le build n'est pas discipliné.

Ce n'est pas un manque documentaire critique. C'est un risque d'implémentation.

## Cohérence benchmarks / fixtures

Le corpus est plus sérieux que beaucoup de projets à ce stade :

- scénarios de référence ;
- benchmark pack ;
- protocole humain de review ;
- plan de fixtures et de failure injection ;
- frontière claire entre surfaces synthétiques, sandbox réalistes et plateformes externes.

C'est un vrai point fort.

Le risque principal est inverse :

- se croire prêt parce que les benchmarks sont bien écrits, alors qu'ils ne sont pas encore matérialisés.

Autrement dit :

- la pensée d'évaluation est prête ;
- la matérialisation de l'environnement de test doit devenir le premier chantier du build.

## Cohérence sécurité / policy

Le corpus est cohérent et conservateur :

- pas de stealth ;
- pas de CAPTCHA bypass ;
- pas de credential harvesting ;
- pas de spam de masse ;
- pas de contournement des plateformes ;
- pas de soumission ou publication en V1 ;
- pas de persistance excessive.

Cette posture est saine.

Le seul danger est d'abandonner cette discipline pour rendre une démo plus impressionnante.

## Cohérence du modèle agentique

La réévaluation a été utile.

Le modèle retenu est cohérent parce qu'il capture la vraie nuance :

- un seul agent agit ;
- la vérification, la policy et la revue d'artefact existent vraiment ;
- mais elles sont internalisées comme rôles et checkpoints, pas comme agents autonomes.

Cette décision est compatible avec :

- l'audit ;
- les benchmarks ;
- la lisibilité opérateur ;
- la fermeture du slice ;
- l'héritage utile de `claw-code` sur la séparation des responsabilités.

## Contradictions et tensions identifiées

### Tensions acceptables

- Le pack browser décrit plus large que le slice prototype.
- Le corpus artefact décrit plus large que les artefacts V1 retenus.
- Le plan de fixtures couvre des cas auth synthétiques alors que les workflows auth réels restent hors scope.
- Certains fichiers plus anciens restent présents dans `docs/` mais ne sont plus normatifs.

Ces tensions sont acceptables si le build respecte la hiérarchie canonique.

### Contradictions non bloquantes mais à surveiller

- Vocabulaire mixte français/anglais dans plusieurs documents.
- Certains documents parlent en logique produit cible, d'autres en logique prototype fermé.

Ce n'est pas bloquant, mais cela justifie une règle simple :

- `pour le développement, les documents de launch et de slice priment sur tout le reste`

### Contradictions bloquantes

Aucune contradiction bloquante majeure n'a été identifiée après la fermeture opérationnelle et la réévaluation mono-agent.

## Glissements de périmètre les plus probables

Les glissements les plus dangereux sont désormais connus :

- réintroduire LinkedIn, Upwork ou d'autres plateformes sensibles comme terrain principal trop tôt ;
- ajouter login, upload, rich editors, submit ou publish pour rendre la démo plus spectaculaire ;
- laisser le fallback visuel devenir le mécanisme dominant ;
- réintroduire un agent vérificateur autonome au milieu du build ;
- élargir silencieusement la persistance locale ;
- traiter une réussite cosmétique comme une réussite benchmarkée.

## Conclusion finale

Conclusion d'architecte :

- le corpus est `cohérent sous conditions` ;
- le prototype autorisé `fait sens` ;
- la phase de développement peut commencer `si et seulement si` les documents de lancement, de gate, de slice, d'approvals, de persistance et de benchmarks restent prioritaires pendant le build.

Le projet n'a plus besoin d'un nouveau tour de cadrage général.

Il a besoin d'un build discipliné, benchmark-first, evidence-first, et très strict sur la non-dérive de scope.
