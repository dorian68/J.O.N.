# CLI_TESTABILITY_CONTRACT.md — JON

Toute capacité doit être pilotable et vérifiable depuis la CLI par un agent, sans cliquer dans l'UI (backend-first). L'UI est la représentation finale de l'état, pas la source de vérité.

## Règle

Pour chaque feature critique de `FUNCTIONAL_SPECIFICATION.md` :
1. **Déclencheur CLI** : un script Node lance le flux complet (`npm run debug:* ` ou `node src/scripts/*`).
2. **Smoke test** : valide forme de réponse, transitions d'état, cohérence produit, sécurité ; échoue **bruyamment** (exit ≠ 0).
3. **Pas d'appel externe non configuré** ; le mock/simulé est étiqueté.
4. **Reproductible** : même entrée → même verdict (déterministe autant que possible).

## Commandes standard (cwd = `app/`)

### Tests & suite
```bash
npm test                         # suite complète (108 suites)
```

### Smoke ciblés (existants)
```bash
npm run smoke:security           # auth/bind/MCP stdio/redaction (Lot 1)
npm run smoke:production-readiness
npm run smoke:browser-extension  # packaging + eval/CDP gating (Lot 2)
npm run smoke:core-reliability   # startMission/e-stop/double-actuation/URL/path (Lot 3)
npm run smoke:browser-operator
npm run smoke:browser-planner
npm run smoke:agentic-desktop
npm run smoke:cowork
npm run smoke:real-surfaces
```

### Debug / parcours par capacité (existants)
```bash
npm run debug:env  debug:db  debug:llm  debug:deliverables
npm run debug:self-check  debug:policy
npm run debug:mission   debug:mission:live   debug:desktop
npm run debug:mobile     # doctor connectivité mobile
npm run campaign         # campagne backend-first multi-flux
```

### Packaging
```bash
npm run build:chrome-extension     # valide le manifest
npm run package:chrome-extension   # -> dist/jon-chrome-extension.zip
```

## Commandes manquantes à créer (backlog)

| Commande | Couvre |
|---|---|
| `smoke:journey` | parcours golden path complet (intention → livrable) en un script |
| `smoke:artifacts` | F1 — route liste artifacts + download desktop |
| `smoke:mcp` | F2/F3 — statuts honnêtes du catalogue + refus OAuth mobile propre |
| `smoke:mobile` (agrégé) | pairing + session + admin 401 + reconnexion |

## Contrat de sortie d'un smoke

```text
exit 0  => PASS (+ résumé lisible)
exit !=0 => FAIL (+ cause + comment reproduire)
```

Un smoke ne doit JAMAIS rester bloqué (timeouts obligatoires sur tout I/O : LLM, SSE, process).
