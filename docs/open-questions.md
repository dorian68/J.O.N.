# Questions ouvertes

## But du document

Lister les décisions non tranchées qui ont un impact réel sur la conception future du produit. Une question reste ouverte tant qu'aucune décision explicite, expérimentation ou ADR ne l'a fermée.

Ce document ne remplace pas les ADRs. Il sert à :

- prioriser les sujets de recherche,
- éviter les non-décisions implicites,
- préparer les futurs prototypes et arbitrages.

## Méthode de classement

- `P0` : bloque une architecture crédible ou un prototype utile.
- `P1` : n'empêche pas de démarrer, mais peut entraîner une mauvaise direction si on tarde trop.
- `P2` : utile à cadrer plus tard, sans effet bloquant immédiat.

## P0. Questions structurantes

### 1. Shell desktop : Electron ou Tauri ?

**Pourquoi la question compte**

Le shell conditionne :

- l'intégration desktop,
- le packaging,
- l'accès aux capacités natives,
- la stratégie de distribution,
- le coût opérationnel de l'équipe.

**Ce qui est déjà clair**

- le produit est `desktop-first`,
- le shell ne doit pas devenir le cœur métier,
- la priorité est la fiabilité et l'intégration, pas l'élégance technologique isolée.

**Ce qu'il faut tester plus tard**

- ergonomie des capacités natives nécessaires,
- facilité d'intégration avec le runtime agentique,
- observabilité locale,
- complexité de distribution Windows.

### 2. Quel niveau exact de contrôle navigateur viser en première implémentation ?

**Pourquoi la question compte**

Le navigateur est une couche structurante du produit. Il faut décider si la première version doit couvrir :

- navigation et extraction,
- formulaires et authentification,
- téléchargement et upload,
- gestion multi-onglets,
- fallback vision si le DOM est insuffisant.

**Risque si la décision tarde**

Soit on construit une couche trop pauvre, proche d'un fetch amélioré, soit on ouvre trop vite une surface d'exécution difficile à sécuriser.

**Ce qu'il faut tester plus tard**

- scénarios réels par verticale,
- stabilité des interactions,
- coût UX des approbations associées,
- besoin réel d'un fallback vision.

### 3. Quelle frontière exacte entre navigateur contrôlé et computer use ?

**Pourquoi la question compte**

Une partie des cas d'usage peut être couverte par un navigateur piloté proprement. Une autre nécessite une interaction OS plus large. La frontière a un impact direct sur :

- la sûreté,
- le périmètre MVP,
- la complexité de test,
- la perception produit.

**Hypothèse actuelle**

Le navigateur contrôlé doit arriver avant le computer use large.

**Ce qu'il faut tester plus tard**

- fréquence des cas réellement non couverts par la couche navigateur,
- coût de maintenance d'une couche desktop native,
- risques d'ambiguïté sur l'état visible à l'écran.

### 4. Le runtime agentique principal doit-il être unifié ou réparti entre plusieurs langages ?

**Pourquoi la question compte**

Cette décision influence :

- la vitesse de prototypage,
- la robustesse du runtime,
- l'intégration outillage,
- la maintenabilité.

**Tension principale**

- un runtime unifié simplifie l'architecture,
- une séparation shell/runtime peut optimiser chaque couche, mais ajoute des interfaces à stabiliser.

**Ce qu'il faut tester plus tard**

- coût de la séparation inter-processus,
- ergonomie de développement,
- facilité de test des événements et tools,
- alignement avec les bibliothèques réellement utiles pour navigateur et desktop.

### 5. Quel modèle de persistance locale adopter dès le départ ?

**Pourquoi la question compte**

Le produit repose sur des objets persistants : projets, runs, approvals, artefacts, sources, skills, journaux. Il faut éviter un stockage ad hoc difficile à migrer.

**Ce qu'il faut trancher**

- base locale relationnelle ou mélange fichiers + index,
- stratégie de stockage des blobs d'artefacts,
- journal d'événements append-only ou reconstruction d'état seulement.

**Ce qu'il faut tester plus tard**

- volumétrie attendue,
- simplicité de sauvegarde/export,
- robustesse en cas d'arrêt brutal,
- facilité de migration de schéma.

### 6. Mono-agent supervisé jusqu'où, avant d'introduire de vrais sous-agents ?

**Pourquoi la question compte**

La délégation multi-agent est une promesse forte, mais elle peut devenir une fuite en avant. Il faut décider ce que le mono-agent doit maîtriser avant toute expansion.

**Décision actuelle**

Pour le prototype V1, la décision est désormais fermée :

- mono-agent supervisé maintenu ;
- pas de second agent autonome vérificateur ;
- rôles de vérification, policy et revue d'artefact internalisés dans le runtime.

Voir :

- [multi-agent-reassessment.md](./multi-agent-reassessment.md)
- [agent-roles-and-responsibilities-v1.md](./agent-roles-and-responsibilities-v1.md)
- [agent-supervision-and-evaluation-loop.md](./agent-supervision-and-evaluation-loop.md)

**Ce qu'il faut tester plus tard**

- quelles sous-tâches justifient réellement un agent spécialisé,
- coût cognitif de supervision,
- effet sur les temps d'exécution et le coût modèle.

## P1. Questions importantes mais non bloquantes immédiates

### 7. Produit strictement local-first ou hybride local + services distants ?

**Pourquoi la question compte**

Cette décision impacte :

- confidentialité,
- synchronisation,
- coût d'infrastructure,
- collaboration future,
- récupération après panne machine.

**Hypothèse actuelle**

Commencer par un cœur local-first, sans fermer la porte à des services distants ultérieurs.

**Ce qu'il faut tester plus tard**

- besoins réels de sync,
- contraintes de sécurité des utilisateurs cibles,
- volume de données et charge d'indexation.

### 8. Quel modèle de skills adopter ?

**Pourquoi la question compte**

Les skills peuvent être :

- simples paquets d'instructions,
- bundles mêlant instructions, ressources et templates,
- extensions outillées avec validation et versioning forts.

**Risque**

Un modèle trop léger devient opaque et peu testable. Un modèle trop lourd ralentit l'itération.

**Ce qu'il faut tester plus tard**

- mode de découverte automatique,
- stratégie de versioning,
- niveau de traçabilité nécessaire,
- séparation entre skill métier et capability technique.

### 9. Quels artefacts doivent être de première classe dans le MVP ?

**Pourquoi la question compte**

L'orientation outcome du produit dépend des artefacts réellement pris en charge, pas seulement de la qualité conversationnelle.

**Ce qu'il faut trancher**

- note structurée,
- email draft,
- document,
- présentation,
- tableau/export.

**Ce qu'il faut tester plus tard**

- formats les plus demandés par la cible prioritaire,
- coût de génération,
- facilité d'édition et d'export,
- valeur réelle perçue par l'utilisateur.

### 10. Jusqu'où va la politique d'approbation configurable ?

**Pourquoi la question compte**

Une politique trop rigide crée une fatigue d'approbation. Une politique trop large crée du risque.

**Ce qu'il faut tester plus tard**

- granularité utile par projet,
- approbations de session pertinentes,
- fréquence d'erreurs humaines dues à la répétition,
- compréhension par l'utilisateur non expert.

### 11. Faut-il concevoir très tôt une synchronisation cloud des projets ?

**Pourquoi la question compte**

La sync paraît attractive, mais elle impose :

- résolution de conflits,
- stratégie de chiffrement,
- identités utilisateurs,
- migrations et compatibilités.

**Hypothèse actuelle**

Ne pas la rendre structurante tant que le modèle local n'est pas stable.

## P2. Questions à traiter plus tard

### 12. Quelle forme de collaboration multi-utilisateur est réellement nécessaire ?

Le produit initial vise un utilisateur principal. La collaboration temps réel ne doit pas déformer la v1.

### 13. Faut-il une marketplace de skills ou seulement un registre local/privé ?

La marketplace peut attendre tant que la forme des skills n'est pas stabilisée.

### 14. Quel niveau d'administration entreprise faut-il viser ?

À différer tant que le produit n'a pas validé sa valeur unitaire et son modèle de permissions.

### 15. Quelle stratégie de télémetrie produit est acceptable ?

Sujet important, mais dépendant du mode de déploiement et du niveau de confidentialité attendu.

## Questions de validation produit

Ces questions ne sont pas purement techniques. Elles conditionnent aussi la forme du produit.

### 16. Quelle verticale prioritaire maximise la valeur de la v1 ?

Possibilités déjà identifiées :

- production documentaire et analytique,
- business ops / reporting,
- e-commerce,
- préparation de livrables exécutifs.

### 17. Quelle mission type doit servir de scénario de référence ?

Le produit a besoin d'un petit nombre de scénarios canoniques pour guider :

- le design de l'UX,
- le choix des artefacts,
- les permissions,
- l'évaluation qualité.

### 18. Quel niveau de correction/réécriture autonome est acceptable avant validation humaine ?

La réponse dépend du type d'artefact, du niveau de risque et du contexte métier.

## Recommandation de priorisation

L'ordre recommandé d'investigation est :

1. shell desktop,
2. niveau exact de browser control,
3. frontière navigateur / computer use,
4. runtime unifié ou séparé,
5. persistance locale,
6. seuil d'introduction des sous-agents,
7. modèle de skills,
8. artefacts MVP,
9. stratégie d'approbation configurable,
10. sync cloud éventuelle.

## Règle de gouvernance

Une question ouverte doit aboutir à l'une des trois issues suivantes :

- un ADR,
- une expérimentation explicite,
- un report assumé avec justification.

Une question laissée implicite finit presque toujours par devenir une dette d'architecture.
