# Comment JON auto-cartographie une app (interne)

Vue technique de bout en bout. Tout est déterministe en V1 (heuristiques DOM, pas de LLM lourd) → testable et reproductible.

## Pipeline
```
HTML (fixture ou page capturée)
  └─ extractDomSummary()            → { title, headings, buttons, links, inputs, forms, navLinks, banners }
       └─ detectSurfaces()          → surfaces[] (page courante + liens de nav, typées)
            └─ discoverActions()    → actions[] (type + trigger{selector} + inputs + safety + successState + confidence)
                 └─ classifyRisk()  → low|medium|high|critical (+ requiresConfirmation)
            └─ inferWorkflows()     → workflows[] (steps→actionIds, requiredInputs, confidence, needsHumanReview)
  └─ generateJonificationManifest() → manifest (confidence global + humanReview.questions + safety.globalRules)
  └─ validateManifest()             → { valid, errors, warnings }  (invariants sécurité)
  └─ simulateWorkflow()             → dry-run (steps, missingInputs, confirmations, maxRisk, executionMode)
  └─ registerJonifiedApp()          → <DATA_ROOT>/jonify-apps/<id>.jonification.manifest.json
```

## Résolution des éléments (sans code source)
JON ne lit pas le binaire : il lit l'UI **vivante** exposée par l'OS/le navigateur (DOM côté web ; UI Automation / AT-SPI côté desktop — cf. `docs/jon-ify-app-tool-protocol.md`). Chaque contrôle → `preferredSelector` (data-testid > id > name > texte) + `selectorCandidates[]` pour la résilience.

## Confiance & ambiguïté
- Confiance par élément (data-testid ⇒ +), par surface, par workflow, puis moyenne globale.
- < 0.8 ou présence d'actions sensibles ⇒ `humanReview.required` + questions ciblées.
- L'utilisateur **valide/corrige** ; il n'écrit rien.

## Sécurité (fail-closed)
- high/critical ⇒ `requiresConfirmation:true`, jamais auto en V1 (vérifié par le validateur).
- Règles globales (delete/paiement/envoi/publication ⇒ confirmation).

## Extension desktop (V4)
Même schéma de manifest, adaptateurs UIA (Windows) / AT-SPI (Linux) au lieu du DOM → une app desktop devient un « serveur de tools » comme un MCP (cf. App Tool Protocol).

## Fichiers
`src/jonify/*.js`, `tests/jonify.test.js`, `fixtures/jonify/sample-crm.html`, CLI `src/scripts/jonify-*.js`.
