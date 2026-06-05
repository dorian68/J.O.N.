# PRODUCTION_READINESS.md — JON

Verdict vivant de la mise en production. Mis à jour à chaque lot.

## Verdict global actuel : **PARTIEL** (sécurité OK, cohérence produit en cours)

`npm run smoke:production-readiness` doit être ✅ ; en mode `JON_PRODUCTION=true` le serveur **refuse de démarrer** si un check FAIL.

## Checklist sécurité (Lot 1-2-3 — FAIT)

| Check | État | Preuve |
|---|---|---|
| Bind loopback par défaut ; LAN opt-in | ✅ | `desktop-auth.js`, `smoke:security` |
| Auth desktop sur routes sensibles (LAN) | ✅ | gate central, `smoke:security` |
| Admin mobile exige session | ✅ | T5 |
| MCP stdio désactivé par défaut + allowlist | ✅ | T2, `smoke:security` |
| Redaction secrets (sk-/Bearer/x-api-key/JWT/AWS/GCP/GitHub/Slack) | ✅ | T6, test redaction |
| Pas de CORS wildcard sur SSE mobile | ✅ | T20 |
| eval/CDP navigateur désactivés par défaut | ✅ | T3, `smoke:browser-extension` |
| Bridge extension anti-spoofing | ✅ | T4 |
| Arrêt d'urgence universel (desktop+browser) | ✅ | T8, `smoke:core-reliability` |
| Pas de double-actuation desktop | ✅ | T9 |
| URL de lancement navigateur assainie | ✅ | T10 |
| Fichiers confinés (workspace + subpaths sensibles) | ✅ | T11 |
| Pairing mobile persistant (devices/sessions DB) | ✅ | session-persistence |

## Checklist fiabilité

| Check | État |
|---|---|
| `startMission` unique (pas de duplicata mort) | ✅ T7 |
| Budget tokens fenêtre glissante (pas de brick) | ✅ |
| Suite de tests verte | ✅ 108 suites |

## Checklist cohérence produit (Lot 4 — À FAIRE)

| Check | État |
|---|---|
| Livrables téléchargeables sur desktop (F1) | ❌ route liste absente |
| Catalogue MCP honnête (statuts) (F2) | ❌ ~76% décoratif |
| OAuth MCP mobile : refus propre / desktop (F3) | ❌ timeout silencieux |
| « Automatisation » honnête ou scheduler (F5) | ❌ one-shot |
| Bouton reprise mission desktop (F6) | ❌ |
| Bannière mode mock dans la conversation (F9) | ❌ |
| Self-check visible sur desktop (F7) | ❌ |

## Checklist packaging / livraison (Lot 5 — partiel)

| Check | État |
|---|---|
| Extension Chrome téléchargeable + doc | ✅ |
| `docs/chrome-extension-installation.md` | ✅ |
| `docs/mobile-access.md` | ✅ |
| Release checklist + guide démarrage | ❌ |
| Mode `JON_PRODUCTION` documenté (.env example) | 🟡 |

## Refus de démarrage en production si :
- une route sensible reste sans auth ;
- MCP stdio activé sans allowlist ;
- (futur) workspace root absent quand requis ;
- fournisseur LLM mock en production.

## Definition of « production ready »
Toutes les cases sécurité + fiabilité + cohérence ✅, `smoke:production-readiness` PASS, golden-path `smoke:journey` PASS, et verdicts Technical RL + Business Client Mystère = PASS.
