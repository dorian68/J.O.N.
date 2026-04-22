# Spec outils browser et desktop

## 1. Objectif

Définir la première couche d'outils pour permettre à l'agent d'agir sur le navigateur et le poste local de manière fiable, observable et gouvernée par permissions.

## 2. Principes généraux

- les outils doivent avoir des contrats simples,
- chaque action doit produire un résultat structuré,
- tout appel doit être journalisable,
- le navigateur doit être piloté d'abord par état réel, pas par suppositions,
- le desktop doit rester borné et prioriser les APIs natives sur la vision.

## 3. Modèle générique d'un tool

Chaque outil doit exposer :

- `name`
- `description`
- `risk_level`
- `input_schema`
- `output_schema`
- `approval_policy`
- `timeout_policy`
- `retry_policy`

Chaque exécution doit produire :

- `status`
- `started_at`
- `ended_at`
- `input`
- `output`
- `logs`
- `artifacts`
- `error` si échec

## 4. Couche navigateur

La couche navigateur doit combiner :

- actions haut niveau robustes,
- inspection bas niveau via CDP,
- captures et logs,
- attachement à une session Chrome existante si autorisé.

## 5. Outils navigateur v1

### `browser.open_page`

But :

- ouvrir une URL ou un nouvel onglet.

Entrées minimales :

- `url`
- `new_tab`
- `wait_until`

Sorties minimales :

- `page_id`
- `final_url`
- `title`

### `browser.read_dom`

But :

- extraire contenu, structure et éléments utiles d'une page.

Entrées minimales :

- `page_id`
- `selector` optionnel
- `include_text`
- `include_links`
- `include_forms`

Sorties minimales :

- `url`
- `title`
- `elements`
- `main_text`

### `browser.click`

But :

- cliquer un élément identifié.

Entrées minimales :

- `page_id`
- `selector` ou `element_ref`
- `preflight_only`

Sorties minimales :

- `clicked`
- `navigation_detected`
- `post_state_summary`

### `browser.type`

But :

- remplir un champ.

Entrées minimales :

- `page_id`
- `selector`
- `text`
- `clear_first`

Sorties minimales :

- `typed`
- `field_snapshot`

### `browser.submit`

But :

- soumettre un formulaire ou déclencher une action web à impact.

Entrées minimales :

- `page_id`
- `selector`
- `preflight_only`

Sorties minimales :

- `submitted`
- `navigation_detected`
- `network_summary`

Niveau de risque :

- souvent `D`

### `browser.screenshot`

But :

- prendre une capture pour audit ou vision.

Entrées minimales :

- `page_id`
- `full_page`
- `selector` optionnel

Sorties minimales :

- `image_path`
- `viewport`

### `browser.download`

But :

- déclencher ou récupérer un téléchargement dans le projet.

Entrées minimales :

- `page_id`
- `target_dir`

Sorties minimales :

- `downloaded`
- `saved_path`
- `mime_type`

### `browser.get_console_logs`

But :

- lire les logs console de la page.

### `browser.get_network_trace`

But :

- obtenir les requêtes réseau récentes utiles à l'analyse.

### `browser.attach_chrome`

But :

- s'attacher à une session Chrome existante.

Contraintes :

- permission explicite,
- affichage clair de la session ciblée,
- risques de session authentifiée bien signalés.

## 6. Couche CDP

Le produit doit supporter des capacités CDP quand Playwright haut niveau ne suffit pas.

Capacités prioritaires :

- récupérer DOM brut,
- écouter console et réseau,
- capturer screenshot,
- lire état onglets/cibles,
- attacher une cible existante,
- obtenir cookies ou stockage uniquement si explicitement autorisé.

Règle :

- ne pas exposer CDP brut directement au planner,
- passer par des outils internes avec politiques claires.

## 7. Couche desktop

La couche desktop v1 doit rester prudente. Elle sert d'abord à inspecter, ouvrir, cibler et réaliser des actions simples.

## 8. Outils desktop v1

### `desktop.list_windows`

But :

- lister les fenêtres visibles et leurs métadonnées principales.

Sorties minimales :

- `window_id`
- `title`
- `process_name`
- `bounds`
- `is_focused`

### `desktop.focus_window`

But :

- amener une fenêtre au premier plan.

Entrées minimales :

- `window_id`

### `desktop.capture_screen`

But :

- capturer tout l'écran ou une fenêtre.

Entrées minimales :

- `window_id` optionnel
- `region` optionnelle

Sorties minimales :

- `image_path`
- `capture_target`

### `desktop.inspect_ui`

But :

- lire l'arbre UI accessible d'une fenêtre.

Entrées minimales :

- `window_id`
- `depth`

Sorties minimales :

- `nodes`
- `interactive_elements`

### `desktop.click`

But :

- cliquer un élément identifié via UI Automation ou coordonnées.

Politique :

- préférer un élément sémantique,
- n'utiliser les coordonnées qu'en fallback.

### `desktop.type`

But :

- saisir du texte dans un champ identifié.

### `desktop.launch_app`

But :

- ouvrir une application autorisée.

Entrées minimales :

- `app_id` ou `path`
- `arguments`

### `desktop.close_app`

But :

- fermer une application, seulement si autorisé.

## 9. OCR et vision

Le système doit fournir deux capacités séparées :

- OCR pour extraire du texte rapidement,
- interprétation visuelle pour des zones non accessibles autrement.

Outils minimaux :

- `vision.ocr_image`
- `vision.describe_region`

Règle :

- utiliser d'abord DOM, filesystem ou UI Automation,
- utiliser la vision seulement si les signaux structurés ne suffisent pas.

## 10. Contrat d'état avant action

Avant une action sensible, l'outil doit pouvoir fournir un `preflight` :

- cible détectée,
- état actuel,
- impact estimé,
- niveau de risque,
- besoin d'approbation.

Ce `preflight` doit nourrir l'UI d'approbation.

## 11. Erreurs à normaliser

Les erreurs doivent être catégorisées.

Catégories minimales :

- `not_found`
- `permission_denied`
- `timeout`
- `ambiguous_target`
- `page_changed`
- `window_changed`
- `tool_unavailable`
- `unsafe_action_blocked`

## 12. Invariants de sécurité

- aucun tool n'agit hors de son contrat,
- les écritures sont bornées par chemin/domaine/contexte,
- les actions à impact exigent validation,
- les sorties contiennent assez d'état pour audit,
- l'arrêt d'urgence interrompt les tools longs.

## 13. Événements à streamer dans l'UI

Pour chaque tool call :

- début d'exécution,
- demande d'approbation,
- validation ou refus,
- logs intermédiaires,
- résultat,
- erreur éventuelle,
- artefacts produits.

## 14. Recommandation v1

Pour la première version, les outils à industrialiser en priorité sont :

- `browser.open_page`
- `browser.read_dom`
- `browser.click`
- `browser.type`
- `browser.screenshot`
- `browser.download`
- `desktop.list_windows`
- `desktop.capture_screen`
- `desktop.inspect_ui`
- `desktop.launch_app`

Le reste peut venir après une première boucle produit fiable.
