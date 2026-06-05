# PRODUCT_PHILOSOPHY.md — JON

## En une phrase

**JON est un « agent OS » personnel et local pour Windows : un coworker qui exécute réellement des tâches sur TON ordinateur (bureau, navigateur, fichiers, outils connectés), avec preuve, contrôle et arrêt à tout moment — piloté depuis le desktop ou le téléphone.**

## La promesse

> Donne une intention en langage naturel. JON la traduit en actions réelles sur des surfaces réelles (applications Windows, Chrome, système de fichiers, outils MCP), te montre ce qu'il fait, produit un livrable vérifiable, et s'arrête quand tu le demandes.

Ce que JON N'EST PAS :
- pas un chatbot qui répond du texte ;
- pas un SaaS cloud qui exfiltre ton travail (tout est **local**, secrets en DPAPI) ;
- pas une démo : les actions, livrables et connecteurs sont **réels** ou explicitement étiquetés « simulé / à configurer ».

## Pour qui

Un utilisateur Windows (indépendant, opérateur, power-user) qui veut déléguer des tâches concrètes :
- « ouvre ce site et note les infos dans un fichier » ;
- « compare ces pages et fais-moi une note de décision (PDF) » ;
- « pilote mon PC depuis mon téléphone ».

## Principes directeurs (non négociables)

1. **Réel d'abord.** Une feature montrée doit faire ce qu'elle dit. Le simulé est étiqueté.
2. **Local et privé.** Aucune dépendance tierce obligatoire ; secrets chiffrés (DPAPI) ; loopback par défaut.
3. **Sous contrôle.** Approbations sur actions sensibles, arrêt d'urgence universel, autonomie réglable.
4. **Vérifiable.** Chaque mission produit des preuves (captures, log d'actions, livrable).
5. **Cross-surface.** Une intention peut enchaîner web → bureau → fichier avec passage de données.
6. **Backend-first & CLI-testable.** Toute capacité doit être démontrable en CLI, pas seulement via l'UI.
7. **Honnête.** Pas d'échec silencieux : si JON est en mock, bloqué, ou ne sait pas faire, il le dit.

## Le « moment de valeur » (aha)

L'utilisateur tape une demande → voit JON ouvrir réellement l'app/le site, agir étape par étape (log visible), et récupère **un fichier livrable** ou un résultat vérifié — en < 2 minutes, sans toucher au clavier.

## Critère de réussite commerciale

Un utilisateur cible, après un parcours de 5 minutes, doit pouvoir dire :
> « J'ai compris en 30 s, j'ai confiance, ça a vraiment fait le travail, et je paierais pour gagner ce temps. »

Si l'un de ces 4 manque (clarté, confiance, exécution réelle, valeur), le produit n'est pas prêt commercialement.
