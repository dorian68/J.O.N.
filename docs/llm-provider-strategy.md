# LLM Provider Strategy

## Statut

Normative strategy document.

Ce document devient la reference canonique pour la strategie `LLM provider` du produit.

Documents lies :
- [architecture-cible.md](./architecture-cible.md)
- [runtime-agentique.md](./runtime-agentique.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [prompt-registry-and-versioning.md](./prompt-registry-and-versioning.md)
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
- [token-consumption-governance.md](./token-consumption-governance.md)
- [threat-model.md](./threat-model.md)

## 1. Decision de base

Le produit utilise les modeles via une `internal LLM gateway contract`.

Decision :
- aucun composant produit hors couche gateway ne doit appeler un SDK provider directement ;
- le reste du systeme parle a des `model aliases`, pas a des noms de modeles bruts ;
- la gateway peut etre implementee localement au debut ;
- un gateway manage externe reste possible plus tard, mais n'est pas requis par le prototype.

## 2. Role du LLM dans le produit

Le LLM est un composant de raisonnement et de synthese, pas un composant de confiance.

Il sert a :
- reformuler une mission et proposer un plan ;
- compresser et structurer du contexte ;
- proposer des syntheses et drafts d'artefacts ;
- produire une critique ou une evaluation de qualite ;
- aider a interpreter un contenu ambigu quand une logique deterministe ne suffit pas ;
- eventuellement, plus tard, faire une interpretation visuelle bornee.

Il ne sert pas a :
- autoriser une action ;
- elargir un scope de permissions ;
- decider seul qu'un outcome est verifie quand un check deterministe est disponible ;
- stocker ou manipuler des secrets ;
- devenir la source de verite d'un audit.

## 3. Topologie retenue

Topologie normative :

```text
Runtime / services produit
  -> Internal LLM Gateway
       -> Provider adapters
            -> Provider A
            -> Provider B
            -> Mock / Offline provider
```

Decision :
- `internal gateway` obligatoire ;
- `provider adapters` obligatoires ;
- `mock/offline provider` obligatoire pour tests et benchmarks non dependants du reseau ;
- `managed external gateway` optionnel, derriere le meme contrat.

## 4. Provider direct vs gateway

### Decision

Le produit est `gateway-first`, pas `provider-direct`.

Cela signifie :
- le runtime connait des `capability classes` et des `model aliases` ;
- la resolution provider/modele est faite dans la gateway ;
- la politique de fallback est portee par la gateway ;
- l'observabilite des appels est centralisee.

### Ce qui reste autorise

Pour le prototype ou le dev local :
- la gateway peut embarquer directement un adapter OpenAI, Anthropic ou autre ;
- mais l'appel reste encapsule par le contrat gateway.

### Ce qui est interdit

- un module browser qui appelle un SDK provider ;
- un module UI qui porte une cle provider ;
- un prompt inline qui choisit lui-meme le provider ;
- un tool qui contourne la gateway pour "aller plus vite".

## 5. Model roles retenus

La selection des modeles doit se faire par `role`, pas par appel opportuniste.

### 5.1 Primary reasoning model

Usage :
- mission understanding,
- plan generation,
- recovery reasoning,
- evaluator notes,
- decision note drafting.

Qualites requises :
- forte adherence aux instructions,
- bon raisonnement multi-etapes,
- sorties stables,
- bon support du structured output quand requis.

### 5.2 Utility structuring model

Usage :
- reformatage,
- extraction textuelle assistee,
- compression de contexte,
- normalisation de contenu non critique.

Qualites requises :
- cout plus bas,
- latence plus faible,
- bonne discipline de schema.

Decision :
- ce role est optionnel au prototype ;
- il devient utile seulement si les benchmarks montrent un vrai gain cout/latence.

### 5.3 Vision fallback model

Usage :
- interpretation visuelle bornee quand le DOM ou l'accessibilite sont insuffisants ;
- jamais comme voie primaire.

Decision :
- ce role n'est pas central au prototype ;
- il ne peut pas devenir la solution majoritaire ;
- toute activation doit etre visible dans l'audit.

### 5.4 Mock / offline model

Usage :
- tests deterministes,
- fixtures benchmark,
- development safety,
- degraded mode controle.

Decision :
- indispensable pour les tests non reseau ;
- ne doit pas etre presente comme preuve de qualite produit sur des cas realistes.

## 6. Selection de modele par usage

| Usage | Alias canonique | Statut | Exigence |
| --- | --- | --- | --- |
| Planification et reformulation de mission | `primary_reasoning` | obligatoire | sorties robustes et explicables |
| Evaluation / critique | `primary_reasoning` | obligatoire | meme famille ou equivalent stable |
| Draft de `Note de decision` | `primary_reasoning` | obligatoire | qualite textuelle et structure |
| Compression / structuration de contexte | `utility_structuring` | optionnel | schema et cout |
| Vision fallback bornee | `vision_fallback` | optionnel | usage rare, journalise |
| Tests locaux / benchmark controle | `mock_offline` | obligatoire | determinisme |

Decision :
- le prototype n'a pas besoin d'un grand nombre de modeles ;
- il a besoin d'`aliases` stables et d'une politique de choix explicite.

## 7. Configuration model

### Decision

La configuration LLM se fait en trois niveaux :
- `global runtime`
- `project override` borne
- `run snapshot`

### 7.1 Global runtime

Contient :
- providers disponibles ;
- model aliases ;
- budgets par defaut ;
- timeouts ;
- limites de retries ;
- politiques de redaction ;
- provider order.

### 7.2 Project override

Autorise seulement :
- choix parmi des aliases allowlistes ;
- ajustement de budget ou timeout dans des bornes explicites ;
- activation ou non d'un role optionnel.

Interdit :
- stocker une cle brute par projet ;
- pointer vers un provider arbitraire ;
- changer les policies de logging.

### 7.3 Run snapshot

Chaque run doit conserver la resolution effective :
- provider alias ;
- model alias ;
- prompt versions ;
- budget applicable ;
- fallback chain activee.

Cela est requis pour audit et benchmark review.

## 8. Fallback policy

### Decision

Un fallback n'est jamais silencieux ni gratuit.

Le systeme peut faire :
1. retry borne sur erreur transitoire ;
2. fallback vers un autre modele compatible du meme role ;
3. stop propre en mode degrade.

Le systeme ne peut pas faire :
- changer de role de modele sans trace ;
- utiliser un modele vision comme remplacement implicite d'un modele de raisonnement ;
- changer de provider et continuer comme si rien ne s'etait passe ;
- remplacer un structured output par du texte libre et pretendre que le contrat est respecte.

### Regles

- Chaque fallback genere un evenement runtime.
- Chaque fallback doit etre visible dans l'observabilite LLM.
- Si aucun modele compatible n'est disponible, la mission dependante du LLM doit s'arreter proprement.

## 9. Degraded mode

Si le provider est indisponible, le produit doit rester exploitable au niveau :
- UI operateur,
- revue des runs precedents,
- consultation des sources, preuves et artefacts existants,
- benchmarks purement deterministes ou mockes.

Pour un run LLM-dependant :
- le systeme ne doit pas inventer une continuation non comparable ;
- pour le prototype autorise, certains appels LLM bornes peuvent degrader vers un chemin deterministe explicitement trace quand ce chemin existait deja dans le slice ;
- cette degradation n'est acceptable que si elle reste dans le meme contrat produit, avec evenements, call records d'echec et signalement visible cote operateur ;
- hors de ces cas bornes, le run doit passer en `blocked` ou `failed` explicite selon policy.

Decision :
- le produit degrade proprement ;
- il ne masque pas l'indisponibilite du provider.

## 10. Security posture

### Decisions

- aucune cle provider cote UI ;
- aucune cle provider exposee au navigateur ;
- aucune cle brute dans les projets ;
- jamais de secret brut dans les prompts ;
- redaction avant logging ;
- les decisions de policy restent deterministes et hors modele ;
- les donnees sensibles ne doivent pas etre envoyees au provider sans autorisation et justification explicites.

## 11. Observabilite requise

Chaque appel LLM doit produire au minimum :
- `run_id`
- `project_id`
- `call_type`
- `provider_alias`
- `model_alias`
- `prompt_ids_and_versions`
- `latency_ms`
- `token_usage`
- `estimated_cost`
- `result_status`
- `fallback_used`
- `error_category` si echec

Le detail complet est ferme dans [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md).

## 12. Costs, budgets, and rate limits

### Decision

Le produit doit raisonner en budgets, pas seulement en cout a posteriori.

Budgets minimaux requis :
- budget par `run`
- budget journalier ou sessionnel cote runtime
- plafond de retries
- gouvernance par `reasoning stage`

Statut d'implementation actuel :

- la gateway applique maintenant une gouvernance explicite de consommation pour les stages actifs ;
- cette gouvernance couvre compaction de contexte, reuse exact intra-run, suppression de stages optionnels et routage stage-aware ;
- le detail canonique est ferme dans [token-consumption-governance.md](./token-consumption-governance.md).

Rate limits :
- centralises dans la gateway ;
- surfaces visibles dans les metriques ;
- ne doivent jamais conduire a une boucle de retry opaque.

## 13. Limites connues

Ce document ne tranche pas encore :
- le fournisseur exact a privilegier en production ;
- le nombre final de providers supportes ;
- l'usage d'un gateway externe manage ;
- les valeurs precises des budgets par verticale.

Ces sujets restent ouverts mais ne bloquent pas le contrat d'architecture.

## 14. Conclusion normative

La strategie provider du produit est :
- `gateway-first`
- `alias-based`
- `safe-by-default`
- `observable`
- `budgeted`
- `prompt-versioned`
- et `degraded-but-explicit` en cas d'indisponibilite.
