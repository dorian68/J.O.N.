# Browser control task patterns

## But du document

Définir les grands patterns de tâches navigateur qui structureront plus tard :

- les scénarios de prototype,
- les capacités V1/V2,
- les approvals,
- les benchmarks,
- la forme des artefacts issus du web.

Un pattern n'est pas un scénario exact. C'est une famille récurrente de tâches avec une dynamique commune.

## Pattern 1. Recherche d'information structurée

**Objectif**

Lire une ou plusieurs pages afin d'extraire une information fiable et structurée pour un artefact.

**Étapes typiques**

1. ouvrir ou focaliser la bonne target,
2. vérifier le domaine et l'état de page,
3. capturer le DOM,
4. localiser le contenu principal,
5. extraire l'information pertinente,
6. rattacher la page comme source,
7. produire une synthèse ou un fait structuré.

**Dépendances**

- navigation fiable,
- DOM lisible,
- extraction structurée,
- traçabilité de source.

**Risques**

- confusion entre contenu principal et bruit périphérique,
- source faible ou promotionnelle,
- page incomplète à cause de lazy loading.

**Approvals**

- souvent aucune en domaine autorisé,
- approval si domaine hors périmètre.

**Observabilité**

- page source,
- région lue,
- faits extraits,
- preuve de provenance.

**Conditions de réussite**

- information pertinente captée,
- source fiable ou clairement qualifiée,
- aucun acte engageant.

**Signaux de blocage**

- contenu non rendu,
- source ambiguë,
- DOM insuffisant pour localiser l'information.

## Pattern 2. Navigation multi-onglets

**Objectif**

Comparer ou agréger des informations réparties sur plusieurs pages ou plusieurs résultats.

**Étapes typiques**

1. ouvrir une page de départ,
2. ouvrir plusieurs onglets secondaires,
3. conserver une identité claire pour chaque target,
4. extraire ou comparer,
5. revenir à un onglet maître ou produire un artefact.

**Dépendances**

- gestion fiable des targets,
- focus explicite,
- mémoire de run structurée.

**Risques**

- action sur mauvais onglet,
- perte de contexte inter-pages,
- comparaison non traçable.

**Approvals**

- liées surtout aux domaines ouverts,
- aucune approval spécifique si lecture simple intra-périmètre.

**Observabilité**

- mapping `target -> rôle`,
- historique d'ouverture,
- comparaisons produites.

**Conditions de réussite**

- aucune ambiguïté sur la target active,
- synthèse multi-source traçable.

**Signaux de blocage**

- trop d'onglets concurrents,
- redirections inattendues,
- target non identifiable.

## Pattern 3. Remplissage de formulaire

**Objectif**

Compléter un formulaire de manière supervisée et traçable.

**Étapes typiques**

1. inspecter la structure du formulaire,
2. résoudre champs, labels et contraintes,
3. pré-remplir ou remplir les champs autorisés,
4. vérifier les valeurs présentes,
5. préparer la soumission ou s'arrêter avant celle-ci.

**Dépendances**

- stratégie DOM robuste,
- compréhension de labels,
- approvals claires.

**Risques**

- champ mal ciblé,
- effacement involontaire,
- validation serveur inattendue,
- action engageante déguisée.

**Approvals**

- saisie : souvent approval explicite en V1,
- soumission : approval unitaire obligatoire.

**Observabilité**

- champs touchés,
- valeurs saisies ou masquées,
- raisons de soumission ou d'arrêt.

**Conditions de réussite**

- formulaire correctement compris,
- saisie vérifiée,
- aucune soumission involontaire.

**Signaux de blocage**

- champ ambigu,
- captcha,
- structure custom non fiable,
- login expiré.

## Pattern 4. Workflow d'édition

**Objectif**

Modifier un contenu web existant ou préparer un brouillon dans une interface d'édition.

**Étapes typiques**

1. identifier la zone éditable,
2. lire le contenu existant,
3. décider s'il faut compléter ou remplacer,
4. appliquer l'édition,
5. vérifier le rendu,
6. enregistrer en brouillon ou attendre approval de publication.

**Dépendances**

- focus et saisie robustes,
- compréhension des éditeurs riches,
- vérification visuelle ou DOM du résultat.

**Risques**

- remplacement non voulu,
- perte de brouillon,
- confusion entre save draft et publish.

**Approvals**

- édition : selon portée et surface,
- publication : jamais automatique en V1.

**Observabilité**

- contenu avant/après,
- zone éditée,
- statut brouillon vs publié.

**Conditions de réussite**

- contenu correctement modifié,
- aucun acte de publication involontaire.

**Signaux de blocage**

- éditeur trop opaque,
- DOM insuffisant,
- auto-save non vérifiable,
- bouton de publication ambigu.

## Pattern 5. Triage / revue de profils ou d'offres

**Objectif**

Parcourir une liste de profils, offres ou résultats pour les qualifier et en tirer une synthèse.

**Étapes typiques**

1. charger une liste,
2. identifier les cartes ou lignes pertinentes,
3. ouvrir certains détails,
4. extraire attributs utiles,
5. classer ou annoter,
6. produire une liste structurée ou une recommandation.

**Dépendances**

- extraction par item,
- navigation liste -> détail,
- artefact intermédiaire de triage.

**Risques**

- confondre les objets de la liste,
- perdre le contexte entre liste et détail,
- dériver vers du scraping agressif.

**Approvals**

- lecture simple : faible,
- actions de message ou candidature : hors pattern V1.

**Observabilité**

- critères de tri,
- items consultés,
- raisons de qualification.

**Conditions de réussite**

- tri clair,
- rythme compatible avec supervision,
- aucune action engageante sur plateforme.

**Signaux de blocage**

- infinite scroll non borné,
- DOM instable par item,
- plateforme sensible ou protégée.

## Pattern 6. Publication assistée

**Objectif**

Préparer un contenu publiable sans faire de la publication autonome la norme.

**Étapes typiques**

1. ouvrir l'interface de création,
2. préparer le contenu,
3. vérifier ton, forme et pièces jointes éventuelles,
4. s'arrêter sur un état prêt à publier,
5. demander approval finale si la soumission est autorisée par le périmètre.

**Dépendances**

- éditeur robuste,
- approvals explicites,
- distinction nette draft/publish.

**Risques**

- publication involontaire,
- plateforme sensible,
- interprétation trop large de l'autorisation utilisateur.

**Approvals**

- obligatoires et unitaires pour publier,
- non automatiques en V1.

**Observabilité**

- contenu préparé,
- cible de publication,
- état avant publication.

**Conditions de réussite**

- brouillon correctement préparé,
- publication non exécutée sans validation.

**Signaux de blocage**

- bouton de publication mal distingué,
- plateforme impose confirmation multiple,
- contenu non vérifiable.

## Pattern 7. Réponse assistée

**Objectif**

Préparer une réponse à un message, une opportunité ou un formulaire de candidature sans envoyer automatiquement.

**Étapes typiques**

1. lire le contexte entrant,
2. extraire les éléments à traiter,
3. préparer un draft,
4. l'insérer dans l'éditeur ou le champ de réponse,
5. vérifier le résultat,
6. attendre validation finale.

**Dépendances**

- lecture de contexte web,
- artefact ou brouillon textuel,
- stratégie éditeur.

**Risques**

- erreur de destinataire ou de contexte,
- ton inadapté,
- envoi trop rapide.

**Approvals**

- insertion de texte : sensible,
- envoi : non automatique en V1.

**Observabilité**

- source du contexte,
- brouillon généré,
- état du champ de réponse.

**Conditions de réussite**

- draft exploitable,
- aucun envoi non approuvé.

**Signaux de blocage**

- contexte insuffisant,
- éditeur ambigu,
- plateformes sensibles type messagerie professionnelle.

## Pattern 8. Collecte d'information pour artefact

**Objectif**

Parcourir plusieurs pages pour alimenter directement un artefact produit.

**Étapes typiques**

1. définir le schéma d'information à collecter,
2. visiter les pages pertinentes,
3. extraire les champs nécessaires,
4. rattacher chaque page comme source,
5. produire un artefact intermédiaire puis final.

**Dépendances**

- extraction structurée,
- traçabilité source -> artefact,
- mémoire de run.

**Risques**

- collecte trop large,
- schéma de données instable,
- mélange entre faits et interprétation.

**Approvals**

- liées au périmètre de navigation,
- pas d'acte engageant requis.

**Observabilité**

- liste des pages consultées,
- schéma collecté,
- transformation en artefact.

**Conditions de réussite**

- collecte bornée,
- provenance explicite,
- artefact réellement utile.

**Signaux de blocage**

- structure des pages trop hétérogène,
- informations insuffisantes,
- dérive vers une exploration sans fin.

## Pattern 9. Synchronisation entre plusieurs pages

**Objectif**

Utiliser une page comme source et une autre comme surface d'édition ou de préparation.

**Étapes typiques**

1. lire une page source,
2. conserver son contexte,
3. basculer vers une page cible,
4. reporter une information de manière contrôlée,
5. vérifier la cohérence du transfert.

**Dépendances**

- multi-tab fiable,
- mémoire courte inter-targets,
- contrôles de vérification.

**Risques**

- transfert vers mauvaise cible,
- contexte source périmé,
- confusion entre lecture et action engageante.

**Approvals**

- élevées si la page cible est éditable ou engageante.

**Observabilité**

- source utilisée,
- cible modifiée,
- éléments transférés.

**Conditions de réussite**

- transfert exact,
- bonnes cibles,
- audit clair.

**Signaux de blocage**

- trop de cibles concurrentes,
- valeurs non vérifiables,
- état cible instable.

## Décisions prises

- les patterns de lecture, de collecte et de formulaire sont cœur `V1`,
- les patterns de publication et de réponse restent fortement supervisés,
- les patterns qui ressemblent à du scraping agressif ou à de l'action de masse sont exclus,
- la multi-target navigation est utile mais doit rester lisible et bornée.

## Liens avec le reste du corpus

- Spec générale : [browser-control-spec.md](./browser-control-spec.md)
- Stratégie DOM : [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- Boundaries plateforme : [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md)
- Benchmarks : [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
