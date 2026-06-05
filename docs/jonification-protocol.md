# Protocole de JONification

Le protocole maison qui transforme une app observée en carte opérationnelle. Onze étapes, du brut à l'enregistrement.

| # | Étape | Entrée → Sortie | Module |
|---|---|---|---|
| 1 | **App Discovery** | URL/app ouverte → HTML capturé | `app-observer.js` (`observeHtml`/`observeUrl`) |
| 2 | **Surface Detection** | DOM summary → surfaces typées (dashboard/list/form/settings/login) | `surface-detector.js` |
| 3 | **Element Mapping** | éléments interactifs → id stable + selectors candidats/préféré | `app-observer.js` |
| 4 | **Action Discovery** | éléments → actions typées + trigger + inputs | `action-discovery.js` |
| 5 | **Workflow Inference** | actions → workflows candidats (create/search/delete/export) | `workflow-inference.js` |
| 6 | **State Detection** | bannières/role=alert,status → états succès/erreur attendus | `app-observer.js` + successState |
| 7 | **Safety Classification** | action → risque low/medium/high/critical + confirmation | `safety-classifier.js` |
| 8 | **Manifest Generation** | tout → `jonification.manifest.json` + confiance + questions | `manifest-generator.js` |
| 9 | **Smoke Validation** | manifest → valid/erreurs/avertissements ; simulation dry-run | `manifest-validator.js`, `workflow-simulator.js` |
| 10 | **Human Review (minimal)** | ambiguïtés → questions ciblées (l'utilisateur valide, ne remplit pas) | `humanReview.questions` |
| 11 | **Operational Registration** | manifest validé → registre local + context provider | `registry.js`, `jonifyContextProvider` |

## Invariants
- **Génération par JON** : aucune étape ne demande à l'utilisateur d'écrire le manifest.
- **Fail-closed sécurité** : high/critical ⇒ `requiresConfirmation:true`, jamais auto en V1 ; règles globales (pas de delete/paiement/envoi sans confirmation).
- **Confiance explicite** : score par surface/action/workflow + global ; < 0.8 ⇒ `humanReview.required`.
- **Selectors résilients** : `selectorCandidates[]` + `preferredSelector` (data-testid > id > name > texte).
- **Simulation sans effet** : on décrit ce que JON ferait, les inputs manquants, les confirmations, les états de succès, les zones de faible confiance.

## Modes de génération
`generationMode: "auto-assisted"` (V1). V2+ : exploration multi-pages, états réels, exécution sûre, auto-réparation des selectors.
