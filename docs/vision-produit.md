# Vision produit

## 1. Ambition

Construire un coworker IA desktop qui prend en charge un objectif de travail complet, agit avec des outils réels, et revient avec un livrable exploitable plutôt qu'une simple réponse conversationnelle.

Le produit doit être perçu comme :

- un opérateur numérique fiable,
- un assistant de production orienté résultat,
- un système supervisable,
- un environnement de travail par projet.

## 2. Problème à résoudre

Les assistants IA classiques échouent souvent sur les tâches de travail réelles pour quatre raisons :

- ils ne tiennent pas bien le contexte opérationnel,
- ils ne savent pas agir proprement sur les outils du poste,
- ils n'offrent pas assez de contrôle sur les permissions,
- ils rendent des réponses plutôt que des livrables finalisés.

Le produit doit fermer ce gap entre "bonne conversation" et "travail réellement terminé".

## 3. Promesse utilisateur

"Définis ton objectif, branche tes sources, laisse l'agent travailler sous contrôle, récupère un livrable prêt à être utilisé."

## 4. Job to be done principal

Quand un utilisateur doit transformer des informations dispersées en résultat concret, il veut déléguer le travail de recherche, de structuration, d'exécution et de rédaction à un agent qui reste contrôlable et traçable.

## 5. Type de produit

Le produit n'est pas :

- un chatbot généraliste,
- un assistant purement conversationnel,
- un RPA aveugle,
- un framework développeur pur,
- une simple interface de prompts.

Le produit est :

- une application desktop agentique,
- centrée projet,
- orientée livrables,
- outillée,
- gouvernée par permissions,
- observable de bout en bout.

## 6. Utilisateur idéal v1

L'utilisateur idéal de la v1 :

- travaille souvent avec documents, tableurs, navigateur et dossiers locaux,
- veut gagner du temps sur l'analyse et la production,
- accepte de superviser des actions sensibles,
- attend un résultat final structuré et réutilisable,
- n'a pas envie d'orchestrer manuellement dix outils différents.

## 7. Cas d'usage signature

### Cas 1

Analyser un dossier de documents, compléter avec des recherches web, puis produire une note de synthèse sourcée.

### Cas 2

Lire plusieurs exports Excel/CSV et générer un rapport de management avec hypothèses, tableaux et recommandations.

### Cas 3

Préparer un deck ou un document de travail à partir de sources internes et d'éléments récupérés dans le navigateur.

### Cas 4

Sur une tâche de code bornée, utiliser sous contrôle un outil spécialisé comme Codex CLI pour explorer, modifier puis vérifier un livrable technique.

## 8. Piliers d'expérience

Le produit doit être excellent sur cinq dimensions.

### 8.1 Compréhension

L'agent reformule correctement l'objectif, identifie les inconnues et propose un plan crédible.

### 8.2 Exécution

L'agent sait vraiment agir sur les fichiers, le navigateur et les outils autorisés.

### 8.3 Contrôle

L'utilisateur sait toujours ce qui est en train de se passer et peut approuver, refuser, corriger ou arrêter.

### 8.4 Qualité

Le livrable final est structuré, lisible, sourcé et suffisamment propre pour être réutilisé immédiatement.

### 8.5 Traçabilité

Les étapes, outils, sources et décisions restent visibles après le run.

## 9. Différenciation produit

Le produit doit se distinguer par :

- une UX centrée run plutôt que chat,
- un vrai système de permissions graduées,
- une combinaison cohérente de navigateur, desktop, fichiers et outils,
- des artefacts de qualité,
- un mode projet durable,
- une montée progressive vers l'autonomie plutôt qu'une promesse magique.

## 10. Anti-objectifs

La v1 ne doit pas chercher à être :

- l'agent universel pour toute tâche imaginable,
- un produit social ou collaboratif complexe,
- une plateforme plugin ouverte dès le départ,
- un moteur multi-agent généralisé,
- un système opaque qui agit sans rendre de comptes.

## 11. Principe de progression

La progression produit recommandée est :

1. produire de bons livrables,
2. fiabiliser les outils,
3. rendre les permissions naturelles,
4. améliorer la mémoire et la reprise,
5. ajouter des spécialisations,
6. seulement ensuite déléguer à plusieurs agents.

## 12. North star

Une mission est réussie si l'utilisateur peut dire :

"L'agent a compris le but, a utilisé les bons outils, m'a demandé au bon moment, et m'a rendu un résultat que je peux vraiment utiliser."

## 13. Critères de réussite v1

- premier livrable utile en quelques minutes,
- plan clair et révisable,
- approvals compréhensibles,
- logs réellement lisibles,
- artefacts exportables,
- faible besoin de retravail manuel,
- confiance suffisante pour relancer une deuxième mission.

## 14. Scénario de démonstration idéal

1. L'utilisateur crée un projet.
2. Il dépose des PDF, un Excel et une consigne.
3. L'agent construit un plan.
4. L'agent lit les fichiers, complète sur le web via navigateur contrôlé et demande validation pour une action sensible.
5. L'agent produit une synthèse et un deck de travail.
6. L'utilisateur voit les sources, l'historique et exporte le résultat.

## 15. Ligne directrice de design produit

Chaque décision doit répondre à une question simple :

"Est-ce que cela augmente la capacité du système à terminer un vrai travail sous contrôle utilisateur ?"

Si la réponse est non, la feature ne mérite probablement pas la v1.
