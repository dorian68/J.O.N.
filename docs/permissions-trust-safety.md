# Permissions, trust et safety

## 1. Objet du document

Ce document décrit le modèle de confiance du futur Cowork IA.

Le produit vise des actions réelles sur :

- fichiers,
- navigateur,
- ordinateur,
- connecteurs,
- outils externes,
- et éventuellement code.

Le système de permissions ne peut donc pas être un détail d'implémentation. Il fait partie du produit.

## 2. Principes directeurs

- `Safe by default` : l'absence d'autorisation explicite signifie refus.
- `Least privilege` : un tool ne reçoit que le niveau d'accès nécessaire.
- `Bounded scope` : toute autorisation a un périmètre.
- `Explain before acting` : l'utilisateur doit comprendre ce qui est demandé.
- `Audit by design` : toute décision sensible est traçable.
- `Revocable trust` : une autorisation durable peut être retirée.
- `No silent escalation` : un niveau de risque supérieur ne doit jamais être franchi implicitement.

## 3. Niveaux de risque canoniques

## 3.1 Lecture seule

Exemples :

- lire un fichier autorisé,
- lire le DOM d'une page,
- lire une ressource MCP,
- capturer un screenshot,
- inspecter une fenêtre,
- lire des logs.

Politique recommandée :

- généralement autorisable au niveau projet,
- journalisation systématique,
- aucune modification effective.

## 3.2 Écriture réversible

Exemples :

- créer un brouillon,
- écrire un artefact dans un espace dédié,
- télécharger un fichier dans le workspace projet,
- générer une copie de travail,
- modifier un dossier réversible avec snapshot.

Politique recommandée :

- peut être autorisée à l'échelle projet ou session selon contexte,
- doit rester bornée,
- rollback souhaitable.

## 3.3 Écriture sensible

Exemples :

- modifier un fichier utilisateur existant,
- exécuter une commande shell,
- lancer ou piloter une application,
- écrire hors du périmètre projet,
- attacher une session navigateur authentifiée,
- utiliser un outil externe de code sur un repo local.

Politique recommandée :

- approbation explicite,
- portée limitée,
- justification lisible,
- arrêt possible,
- audit détaillé.

## 3.4 Action externe irréversible

Exemples :

- envoyer un email,
- publier un contenu,
- soumettre un formulaire,
- déclencher une action métier,
- supprimer définitivement,
- pousser du code ou publier une release.

Politique recommandée :

- approbation unitaire obligatoire,
- jamais de pré-autorisation durable par défaut,
- aperçu avant exécution,
- trace maximale.

## 4. Sources de confiance

La confiance peut provenir de plusieurs niveaux, mais chacun doit rester explicite.

### 4.1 Confiance implicite minimale

Le système peut supposer :

- lecture locale dans le périmètre clairement autorisé,
- écriture dans la zone d'artefacts dédiée du projet,
- consultation de l'historique et de la mémoire du projet.

### 4.2 Confiance de session

Accords temporaires valables jusqu'à la fin de session.

### 4.3 Confiance de projet

Accords liés à un projet donné :

- domaine web autorisé,
- dossier autorisé,
- type d'écriture réversible autorisé,
- connecteur donné en lecture.

### 4.4 Confiance interdite par défaut

Certaines actions ne doivent jamais devenir "normales" sans décision spécifique :

- publication externe,
- suppression définitive,
- shell non borné,
- contrôle desktop ambigu,
- actions sur session authentifiée sans confirmation.

## 5. Logique d'approbation

Une demande d'approbation doit toujours expliciter :

- l'action,
- la cible,
- pourquoi l'action est nécessaire,
- le niveau de risque,
- le périmètre d'accord possible,
- les conséquences si elle est exécutée,
- ce qu'il se passe si l'utilisateur refuse.

## 6. Périmètres d'accord

Les scopes minimaux à supporter sont :

- `once`
- `step`
- `run`
- `session`
- `project`

Le scope global doit être évité pour les actions sensibles.

## 7. Fatigue d'approbation

Un mauvais système d'approbation rend le produit inutilisable.

Les principes pour éviter cette fatigue sont :

- regrouper les actions homogènes à faible risque,
- ne pas demander deux fois la même autorisation dans le même scope,
- afficher l'impact réel plutôt qu'un message générique,
- différencier clairement lecture, écriture réversible et action irréversible,
- permettre des approvals de projet quand le risque le justifie,
- ne pas casser le run si une alternative sûre existe.

Le but n'est pas de supprimer les approvals. Le but est de les rendre rares, compréhensibles et utiles.

## 8. Garde-fous non négociables

- arrêt d'urgence visible,
- journal d'audit non désactivable,
- liste blanche de chemins, domaines et applications,
- séparation claire entre zones de travail et zones sensibles,
- snapshots avant actions réversibles importantes,
- refus par défaut des destructions définitives,
- refus par défaut des publications externes,
- refus par défaut des actions desktop ambiguës.

## 9. Ce que nous refusons par défaut

Par défaut, le produit doit refuser :

- toute suppression définitive,
- tout envoi ou toute publication externe,
- toute exécution shell non cadrée,
- toute écriture hors périmètre sans approval,
- toute action sur navigateur authentifié sans signal fort,
- toute automation desktop qui n'identifie pas clairement sa cible,
- toute pré-autorisation permanente de type full access.

## 10. Journal d'audit

Le journal d'audit doit enregistrer au minimum :

- l'horodatage,
- le run,
- l'étape,
- l'outil,
- la cible,
- le niveau de risque,
- la justification de l'agent,
- la décision d'autorisation,
- l'utilisateur ayant décidé,
- le résultat final de l'action.

## 11. Conséquence vis-à-vis de `claw-code`

Le principe de policy et d'enforcer est réutilisable.

En revanche, la posture produit `danger-full-access` par défaut ne l'est pas.

Pour Cowork IA, la confiance doit être gagnée et bornée, pas supposée.

## 12. Position cible

Le bon modèle pour notre produit est :

- lecture locale bornée par défaut,
- écriture réversible accordable avec discernement,
- écriture sensible sous approval explicite,
- actions externes irréversibles toujours sous décision unitaire,
- traçabilité complète et revocation simple.

Voir aussi :

- [approval-policy-matrix.md](./approval-policy-matrix.md)
- [threat-model.md](./threat-model.md)
- [prototype-boundary-v1.md](./prototype-boundary-v1.md)
