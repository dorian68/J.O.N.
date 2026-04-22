# LLM Secrets, Costs, And Observability

## Statut

Normative operational document.

Ce document ferme les decisions sur :
- secrets,
- credentials provider,
- couts et budgets,
- erreurs provider,
- journaux utiles,
- et redaction.

Documents lies :
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [token-consumption-governance.md](./token-consumption-governance.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [threat-model.md](./threat-model.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)

## 1. Secrets posture

### Decision

Les credentials provider sont `runtime-only`.

Cela signifie :
- jamais dans l'UI ;
- jamais dans le navigateur ;
- jamais dans un projet ;
- jamais dans un artifact ;
- jamais dans un prompt.

### Stockage autorise

Ordre de preference :
1. coffre systeme / keychain / secret store local
2. variable d'environnement locale de dev
3. fichier local ignore en dernier recours borne de dev

Statut d'implementation actuel :

- Windows : un stockage local protege par DPAPI `CurrentUser` est disponible dans le repo via la couche `os-secret-store` ;
- fallback : si ce stockage n'est pas disponible ou ne peut pas etre prouve dans l'environnement courant, le runtime peut encore resoudre la cle depuis l'environnement ;
- metadata locale : `.env.local` / `app/.env.local` peuvent porter les metadonnees provider non secretes et, en fallback borne de dev, une cle locale ignoree du VCS ;
- la source resolue reste visible uniquement comme metadonnee publique (`os_secret_store`, `env`, `local_env_file`, `missing`) ;
- aucune valeur secrete n'est exposee a l'UI ou persistee en clair.

Interdit par defaut :
- fichier projet versionne ;
- configuration persistante en clair ;
- stockage dans SQLite ;
- stockage dans logs.

## 2. Backend-only keys

Dans un produit `desktop-first`, `backend-only` signifie :
- la cle ne sort jamais du processus runtime ou du service local autorise ;
- l'UI ne voit qu'un etat `provider configured / not configured` ;
- les appels passent par le runtime ou la gateway, jamais par le front.

## 3. Gateway credentials

Si un gateway externe est utilise plus tard :
- il suit les memes regles de secret ;
- il ne doit pas exposer de credentiel provider brut au client ;
- il doit etre observable avec les memes champs minimums.

## 4. What must be logged

Chaque appel LLM doit produire un `call record` avec au minimum :
- `timestamp`
- `run_id`
- `project_id`
- `provider_alias`
- `model_alias`
- `call_type`
- `prompt_ids_and_versions`
- `input_size_estimate`
- `output_size_estimate`
- `latency_ms`
- `token_usage` si disponible
- `estimated_cost`
- `retry_count`
- `fallback_chain`
- `result_status`
- `error_category` si echec
- `reasoning_stage`
- `context_snapshot_id`
- `token_governance` ou equivalent

## 5. What must not be logged by default

Interdits par defaut :
- raw API keys
- tokens, cookies, session ids
- prompts complets sur runs sensibles
- contexte brut complet
- dumps integrals de pages ou documents
- donnees personnelles non necessaires
- chaine complete d'un artifact intermediaire si elle n'est pas utile a l'audit

### Exception bornee

Un mode debug plus verbeux peut exister sur :
- fixtures synthetiques
- environnements de test controles

Mais il ne doit pas devenir le mode normal d'observabilite.

## 6. Redaction policy

Decision :
- la redaction se fait avant persistence des journaux ;
- les logs gardent les metadonnees utiles, pas les secrets bruts ;
- les prompt bodies doivent etre references par `prompt_id + version`, pas journalises integralement par defaut.

## 7. Costs and budgets

### Decision

Le systeme doit appliquer des budgets explicites.

Minimum requis :
- budget par run ;
- budget sessionnel ou journalier cote runtime ;
- plafond de retries facturants.

Statut d'implementation actuel :

- le runtime applique maintenant une gouvernance explicite de consommation pour les stages actifs ;
- compaction, reuse, suppression et downgrade stage-aware sont traces ;
- le detail canonique est ferme dans [token-consumption-governance.md](./token-consumption-governance.md).

### Prototype posture

Pour le prototype :
- depassement de budget `run` sur le provider live => degradation explicite vers mock ou fallback deterministe borne si ce chemin existe deja dans le slice ;
- pas de continuation silencieuse ;
- si aucun chemin degrade borne n'est disponible, arret ou pause explicite ;
- un run benchmarke doit pouvoir rapporter son cout estime ou indiquer explicitement `cost unavailable`.

## 8. Rate limits and provider pressure

Le runtime doit distinguer :
- `rate_limit`
- `quota_exceeded`
- `timeout`
- `provider_unavailable`
- `auth_error`
- `malformed_output`
- `safety_refusal`

Decision :
- ces categories doivent etre normalisees ;
- elles doivent apparaitre dans l'observabilite ;
- elles doivent guider retry/fallback/degraded mode.

## 9. Metrics to track

### Required

- calls per provider/model alias
- success rate
- error counts by category
- average latency
- p95 latency plus tard si la volumetrie existe
- token usage
- estimated cost
- fallback frequency

### Useful but not blocking early

- prompt family deltas over time
- budget burn by project type
- correlation between prompt version and benchmark regressions

## 10. Relationship with persistence

Les journaux LLM doivent respecter [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md).

Decision :
- on persiste les metadonnees d'appel et les references de prompts ;
- on ne persiste pas automatiquement les prompts complets ni les contextes complets ;
- toute expansion de ce stockage doit etre explicitement justifiee.

## 11. Operational failure handling

En cas d'erreur provider :
- journaliser la categorie ;
- journaliser si un retry a eu lieu ;
- journaliser si un fallback a ete tente ;
- journaliser si le run est passe en degraded mode ou en stop.

Le systeme ne doit pas :
- absorber silencieusement l'erreur ;
- masquer la perte de reproductibilite ;
- redemander indefiniment.

## 12. Decision finale

La politique LLM du produit est :
- `keys runtime-only`
- `os-backed secret store preferred when locally available`
- `logs metadata-first`
- `prompts version-referenced`
- `budgets explicit`
- `errors normalized`
- `redaction by default`

Toute implementation qui logge massivement les prompts ou stocke des secrets localement en clair sort du cadre canonique.
