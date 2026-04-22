# Readiness to build assessment

## But du document

Évaluer honnêtement si le corpus documentaire donne maintenant une vision suffisamment claire pour démarrer un prototype sans partir immédiatement dans une mauvaise direction.

Ce document ne sert pas à rassurer. Il sert à dire ce qui est fermé, ce qui reste ouvert et ce qui reste réellement dangereux.

## Verdict exécutif

Le corpus est désormais :

- fort sur la vision produit ;
- cohérent sur l'architecture cible ;
- suffisamment fermé pour autoriser un prototype étroit ;
- encore insuffisant pour autoriser un MVP élargi ou une itération produit large.

Verdict d'architecte :

- `oui` : la vision de ce qu'il faudra développer est claire ;
- `oui, sous conditions strictes` : le prototype peut démarrer au prochain run ;
- `non` : il ne faut pas encore élargir au-delà du slice défini.

## Lecture rapide par thème

| Thème | Niveau de clarté | Diagnostic court | Priorité |
| --- | --- | --- | --- |
| Vision produit | élevé | forme produit claire, anti-objectifs solides | haute |
| Slice prototype | élevé | coupe exacte désormais fermée | critique |
| Browser control | élevé pour prototype | bien cadré conceptuellement et borné opérationnellement | critique |
| Objets métier | élevé | run, projet, artefact, approval bien définis | haute |
| Politique d'approbation | élevé pour prototype | contrat UX maintenant fermé pour V1 | critique |
| Artefacts prototype | élevé | types retenus et quality bar fermés | haute |
| Scénarios de référence | élevé | exploitables et reliés aux benchmarks | haute |
| Evals et benchmarks | moyen à élevé | protocole V1 fermé, gouvernance long terme encore ouverte | haute |

## 1. Vision produit

### Niveau de clarté

`Élevé`

### Ce qui est clair

- Le produit est un `desktop coworker`.
- La finalité est de déléguer du travail, pas de discuter.
- Le run, l'approval, la source et l'artefact sont des primitives produit.
- Le navigateur est une capacité cœur du prototype.

### Zones encore ouvertes

- verticale métier prioritaire après prototype ;
- trajectoire post-prototype vers MVP plus large.

### Risques si on build trop large

- transformer le prototype en mini-produit flou ;
- mélanger validation de faisabilité et validation de marché.

### Priorité

`Haute`

## 2. Slice prototype

### Niveau de clarté

`Élevé`

### Ce qui est clair

- mono-agent supervisé ;
- browser control centric ;
- read-and-prepare workflows ;
- pas d'actes engageants ;
- artefacts fermés ;
- benchmark gate fermé.

### Zones encore ouvertes

- aucune zone bloquante si le slice reste respecté ;
- quelques choix d'implémentation restent ouverts mais n'affectent pas le périmètre.

### Risques si on build mal

- élargir le slice sous prétexte de “faire une démo plus impressionnante”.

### Priorité

`Critique`

## 3. Browser control

### Niveau de clarté

`Élevé pour le prototype`

### Ce qui est clair

- posture `DOM-first` ;
- primitives V1 incluses ;
- patterns couverts ;
- limites explicites sur authentification, submit et plateformes sensibles ;
- fixtures et benchmarks minimaux.

### Zones encore ouvertes

- support futur des surfaces authentifiées réelles ;
- stratégie de fallback visuel au-delà du premier slice ;
- richesse ultérieure des éditeurs complexes, frames et uploads.

### Risques si on build trop tôt au-delà du slice

- glissement rapide vers un bot navigateur opaque ;
- faible robustesse hors surfaces contrôlées ;
- confusion entre lecture, préparation et engagement.

### Priorité

`Critique`

## 4. Objets métier

### Niveau de clarté

`Élevé`

### Ce qui est clair

- relations entre projet, run, approval, source, artefact et evidence ;
- rôle du run comme unité de supervision ;
- distinction entre artefact final, intermédiaire et preuve système.

### Zones encore ouvertes

- détails de représentation technique, non bloquants avant prototype.

### Risques si on code mal

- implémentation opportuniste qui casse plus tard la traçabilité.

### Priorité

`Haute`

## 5. Politique d'approbation

### Niveau de clarté

`Élevé pour le prototype`

### Ce qui est clair

- lecture auto-approuvée sur surface autorisée ;
- write intent sous approval explicite ;
- actions engageantes hors scope ;
- contrat d'information minimum visible pour chaque approval.

### Zones encore ouvertes

- formes plus avancées d'auto-approval après prototype ;
- configuration par projet plus riche.

### Risques si on élargit trop tôt

- fatigue d'approval ;
- faux sentiment de sécurité ;
- dérive vers des autorisations trop larges.

### Priorité

`Critique`

## 6. Artefacts

### Niveau de clarté

`Élevé pour le prototype`

### Ce qui est clair

- `Tableau de collecte navigateur` comme artefact intermédiaire ;
- `Note de decision` comme artefact final ;
- rubric de qualité fermée ;
- traçabilité obligatoire vers sources et preuves.

### Zones encore ouvertes

- diversité des artefacts au-delà du prototype ;
- niveau d'éditabilité plus avancé.

### Risques si on build mal

- produire des artefacts polis mais non utiles ;
- masquer les faiblesses navigateur derrière une bonne rédaction.

### Priorité

`Haute`

## 7. Scénarios de référence

### Niveau de clarté

`Élevé`

### Ce qui est clair

- les scénarios de référence sont exploitables ;
- ils alimentent fixtures et benchmarks ;
- le slice prototype sélectionne un chemin minimal réaliste.

### Zones encore ouvertes

- extension future vers cas authentifiés et plateformes réelles.

### Risques si on saute cette discipline

- revenir à une logique de démo au lieu d'une logique de prototype.

### Priorité

`Haute`

## 8. Evals futures

### Niveau de clarté

`Moyen à élevé`

### Ce qui est clair

- benchmark pack V1 ;
- fixture plan ;
- protocole de revue humaine ;
- classification des résultats.

### Zones encore ouvertes

- gouvernance du corpus de benchmarks dans le temps ;
- seuils de passage MVP ;
- instrumentation comparative plus fine entre runs.

### Risques si on va trop vite

- surestimer la maturité du prototype ;
- comparer des runs non comparables.

### Priorité

`Haute`

## Si je devais commencer un prototype demain

### Ce qui est suffisamment clair

- le produit à construire ;
- le slice exact à implémenter ;
- les artefacts attendus ;
- les approvals attendues ;
- la persistance minimale ;
- les fixtures minimales ;
- les benchmarks obligatoires ;
- les conditions d'arrêt.

### Ce qui me manquerait encore pour éviter une mauvaise v1

Il ne manque plus de fermeture strictement bloquante avant prototype, à condition de respecter le slice et de ne pas rouvrir le scope.

Les manques résiduels concernent surtout l'après-prototype :

- enrichissement des payloads d'événements ;
- registre de policy par domaine ;
- catalogue concret des fixtures ;
- trajectoire d'extension vers surfaces authentifiées réelles.

## Conclusion architecturale

Le projet n'est plus seulement “clair en vision”.

Il est maintenant suffisamment fermé pour autoriser un run de développement prototype, mais seulement dans un cadre étroit, auditable et benchmarké.

Verdict final :

- **vision claire** : oui ;
- **vision de ce qu'il faudra développer** : oui ;
- **autorisation de build prototype au prochain run** : oui, sous conditions strictes ;
- **autorisation d'élargissement au-delà du slice** : non.
