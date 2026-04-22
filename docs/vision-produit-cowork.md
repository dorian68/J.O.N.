# Vision produit — Cowork IA

## 1. Position du produit

Le produit cible est un **desktop coworker IA orienté outcome**.

Sa finalité n'est pas de tenir une bonne conversation, ni d'offrir un terminal agentique impressionnant, mais de permettre à un utilisateur de **déléguer un travail réel** et de récupérer un résultat exploitable.

## 2. Comparaison avec deux archétypes voisins

| Archétype | Centre de gravité | Ce qu'il produit surtout | Limite principale pour notre cible |
|---|---|---|---|
| Chat assistant | échange conversationnel | réponses, idées, reformulations | ne termine pas réellement le travail |
| Agent coding CLI | terminal, repo, tools de code | patches, commandes, sessions de dev | trop centré code/CLI, faible forme produit métier |
| Desktop coworker orienté livrables | mission, run, outils, approvals, artefacts | synthèses, dossiers, rapports, actions contrôlées | plus difficile à construire, mais cohérent avec notre ambition |

Notre produit appartient explicitement à la troisième catégorie.

## 3. Problème que le produit veut résoudre

Les assistants actuels aident à réfléchir.

Le produit que nous visons doit aider à **faire avancer puis terminer** le travail.

## 4. Promesse produit

"Donnez un objectif, fournissez le bon périmètre, laissez l'agent travailler sous contrôle, récupérez un livrable exploitable."

Cette promesse implique cinq exigences non négociables :

- comprendre l'objectif,
- agir avec de vrais outils,
- demander validation au bon moment,
- produire un artefact réutilisable,
- laisser un audit clair.

## 5. Ce qu'est le produit

Le produit est :

- une application desktop,
- centrée sur des projets et des runs,
- capable d'utiliser des outils locaux et distants,
- capable de `browser control` et de `computer control` sous supervision,
- orientée livrables,
- gouvernée par permissions et approvals,
- conçue pour monter progressivement vers plus d'autonomie.

## 6. Ce que le produit n'est pas

Le produit n'est pas :

- un clone UI d'un agent CLI,
- un simple chat avec quelques tools,
- un navigateur automatisé sans contrôle,
- une plateforme purement développeur,
- un orchestrateur multi-agent pour le plaisir d'orchestrer,
- un système opaque qui agit sans rendre de comptes.

## 7. Job to be done central

Quand un utilisateur veut transformer une mission floue ou lourde en travail terminé, il doit pouvoir :

1. définir l'objectif et les contraintes,
2. fournir le contexte initial,
3. voir un plan de travail compréhensible,
4. laisser l'agent exécuter ce qui peut l'être,
5. approuver les actions sensibles,
6. récupérer un résultat final vérifiable.

## 8. Cas d'usage centraux

- analyse documentaire et synthèse,
- reporting et transformation de données,
- recherche web assistée puis livrable,
- structuration d'un dossier de travail,
- tâches spécialisées de code sous contrôle quand utile.

## 9. Le vrai centre de gravité du produit

Le centre de gravité n'est ni le terminal, ni la boîte de texte, ni le modèle LLM seul.

Le centre de gravité est le **run de travail**.

Un run comprend :

- une mission,
- un plan,
- un état,
- des outils,
- des permissions,
- des événements,
- des sources,
- des artefacts.

## 10. Conséquences produit

Si le run est le centre du produit, alors :

- l'interface doit être construite autour du run,
- les approvals doivent être des composants natifs,
- l'audit doit être accessible,
- les artefacts doivent être consultables hors conversation,
- la mémoire doit être project-scoped,
- le browser et le desktop ne peuvent pas être des détails ajoutés ensuite,
- le `browser control` et le `computer control` doivent être pensés ensemble, avec une hiérarchie claire et un contrôle strict.

## 11. Utilisateur cible initial

Le meilleur utilisateur de départ est un professionnel qui :

- travaille déjà avec beaucoup de fichiers et d'informations,
- a besoin de produire des synthèses, rapports, notes ou dossiers,
- accepte de superviser l'agent sur les actions sensibles,
- valorise plus le résultat fini que la pure fluidité conversationnelle.

## 12. Anti-objectifs de la v1

La v1 ne doit pas essayer d'être :

- le super-agent généraliste pour toutes les tâches du poste,
- une plateforme de marché de plugins ouverte,
- un système multi-agent complexe dès le départ,
- une couche enterprise lourde,
- un moteur de computer use sans garde-fous.

## 13. Critères de réussite produit

Une mission réussie doit satisfaire simultanément ces conditions :

- l'objectif a été compris correctement,
- les bonnes sources ont été exploitées,
- les outils ont été utilisés sans comportement opaque,
- les approvals ont eu lieu au bon niveau,
- le résultat final est réutilisable sans retravail majeur,
- l'utilisateur peut comprendre ce qui a été fait.

## 14. North star

La bonne phrase de validation utilisateur est :

"Je lui ai délégué un vrai travail, il a avancé proprement sous contrôle, et le résultat m'a réellement fait gagner du temps."
