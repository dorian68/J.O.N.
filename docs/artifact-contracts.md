# Artifact contracts

## But du document

Définir précisément ce qu'est un `artefact` dans ce produit et établir les contrats minimaux que le système devra respecter.

Le fichier utilise le mot `artifact` dans son nom pour des raisons de lisibilité internationale, mais le terme métier canonique dans la documentation reste `artefact`.

## Pourquoi ce document est nécessaire

Sans contrat d'artefact explicite, un système agentique dérive rapidement vers :

- des sorties confondues avec le log du run,
- des brouillons présentés comme des livrables,
- des documents sans provenance claire,
- des objets impossibles à versionner ou à exporter proprement.

Le produit visé est orienté `outcome`. L'artefact doit donc être traité comme un objet produit de première classe.

## Définition canonique

Un `artefact` est un objet produit par le système, destiné à être :

- lu,
- validé,
- exporté,
- affiné,
- comparé à une version précédente,
- relié à une mission, à des sources et à un run.

Un artefact n'est ni un simple message, ni un log d'exécution, ni une mémoire de travail.

## Contrat commun à tous les artefacts

Chaque artefact doit porter au minimum :

- un identifiant stable,
- un type d'artefact,
- un titre,
- un statut,
- une version,
- un run d'origine,
- un projet de rattachement,
- une provenance structurée,
- un niveau de confiance,
- un niveau de validation,
- un format interne,
- des options d'export,
- un horodatage de création,
- un horodatage de dernière révision.

## Taxonomie haute

### 1. Artefact final

Livrable destiné à être consommé par l'utilisateur ou partagé après validation.

### 2. Artefact intermédiaire

Sortie substantielle utile au raisonnement ou à la revue, mais qui n'est pas encore le livrable final.

### 3. Artefact temporaire

Objet transitoire lié à un run, utile à court terme mais non destiné à devenir un livrable durable.

### 4. Artefact système

Objet produit pour l'observabilité, l'audit ou la reprise, et non pour une consommation métier directe.

## Niveaux de confiance

Le niveau de confiance ne signifie pas "vrai à 100 %". Il exprime la qualité de la provenance et le degré de vérifiabilité.

| Niveau | Signification |
| --- | --- |
| `faible` | contenu très dépendant d'hypothèses ou de génération libre, peu vérifié |
| `moyen` | contenu globalement cohérent, mais comportant des zones non vérifiées |
| `élevé` | contenu fortement ancré dans des sources identifiées et relu par le runtime |
| `validé utilisateur` | l'utilisateur a explicitement validé l'artefact pour son usage |

## Statuts de validation

| Statut | Sens |
| --- | --- |
| `draft` | première version produite, non revue |
| `review-needed` | artefact suffisamment formé pour revue humaine |
| `validated` | validé explicitement par l'utilisateur |
| `superseded` | remplacé par une version plus récente |
| `rejected` | jugé non satisfaisant pour l'usage visé |

## Types d'artefacts prioritaires

| Type d'artefact | Objectif | Structure minimale attendue | Provenance minimale | Édition | Export |
| --- | --- | --- | --- | --- | --- |
| Note de synthèse | restituer une compréhension dense d'un dossier | titre, résumé, constats, sources, recommandations | sources documentaires et/ou web reliées | oui | texte, markdown, doc |
| Note de décision | aider un choix ou arbitrage | contexte, options, analyse, recommandation, hypothèses | sources + critères utilisés | oui | texte, markdown, doc |
| Rapport analytique | transformer des données en constats exploitables | méthode, constats, anomalies, limites, recommandations | fichiers tabulaires et calculs tracés | oui | texte, markdown, tableur, pdf plus tard |
| Plan d'action | traduire une analyse en étapes concrètes | objectifs, actions, priorité, dépendances, risques | run et artefacts parents | oui | texte, markdown |
| Brouillon d'email | préparer une communication, sans envoi autonome initial | destinataire visé, objet, corps, contexte | objectif utilisateur + sources liées | oui | texte, email draft plus tard |
| Plan de deck | préparer une présentation | structure slide par slide, messages clés, sources | sources et chiffres reliés | oui | document de travail, format deck plus tard |

## Contrats par classe d'artefacts

### Artefacts finaux

**Objectif**

Servir de sortie principale du run.

**Exigences**

- doivent être compréhensibles sans relire tout le run,
- doivent référencer leur provenance,
- doivent indiquer clairement leur statut de validation,
- doivent être exportables.

### Artefacts intermédiaires

**Objectif**

Servir d'étape de travail explicite entre collecte et livrable final.

**Exemples**

- résumé par source,
- tableau de constats,
- plan narratif,
- comparaison d'options.

**Exigences**

- doivent être liés au run et aux sources,
- peuvent rester non exportés par défaut,
- doivent être distingués visuellement et sémantiquement des artefacts finaux.

### Artefacts temporaires

**Objectif**

Porter un résultat utile au runtime mais pas nécessairement à l'utilisateur final.

**Exemples**

- sélection de passages,
- notes de tri,
- tentative partielle abandonnée.

**Exigences**

- durée de vie bornée,
- non promus comme livrables,
- traçables si impact sur le résultat final.

### Artefacts système

**Objectif**

Supporter audit, reprise ou évaluation.

**Exemples**

- snapshot de plan,
- résumé de run,
- état de reprise.

**Exigences**

- forte traçabilité,
- consommation surtout interne,
- conservation selon politique d'audit.

## Lien avec le run et les sources

Un artefact doit toujours permettre de répondre à ces questions :

- de quel run provient-il ?
- à quel objectif répond-il ?
- sur quelles sources s'appuie-t-il ?
- quelles approvals ont conditionné sa production ?
- s'agit-il d'une version finale ou d'un état de travail ?

Si le système ne peut pas répondre à ces questions, l'objet ne doit pas être traité comme un artefact fiable.

## Capacité d'édition

Le produit doit distinguer :

- édition légère de contenu,
- affinage via nouveau run,
- régénération partielle,
- export sans modification.

Un artefact validé n'est pas figé, mais toute révision doit conserver une traçabilité de version.

## Exportabilité

Tous les artefacts ne doivent pas être exportables de la même manière.

| Classe | Export par défaut |
| --- | --- |
| Final | oui |
| Intermédiaire | optionnel |
| Temporaire | non par défaut |
| Système | non par défaut |

## Ce que ce document décide

- l'artefact est un objet produit de première classe,
- provenance, statut et version sont obligatoires,
- un artefact final doit être exportable,
- le système doit distinguer final, intermédiaire, temporaire et système.

## Ce que ce document ne décide pas encore

- les formats exacts d'export par type,
- le niveau de richesse d'édition in-app,
- le mode de représentation interne détaillé,
- la hiérarchie finale des templates de livrables.

## Liens avec le reste du corpus

- Le modèle métier global est défini dans [workspaces-projets-artefacts.md](./workspaces-projets-artefacts.md).
- Les scénarios qui motivent ces contrats sont décrits dans [scenarios-de-reference.md](./scenarios-de-reference.md).
- Les limites du premier prototype sont posées dans [prototype-boundary-v1.md](./prototype-boundary-v1.md).
- Les critères d'évaluation associés sont détaillés dans [evals-and-benchmarks.md](./evals-and-benchmarks.md).
