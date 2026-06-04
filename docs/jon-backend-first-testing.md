# JON — Backend-First Testing & CLI Campaigns

> Adaptation et extension, **spécifique à JON**, du paradigme générique
> `backend_first_debugging_paradigm.md`. Le principe reste : **on valide le
> moteur (backend) en CLI, avec des logs structurés, avant de toucher l'UI**.
> Ce document décrit comment ce principe s'applique à *tout* l'usage de JON et
> comment lancer des campagnes de test ici, en ligne de commande.

## 1. Principe (rappel)

```
Flux backend d'abord
→ script CLI / debug
→ logs structurés
→ point d'échec exact
→ backend validé
→ seulement ensuite : UI
```

L'UI (desktop `ui/src/main.jsx`, mobile `ui/mobile/app.js`) est le **tableau de
bord**, pas le moteur. Un message d'erreur d'UI est un *symptôme* ; la cause se
diagnostique sur le flux backend. On ne style/patch pas l'UI tant que le flux
backend n'est pas validé indépendamment.

## 2. Carte des flux JON (le « moteur »)

Chaque flux ci-dessous est testable seul, sans UI, via le lanceur de campagne.

| Flux (id) | Catégorie | Requis | Ce qu'il prouve |
|---|---|---|---|
| `environment` | config | ✅ | Variables d'env présentes/masquées ; JON tourne hors-ligne par défaut |
| `database` | storage | ✅ | Ouverture SQLite, écriture projet, écriture+recherche mémoire |
| `llm-gateway` | llm | ✅ | Construction du gateway, providers, statut, capacités |
| `deliverables` | artifacts | ✅ | Rendu réel PDF/DOCX/XLSX (magic bytes valides) |
| `self-check` | health | ✅ | `runSelfCheck` : renderer + actuation desktop + gateway |
| `approvals-policy` | policy | ✅ | Read auto-approuvé, write gaté, resolver invoqué |
| `emergency-stop` | control | ✅ | Registre d'abort coopératif (flag, portée, no-op) |
| `mission-research` | mission | ✅ | **Bout-en-bout** : planning → navigateur (fixture) → artefacts → livrables → completion guard |
| `desktop-provider` | desktop | ⛔ optionnel | Actuation Windows (daemon persistant + fallback single-shot) |

Le flux `mission-research` force le **provider LLM mock** (déterministe,
hors-ligne) : un test du moteur doit être reproductible et ne pas dépendre du
réseau. Le provider **live** se valide via le serveur opérateur ou un flux dédié.

### Couverture vs surfaces d'usage de JON
- **Missions documentaires/recherche** → `mission-research` (le cœur de la promesse).
- **Livrables exploitables** (PDF/DOCX/XLSX) → `deliverables` + assertion disque dans `mission-research`.
- **Contrôle desktop** (clic/saisie/scroll/capture) → `desktop-provider` (selfTest réel sur Windows).
- **Contrôle navigateur** → exercé par `mission-research` (Chromium headless sur fixture-server).
- **Permissions/approbations** → `approvals-policy`.
- **Arrêt d'urgence** → `emergency-stop`.
- **Santé/auto-correction** → `self-check` (+ log `[SELF-CHECK]` au démarrage serveur).
- **Mémoire, stockage, gateway** → `database`, `llm-gateway`.

## 3. Lancer une campagne (CLI)

```bash
cd app

npm run campaign            # tous les flux, diagnostic final, exit 0/1
npm run campaign:list       # liste les flux disponibles

# Flux ciblés (debug backend-first d'un sous-système) :
npm run debug:env
npm run debug:db
npm run debug:llm
npm run debug:deliverables
npm run debug:self-check
npm run debug:policy
npm run debug:mission       # bout-en-bout (offline)
npm run debug:desktop       # Windows uniquement

# Sélections arbitraires :
node src/scripts/run-jon-campaign.js --flow=deliverables,mission-research
node src/scripts/run-jon-campaign.js --category=mission
node src/scripts/run-jon-campaign.js --json     # logs JSON (CI / parsing)
```

**Code de sortie** : `0` si tous les flux **requis** sélectionnés passent, `1`
sinon (les flux optionnels skippés n'échouent pas la campagne). Idéal en CI ou
en pré-commit.

## 4. Standard de logs structurés

Chaque étape émet (cf. `src/testing/structured-log.js`) :

```
[STEP]    ce qui est testé        ✅/❌/⏭️/⚠️
[REQUEST] endpoint / opération
[INPUT]   paramètres (secrets masqués)
[OUTPUT]  résumé de réponse
[ERROR]   code/message brut éventuel
[NEXT]    implication / action suivante
```

Le diagnostic final ressemble à :

```
=== FINAL DIAGNOSIS ===
✅ deliverables: All 4 deliverable formats produced valid binaries (PDF/DOCX/XLSX).
❌ mission-research: Provider request timed out.
     causes: Browser/Playwright failed; Planner produced no steps; ...
     next:   Inspect run events in DB; Run flow `deliverables` in isolation; ...
Verdict: ❌ Backend NOT validated — fix required flow(s): mission-research.
```

## 5. Sécurité des logs

Jamais de secret en clair. `maskSecret()` / `maskObject()`
(`src/testing/structured-log.js`) masquent toute clé contenant
`token|secret|password|api_key|authorization|cookie|private_key|seed|…` et ne
laissent que **présence / 4 premiers / 4 derniers / longueur**. Toute valeur
loggée passe par ce masquage.

## 6. Erreurs structurées et actionnables

En cas d'échec, un flux retourne (`structuredError`) :

```json
{
  "success": false,
  "step": "mission_research",
  "error": {
    "code": "MISSION_FLOW_INCOMPLETE",
    "message": "...",
    "rawProviderMessage": "...",
    "possibleCauses": ["Browser/Playwright failed", "..."],
    "nextActions": ["Inspect run events in DB", "..."]
  }
}
```

## 7. Quand demander à l'humain

Exécuter directement toutes les commandes sûres. Ne demander à l'utilisateur que
pour : authentification navigateur, écran de consentement OAuth, credential
manquant, configuration dans un dashboard externe, ou action destructive/risquée.
(Les flux JON par défaut sont hors-ligne et non destructifs : aucune intervention
requise.)

## 8. Ajouter un flux

1. Écrire `async function flowX(ctx, log) { … return { success, summary, details } }`
   ou `return structuredError({...})` dans `src/testing/jon-flows.js`.
2. Utiliser `log.ok/fail/skip/warn/log({ step, request, input, output, error, next })`.
3. Nettoyer ses ressources (DB temp, serveurs, runtime `.close()`).
4. L'enregistrer dans `FLOWS` (`id`, `label`, `category`, `required`).
5. Ajouter optionnellement un script `debug:x` dans `package.json`.

## 9. Critères de validation backend (avant UI)

Un flux backend n'est valide que si : le script CLI passe, les appels renvoient
les données attendues, les cas limites sont gérés, les erreurs sont explicites et
actionnables, les logs montrent le flux exact, et le backend renvoie des données
normalisées prêtes pour l'UI. **Seulement alors** on connecte/patche l'UI.

## 10. Anti-patterns (à éviter)

Patcher l'UI avant de comprendre l'échec backend ; deviner depuis un message
d'UI ; avaler les exceptions ; logger des secrets en entier ; s'appuyer sur des
mocks pour tester une intégration *réelle* (pour le live, utiliser un flux dédié,
pas le flux moteur déterministe) ; connecter l'UI avant validation backend.
