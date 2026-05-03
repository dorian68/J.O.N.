# Workspace Browser V1

## Statut

`active` — chantier en cours. Implémentation initiale disponible dans le repo.

---

## 1. Pourquoi JON a besoin d'un navigateur intégré

JON est un workspace AI missionnel. Son modèle de travail est :

```
mission → plan → exécution → preuves → artefacts → rapport
```

Jusqu'ici, JON pilotait un navigateur Playwright headless invisible. Le résultat : des preuves et des artefacts produits, mais aucune **surface visible** pour l'utilisateur ou l'opérateur.

Le navigateur intégré (`workspace_browser`) change cela :

| Problème actuel | Solution workspace_browser |
|---|---|
| Browser invisible, exécution opaque | Surface vivante dans le workspace |
| Preuves seulement dans la DB | Screenshots streamés en live vers l'UI |
| URL/titre inconnus pendant la mission | État browser dans le panneau workspace |
| Pas de lien entre navigation et run | Session browser liée au runId |
| Dépendance au profil Chrome utilisateur | Session isolée, reset à chaque run |
| Pas de replay de navigation | Historique de navigation dans le run |

---

## 2. Deux modes de navigation

### `workspace_browser`

Navigateur **géré par JON**, isolé, contrôlé, traçable.

- Démarre sur demande de JON ou d'une mission
- Session isolée (pas de cookies utilisateur, pas d'extensions)
- URL, titre, screenshot streamés vers l'UI
- Événements de navigation liés au runId
- Preuves (screenshots + DOM snapshots) enregistrées automatiquement
- Peut être headless (invisible) ou visible (mode démo / supervision)
- Resetté et nettoyé à la fin de la session

### `system_browser`

Navigateur **personnel de l'utilisateur** (Chrome, Edge, Firefox).

- JON ne lance pas le browser système
- Peut recevoir des URLs à ouvrir via une notification ou clipboard
- Cookies, extensions, sessions personnelles préservées
- Pas de traçabilité complète côté JON
- Pas de screenshots ou DOM snapshots automatiques
- Utilisation recommandée : login utilisateur réel, extensions, contexte personnel

---

## 3. Quand utiliser `workspace_browser`

| Cas d'usage | Mode recommandé | Raison |
|---|---|---|
| Recherche web bornée | `workspace_browser` | Allowlist, preuves, isolation |
| Extraction DOM | `workspace_browser` | DOM accessible via Playwright |
| Screenshot / preuve | `workspace_browser` | Capture automatique liée au run |
| Test reproductible | `workspace_browser` | Session reset, pas de pollution |
| Navigation pour artefact | `workspace_browser` | Lien run→source→preuve intact |
| Login utilisateur existant | `system_browser` | Cookies et sessions personnelles |
| Extensions nécessaires | `system_browser` | JON ne contrôle pas les extensions |
| Profil utilisateur Chrome | `system_browser` | Pas d'accès silencieux aux profils |
| Usage humain direct | `system_browser` | L'utilisateur préfère son browser |

---

## 4. Principes de sécurité

1. **Pas d'accès silencieux aux profils utilisateur** — `workspace_browser` ouvre une session vierge, isolée, sans héritage de cookies/extensions Chrome.

2. **Pas d'extraction de cookies** — le navigateur workspace ne peut pas accéder aux cookies du browser système et ne doit pas essayer.

3. **Allowlist obligatoire** — `openBrowserSession` accepte `allowlistedHosts`. Toute navigation est validée contre cette liste.

4. **Pas de navigation sensible sans approval** — les URLs hors allowlist, les formulaires de paiement, et les champs credential déclenchent une demande d'approval via `PolicyEngine`.

5. **Logs et preuves obligatoires** — chaque navigation, screenshot et action DOM est enregistrée dans les événements du run. Rien n'est silencieux.

6. **Séparation claire workspace vs personnel** — le système ne confond pas les deux modes. L'UI affiche le mode actif.

7. **Cleanup à la fermeture** — la session browser workspace est fermée et nettoyée en fin de run. Pas de persistance de context Playwright entre les runs.

---

## 5. Intégration au workspace AI

Le navigateur workspace devient une **surface vivante** dans l'UI de JON, aux côtés des terminaux.

```
[Conversation] [Terminaux] [Browser] [Trace/Inspector]
```

### Ce que voit l'utilisateur (panneau Browser)

- Mode actif : `workspace` ou `system`
- URL courante + titre de page
- Dernier screenshot (mis à jour à chaque navigation)
- Historique de navigation (dernières 5 URL)
- Statut de session : `inactive` / `active` / `navigating` / `closed`

### Ce que voit l'opérateur (console admin)

- Sessions browser par run
- Événements de navigation (type, URL, timing)
- Preuves capturées (screenshots + DOM snapshots)
- Mode utilisé
- Erreurs et limitations

### Événements SSE émis

| Événement | Contenu | Déclencheur |
|---|---|---|
| `workspace.browser.session.opened` | sessionId, mode, runId | openBrowserSession |
| `workspace.browser.navigated` | url, title, sessionId, runId | navigate success |
| `workspace.browser.screenshot` | base64 PNG (480px), sessionId | après navigation |
| `workspace.browser.session.closed` | sessionId, runId | close/cleanup |

---

## 6. Stratégie technique

### Stack actuelle (implémentée)

- **Provider**: Playwright Chromium bundled
- **Couche**: `BrowserController` (723 lignes) + `BrowserOperator` + `BrowserPlanner`
- **DOM-first**: `dom-strategy.js` avec ranking sémantique
- **Evidence**: `exportPageEvidence()` → screenshot + JSON

### Nouveautés V1 (ce chantier)

- **`BROWSER_MODE`** — constantes `workspace_browser`, `system_browser`, `fixture_browser`
- **`BrowserSessionTracker`** — état vivant de la session browser par projet
- **Mode `headless: false`** — browser workspace visible en mode démo
- **SSE streaming** — navigation events + screenshot base64 vers l'UI
- **`WorkspaceBrowserProvider`** — adapter qui wrappe BrowserController avec mode + events
- **DB table `workspace_browser_sessions`** — persistance des sessions par run
- **Panneau Browser UI** — surface workspace dans le chat
- **API `/workspace/browser`** — endpoint pour l'état courant

### Prochaine étape (V2, hors scope actuel)

- WebView2 integration (Windows) : navigateur intégré dans l'app Electron/MSIX
  - Requiert une couche C#/WinUI ou un addon Node natif
  - CDP via `CallDevToolsProtocolAsync` / `GetDevToolsProtocolEventReceiver`
  - Plus fort en termes d'isolation et de contrôle OS
  - Reporté : complexité shell desktop requise

---

## 7. Abstraction Browser (`app/src/browser/browser-mode.js`)

```js
BROWSER_MODE = {
  WORKSPACE: "workspace_browser",   // JON-managed, isolated, traceable
  SYSTEM:    "system_browser",      // user's personal browser
  FIXTURE:   "fixture_browser"      // controlled test fixture (existing)
}

BrowserSessionState = {
  sessionId, mode, runId, projectId,
  currentUrl, currentTitle, status,
  navigationHistory, screenshotBase64, lastActivityAt
}
```

---

## 8. Référence de sécurité

Voir aussi :
- `docs/threat-model.md` — classification des risques browser
- `docs/browser-control-approval-matrix.md` — quelles actions requièrent une approval
- `docs/permissions-trust-safety.md` — principes généraux
- `docs/browser-control-spec.md` — spec V1 complète

---

## 9. Fichiers implémentés (ce chantier)

| Fichier | Type | Description |
|---|---|---|
| `app/src/browser/browser-mode.js` | Nouveau | Constantes BROWSER_MODE + BrowserSessionTracker |
| `app/src/browser/workspace-browser-provider.js` | Nouveau | Adapter WorkspaceBrowserProvider |
| `app/src/service/operator-service.js` | Modifié | getWorkspaceBrowserState, events SSE |
| `app/src/server/operator-server.js` | Modifié | /workspace/browser endpoint |
| `app/src/storage/database.js` | Modifié | workspace_browser_sessions table |
| `app/ui/src/main.jsx` | Modifié | BrowserSurfacePanel component |
| `app/ui/styles.css` | Modifié | Styles panneau browser |
| `app/tests/browser-mode.test.js` | Nouveau | Tests BrowserMode + BrowserSessionTracker |
