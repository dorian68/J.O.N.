# Cahier des charges v1

## 1. Objet du produit

Construire une application desktop agentique permettant à un utilisateur de déléguer un objectif de travail à un assistant IA capable de :

- comprendre la mission,
- analyser les sources disponibles,
- produire un plan visible,
- exécuter des actions sur fichiers, terminal, navigateur et applications autorisées,
- demander validation pour les actions sensibles,
- revenir avec un livrable exploitable et traçable.

Le produit doit être pensé comme un environnement de travail par projet, avec contexte, historique, permissions et artefacts propres à chaque workspace.

## 2. Vision produit

### Promesse

"Donnez un objectif, connectez vos sources, validez les actions sensibles, récupérez un livrable prêt à l'emploi."

### Positionnement

Le produit doit se comporter comme un coworker numérique de production, pas comme un chatbot généraliste. La valeur vient de la combinaison :

- raisonnement avancé,
- exécution outillée,
- supervision claire,
- qualité du livrable final.

### Cadrage recommandé

La v1 doit rester verticalisée. Le meilleur point d'entrée actuel est :

- production documentaire et analytique,
- synthèse multi-sources,
- reporting et présentations,
- navigation web utile au contexte,
- automatisation locale encadrée.

## 3. Principes produit

- `Artifacts first` : le succès se mesure au livrable produit.
- `Approval first` : les actions à risque sont soumises à validation.
- `Project scoped` : contexte, mémoire et permissions sont bornés par projet.
- `Observable by design` : le plan, les étapes, les outils et les résultats sont visibles.
- `Local first` : les données et outils locaux priment tant que c'est viable.
- `Single agent first` : le multi-agent est une évolution, pas une hypothèse de départ.

## 4. Cibles utilisateurs

### Cible primaire

- fondateurs,
- consultants,
- analystes,
- équipes ops,
- équipes finance,
- e-commerce managers,
- product managers.

### Cible secondaire

- développeurs,
- analystes avancés,
- équipes innovation IA,
- opérations internes.

## 5. Cas d'usage prioritaires

1. Lire un dossier de documents et produire une synthèse exécutive.
2. Transformer des CSV, PDF et fichiers Excel en rapport structuré.
3. Préparer un deck ou un memo à partir de sources hétérogènes.
4. Naviguer sur le web pour compléter un dossier puis citer les sources utiles.
5. Organiser un répertoire projet et proposer une structure documentaire plus propre.
6. Exécuter une tâche de recherche, rédaction ou structuration dans une boucle plan-exécution-vérification.
7. Sur des tâches de code ciblées, déléguer ponctuellement à un outil externe comme Codex CLI sous supervision explicite.

## 6. Périmètre v1

### In scope

- application desktop,
- gestion de projets/workspaces,
- import et lecture de fichiers locaux,
- saisie d'objectif et contraintes,
- planification visible,
- exécution multi-étapes,
- navigateur contrôlé,
- shell contrôlé,
- couche outils/connecteurs,
- validations utilisateur,
- génération d'artefacts finaux,
- historique complet des runs,
- reprise après interruption,
- export des résultats.

### Out of scope

- autonomie totale sans validation pour actions à risque,
- marketplace publique de skills,
- orchestration massive multi-agents,
- automatisation système non bornée,
- multi-tenant entreprise avancé,
- collaboration temps réel complexe.

## 7. Flux utilisateur cible

1. L'utilisateur crée ou ouvre un projet.
2. Il ajoute des fichiers, consignes, objectifs et restrictions.
3. L'agent produit un plan initial et signale les actions nécessitant approbation.
4. L'agent exécute les étapes, journalise ses actions et met à jour l'état.
5. L'utilisateur valide ou refuse les actions sensibles.
6. L'agent produit un ou plusieurs artefacts finaux avec hypothèses, sources et résumé d'exécution.
7. Le run reste rejouable, raffinnable et exportable.

## 8. Exigences fonctionnelles

### 8.1 Projet / workspace

Chaque projet doit contenir :

- nom,
- description,
- consignes permanentes,
- objectifs,
- fichiers attachés,
- base de connaissances légère,
- historique des runs,
- artefacts produits,
- paramètres de permissions,
- connecteurs autorisés.

### 8.2 Saisie de mission

L'utilisateur doit pouvoir préciser :

- objectif libre,
- niveau de profondeur,
- type de livrable attendu,
- contraintes métier,
- délai souhaité,
- sources autorisées,
- actions interdites,
- niveau d'autonomie souhaité.

### 8.3 Planification

Avant ou au début d'un run, le système doit produire :

- reformulation de l'objectif,
- hypothèses initiales,
- étapes prévues,
- outils pressentis,
- demandes d'approbation probables,
- sorties attendues.

Le plan doit être révisable en cours d'exécution.

### 8.4 Runtime agentique

Le runtime minimal doit contenir :

- un `planner`,
- un `executor`,
- un `reviewer`,
- un `state manager`,
- un `policy engine`,
- un `approval engine`.

Exigences :

- progression étape par étape,
- logs lisibles,
- suspension/reprise,
- annulation,
- retry ciblé,
- conservation d'état,
- traitement des erreurs,
- détection d'impasse.

### 8.5 Outils et connecteurs

La couche outils doit standardiser l'accès aux capacités externes.

Connecteurs prioritaires v1 :

- système de fichiers local,
- navigateur contrôlé via Chrome DevTools Protocol,
- shell contrôlé,
- lecture PDF,
- lecture/écriture DOCX, XLSX, PPTX,
- email draft,
- capture d'écran,
- OCR de base,
- bridge MCP.

Classification de risque des outils :

- lecture seule,
- écriture réversible,
- écriture sensible,
- action externe irréversible.

### 8.6 Contrôle navigateur

Le produit doit piloter le navigateur de façon fiable avec deux niveaux :

- niveau haut : navigation, clics, formulaires, lecture DOM, téléchargements,
- niveau bas : accès CDP pour DOM, réseau, console, screenshots et attachement à une session Chrome.

Le navigateur doit être observable dans la timeline du run.

### 8.7 Contrôle desktop

Le produit doit pouvoir, à terme, agir sur le poste local avec garde-fous.

Pour la v1, le contrôle desktop doit rester borné à :

- lecture d'état,
- ouverture d'applications autorisées,
- interaction sur actions simples,
- screenshots et inspection,
- automatisation Windows prioritaire.

Les actions destructrices ou ambiguës doivent exiger confirmation.

### 8.8 Permissions

Le système doit permettre :

- approbation unitaire,
- approbation pour une session,
- approbation pour un projet,
- refus explicite,
- règles de confiance configurables.

Exemples d'actions sensibles :

- modifier ou supprimer un fichier,
- exécuter une commande shell,
- envoyer un email,
- valider un formulaire web,
- utiliser un outil externe de code,
- déclencher une action métier irréversible.

### 8.9 Gestion du contexte

Le contexte doit être injecté juste à temps, et non chargé massivement.

Le système doit proposer :

- indexation légère,
- récupération ciblée,
- résumés intermédiaires,
- mémoire de session,
- citations de sources,
- compression du contexte,
- bornes strictes sur les fenêtres de contexte.

### 8.10 Skills

Le produit doit exposer un registre local de skills activables automatiquement ou manuellement.

Exigences :

- registre versionné,
- critères d'activation,
- logs d'activation,
- possibilité de test par skill,
- périmètre de permissions par skill.

Skills prioritaires v1 :

- analyse documentaire,
- synthèse business,
- reporting Excel/PDF,
- rédaction d'email,
- création de présentation,
- structuration de fichiers,
- code assisté sous supervision.

### 8.11 Artefacts

Le produit doit générer des artefacts autonomes et exportables :

- note de synthèse,
- rapport,
- email draft,
- présentation,
- tableau,
- checklist,
- plan d'action,
- dossier restructuré.

Exigences :

- aperçu,
- versioning,
- duplication,
- export,
- régénération partielle,
- validation utilisateur,
- métadonnées de provenance.

### 8.12 UI / UX

L'interface doit montrer autre chose qu'un simple fil de messages.

Blocs minimaux :

- objectif courant,
- projet courant,
- plan visible,
- timeline du run,
- outils utilisés,
- sources consultées,
- demandes d'approbation,
- artefacts,
- résumé final,
- actions `rerun`, `refine`, `export`.

États minimaux :

- vide,
- analyse,
- exécution,
- en attente d'approbation,
- terminé,
- erreur,
- reprise.

### 8.13 Historique et audit

Chaque run doit conserver :

- prompt initial,
- plan,
- étapes exécutées,
- outils utilisés,
- validations,
- fichiers consultés,
- fichiers modifiés,
- outputs intermédiaires,
- output final,
- erreurs,
- timestamps,
- coût estimé.

## 9. Exigences non fonctionnelles

### 9.1 Sécurité

- stockage sécurisé des secrets,
- séparation lecture/écriture,
- logs d'audit,
- consentement explicite,
- sandbox des outils critiques,
- arrêt d'urgence,
- liste blanche de dossiers, applications et domaines.

### 9.2 Performance

- démarrage rapide,
- UI fluide,
- streaming des logs,
- jobs longs asynchrones,
- reprise après crash,
- chargement paresseux des historiques.

### 9.3 Qualité

- tests unitaires,
- tests d'intégration,
- tests end-to-end,
- jeux d'évaluation par cas d'usage,
- score qualité par run,
- vérification des champs attendus,
- détection des sorties incomplètes.

### 9.4 Compatibilité

- Windows prioritaire,
- macOS en second,
- Linux optionnel.

### 9.5 Observabilité

- traces par tool call,
- erreurs catégorisées,
- métriques de coût,
- durée par run,
- taux d'approbation,
- taux de complétion,
- taux de rerun.

## 10. Architecture fonctionnelle cible

Le système doit être structuré autour de quatre blocs :

- `desktop shell`,
- `runtime agentique`,
- `couche outils`,
- `stockage et mémoire`.

Une couche `LLM gateway` sépare les modèles du reste du runtime pour permettre routage, fallback et journalisation.

## 11. MVP recommandé

Le MVP doit être crédible, pas maximal.

### Capacités à inclure

- application desktop,
- projets/workspaces,
- fichiers locaux,
- planner + executor + reviewer,
- navigateur contrôlé,
- approvals simples,
- 3 à 5 skills,
- historique des runs,
- export.

### Artefacts MVP

- note de synthèse,
- email draft,
- document ou deck de travail.

### Skills MVP

- analyse documentaire,
- reporting Excel/PDF,
- synthèse business,
- création de présentation,
- structuration de dossier.

## 12. Roadmap proposée

### Phase 1

- shell desktop,
- projets,
- fichiers locaux,
- run engine,
- approvals,
- artefacts,
- logs et exports.

### Phase 2

- MCP,
- navigateur plus robuste,
- moteur d'évaluation renforcé,
- reprise longue durée,
- règles de permissions plus fines,
- citations et provenance,
- instrumentation usage/coût.

### Phase 3

- contrôle desktop plus complet,
- workflows multi-apps,
- délégation multi-agent,
- policies équipe/entreprise,
- bibliothèque de skills plus large.

## 13. KPI de succès

### Produit

- taux de complétion des missions,
- temps moyen jusqu'au premier livrable,
- taux de rerun,
- taux d'édition manuelle après génération,
- taux d'acceptation des artefacts.

### Business

- activation J7,
- nombre moyen de runs par projet,
- rétention mensuelle,
- coût IA par mission,
- marge brute par client.

## 14. Risques principaux

- produit trop généraliste trop tôt,
- outil browser/desktop peu fiable,
- friction excessive sur les permissions,
- coût modèle trop élevé,
- mauvaise qualité des artefacts,
- trop de contexte injecté,
- UX qui retombe en simple chat,
- confusion entre autonomie perçue et autonomie réellement maîtrisée.

## 15. Ligne de conduite

La bonne v1 n'est pas un clone complet d'un agent généraliste. La bonne v1 est un coworker de production, borné, explicable, fiable, avec :

- missions bien délimitées,
- outils bien choisis,
- artefacts de qualité,
- audit clair,
- sécurité réelle,
- montée progressive vers plus d'autonomie.
