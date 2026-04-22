# Modèle de permissions

## 1. Objectif

Le système de permissions doit permettre à l'agent d'être réellement utile sans devenir opaque ou dangereux. Le modèle doit être suffisamment fin pour contrôler les actions sensibles, sans bloquer l'ensemble de l'expérience.

## 2. Principes

- `Fail closed` : sans permission claire, l'action n'est pas exécutée.
- `Least privilege` : chaque outil n'obtient que le minimum nécessaire.
- `Explicit approval` : les actions sensibles demandent une validation compréhensible.
- `Scope bounded` : une autorisation a toujours un périmètre.
- `Auditability` : toute décision d'autorisation est historisée.
- `Revocability` : une permission accordée peut être retirée.

## 3. Niveaux de risque

Chaque outil et chaque action doivent être classés dans l'un des niveaux suivants.

### Niveau A - Lecture seule

Exemples :

- lire un fichier autorisé,
- lire le DOM d'une page,
- extraire du texte d'un PDF,
- faire une capture d'écran,
- lire un répertoire,
- récupérer la console d'une page.

Politique recommandée :

- autorisable par défaut dans le périmètre du projet,
- journalisation obligatoire.

### Niveau B - Écriture réversible

Exemples :

- créer un brouillon,
- écrire un artefact interne,
- modifier une copie de travail,
- télécharger un fichier vers un dossier projet,
- restructurer un dossier avec possibilité de rollback.

Politique recommandée :

- autorisation par projet ou par session possible,
- confirmation initiale selon le contexte,
- snapshots avant/après si possible.

### Niveau C - Écriture sensible

Exemples :

- modifier un fichier utilisateur existant,
- exécuter une commande shell,
- lancer une application,
- écrire dans un dossier hors workspace projet,
- attacher l'agent à une session navigateur authentifiée,
- appeler Codex CLI pour modifier un repo local.

Politique recommandée :

- confirmation explicite obligatoire,
- description précise de l'action,
- périmètre limité,
- logs détaillés,
- possibilité d'interruption.

### Niveau D - Action externe irréversible

Exemples :

- envoyer un email,
- publier un contenu,
- soumettre un formulaire,
- déclencher une opération e-commerce,
- supprimer définitivement un fichier,
- pousser du code ou ouvrir une PR.

Politique recommandée :

- confirmation unitaire obligatoire,
- jamais d'accord implicite durable,
- aperçu avant exécution,
- traçabilité maximale.

## 4. Périmètres d'autorisation

Une autorisation accordée doit toujours préciser sa portée.

### One-shot

Valable pour une seule action.

### Step

Valable pour l'étape courante du plan.

### Session

Valable jusqu'à fermeture ou fin de session.

### Project

Valable pour le projet courant uniquement.

### Global

À éviter en v1. Réserver aux actions non sensibles et très stables.

## 5. Dimensions d'une permission

Une permission doit pouvoir porter sur :

- l'outil,
- le type d'action,
- le niveau de risque,
- le projet,
- le chemin fichier,
- l'application,
- le domaine web,
- la durée de validité,
- la nécessité ou non d'un aperçu préalable.

## 6. Objets gouvernés

Le système doit gouverner au minimum :

- file system,
- navigateur,
- shell,
- outils desktop,
- connecteurs externes,
- outils de code,
- actions de publication.

## 7. Matrice par grande famille d'outils

### File system

- lecture dans le workspace projet : auto-autorisation projet
- écriture dans les artefacts du projet : autorisation projet possible
- modification d'un fichier utilisateur existant : confirmation explicite
- suppression : confirmation unitaire

### Navigateur

- lecture DOM et navigation simple : autorisation session/projet possible
- téléchargement dans le projet : autorisation projet possible
- saisie formulaire : confirmation selon risque
- soumission formulaire : confirmation unitaire
- attachement à session connectée : confirmation explicite

### Shell

- commandes de lecture : confirmation initiale recommandée
- commandes d'écriture : confirmation explicite
- commandes destructrices : interdiction par défaut sauf décision explicite

### Desktop

- screenshots et inspection : autorisation session possible
- ouverture d'une application autorisée : confirmation initiale
- clic/clavier sur app externe : confirmation explicite si impact non trivial

### Outils de code

- lecture de repo : confirmation initiale selon projet
- édition de code : confirmation explicite
- tests : autorisation session possible si bornée
- push/publication : confirmation unitaire

## 8. Flux UX d'approbation

Une demande d'approbation doit toujours inclure :

- l'action proposée,
- pourquoi elle est nécessaire,
- ce qui sera impacté,
- le niveau de risque,
- le périmètre possible de l'accord,
- les alternatives si refus.

Actions disponibles :

- autoriser une fois,
- autoriser pour cette étape,
- autoriser pour cette session,
- autoriser pour ce projet,
- refuser,
- demander plus de détails.

## 9. Politique de refus

En cas de refus :

- l'action ne part pas,
- le run reste cohérent,
- l'agent doit proposer une alternative,
- le refus est historisé.

L'agent ne doit jamais essayer de contourner un refus.

## 10. Audit

Chaque décision liée à une permission doit stocker :

- utilisateur,
- date,
- run,
- étape,
- outil,
- action,
- portée,
- cible,
- justification de l'agent,
- décision finale.

## 11. Règles de sécurité minimales v1

- interdiction par défaut des suppressions définitives,
- interdiction par défaut des publications externes,
- shell borné et journalisé,
- liste blanche de dossiers et de domaines,
- arrêt d'urgence visible,
- invalidation facile des permissions actives.

## 12. États spéciaux

### Mode lecture seule

L'agent ne peut qu'inspecter, lire, analyser et proposer.

### Mode supervision renforcée

Toute action non lecture seule demande validation.

### Mode projet de confiance

Certaines actions réversibles peuvent être pré-autorisées pour le projet.

## 13. Recommandation v1

La meilleure politique initiale est :

- lecture autorisée dans le périmètre projet,
- écriture réversible autorisable au niveau projet,
- shell, desktop actif, code et navigateur authentifié soumis à validation explicite,
- publication et suppression définitive toujours en one-shot.

## 14. Questions à trancher

- faut-il autoriser le shell lecture seule sans popup systématique ?
- faut-il distinguer davantage navigateur connecté et navigateur non connecté ?
- quel niveau de pré-autorisation accepter pour Codex CLI ?
- veut-on un mode "apprendre mes préférences" dès la v1 ou plus tard ?
