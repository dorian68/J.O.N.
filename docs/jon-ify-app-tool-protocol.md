# Étude de faisabilité — « JON-ifier » une app (App Tool Protocol)

## Concept

Comme une voiture qui passe au garage : JON **étudie** une application desktop, en **dérive des capacités sous forme de tools** (comme un serveur MCP), écrit un **manifest d'app**, puis **appelle ces tools** dans sa boucle agentique — exactement comme il appelle déjà des tools MCP. But : pousser le concept « agent IA-OS » à l'extrême via un protocole uniforme « app = serveur de tools ».

```
studyApp(app)  →  probe (accessibilité) + LLM  →  app-manifest.json (tools[])
                     ↓ enregistré comme "connecteur d'app" local (registre MCP existant)
callAppTool(app, tool, args)  →  résout le contrôle au runtime  →  exécute via pattern d'accessibilité  →  vérifie
```

## Ce que JON a DÉJÀ (la moitié du chemin existe)

| Brique nécessaire | Existant dans JON |
|---|---|
| Inspection arbre d'UI Windows | `windows-control.ps1` : UIA (`UIAutomationClient`, `AutomationElement.FromHandle`, `Convert-AutomationElement`, `ControlType`, `BoundingRectangle`), `Get-AccessibilityTree` |
| Aplatissement / ciblage sémantique | `desktop-perception.js` : `flattenAccessibilityTree`, `buildSemanticTargets`, `resolveSemanticTarget`, `summarizeAccessibility` |
| Exécution desktop + sécurité | `computer-control-service.js`, `desktop-safety.js` (approbations, autonomie, blocages), arrêt d'urgence, evidence |
| Modèle de tools + registre | `mcp-connector-service.js` (`listTools`/`callTool`), registre connecteurs persistant, graphe de capacités |
| Raisonnement → tool calls | gateway LLM + sortie structurée + boucle plan→act→observe |

**Manque** : (1) extraire les **patterns** UIA (Invoke/Value/Toggle/Expand/Selection) — aujourd'hui on lit surtout la géométrie ; (2) **générer/persister un manifest** d'app ; (3) **exécuter par élément** (pattern) au lieu de clics coordonnés ; (4) **exposer** le manifest comme tools au planner.

## Windows — Faisabilité : **HAUTE**

**Sonde (study).** UI Automation expose pour chaque contrôle : `ControlType` (Button, MenuItem, Edit, ComboBox, Tab…), `Name`, `AutomationId`, et surtout des **patterns** actionnables :
- `InvokePattern` → action « cliquer » (boutons, items de menu) → tool sans paramètre.
- `ValuePattern` → lire/écrire un champ → tool `set_value(value)`.
- `TogglePattern` / `ExpandCollapsePattern` / `SelectionItemPattern` / `ScrollPattern` → toggles, menus, listes.
Walk de l'arbre + expansion contrôlée des menus → liste de capacités brutes.

**Manifest (LLM).** Le gateway transforme l'arbre brut en manifest sémantique : `{ tool, description, when_to_use, params, selector:{automationId|name|path}, action:{pattern} }`. Persisté comme un « connecteur d'app » dans le registre existant → les tools apparaissent au planner à côté des MCP.

**Exécution (call).** Un tool call résout le contrôle au runtime (par `AutomationId`/Name/chemin) puis applique le pattern (Invoke/SetValue…) — **par élément, pas en coordonnées aveugles** → bien plus robuste, et déjà couvert par approbations/abort/evidence.

**Limites Windows :**
- Apps **Win32 classiques / WinForms / WPF / UWP** : UIA riche → excellent.
- **Electron/Chromium** : UIA partiel (souvent l'arbre web n'est pas exposé) → fallback DOM via l'extension/CDP, ou vision/OCR (déjà dans JON).
- **Custom-drawn / jeux / Canvas** : aucune accessibilité → fallback vision + coordonnées (dégradé, déjà présent).
- **Localisation** : les `Name` varient par langue → préférer `AutomationId` + type + position relative.
- **UI dynamique** : un manifest est un instantané ; re-sonder à la volée + re-résoudre par sélecteur tolérant.
- **Effets de bord** : découvrir les menus = les ouvrir → faire en mode « étude » isolé, sans valider.

**Effort estimé Windows :** moyen (≈ 1–2 semaines pour un MVP solide), car ~60 % de l'infra existe. Nouveau : extracteur de patterns (ps1), générateur de manifest (LLM), exécuteur par pattern, exposition au planner, persistance.

## Ubuntu (natif & WSL) — Faisabilité : **MOYENNE à HAUTE selon l'affichage**

L'équivalent Linux d'UIA est **AT-SPI2** (Assistive Technology SPI) via D-Bus : rôles (`push button`, `menu item`, `text`…), **actions** (`do_action`) et états. Outils : `libatspi`/`pyatspi`, `dogtail`, `ldtp`.

- **Ubuntu natif sous X11** : **HAUTE**. Inspection via AT-SPI ; actuation via `do_action` (clic logique sans coordonnées) ou `xdotool` (coordonnées). Très proche du modèle Windows.
- **Ubuntu sous Wayland** : inspection AT-SPI **OK**, mais **injection d'entrée globale restreinte par design** (sécurité Wayland) → préférer `do_action` (AT-SPI agit dans l'app sans input global) ; sinon `ydotool`/`uinput` (droits) ou portails. Actuation plus délicate.
- **WSL (ton cas : Ubuntu sur Windows)** : les apps GUI Linux tournent via **WSLg** (compositeur Weston/Wayland + XWayland). Spécificités :
  - AT-SPI doit être **activé** : bus `at-spi-bus-launcher`, `GTK_MODULES`, `QT_ACCESSIBILITY=1`, `ACCESSIBILITY_ENABLED=1`. Pas garanti par défaut → étape de setup.
  - Apps **GTK/Qt** exposent bien AT-SPI ; actuation par `do_action` contourne la restriction d'input Wayland.
  - Apps **X11 via XWayland** : `xdotool` fonctionne pour l'input.
  - JON backend tourne côté Windows ; piloter une app WSLg = soit un **agent-relais léger dans WSL** (petit service Python/AT-SPI exposant probe/call en JSON sur loopback), soit via `wsl.exe` exec. Le relais est le design propre.

**Effort estimé Ubuntu :** moyen-élevé (le relais AT-SPI + l'adaptateur Wayland/X11 sont du code neuf ; setup accessibilité à scripter).

## Le protocole unifié proposé — « App Tool Protocol (ATP) »

Un seul schéma de manifest, deux adaptateurs de plateforme :

```jsonc
// app-manifest (même forme qu'un listTools MCP)
{
  "app": "notepad",
  "platform": "windows",          // windows | linux-x11 | linux-wayland | wslg
  "tools": [
    { "name": "save_file", "description": "Enregistre le fichier courant",
      "params": [{ "name": "path", "type": "string", "required": false }],
      "selector": { "automationId": "Item 2", "name": "Enregistrer", "controlType": "MenuItem" },
      "action": { "kind": "invoke" } }
  ]
}
```

- **Adaptateur Windows** : probe = UIA tree+patterns ; execute = pattern UIA.
- **Adaptateur Linux** : probe = AT-SPI roles+actions ; execute = `do_action`/xdotool.
- **Réutilise tel quel** : registre de connecteurs, tool-calling du planner, approbations, abort, evidence, persistance — donc une app « JON-ifiée » devient indistinguable d'un serveur MCP pour l'agent.

## Verdict

- **Windows : faisable et naturel** — ~60 % de l'infra existe (UIA + tools + sécurité). C'est l'extension la plus alignée avec « JON = agent IA-OS ».
- **Ubuntu natif X11 : faisable** (AT-SPI ≈ UIA).
- **WSLg/Wayland : faisable pour l'inspection**, actuation plus délicate (préférer AT-SPI `do_action` + relais WSL) — mais réaliste.

## Plan d'implémentation par phases (si go)

1. **MVP read-only (Windows)** : `studyApp` → extraire patterns UIA → générer + persister un manifest (aucune exécution). Smoke : manifest non vide sur Notepad/Calc/Explorer.
2. **Exécuteur par pattern (Windows)** : `callAppTool` via Invoke/Value, derrière approbations + abort + evidence. Smoke : `notepad.set_text` + `save_file`.
3. **Exposition au planner** : enregistrer le manifest comme connecteur local → le planner peut choisir `app.notepad.save_file`. Smoke journey.
4. **Adaptateur Linux (X11)** via relais AT-SPI dans WSL. 5. **Wayland/WSLg** (`do_action`, setup accessibilité). 6. **Re-sonde adaptative** (manifests qui se rafraîchissent quand l'UI change).

Risques transverses : variabilité/instabilité des UI, apps sans accessibilité (fallback vision), localisation, maintenance (apps qui changent), sécurité (n'actionner que des apps approuvées).
