# General Desktop Control Cowork Strategy V1

## Statut

Product and technical strategy note.

## Verdict court

L'objectif produit vise bien un vrai cowork desktop generaliste: l'utilisateur exprime une mission naturelle, l'agent comprend l'objectif, decouvre les applications/outils disponibles, choisit une strategie, agit sur la machine, verifie, puis restitue.

Le repo actuel n'implemente pas encore ce niveau. Il implemente un cowork local borne avec quelques capacites explicites. Pour atteindre un controle desktop generaliste, il faut changer d'echelle: passer d'un catalogue de scenarios a une couche d'autonomie desktop gouvernee.

Le bon objectif n'est pas un agent "sans limites". Le bon objectif est un agent avec champ d'action large, mais gouverne par permissions, approvals, audit, politiques de risque, rollback et verification.

## Ce que "controle desktop integral" implique

Un vrai controle desktop generaliste doit pouvoir:

- inventorier les applications installees et accessibles;
- comprendre quelle application est pertinente pour une mission;
- ouvrir une application;
- observer l'interface visible;
- comprendre l'etat UI par accessibilite, DOM, OCR et vision;
- cliquer, taper, scroller, utiliser des raccourcis;
- manipuler des fichiers locaux;
- gerer plusieurs fenetres;
- passer d'un outil a l'autre;
- demander une clarification quand l'intention ou la cible est ambigue;
- demander approval avant action sensible;
- verifier que l'action a vraiment reussi;
- produire une preuve exploitable.

## Challenges majeurs

### 1. Securite

Un agent capable d'agir partout peut supprimer, envoyer, publier, acheter, exposer des secrets ou modifier des fichiers critiques.

Il faut donc:

- permissions par type d'action;
- allow/deny policies;
- confirmations pour actions irreversibles;
- blocage par defaut des actions dangereuses;
- journal d'audit complet;
- secret store et redaction stricts.

### 2. Fiabilite UI

Les interfaces changent, les boutons bougent, les fenetres perdent le focus, les popups apparaissent.

Il faut donc:

- preferer APIs structurees quand disponibles;
- utiliser UI Automation / Accessibility avant la vision brute;
- fallback OCR/vision quand necessaire;
- verification apres chaque action;
- recovery quand l'etat observe ne correspond pas au plan.

### 3. Raisonnement agentique

Le coeur ne peut pas etre un mapping statique.

Il faut:

- mission understanding par LLM;
- planner qui choisit outils/apps;
- executor qui agit et observe;
- verifier/evaluator qui juge l'outcome;
- policy checker qui bloque ou demande approval;
- memory/capability graph des apps disponibles.

### 4. Decouverte des outils

L'agent doit connaitre la machine:

- applications installees;
- navigateurs;
- chemins executables;
- handlers de fichiers;
- dossiers utilisateur;
- apps autorisees;
- capacites detectees par app.

Cette decouverte doit etre persistante, rafraichissable et auditable.

### 5. Verification et rollback

Un agent desktop generaliste doit prouver ce qu'il a fait.

Il faut:

- captures avant/apres;
- snapshots UI;
- logs d'actions;
- fichiers crees/modifies;
- verification explicite;
- undo/rollback quand possible;
- arret propre si verification impossible.

## Stack technique cible Windows-first

### Desktop shell

- Electron, Tauri ou Windows App SDK pour une vraie app desktop.
- Tray/background service optionnel.
- Auto-update et packaging signe plus tard.

### Runtime agentique

- Node.js conserve pour le serveur local et l'orchestration actuelle.
- Worker specialise pour l'automation OS:
  - .NET/C# pour Windows UI Automation;
  - ou Python avec pywinauto/pyautogui en prototype;
  - ou Rust si l'objectif est robustesse et packaging.

### Observation desktop

- Windows UI Automation / Accessibility tree.
- Screenshot capture par fenetre/ecran.
- OCR local ou cloud selon politique.
- Vision model pour cas non structurables.
- Window manager pour focus, enumeration, geometry.

### Action desktop

- Launch app via registry/start menu/executable allowlist.
- Focus window.
- Click/type/scroll/hotkeys avec approvals selon risque.
- File operations via APIs structurees plutot que gestes UI quand possible.
- Browser automation via Playwright/CDP quand la cible est web.

### Agent reasoning

- LLM gateway existante.
- Prompts structures:
  - mission_understanding
  - tool/app_selection
  - desktop_plan
  - action_decision
  - verification
  - recovery
- Sorties JSON strictement validees.
- Fallback conservateur si LLM indisponible.

### Policy and safety

- Policy engine central.
- Capability manifests par application.
- Risk levels par primitive:
  - observe
  - focus
  - open
  - read
  - write
  - click
  - type
  - submit/send/publish/delete/pay
- Approval broker obligatoire pour actions sensibles.

### Persistence and audit

- SQLite local conserve.
- Action log append-only.
- Evidence store.
- Screenshots redacted/minimized.
- Run chain + action chain.
- Export session de test.

## Architecture cible minimale

```text
User mission
  -> Mission understanding
  -> Capability discovery / app selection
  -> Bounded desktop plan
  -> Policy review
  -> Approval if needed
  -> Action executor
  -> Observation
  -> Verification
  -> Recovery or next action
  -> Outcome summary + evidence
```

## Ce qu'il faut ajouter au repo actuel

### Lot 1: Capability discovery

- inventaire apps installees;
- detection des apps ouvrables;
- classification par type: browser, office, file manager, terminal, etc.;
- stockage dans un capability registry local.

### Lot 2: Desktop primitive layer

- open application;
- focus window;
- observe active window;
- capture window/screen;
- click;
- type;
- scroll;
- hotkey;
- file open/save helpers.

Chaque primitive doit avoir:

- niveau de risque;
- approval policy;
- preuve attendue;
- verification attendue.

### Lot 3: Agentic desktop planner

- stage LLM `desktop_plan`;
- selection d'app/outils selon mission;
- plan multi-step;
- stop/clarify si ambigu;
- verification goals par step.

## Etat repo actuel apres fondation V1

Le repo implemente maintenant une premiere version de `desktop autonomy foundation`:

- discovery d'applications installees;
- primitives desktop gouvernees;
- stage LLM `desktop_plan`;
- executor observe/action/verify;
- approvals pour lancement, saisie, clic, hotkey et scroll;
- preuves et verification summary.

Ce n'est toujours pas une autonomie desktop production-ready: l'accessibility tree, l'OCR/vision, la recuperation robuste et les skills app-specifiques restent les prochains gaps.

### Lot 4: Executor loop

- boucle observe -> decide -> act -> verify;
- pas d'action sans policy check;
- pas d'action sensible sans approval;
- arret si l'etat UI diverge.

### Lot 5: User-facing trust UX

- preflight lisible;
- action preview;
- approval claire;
- evidence/outcome summary;
- "ce que je vais faire / ce que je ne ferai pas".

## Difference avec le repo actuel

Actuel:

- scenarios bornes;
- quelques actions desktop autorisees;
- browser launch/search/capture;
- multi-run borne;
- verification et audit.

Cible generaliste:

- applications decouvertes dynamiquement;
- outils selectionnes par l'agent;
- primitives desktop generiques;
- loop d'execution observe/act/verify;
- politique de risque plus riche;
- agent capable de missions multi-apps.

## Risque produit principal

Si on ouvre tout sans policy solide, le produit devient dangereux et instable.

Si on garde trop de scenarios fixes, le produit reste un formulaire intelligent.

La bonne voie est:

- champ fonctionnel large;
- primitives generales;
- decisions LLM structurees;
- garde-fous stricts;
- approvals explicites;
- verification systematique.

## Conclusion

Oui, l'objectif est compris: construire une version personnelle de cowork desktop capable d'agir librement sur la machine selon une mission naturelle.

Mais pour le faire correctement, il faut un vrai sous-systeme de desktop autonomy, pas seulement ajouter des scenarios. Le prochain chantier coherent est donc `desktop autonomy foundation`: capability discovery, primitives desktop gouvernees, planner LLM desktop, executor loop et verification.
