# LLM Provider Clarity Audit

## Statut

Audit documentaire cible.

Ce document evalue si la strategie `LLM provider` etait, avant ce run, suffisamment explicite pour guider un developpement sans ambiguite.

Documents lies :
- [architecture-cible.md](./architecture-cible.md)
- [runtime-agentique.md](./runtime-agentique.md)
- [threat-model.md](./threat-model.md)
- [stack-technique-v1.md](./stack-technique-v1.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [prompt-registry-and-versioning.md](./prompt-registry-and-versioning.md)
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)

## Verdict court

Verdict : `partiellement clair`, mais `insuffisant pour un build serein` des appels LLM.

Le corpus disait deja que :
- une `LLM gateway` devait exister ;
- le systeme devait pouvoir router plusieurs modeles ;
- les secrets devaient etre proteges ;
- les couts et la latence devaient etre observes.

Mais il ne disait pas encore, de maniere normative :
- qui a le droit d'appeler un provider ;
- comment un provider est configure ;
- quel modele sert a quoi ;
- quand un fallback est autorise ;
- quelles sorties du modele sont acceptables ou interdites ;
- comment versionner les prompts ;
- quoi logger, quoi ne jamais logger ;
- quels budgets et quels modes degrades doivent etre appliques.

## Evaluation par theme

| Theme | Etat avant ce run | Ce qui existait deja | Ce qui manquait reellement | Gravite |
| --- | --- | --- | --- | --- |
| Existence d'une couche provider/gateway | partiellement clair | `LLM gateway` mentionnee dans plusieurs docs | contrat canonique absent | elevee |
| Role du LLM dans le produit | partiellement clair | references generales a planification, review et artefacts | frontiere precise entre logique LLM et logique deterministe absente | elevee |
| Selection des modeles par usage | implicite | idee de modele haut de gamme vs modele moins couteux dans [stack-technique-v1.md](./stack-technique-v1.md) | aucune decision normative sur les roles modeles | elevee |
| Provider direct vs gateway | implicite | notion de gateway multi-fournisseurs | topologie normative absente | moyenne |
| Fallback et mode degrade | implicite | le mot `fallback` apparait | politique de fallback absente | elevee |
| Secrets et credentials | partiellement clair | separation des secrets mentionnee | stockage, exposition UI et journaux non fermes | elevee |
| Couts / budgets / rate limits | insuffisant | observabilite des couts evoquee | budgets et seuils d'arret absents | moyenne |
| Prompt governance | insuffisant | mentions eparses de prompts et system prompts | aucun registre, versioning, rollback, review | elevee |
| Observabilite LLM | insuffisant | journalisation generale evoquee | schema minimal des call records absent | moyenne |
| Contrat runtime | insuffisant | le runtime parle de planner/executor/evaluator | aucune norme sur ce que le LLM peut produire et ne pas produire | elevee |

## Ce qui etait deja dit explicitement

### 1. Une gateway etait deja attendue

[architecture-cible.md](./architecture-cible.md) et [cahier-des-charges-v1.md](./cahier-des-charges-v1.md) mentionnaient une `LLM gateway` pour :
- routage,
- fallback,
- secrets,
- journalisation,
- confidentialite.

Cela donnait une direction utile, mais pas un contrat suffisant.

### 2. Le projet ne devait pas etre confondu avec "le modele"

[vision-produit-cowork.md](./vision-produit-cowork.md) et [runtime-agentique.md](./runtime-agentique.md) installaient deja une bonne posture :
- le produit est `run-centric`,
- les approvals, artefacts, evidence et policies sont des primitives produit,
- le modele n'est pas le centre de gravite.

Cette posture est saine, mais encore trop haute.

### 3. Les secrets devaient etre traites a part

[stack-technique-v1.md](./stack-technique-v1.md), [threat-model.md](./threat-model.md) et [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md) interdisaient deja :
- la persistance brute de secrets,
- l'injection de secrets dans les prompts,
- la confusion entre runtime et surfaces non fiables.

La direction etait bonne, mais non fermee au niveau provider.

## Ce qui n'etait dit que de maniere implicite

### 1. Le reste du systeme ne devait probablement pas appeler les SDK providers directement

Le corpus parlait de gateway, mais aucun document ne disait clairement :

- `le runtime, le browser control, le computer control, l'UI et les tools n'appellent jamais un SDK provider directement hors de la couche gateway`.

Sans cette phrase, une derive ad hoc etait probable.

### 2. Tous les appels LLM n'ont pas le meme niveau d'exigence

Le corpus laissait entendre des usages differents :
- planification,
- evaluation,
- synthese,
- vision en secours.

Mais il ne disait pas quels usages devaient etre :
- schema-valides,
- soumis a budget strict,
- interdits en fallback,
- ou toujours verifies par logique deterministe.

### 3. Les prompts devaient forcement etre gouvernes

Beaucoup de documents dependent implicitement de prompts stables :
- planner,
- evaluator,
- artifact drafting,
- context compression.

Mais aucun document n'en faisait encore un objet gouverne.

## Ce qui manquait vraiment

### 1. Un document canonique unique

Le sujet etait disperse entre :
- architecture,
- stack exploratoire,
- threat model,
- guidelines.

Il manquait un document normatif unique.

### 2. Un contrat runtime

Il manquait une reponse explicite a :
- ou le LLM intervient,
- ou il ne doit pas intervenir,
- quelles sorties il peut produire,
- lesquelles doivent rester non autoritatives.

### 3. Une politique de fallback

Le mot `fallback` etait present, mais pas la regle.

Or c'est critique. Un systeme qui change silencieusement de provider ou de modele peut :
- casser la qualite,
- casser les benchmarks,
- casser la reproductibilite,
- casser la confiance operateur.

### 4. Une gouvernance des prompts

Sans registre et versioning, les changements de prompts deviennent :
- invisibles,
- peu auditables,
- difficiles a corriger,
- et impossibles a correler aux regressions benchmark.

### 5. Une politique explicite sur logs, couts et secrets

Il manquait :
- le schema minimal d'observabilite LLM,
- la politique de redaction,
- la posture `backend-only keys`,
- les budgets minimums du prototype et du MVP.

## Contradictions ou tensions observees

### 1. Direction claire, niveau de fermeture insuffisant

Il n'y avait pas de contradiction frontale entre documents.

La tension etait plutot :
- `architecture-cible.md` disait qu'une gateway existe ;
- mais aucun document canonique ne definissait cette gateway.

### 2. Documents exploratoires plus explicites que certains documents normatifs

[stack-technique-v1.md](./stack-technique-v1.md) parlait plus concretement de :
- routage multi-fournisseurs,
- couts,
- latence,
- masquage des secrets.

Mais ce document est exploratoire, pas canonique.

Cela creait une dependance malsaine a un document non normatif.

## Risque si on build trop tot sans fermer ce sujet

Si le developpement LLM continuait sans fermeture documentaire :
- des appels provider directs apparaitraient hors gateway ;
- les modeles seraient choisis "au feeling" ;
- les prompts seraient modifies inline dans le code ;
- les couts ne seraient observes qu'apres incident ;
- les benchmarks ne seraient plus comparables ;
- les secrets pourraient fuir dans logs ou configs ;
- le fallback deviendrait une magie opaque.

## Conclusion

### Reponse a la question centrale

Avant ce run, l'utilisation d'un provider LLM n'etait **pas** explicitement, clairement et suffisamment documentee pour guider un developpement sans ambiguite.

Le bon verdict n'est pas `flou total`.

Le bon verdict est :
- `direction claire`,
- `intention architecturale saine`,
- mais `niveau de fermeture insuffisant pour un build serein des appels LLM`.

### Decision

Le sujet doit desormais etre traite comme un sous-ensemble canonique a part entiere du corpus, avec :
- [llm-provider-strategy.md](./llm-provider-strategy.md)
- [llm-runtime-contract.md](./llm-runtime-contract.md)
- [prompt-registry-and-versioning.md](./prompt-registry-and-versioning.md)
- [llm-secrets-costs-and-observability.md](./llm-secrets-costs-and-observability.md)
