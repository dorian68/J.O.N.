# Prototype boundary v1

## But du document

Définir ce que doit être le premier prototype utile, et surtout ce qu'il ne doit pas prétendre être.

Le prototype n'a pas pour but de "montrer un maximum de capacités". Il a pour but de valider le cœur produit de façon honnête et testable.

## Rôle du prototype

Le prototype doit répondre à une question simple :

"Sommes-nous capables d'exécuter une mission bornée, sous supervision, avec vrais fichiers, approvals explicites, provenance visible et artefact exploitable ?"

S'il ne répond pas à cette question, il ne prépare pas correctement le build.

## Ce que le prototype doit faire

Le premier prototype utile doit couvrir une boucle courte mais complète :

- un projet local borné,
- une mission explicite,
- un run visible,
- un plan initial lisible,
- une exécution instrumentée,
- des approvals sur actions sensibles,
- un artefact final distinct du log,
- une trace suffisante pour revue après coup.

## Capacités minimales du prototype

### 1. Périmètre de travail

- mono-utilisateur,
- local-first,
- un projet clairement borné,
- pas de collaboration temps réel.

### 2. Scénarios couverts

Le prototype doit annoncer explicitement couvrir un sous-ensemble des [scénarios de référence](./scenarios-de-reference.md), idéalement :

- synthèse documentaire,
- rapport analytique tabulaire,
- enrichissement web borné,
- éventuellement tri de dossier réversible.

### 3. Capacités opératoires

- lecture fichiers projet,
- génération de plan,
- suivi de run,
- provenance de sources,
- création d'artefacts,
- approvals explicites,
- navigation navigateur en lecture bornée.

### 4. Sorties attendues

- note de synthèse,
- rapport analytique ou note de décision,
- journal de run intelligible,
- statut final clair.

## Ce que le prototype ne doit pas faire

- multi-agent généralisé,
- computer control large,
- connecteurs externes nombreux,
- actions externes irréversibles,
- envoi autonome d'emails,
- publication,
- shell libre hors cadrage strict,
- sync cloud structurante,
- marketplace de skills.

## Dette acceptable

Le prototype peut assumer certaines limites si elles sont explicites :

- nombre réduit de scénarios,
- ergonomie encore brute,
- formats d'export limités,
- artefacts éditables de façon minimale,
- connecteurs absents,
- style visuel non finalisé.

Ces dettes sont acceptables parce qu'elles n'altèrent pas la vérité du cœur produit.

## Dette non acceptable

Le prototype ne doit pas reposer sur :

- actions cachées non visibles par l'opérateur,
- permissions implicites non traçables,
- artefacts sans provenance,
- confusion entre log et livrable,
- fetch déguisé en vrai browser control,
- scénario de démo trop scripté pour être rejouable,
- absence de gestion d'erreur ou d'état bloqué,
- accès trop large accordé par commodité.

## Faux raccourcis à éviter

### 1. "Le chat suffit pour l'instant"

Faux. Si le prototype retombe dans une interaction conversationnelle sans run explicite, il invalide la proposition produit.

### 2. "On montrera le navigateur plus tard"

Faux. Le `browser control` fait partie de la proposition de valeur et doit être démontré dans un cadre borné.

### 3. "On mettra les approvals après"

Faux. Sans approvals, la future forme produit n'est pas testée.

### 4. "On peut simuler les artefacts avec la sortie du modèle"

Faux. Un artefact doit être un objet distinct, versionnable et relié aux sources.

### 5. "Le multi-agent rendra le tout plus impressionnant"

Faux. Il compliquera le diagnostic d'un système qui n'a pas encore prouvé son cœur.

## Critères d'honnêteté du prototype

Le prototype doit permettre à un observateur de répondre clairement à ces questions :

- quel scénario couvre-t-il ?
- quelles actions peut-il réellement faire ?
- quelles actions refuse-t-il ?
- quels sont ses points d'approval ?
- où sont les sources ?
- où sont les artefacts ?
- comment un run échoue-t-il ?

Si ces réponses ne sont pas visibles, le prototype est trompeur.

## Critères de sortie du prototype utile

- au moins deux scénarios MVP sont couverts de bout en bout,
- la différence entre plan, exécution, approvals et artefacts est visible,
- le système sait s'arrêter proprement sur un cas hors périmètre,
- les événements nécessaires à la relecture d'un run existent conceptuellement et sont exploitables,
- l'utilisateur peut revoir les sources ayant alimenté le livrable.

## Ce que ce document décide

- le premier prototype doit être étroit mais complet,
- il doit valider la boucle `mission -> run -> approvals -> artefact`,
- il ne doit pas sacrifier la sûreté ni l'audit pour paraître plus autonome,
- le multi-agent et le computer control large sont exclus de cette première frontière.

## Ce qui reste dépendant d'un prototype futur

- l'étendue exacte du `browser control`,
- la profondeur du rapport analytique,
- la granularité acceptable des approvals groupées,
- la qualité minimale d'édition des artefacts dans le shell.

## Liens avec le reste du corpus

- Les scénarios couverts sont définis dans [scenarios-de-reference.md](./scenarios-de-reference.md).
- Les capacités disponibles sont cartographiées dans [tooling-and-capabilities-map.md](./tooling-and-capabilities-map.md).
- Les évaluations attendues sont décrites dans [evals-and-benchmarks.md](./evals-and-benchmarks.md).
- Les anti-objectifs globaux sont détaillés dans [non-goals-and-kill-criteria.md](./non-goals-and-kill-criteria.md).
