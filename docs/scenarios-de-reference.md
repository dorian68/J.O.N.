# Scénarios de référence

## But du document

Définir les scénarios qui serviront de vérité terrain pour le futur produit. Ces scénarios doivent guider :

- le périmètre du prototype,
- le design des approvals,
- la forme des artefacts,
- la sélection des capacités utiles,
- les futures évaluations.

Un scénario de référence n'est pas une idée générale. C'est une mission suffisamment concrète pour tester le système de bout en bout.

## Règles d'usage

- Chaque futur prototype doit annoncer explicitement quels scénarios il couvre.
- Un scénario non couvert ne doit pas être implicitement considéré comme "presque prêt".
- Les scénarios MVP servent de base aux [evals](./evals-and-benchmarks.md).
- Les scénarios post-MVP servent à préparer l'élargissement du produit sans déformer la v1.
- Les scénarios hors périmètre servent à éviter les contresens produit.

## Catégories

- `MVP` : doit être couvert par le premier prototype utile puis par le MVP produit.
- `Post-MVP` : crédible plus tard, mais non structurant pour la première boucle produit.
- `Hors périmètre` : explicitement non visé au début.

## Scénario 1. Synthèse exécutive à partir d'un dossier documentaire

**Catégorie**

`MVP`

**Contexte utilisateur**

Un fondateur ou consultant dispose d'un dossier de PDFs, notes internes et documents Word sur un sujet précis. Il veut obtenir une note claire et exploitable pour prise de décision.

**Objectif**

Lire les documents pertinents, identifier les points clés, expliciter hypothèses et produire une synthèse exécutive structurée.

**Entrées disponibles**

- dossier projet local,
- fichiers PDF / DOCX / TXT,
- instruction utilisateur,
- contraintes éventuelles sur longueur et style.

**Outils potentiellement nécessaires**

- file tools en lecture,
- extraction de texte document,
- retrieval local,
- génération d'artefact textuel,
- citations et traçabilité de sources.

**Niveau de risque**

Faible à moyen.

**Approvals attendues**

- généralement aucune pour la lecture dans le périmètre projet,
- approval éventuelle si le système veut ouvrir des sources hors périmètre initial.

**Artefacts attendus**

- note de synthèse finale,
- éventuellement résumé intermédiaire par sous-document,
- journal des sources utilisées.

**Critères de réussite**

- la note répond à l'objectif explicite,
- les sources importantes sont réellement prises en compte,
- les affirmations importantes sont traçables,
- le niveau de condensation est utile pour un décideur.

**Causes probables d'échec**

- mauvais tri des documents utiles,
- contexte trop large injecté sans sélection,
- résumé générique sans structure décisionnelle,
- citations absentes ou trompeuses.

## Scénario 2. Transformer des fichiers Excel/CSV en rapport analytique

**Catégorie**

`MVP`

**Contexte utilisateur**

Un opérateur business ou finance dispose de plusieurs exports CSV/XLSX et veut un rapport compréhensible avec constats, anomalies et recommandations.

**Objectif**

Lire les fichiers tabulaires, comprendre leur structure, calculer les indicateurs utiles et produire un rapport d'analyse.

**Entrées disponibles**

- un ou plusieurs fichiers tabulaires,
- une question métier,
- éventuelles définitions d'indicateurs,
- dossier projet local.

**Outils potentiellement nécessaires**

- lecture tabulaire,
- normalisation légère,
- génération de tableaux ou résumés structurés,
- production de rapport.

**Niveau de risque**

Moyen.

**Approvals attendues**

- lecture auto-autorisée dans le projet,
- approval si le système veut écrire un export dérivé hors zone d'artefacts.

**Artefacts attendus**

- rapport analytique,
- tableau de constats,
- export optionnel de données transformées.

**Critères de réussite**

- les conclusions reposent sur les bonnes colonnes et agrégations,
- les anomalies significatives sont explicites,
- les hypothèses de nettoyage ou de mapping sont visibles,
- l'artefact final est lisible par un non-technicien.

**Causes probables d'échec**

- mauvaise compréhension du schéma,
- confusion entre métriques métier et métriques calculées,
- absence d'explication sur les données manquantes,
- rapport trop descriptif et pas assez actionnable.

## Scénario 3. Enrichissement web borné puis note de décision

**Catégorie**

`MVP`

**Contexte utilisateur**

Un utilisateur a déjà un dossier local, mais il manque quelques vérifications externes simples : site officiel, documentation publique, page produit, FAQ.

**Objectif**

Compléter un dossier local par une recherche web bornée, puis produire une note de décision ou de recommandation.

**Entrées disponibles**

- documents locaux,
- liste éventuelle de sites autorisés,
- question précise,
- contrainte de sources fiables.

**Outils potentiellement nécessaires**

- browser control en lecture,
- source capture,
- citations,
- synthèse finale.

**Niveau de risque**

Moyen.

**Approvals attendues**

- approval de navigation hors domaines pré-autorisés,
- approval si téléchargement externe dans le projet,
- aucune soumission externe.

**Artefacts attendus**

- note de décision,
- liste de sources externes consultées,
- journal des faits validés ou invalidés.

**Critères de réussite**

- les sources externes complètent réellement le dossier,
- les sources consultées sont explicites,
- la note distingue clairement faits externes et hypothèses,
- aucune action externe non autorisée n'a lieu.

**Causes probables d'échec**

- usage de fetch simple là où un navigateur contrôlé est nécessaire,
- prise en compte de sources faibles sans signalement,
- confusion entre contenu promotionnel et fait fiable,
- parcours web trop large par rapport à l'objectif.

## Scénario 4. Triage et réorganisation d'un dossier projet

**Catégorie**

`MVP`

**Contexte utilisateur**

Un utilisateur a un dossier de travail désordonné et veut une proposition crédible de structure, puis éventuellement l'application contrôlée de cette organisation.

**Objectif**

Analyser le contenu d'un dossier, proposer une structure cible, puis effectuer des opérations réversibles après approvals.

**Entrées disponibles**

- arborescence locale,
- types de fichiers,
- règles de nommage ou d'organisation souhaitées,
- zone de travail bornée.

**Outils potentiellement nécessaires**

- file tools lecture,
- classification de fichiers,
- génération de plan d'organisation,
- opérations de déplacement ou renommage réversibles.

**Niveau de risque**

Moyen à élevé.

**Approvals attendues**

- approval explicite avant toute écriture sur les fichiers,
- approval potentiellement groupée pour un lot d'actions réversibles,
- refus par défaut pour suppression destructrice.

**Artefacts attendus**

- proposition de structure,
- plan d'actions,
- journal des modifications,
- état final du dossier si l'utilisateur valide.

**Critères de réussite**

- la structure proposée est compréhensible,
- les actions sont réversibles et traçables,
- le périmètre d'écriture reste borné,
- l'utilisateur peut interrompre ou annuler proprement.

**Causes probables d'échec**

- renommage trop agressif,
- absence de prévisualisation claire,
- opérations non réversibles,
- périmètre projet mal délimité.

## Scénario 5. Génération d'un deck de travail à partir de sources multiples

**Catégorie**

`Post-MVP`

**Contexte utilisateur**

Un utilisateur veut préparer un support de présentation à partir de documents internes, données tabulaires et quelques sources externes.

**Objectif**

Assembler des informations hétérogènes et produire un artefact de type deck de travail ou plan de slides.

**Entrées disponibles**

- fichiers locaux,
- données tabulaires,
- contraintes sur la structure narrative,
- éventuellement quelques sources web.

**Outils potentiellement nécessaires**

- file tools,
- browser control,
- synthesis,
- artifact generation structurée.

**Niveau de risque**

Moyen.

**Approvals attendues**

- similaires au scénario 3,
- aucune publication ou envoi externe.

**Artefacts attendus**

- plan de deck,
- contenu slide par slide,
- éventuel export de document de travail.

**Critères de réussite**

- structure narrative claire,
- niveau de précision suffisant pour retravail humain,
- provenance claire des chiffres et affirmations.

**Causes probables d'échec**

- deck trop générique,
- absence de hiérarchie narrative,
- contenu non traçable.

## Scénario 6. Workflow web authentifié et collecte structurée

**Catégorie**

`Post-MVP`

**Contexte utilisateur**

L'utilisateur veut récupérer des informations depuis une application web professionnelle authentifiée, sans encore autoriser des mutations sensibles.

**Objectif**

Naviguer dans un outil web authentifié, récupérer des informations ciblées, puis produire un artefact récapitulatif.

**Entrées disponibles**

- application web autorisée,
- accès utilisateur déjà présent ou géré séparément,
- objectif précis de collecte,
- projet local récepteur.

**Outils potentiellement nécessaires**

- browser control avancé,
- gestion d'onglets,
- capture de sources,
- export local contrôlé.

**Niveau de risque**

Élevé.

**Approvals attendues**

- approval d'accès au domaine,
- approval avant toute action pouvant modifier l'état applicatif,
- refus par défaut des opérations de soumission.

**Artefacts attendus**

- rapport de collecte,
- tableau structuré,
- journal des pages et objets consultés.

**Critères de réussite**

- collecte limitée à l'objectif,
- aucune mutation non voulue,
- traçabilité suffisante pour audit.

**Causes probables d'échec**

- ambiguïté entre lecture et mutation,
- sélecteurs ou parcours fragiles,
- fatigue d'approbation excessive.

## Scénario 7. Envoi autonome d'emails ou d'actions externes

**Catégorie**

`Hors périmètre`

**Contexte utilisateur**

L'utilisateur voudrait que le système rédige puis envoie des emails, ou exécute des actions externes engageantes de bout en bout.

**Objectif**

Exécuter une action externe irréversible sans supervision rapprochée.

**Entrées disponibles**

- contenu métier,
- destinataires,
- contexte de projet.

**Outils potentiellement nécessaires**

- connecteur email,
- browser control ou API,
- politiques avancées de validation.

**Niveau de risque**

Très élevé.

**Approvals attendues**

- validation explicite au cas par cas,
- dans le prototype initial, non automatisable.

**Artefacts attendus**

- au mieux un brouillon,
- pas d'envoi autonome dans la première phase.

**Critères de réussite**

- non pertinent pour le premier prototype.

**Causes probables d'échec**

- action irréversible mal contextualisée,
- erreurs de destinataire,
- coût de supervision incompatible avec la promesse produit.

## Scénario 8. Computer control généralisé sur applications arbitraires

**Catégorie**

`Hors périmètre`

**Contexte utilisateur**

L'utilisateur veut que l'agent contrôle de multiples applications desktop sans périmètre stable ni contrat fort.

**Objectif**

Utiliser l'ordinateur comme un opérateur humain généraliste sur des interfaces variées.

**Entrées disponibles**

- écran visible,
- applications ouvertes,
- instructions utilisateur.

**Outils potentiellement nécessaires**

- computer control large,
- vision,
- OCR,
- compréhension d'état applicatif très robuste.

**Niveau de risque**

Très élevé.

**Approvals attendues**

- supervision quasi constante,
- non compatible avec le premier prototype utile.

**Artefacts attendus**

- aucun artefact suffisamment fiable par défaut.

**Critères de réussite**

- hors cible initiale.

**Causes probables d'échec**

- fragilité extrême des interactions,
- audit difficile,
- surface de risque disproportionnée.

## Conséquence pour la suite

Ces scénarios servent de colonne vertébrale pour :

- [operator-ux-flows.md](./operator-ux-flows.md),
- [artifact-contracts.md](./artifact-contracts.md),
- [approval-policy-matrix.md](./approval-policy-matrix.md),
- [evals-and-benchmarks.md](./evals-and-benchmarks.md),
- [prototype-boundary-v1.md](./prototype-boundary-v1.md).

Un futur prototype utile devra annoncer, noir sur blanc, quels scénarios il couvre réellement et lesquels il exclut.
