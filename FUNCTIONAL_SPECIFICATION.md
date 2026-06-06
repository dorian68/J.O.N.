# FUNCTIONAL_SPECIFICATION.md — JON

Source de vérité fonctionnelle. Chaque feature liste : promesse, surface, état réel, contrat CLI, critère de done.

États : ✅ réel & testé · 🟡 réel mais partiel/UI manquante · 🔶 simulé/étiqueté · ❌ cassé/absent.

## 1. Parcours utilisateur principal (golden path)

1. Lancer JON (desktop). 2. Taper une intention. 3. JON comprend (mission understanding) → plan → exécute sur la bonne surface. 4. Approbations sur actions sensibles. 5. Preuves + livrable. 6. Arrêt possible à tout moment.

Variante mobile : appairer le téléphone (QR/code) → piloter/observer → recevoir le livrable.

## 2. Features critiques

| # | Feature | Promesse | État | Contrat CLI |
|---|---|---|---|---|
| F-MISSION | Compréhension + exécution mission | NL → actions réelles | ✅ | `debug:mission`, `debug:mission:live` |
| F-DESKTOP | Automatisation Windows (ouvrir app, taper, fichier) | agir sur le bureau | ✅ | `debug:desktop`, `smoke:core-reliability` |
| F-BROWSER | Automatisation navigateur (plan→act→observe→replan) | piloter le web | ✅ | `smoke:browser-operator`, `smoke:browser-planner` |
| F-JONIFY | JON-ifier une app observée | app observée → manifest/tools/workflows exécutables | 🟡 (CLI/API live, UI desktop à brancher) | `smoke:jonify`, `smoke:jonify:live`, `smoke:jonify:operator` |
| F-COMPOSED | Mission cross-surface web→bureau + hand-off | enchaîner les surfaces | ✅ | test `composed-mission*` |
| F-DELIVERABLE | Livrables PDF/DOCX/XLSX | sortie vérifiable | ✅ | `debug:deliverables`, `smoke:journey` |
| F-ESTOP | Arrêt d'urgence universel | stop à tout moment | ✅ | `smoke:core-reliability` (T8) |
| F-APPROVAL | Approbations actions sensibles | contrôle humain | ✅ | `debug:policy` |
| F-MOBILE | Pairing + pilotage mobile | JON depuis le tél | ✅ | `debug:mobile`, tests mobile-* |
| F-EXT | Extension Chrome téléchargeable | automatiser Chrome perso | ✅ | `smoke:browser-extension` |
| F-MCP | Connecteurs MCP/OAuth locaux | ajouter des outils | 🟡 (catalogue ~76% 🔶 F2 ; OAuth mobile F3) | `debug:llm`+tests mcp-* |
| F-SECURITY | Auth + bind + redaction | livrable en sécurité | ✅ | `smoke:security`, `smoke:production-readiness` |
| F-SELFCHECK | Auto-test des sous-systèmes | crédibilité | 🟡 (UI desktop manquante F6/F7) | `debug:self-check` |
| F-SCHEDULE | Automatisation/planification | tâches récurrentes | ❌ (one-shot seulement F5) | — |

## 3. Exigences de CLI-testabilité (par feature)

Chaque feature critique DOIT avoir : (a) un script CLI déclenchant le flux complet sans UI ; (b) un smoke test qui valide forme de réponse + cohérence + sécurité ; (c) un échec bruyant. Voir `CLI_TESTABILITY_CONTRACT.md`.

## 4. Invariants de sécurité (rappel, voir PRODUCTION_READINESS)

- Bind loopback par défaut ; LAN via `JON_ALLOW_LAN=true` + token desktop sur routes desktop.
- MCP stdio désactivé par défaut ; sinon allowlist.
- eval/CDP navigateur désactivés par défaut.
- Fichiers confinés à `JON_WORKSPACE_ROOT` (défaut home) + subpaths sensibles bloqués.
- Secrets jamais loggés ; arrêt d'urgence sur toutes surfaces.

## 5. Manques fonctionnels connus (backlog priorisé)

- **P1** JON-ify live est prouvé en CLI/API, mais pas encore exposé comme parcours desktop visible avec étapes/preuves.
- **P1** Exécution desktop UIA réelle : V4 observe et génère le manifest ; Invoke/Value reste à brancher dans `windows-control.ps1`.
- **P1** Self-check visible sur desktop : exposé API, carte UI dédiée encore optionnelle.
- **P2** AT-SPI Ubuntu/WSL : même contrat adaptateur, relais Linux à implémenter.
- **P2** Planification récurrente : le produit reste majoritairement orienté exécution one-shot.

## 6. Definition of Done (par feature)

Une feature est done si : implémentée réellement + déclenchable UI **et** CLI + smoke test PASS + preuves + verdict Technical RL PASS + verdict Business Client Mystère PASS (voir AGENTS.md).
