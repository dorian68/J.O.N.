# JON — Release checklist

Avant toute mise à disposition (démo, beta, prod), valider dans l'ordre.

## 1. Config
- [ ] Copier `.env.example` → `.env.local`, renseigner le fournisseur LLM (clé via `npm run secret:llm`, pas en clair).
- [ ] Prod : `JON_PRODUCTION=true`, `COWORK_LLM_PRODUCTION_STRICT=1`, `COWORK_LLM_ALLOW_MOCK_FALLBACK=0`.
- [ ] Réseau : `JON_ALLOW_LAN=false` (loopback) sauf besoin explicite ; si LAN, protéger `~/.cowork/desktop-token`.
- [ ] MCP stdio : laissé `false` (ou allowlist renseignée). Browser eval : `false`.

## 2. Tests (cwd = app/)
```bash
npm test                          # 109 suites
npm run smoke:security
npm run smoke:production-readiness
npm run smoke:core-reliability
npm run smoke:browser-extension
npm run smoke:product
npm run smoke:journey
npm run package:chrome-extension  # dist/jon-chrome-extension.zip
```
- [ ] Tous PASS (exit 0). `smoke:production-readiness` sans FAIL.

## 3. Surfaces réelles (manuel, machine cible)
- [ ] Desktop : une mission « ouvre Notepad et écris X » → livrable + preuve + bouton Reprendre si pause.
- [ ] Navigateur : extension téléchargée (Settings → Browser Automation), chargée, statut « connecté ».
- [ ] Mobile : `JON_ALLOW_LAN=true`, appairage (QR/Tailscale), une tâche, réception du livrable.
- [ ] Arrêt d'urgence : stoppe une mission browser ET desktop en cours.

## 4. Sécurité (spot-check)
- [ ] Depuis un autre appareil LAN sans token : `GET /api/dashboard` → 401.
- [ ] `POST /api/mcp/stdio/connect` (stdio off) → 403.
- [ ] Logs : aucune clé/secret en clair.

## 5. Cohérence produit
- [ ] Catalogue MCP : seuls les services connectables affichent « Connecter » actif ; les autres « bientôt disponible ».
- [ ] Bannière « mode simulation » visible si aucun LLM réel.
- [ ] Aucune feature ne promet ce qu'elle ne fait pas (pas de « automatisation/scheduler »).

## 6. Go / No-Go
- [ ] Verdict Technical RL : PASS.
- [ ] Verdict Business Client Mystère : PASS (score global ≥ seuil).
- [ ] `PRODUCTION_READINESS.md` à jour.

No-Go si : une route sensible sans auth, stdio arbitraire, extension non téléchargeable, livrables desktop cassés, ou un smoke sécurité en échec.
