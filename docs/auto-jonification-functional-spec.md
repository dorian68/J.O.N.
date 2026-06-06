# Auto-JONification — cahier des charges

1. **Objectif produit.** Permettre à JON de transformer **lui-même** une app en environnement opérable (carte de surfaces/actions/workflows), sans saisie manuelle de manifest.
2. **Utilisateurs cibles.** Power-users / opérateurs qui veulent déléguer des tâches sur des apps web/desktop existantes.
3. **Problème résolu.** Les agents « computer use » re-regardent l'écran à chaque fois (fragile, coûteux). Ici, l'app est cartographiée une fois en tools réutilisables.
4. **Parcours utilisateur.** « JON, jonifie cette app » → JON observe → propose une carte → pose 0..N questions ciblées → l'utilisateur valide/corrige → app enregistrée → JON l'utilise.
5. **Modules techniques.** `app-observer`, `surface-detector`, `action-discovery`, `safety-classifier`, `workflow-inference`, `manifest-generator`, `manifest-validator`, `workflow-simulator`, `registry`, `index` (orchestrateur + context provider).
6. **Données collectées.** URL, titre, titres, boutons, liens, champs, formulaires (+ inputs requis), menus, bannières succès/erreur. Aucune donnée utilisateur sensible exfiltrée (tout local).
7. **Format du manifest.** `jonification.manifest.json` (schemaVersion 0.1.0) : `app`, `discovery`, `surfaces[]`, `actions[]`, `workflows[]`, `safety.globalRules`, `humanReview.questions`, `confidence`.
8. **Détection des surfaces.** Page courante + liens de nav → surfaces typées (dashboard/list/form/settings/login/detail).
9. **Détection des actions.** Éléments interactifs → type (navigate/open_form/create/update/delete/submit/send/export/import/search/filter/connect_account/payment/publish) + trigger + inputs.
10. **Détection des workflows.** Séquences probables (create=open+submit, search, delete, export) avec confiance et inputs requis.
11. **Classification safety.** low (navigation/lecture) · medium (création/édition) · high (submit/send/export/connect) · critical (delete/payment/publish). high/critical ⇒ confirmation, jamais auto en V1.
12. **Human-in-the-loop minimal.** `humanReview.questions[]` ciblées ; l'utilisateur valide/corrige uniquement.
13. **CLI attendue.** `jonify:observe`, `jonify:generate`, `jonify:validate`, `jonify:summarize`, `jonify:simulate`, `smoke:jonify`.
14. **API attendue.** `POST /api/jonify/observe|generate|register`, `GET /api/jonify/apps[/:appId]`, `POST /api/jonify/apps/:appId/simulate-workflow` (auth-gated).
15. **Smoke tests.** `npm run smoke:jonify` sur `fixtures/jonify/sample-crm.html` : observe→surfaces→actions→risques→workflows→manifest→validation→simulation→questions, vérifie delete=critical et send/submit=confirmation.
16. **Critères d'acceptation.** Voir le prompt §14 (15 critères) — tous couverts par la V1 + le smoke.
17. **Roadmap.** V1 auto-JONification depuis page observée **✅** ; V2 fusion multi-pages (`jonifyFromObservations`) **✅** ; V3 exécution sûre via adaptateur (`executeWorkflow` : low/medium auto, high/critical confirmation obligatoire, abort, inputs requis) **✅ (cœur ; câblage adaptateur navigateur réel = en cours)** ; V4 desktop via UIA (`jonifyFromAccessibility` : arbre d'accessibilité → manifest) **✅ (observation/manifest ; exécution par pattern UIA = prochaine étape)** ; V5 couche agent-OS (workflows multi-apps, manifests versionnés, self-healing selectors).

### Modules V2-V4 ajoutés
- `src/jonify/executor.js` — `executeWorkflow(manifest, workflowId, { adapter, inputs, confirm, shouldAbort, mode })`. Adaptateur : `{ navigate, click, type, capture? }`.
- `src/jonify/desktop-adapter.js` — `accessibilityTreeToSummary` / `observeAccessibility` (UIA → summary). Linux/AT-SPI = même forme.
- `src/jonify/mission-resolver.js` — `resolveJonifiedAppForMission` + `planJonifyMission`.
- CLI : `jonify:execute` (simulation sûre par défaut). API : `POST /api/jonify/resolve`.

## Critères d'acceptation V1 (état)
1–15 ✅ : observe ✅, éléments ✅, surfaces ✅, actions ✅, risques ✅, ≥1 workflow ✅, manifest généré ✅, validé ✅, simulé ✅, questions ciblées ✅, pas de formulaire manuel ✅, registry ✅, context provider ✅, `smoke:jonify` ✅, rapport ✅.
