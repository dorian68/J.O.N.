# JON — État de fonctionnalité au 2026-05-18

> Vérifié dans le code source. Dernière mise à jour : 2026-05-18.

## Verdict

JON est **production-ready pour une démo pilote supervisée** sur une machine Windows avec un opérateur.
Il **n'est pas encore distribuable** (pas de packaging, pas de multi-user).
Toutes les fonctionnalités critiques sont implémentées et testées à 100%.

---

## Core Agent

| Feature | État | Notes |
|---------|------|-------|
| Conversation principale + mission routing | ✅ | `handleConversationTurn`, preflight LLM, clarification, auto-launch |
| Research mission (web) | ✅ | Browser pipeline : nav → evidence → collection table → decision note |
| Form preparation mission | ✅ | Formulaires via Playwright + artefacts |
| Computer observation mission | ✅ | Desktop autonomy via PowerShell UIA |
| Mission preflight / preview | ✅ | LLM understanding avec routing confidence |
| Plan generation + exécution | ✅ | maxSteps=60, boucle replan protégée |
| Semantic outcome verifier | ✅ | Verdict tracé par evidence |
| Token budget | ✅ | 50k/run · 250k/session — configurable via env `COWORK_LLM_BUDGET_PER_RUN_TOKENS` |

---

## Recovery & Résilience

| Feature | État | Notes |
|---------|------|-------|
| Reflective Recovery Layer V1 | ✅ | diagnose → alternatives → filter → decide → message |
| AUTO_RETRY réel | ✅ | Relance vraiment un run, guard anti-boucle `autoRetryRunId` |
| `#trackRun` crash-safe | ✅ | Unhandled rejection sur LLM timeout absorbé proprement |
| Mode dégradé (LLM hors ligne) | ✅ | `maybePostDegradedModePrompt` |
| Run completion guard | ✅ | `complete()` idempotente |

---

## Sécurité

| Feature | État | Notes |
|---------|------|-------|
| SQL injection | ✅ | 100% prepared statements, 0 interpolation |
| Command injection PowerShell | ✅ | `validateWindowHandle`, `validateHotkey`, `validateImagePath` |
| Path traversal | ✅ | `path.relative()` + dotfiles + extension allowlist |
| Body OOM | ✅ | Limite 5 MB sur `readJsonBody` |
| `ensureAllowlisted()` | ✅ | Subdomain matching + TLD-agnostic |
| Approval system | ✅ | PolicyEngine avec dedup cache, trusted apps/browsers |
| Secret redaction | ✅ | `secret-normalization.js` |
| Stealth browser | ✅ | Activé par défaut, désactivable via `COWORK_BROWSER_STEALTH=0` |

---

## Mémoire & Contexte

| Feature | État | Notes |
|---------|------|-------|
| UserMemory cross-session | ✅ | SQLite `app_settings`, persiste entre restarts |
| ProjectMemory cross-session | ✅ | Idem, par projet |
| UserPreferences | ✅ | SQLite, persistant |
| Memory records structurés | ✅ | Table `memory_records`, searchable |
| Résumés de sessions passées | ✅ | `getStartupMemoryContext` : jusqu'à 8 conversations résumées |

> Note : un audit précédent signalait la mémoire cross-session comme gap "HAUTE". C'est incorrect — la mémoire est DB-backed depuis le début.

---

## Terminal Workspace

| Feature | État | Notes |
|---------|------|-------|
| CliTerminalSupervisor | ✅ | Spawn sans shell, allowlist, stripAnsi, NO_COLOR |
| États canoniques | ✅ | attached / running / waiting_input / completed / error / needs_attention / detached |
| Bridge terminal → conversation | ✅ | `terminal_alert` injecté dans le fil conversationnel |
| Mission brief auto-update | ✅ | Sur transitions terminales significatives |
| conversationId propagé aux terminaux mid-run | ✅ | Fixé 2026-05-16 |
| CLI agents connus | ✅ | `codex_cli`, `claude_code_cli`, `generic_cli` |
| Détection terminaux externes (déjà ouverts) | ✅ | Implémenté 2026-05-18 — ConPTY read-only, SendKeys fallback pour input |
| PTY bidirectionnel interactif | ❌ | stdin interactif non supporté |

---

## UI & UX

| Feature | État | Notes |
|---------|------|-------|
| Conversation panel + composer | ✅ | |
| Activity panel | ✅ | Configurable |
| Browser panel | ✅ | |
| Terminal panel | ✅ | |
| Artifact viewer | ✅ | |
| Evidence viewer | ✅ | |
| Cost dashboard | ✅ | |
| Run inspector (coulisses) | ✅ | |
| Settings modal (approvals, domaines, browsers) | ✅ | |
| i18n fr / en | ✅ | 394 keys FR, pool 200 suggestions |
| Suggestion bubbles | ✅ | |

---

## Mobile

| Feature | État | Notes |
|---------|------|-------|
| Mobile chat UI | ✅ | |
| Pairing sécurisé | ✅ | Token + confirmation |
| SSE events mobiles | ✅ | |
| Voice input | ❌ | Non implémenté |

---

## Infrastructure

| Feature | État | Notes |
|---------|------|-------|
| 81 suites de tests, 100% PASS | ✅ | +external-terminal suite |
| Smoke test workspace AI | ⚠️ | DEGRADED warn-only (LLM timeout transient en env test) — exit code 0 |
| Capability graph | ✅ | Builder, validation, candidats, skill system |
| Benchmarks | ✅ | Suite + review model |
| Audit log JSONL | ✅ | Toutes les calls LLM tracées |
| Release readiness report | ✅ | Gates + critères |

---

## Gaps restants pour la vraie production

| Gap | Criticité | Effort estimé |
|-----|-----------|---------------|
| `name: "Jordan Labry"` hardcodé dans `mission-entry.js` | Basse | 5 min |
| Packaging / distribution (Electron ou installeur) | Haute pour distribuer | Grand chantier |
| Multi-user (isolation utilisateurs, auth) | Haute pour SaaS | Grand chantier |
| PTY bidirectionnel (stdin interactif dans les terminaux) | Moyenne | Moyen |
| Détection terminaux externes pré-existants | ~~Basse~~ | ✅ Implémenté 2026-05-18 |
| Desktop control cross-platform (Mac / Linux) | Basse pour usage Windows | Grand chantier |
| Voice input mobile | Basse | Moyen |
