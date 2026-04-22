# Operator UX flows

## But du document

Décrire l'expérience opérateur de bout en bout, sans dessiner d'interface. Le but est de préciser :

- ce que l'utilisateur fait,
- ce que le système doit rendre visible,
- où se jouent la confiance et la friction,
- comment un run progresse, bloque, reprend et se clôture.

Le terme `operator` désigne ici l'utilisateur qui supervise le coworker IA.

## Principes UX structurants

- L'unité centrale n'est pas le message, mais le `run`.
- La confiance vient de la visibilité sur le plan, les sources, les actions et les artefacts.
- Une approval doit interrompre clairement le flux, sans casser la compréhension globale.
- Les états d'erreur et de reprise doivent être traités comme des états normaux du système, pas comme des cas marginaux.

## Flux 1. Créer ou ouvrir un projet

### Intention utilisateur

Définir un périmètre de travail durable avant d'exécuter une mission.

### Séquence conceptuelle

1. L'utilisateur crée un projet ou en ouvre un existant.
2. Il associe un périmètre de fichiers, d'instructions et éventuellement de connecteurs autorisés.
3. Le système résume ce qui constitue désormais le contexte durable du projet.

### Ce que le système doit rendre visible

- nom et description du projet,
- périmètre de fichiers,
- sources connectées autorisées,
- règles de confiance déjà actives,
- historique récent des runs et artefacts.

### Moments de confiance

- le périmètre projet est explicite,
- l'utilisateur comprend immédiatement ce que le système pourra lire ou non.

### Frictions possibles

- confusion entre dossier local et projet logique,
- permissions projet implicites ou mal expliquées,
- projet trop large dès le départ.

## Flux 2. Lancer une mission

### Intention utilisateur

Confier un objectif concret avec un livrable attendu.

### Séquence conceptuelle

1. L'utilisateur saisit une mission.
2. Il précise si nécessaire contraintes, type d'artefact, sources autorisées et actions interdites.
3. Le systeme prepare un preflight et reformule l'objectif de facon structuree.
4. Le systeme propose le cadre borne qu'il couvrira maintenant, comment le run va se derouler, ce qu'il ne couvrira pas et ce qu'il verifiera.
5. L'utilisateur confirme ou corrige.
6. Le systeme cree alors le run.

### Ce que le système doit rendre visible

- objectif courant,
- contraintes prises en compte,
- hypothèses initiales,
- périmètre d'action autorisé.

### Moments de confiance

- l'objectif est reformulé correctement,
- le cadre d'execution retenu est visible mais secondaire,
- le système montre ce qu'il croit devoir produire.

### Frictions possibles

- mission ambiguë,
- format de livrable implicite,
- attentes irréalistes sur l'autonomie.

Note d'implementation actuelle :

- la surface locale actuelle expose une `MissionSpec` bornee et non une zone de chat libre ;
- la mission passe maintenant par un preflight avant le lancement ;
- la mission reste rattachee a un cadre d'execution existant (`research`, `form`, `computer`) ;
- la composition de mission est maintenant la surface primaire au lancement ;
- la home user et la console admin sont maintenant separees ;
- le moteur produit maintenant aussi une recommandation structuree de `next step` quand une mission depasse un seul run ;
- le moteur peut maintenant, sur opt-in explicite, enchaîner automatiquement un seul `next bounded run` après une décision de handoff raisonnée ;
- une couche d'onboarding premier usage et de missions de depart existe pour accelerer la comprehension et la demo ;
- les diagnostics, benchmarks et raccourcis de scenarios restent accessibles mais secondaires ;
- les contrats exacts sont decrits dans [mission-entry-contract-v1.md](./mission-entry-contract-v1.md), [mission-preflight-v1.md](./mission-preflight-v1.md), [bounded-run-plan-v1.md](./bounded-run-plan-v1.md), [mission-chain-orchestration-v1.md](./mission-chain-orchestration-v1.md) et [run-outcome-and-handoff-v1.md](./run-outcome-and-handoff-v1.md).

## Flux 3. Lire et valider le plan initial

### Intention utilisateur

Comprendre ce que l'agent s'apprête à faire avant qu'il n'exécute des étapes coûteuses ou risquées.

### Séquence conceptuelle

1. Le système génère un plan initial.
2. Il affiche les étapes prévues, les tools pressentis et les points de validation probables.
3. L'utilisateur laisse démarrer, ajuste la mission ou corrige une hypothèse.

### Ce que le système doit rendre visible

- séquence d'étapes,
- incertitudes détectées,
- actions qui demanderont approval,
- artefacts envisagés.

### Moments de confiance

- le plan est intelligible et proportionné,
- le système signale lui-même ses zones d'incertitude.

### Frictions possibles

- plan trop abstrait,
- plan trop détaillé pour être lisible,
- absence de distinction entre lecture et action.

## Flux 4. Superviser l'exécution

### Intention utilisateur

Suivre la progression sans avoir à micro-manager chaque étape.

### Séquence conceptuelle

1. Le run entre en exécution.
2. Le système affiche les étapes terminées, en cours, bloquées ou révisées.
3. Les sources consultées, tools utilisés et résultats intermédiaires deviennent consultables.
4. Le système émet des demandes d'approbation si nécessaire.

### Ce que le système doit rendre visible

- état courant du run,
- dernière action significative,
- sources consultées,
- tools exécutés,
- raisons d'un éventuel blocage.

### Moments de confiance

- l'utilisateur peut suivre sans lire un log brut,
- les actions sensibles n'arrivent jamais "par surprise".

### Frictions possibles

- timeline trop bavarde,
- actions trop opaques,
- difficulté à distinguer progression réelle et simple génération de texte.

## Flux 5. Traiter une demande d'approbation

### Intention utilisateur

Décider rapidement sur une action sensible sans devoir réinterpréter tout le run.

### Séquence conceptuelle

1. Le système émet une demande d'approbation.
2. Il explique l'action, sa justification, le risque, le périmètre et l'alternative éventuelle.
3. L'utilisateur accorde, refuse ou limite l'action.
4. Le run reprend ou se réoriente.

### Ce que le système doit rendre visible

- action exacte proposée,
- effet attendu,
- niveau de risque,
- scope de l'accord,
- conséquence d'un refus.

### Moments de confiance

- la demande est concrète et non ambiguë,
- l'utilisateur comprend ce qu'il autorise réellement.

### Frictions possibles

- fatigue d'approbation,
- scopes d'accord incompréhensibles,
- demande trop tardive dans le run.

## Flux 6. Consulter les sources et la provenance

### Intention utilisateur

Vérifier sur quoi le système s'appuie avant de faire confiance au résultat.

### Séquence conceptuelle

1. L'utilisateur ouvre la liste des sources consultées.
2. Il voit leur nature, leur origine, leur rôle et leur lien avec l'artefact.
3. Il peut vérifier une affirmation importante en remontant à ses sources.

### Ce que le système doit rendre visible

- type de source,
- statut de fiabilité,
- moment d'utilisation,
- lien avec les sections de l'artefact.

### Moments de confiance

- la provenance est vérifiable,
- les sources externes et internes sont bien distinguées.

### Frictions possibles

- source non résoluble,
- citations superficielles,
- impossible de comprendre quelle source alimente quel passage.

## Flux 7. Revoir les artefacts

### Intention utilisateur

Comprendre si le travail produit est exploitable, et décider s'il faut le valider, l'affiner ou le rejeter.

### Séquence conceptuelle

1. Le système présente les artefacts produits.
2. L'utilisateur consulte leur statut, leur provenance et leur niveau de validation.
3. Il peut accepter, commenter, demander un affinage ou lancer un nouveau run.

### Ce que le système doit rendre visible

- type d'artefact,
- version,
- statut de validation,
- sources et run d'origine,
- export possible.

### Moments de confiance

- l'artefact est clairement distinct du log du run,
- l'utilisateur comprend ce qui est final, intermédiaire ou temporaire,
- l'utilisateur comprend aussi ce qui a ete verifie et ce qui ne l'a pas ete.

### Frictions possibles

- confusion entre brouillon et livrable final,
- artefact non éditable ou non exportable,
- absence de lien clair avec la mission initiale.

## Flux 8. Rerun, refine, export

### Intention utilisateur

Continuer le travail sans perdre l'historique ni refaire inutilement tout le parcours.

### Séquence conceptuelle

1. L'utilisateur choisit entre reprendre, relancer ou affiner.
2. Le système explique l'effet de cette action sur le run et les artefacts.
3. Si le run precedent suggerait un meilleur `next step`, le systeme peut precharger cette mission et refaire un preflight.
4. Un nouveau cycle démarre ou un artefact est exporté.

### Ce que le système doit rendre visible

- différence entre reprendre, relancer, affiner,
- point de départ du nouveau cycle,
- impact sur les versions d'artefacts.

### Moments de confiance

- les transitions sont explicites,
- l'historique n'est pas écrasé,
- le `next step` est recommande clairement sans etre lance automatiquement.

### Frictions possibles

- confusion entre correction locale et nouveau run,
- duplication d'artefacts sans hiérarchie claire,
- export trop tardif dans le flux.

## Flux 9. Superviser le cout et la gouvernance LLM

### Intention utilisateur

Comprendre combien coute le raisonnement du cowork, quels stages consomment, et quand la gouvernance economise ou degrade.

### Sequence conceptuelle

1. L'operateur ouvre la console admin.
2. Il consulte le dashboard token/cout.
3. Il voit les totaux, les stages les plus couteux, les runs recents et les decisions de gouvernance.
4. Il ouvre ensuite un run specifique pour lire les traces LLM detaillees si necessaire.

### Ce que le systeme doit rendre visible

- tokens input/output/total,
- cout estime,
- cout par stage,
- cout par run recent,
- reuse/suppression/blocking/downgrade,
- fallback et degraded mode,
- limites d'honnetete quand le cout est estime et non exact.

### Moments de confiance

- les chiffres sont utiles sans pretendre etre plus precis qu'ils ne le sont,
- l'operateur voit ou le moteur brule du budget,
- la gouvernance token n'est pas une boite noire.

### Frictions possibles

- confusion entre cout reporte et cout estime,
- surcharge visuelle si les traces detaillees dominent le cockpit,
- absence de lien clair entre un run couteux et sa valeur produit.

## États système à couvrir

| État | Ce que l'opérateur doit comprendre immédiatement |
| --- | --- |
| `vide` | rien n'est encore défini, il faut créer ou ouvrir un projet |
| `prêt` | le projet existe, aucune mission active |
| `planification` | le système construit ou révise le plan |
| `exécution` | le run progresse normalement |
| `en attente d'approbation` | une action sensible bloque la suite |
| `bloqué` | le système ne peut pas poursuivre sans nouvelle information ou sans alternative |
| `suspendu` | le run est arrêté proprement mais pourra reprendre |
| `erreur` | le run a échoué sans reprise automatique suffisante |
| `terminé` | le run est clos et ses artefacts sont disponibles |

## États d'erreur et de reprise

### Blocage sans gravité

Exemple : source manquante, format inattendu, navigation refusée.

Le système doit :

- l'expliquer simplement,
- proposer l'option la plus sûre,
- préserver le reste du run.

### Échec partiel

Exemple : une étape d'enrichissement web échoue mais le travail local reste exploitable.

Le système doit :

- signaler la perte de couverture,
- permettre une clôture dégradée,
- conserver les artefacts partiels si pertinents.

### Échec terminal

Exemple : run incohérent, état impossible à reprendre, permissions indispensables refusées.

Le système doit :

- arrêter proprement,
- expliquer la cause dominante,
- indiquer ce qu'il faudrait changer pour relancer utilement.

## Points de vigilance UX

- Ne pas laisser le chat redevenir l'interface principale du système.
- Ne pas transformer la timeline en log développeur illisible.
- Ne pas demander des approvals que l'utilisateur ne peut pas interpréter.
- Ne pas masquer la différence entre résultat intermédiaire et livrable final.
- Ne pas rendre la reprise plus complexe qu'un nouveau départ.

## Liens avec le reste du corpus

- Les scénarios concrets sont décrits dans [scenarios-de-reference.md](./scenarios-de-reference.md).
- Les objets manipulés dans ces flux sont définis dans [workspaces-projets-artefacts.md](./workspaces-projets-artefacts.md).
- Les states et événements qui sous-tendent ces flux sont détaillés dans [event-taxonomy.md](./event-taxonomy.md).
- Les règles de validation d'actions sont précisées dans [approval-policy-matrix.md](./approval-policy-matrix.md).
