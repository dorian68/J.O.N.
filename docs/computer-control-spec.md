# Computer Control Spec

## Statut

Canonical capability document.

Ce document réintroduit explicitement le `computer control` comme capacité officielle du produit. Il ne le traite plus comme un appendice hors produit. Il fixe ce que cette capacité signifie, sa relation au `browser control`, et sa forme prudente dans le prototype.

Documents liés :
- [vision-produit-cowork.md](./vision-produit-cowork.md)
- [architecture-cible.md](./architecture-cible.md)
- [browser-and-computer-control.md](./browser-and-computer-control.md)
- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)

## 1. Décision principale

Le `computer control` fait partie du produit cible.

Décision fermée :

- `browser control` et `computer control` sont deux capacités officielles du produit ;
- `browser control` reste la voie principale quand le DOM et les signaux navigateur sont disponibles ;
- `computer control` n'est pas un substitut opportuniste au DOM ;
- `computer control` revient dans le prototype sous une forme bornée, auditée et benchmarkable.

## 2. Définition

Dans ce produit, `computer control` désigne la capacité du système à observer et, plus tard, à agir sur l'interface informatique locale au-delà du seul DOM navigateur.

Cela comprend potentiellement :

- la détection et la qualification de la fenêtre active ;
- la mise au premier plan d'une fenêtre autorisée ;
- la capture d'une fenêtre, d'une zone ou d'un écran ;
- l'observation d'états visibles ou accessibles ;
- des interactions bornées avec l'interface locale quand elles sont explicitement autorisées.

Cela ne signifie pas :

- une automation totale du poste ;
- un agent vision-first opaque ;
- un substitut générique à une intégration structurée ;
- un droit implicite d'agir partout sur la machine.

## 3. Pourquoi cette capacité fait partie du produit

Le produit cible est un `desktop coworker`, pas seulement un contrôleur de navigateur.

Sans `computer control`, le produit resterait limité sur :

- les surfaces non DOM ;
- les dialogues système ;
- les changements de focus entre fenêtres ;
- certaines zones visuellement pertinentes mais structurellement pauvres ;
- la supervision de l'état réel affiché à l'écran.

Conclusion :

- `computer control` est une capacité produit officielle ;
- sa maturité initiale peut rester inférieure à celle du `browser control`.

## 4. Objectifs de la capacité

Les objectifs réels du `computer control` sont :

- compléter le `browser control`, pas le remplacer ;
- donner au runtime une conscience plus fiable de l'environnement informatique visible ;
- gérer proprement certaines transitions hors DOM ;
- produire des preuves visibles et auditables ;
- préparer plus tard des tâches desktop plus larges, sous contrôle strict.

## 5. Périmètre de la capacité

### Inclus au niveau produit

- observation de fenêtre et d'état visible ;
- focus et contexte applicatif ;
- capture d'évidence visuelle ;
- attente d'un état UI observable ;
- vérification d'outcome visible ;
- actuation locale bornée et gouvernée, dans des versions ultérieures.

### Hors périmètre structurel

- stealth anti-bot ;
- CAPTCHA bypass ;
- credential harvesting ;
- surveillance cachée du poste ;
- automation de masse non supervisée ;
- pilotage opportuniste de tout ce qui est cliquable à l'écran.

## 6. Forme retenue dans le prototype

Le prototype ne réintroduit pas un `computer control` général.

Il réintroduit un `computer control` `observability-first`, `window-aware`, `safe-by-default`.

Dans le prototype autorisé, cette capacité couvre uniquement :

- `detect_active_window`
- `focus_allowlisted_window`
- `capture_window_or_region`
- `wait_for_ui_state`
- `verify_visible_outcome`
- `export_action_evidence`
- `launch_supported_browser_after_explicit_approval`
- `load_requested_search_page_in_supported_browser`
- `capture_visible_browser_window_in_a_separate_bounded_run`
- `discover_installed_applications`
- `plan_governed_desktop_primitives`
- `launch_discovered_application_after_explicit_approval`
- `type_text_after_explicit_approval`
- `click_scroll_or_hotkey_after_explicit_approval`

Ne sont pas autorisés dans le premier build :

- `cursor move`
- `click`
- `double click`
- `right click`
- `drag`
- `keyboard input`
- `hotkeys`
- lancement général d'applications
- manipulation de dialogues système réels

Exception désormais autorisée dans la V1 courante :

- lancement borné d'un navigateur local supporté et détecté sur la machine
- chargement borné d'une page de recherche demandée dans ce navigateur
- capture bornée de la fenêtre navigateur visible comme run séparé et vérifié
- lancement gouverné d'une application locale découverte
- primitives desktop générales mais approuvées: saisie texte, clic ponctuel, scroll, hotkey, capture
- uniquement après approval explicite
- avec vérification de fenêtre visible et preuve persistée
- sans ouvrir la voie à un lancement arbitraire d'applications
- sans autoriser un contrôle desktop généralisé de l'application lancée

## 7. Couches fonctionnelles

### 7.1 Observation layer

Responsable de :

- savoir quelle fenêtre est active ;
- capturer ce qui est visible ;
- décrire l'état UI observable ;
- remonter une base de preuve.

### 7.2 Targeting and focus layer

Responsable de :

- qualifier la bonne fenêtre ou la bonne surface ;
- demander approval quand un changement de contexte est sensible ;
- éviter d'agir sur la mauvaise cible.

### 7.3 Actuation layer

Responsable, plus tard, de :

- pointer ;
- cliquer ;
- saisir ;
- scroller ;
- déclencher des interactions locales.

Dans le prototype actuel, cette couche reste presque entièrement fermée.

Un seul sous-slice d'actuation locale est désormais rouvert :

- initier l'ouverture d'un navigateur local supporté ;
- charger une page de recherche visible dans ce navigateur quand la mission le demande ;
- permettre ensuite une capture bornée de la fenêtre navigateur dans un run séparé ;
- découvrir les applications locales et planifier une courte séquence de primitives desktop gouvernées ;
- rester limité au lancement et à la vérification visible ;
- ne pas dériver vers une autonomie non approuvée, non vérifiée ou dangereuse.

### 7.4 Verification and evidence layer

Responsable de :

- comparer l'état visible attendu et l'état visible observé ;
- décider si l'outcome est validé, ambigu ou échoué ;
- produire les preuves exploitables pour audit et benchmark.

## 8. Dépendances

Le `computer control` dépend fortement de :

- [permissions-trust-safety.md](./permissions-trust-safety.md)
- [computer-control-safety-and-approval-matrix.md](./computer-control-safety-and-approval-matrix.md)
- [event-taxonomy.md](./event-taxonomy.md)
- [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md)
- [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md)

Il dépend aussi d'une bonne frontière avec le navigateur :

- [computer-control-vs-browser-control-boundary.md](./computer-control-vs-browser-control-boundary.md)

## 9. Relation avec approvals, artefacts, audit et persistence

### Approvals

Le `computer control` demande une discipline plus stricte que le `browser control` parce que la structure est souvent moins riche et l'ambiguïté plus forte.

Principes :

- observation seule peut être auto-approuvée sur surface autorisée ;
- changement de focus est gouverné ;
- actuation locale reste bloquée ou explicitement approuvée ;
- ambiguïté de cible => stop.

### Artefacts

Le `computer control` ne crée pas un artefact final à lui seul.

Il alimente :

- les preuves du run ;
- la justification de certains outcomes ;
- la compréhension d'un état visible local.

### Audit

Le `computer control` doit être plus auditable que spectaculaire.

Il faut pouvoir répondre à :

- quelle fenêtre était ciblée ;
- pourquoi ;
- quelle preuve visuelle a été capturée ;
- quel outcome visible a été vérifié ;
- pourquoi le système a continué ou s'est arrêté.

### Persistence

Les captures et preuves locales doivent suivre le même principe de minimisation que le reste du prototype :

- conserver ce qui est utile à la reprise, au benchmark et à l'audit ;
- ne pas conserver massivement des captures sensibles par défaut.

## 10. Principaux risques

- agir sur la mauvaise fenêtre ;
- capturer un contenu sensible inutilement ;
- croire qu'un état visible confirme un outcome alors que ce n'est pas suffisant ;
- utiliser le `computer control` comme échappatoire au lieu de résoudre proprement le cas DOM ;
- dériver vers une automation locale opaque et difficile à benchmarker.

## 11. Runtime implications and useful `claw-code` inspirations

La réintroduction du `computer control` renforce plusieurs choix runtime déjà inspirés de `claw-code` :

- `worker_boot` inspire une logique d'états explicites pour les transitions de contexte risqué ;
- `session` inspire une persistance minimale mais structurée des preuves et du run ;
- `trust_resolver` inspire des gates explicites sur surfaces et contextes autorisés ;
- `conversation runtime` inspire la séparation entre exécution, permissions, hooks et journal d'événements ;
- les rôles bornés par outils inspirent une séparation forte entre agent agissant, policy checker et vérificateur internalisé.

La leçon utile n'est pas “mettre plus d'agents”.

La leçon utile est :

- quand une capacité devient plus risquée et plus ambiguë, il faut d'abord renforcer la structure de runtime, les événements, la policy et le recovery.

## 12. Position architecturale retenue

Position retenue :

- le `computer control` est réintroduit officiellement dans le produit ;
- il entre dans l'architecture cible comme couche durable ;
- il entre dans le prototype sous une forme bornée ;
- il ne supprime pas la hiérarchie `DOM-first` ;
- il augmente l'importance du rôle interne de vérification, sans imposer un second agent autonome.

## 13. Décision finale

Décision canonique :

- `computer control` = `partie officielle du produit`
- `computer control` prototype = `borné, observability-first, browser-first`
- `computer control` général et actuatif = `plus tard, après benchmarks et réouverture de gate`
