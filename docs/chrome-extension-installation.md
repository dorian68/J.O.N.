# Installer l'extension Chrome de JON

L'extension « JON Attached Tab Bridge » permet à JON d'automatiser un onglet Chrome déjà ouvert (observer, lire le DOM, cliquer, taper) via le backend local — sans lancer un navigateur séparé.

## Installation en < 3 minutes

1. **Télécharge l'extension** depuis JON Desktop : *Settings → Browser Automation → « Download Chrome Extension »* (ou directement `GET http://127.0.0.1:41732/api/browser-extension/download`).
2. **Dézippe** le fichier `jon-chrome-extension-vX.Y.Z.zip` dans un dossier (ex. `Documents\jon-chrome-extension`).
3. Ouvre **`chrome://extensions`** dans Chrome.
4. Active **« Mode développeur »** (Developer Mode), en haut à droite.
5. Clique **« Charger l'extension non empaquetée »** (Load unpacked).
6. Sélectionne le **dossier dézippé** (celui qui contient `manifest.json`).
7. L'icône JON apparaît dans la barre d'extensions. Sur l'onglet à piloter, **clique l'icône JON** pour l'attacher.
8. Dans JON, le statut passe à **« connecté »** (Settings → Browser Automation → Connection status), avec la version et le dernier heartbeat.

## Vérifier la connexion

- JON Desktop : *Settings → Browser Automation* affiche `connected / disconnected`, `extension version`, `last heartbeat`.
- API : `GET /api/browser-extension/health` → `{ connectedTabs, packaged:{version}, ... }`.

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| Statut reste « disconnected » | L'extension pointe sur `ws://127.0.0.1:41732/...`. Vérifie que JON tourne sur le port 41732 (sinon ajuste `backendWsUrl` dans le storage de l'extension). |
| « TAB_OWNED_BY_OTHER_CONNECTION » | Un autre onglet/instance détient déjà cette session ; ferme l'autre ou ré-attache. |
| Rien ne se passe sur l'onglet | Clique l'icône JON **sur l'onglet ciblé** pour l'attacher (l'extension n'agit que sur les onglets attachés). |
| Extension non chargée | Vérifie que tu as sélectionné le dossier contenant `manifest.json` (pas le `.zip`). |

## Sécurité

- Le bridge n'accepte que des connexions **loopback** avec une origine `chrome-extension://`.
- Un résultat de commande n'est accepté **que depuis la connexion qui a émis la commande** (anti-spoofing), et une session d'onglet ne peut pas être détournée par une autre connexion.
- L'exécution de JavaScript arbitraire / commandes CDP est **désactivée par défaut** (`JON_ENABLE_BROWSER_EVAL=true` pour l'autoriser, à n'utiliser qu'avec des plans de confiance).

## Reconstruire le zip (développeur)

```bash
npm run build:chrome-extension      # valide le manifest
npm run package:chrome-extension    # écrit dist/jon-chrome-extension.zip
```
