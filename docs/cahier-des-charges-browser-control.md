# Cahier des charges browser control

## 1. Objet

Définir le cahier des charges spécifique à la capacité `browser control` de Cowork IA.

Cette capacité doit permettre au produit de réaliser, dans le navigateur, des tâches réelles, supervisées, auditées et orientées outcome, sans dériver vers un browser bot opaque.

## 2. Objectifs

Le browser control doit permettre :

- la lecture fiable de pages web vivantes,
- la navigation dans des sessions et des onglets réels,
- l'exploitation du DOM comme fondation de compréhension,
- l'exécution d'interactions bornées et vérifiables,
- la production de sources et d'artefacts reliés au run,
- la demande d'approvals sur les actions engageantes,
- l'arrêt propre lorsque l'état devient ambigu ou trop risqué.

## 3. Périmètre

### 3.1 Dans le périmètre V1

- sessions navigateur contrôlées,
- gestion des onglets / targets,
- navigation sur domaines autorisés,
- capture et lecture du DOM,
- résolution d'éléments interactifs,
- click, focus, scroll, saisie, sélection, checkbox,
- remplissage partiel de formulaires,
- uploads / downloads bornés,
- gestion simple des frames, modals et bloqueurs,
- vérification d'outcome,
- preuves et audit.

### 3.2 Hors périmètre V1

- stealth anti-détection,
- contournement de CAPTCHA,
- credential harvesting,
- actions de masse,
- publication ou envoi autonomes à l'échelle,
- `computer control` généralisé,
- contournement explicite des protections de plateforme.

## 4. Exigences fonctionnelles

## 4.1 Session et targets

Le système doit pouvoir :

- ouvrir ou attacher une session autorisée,
- lister les targets,
- ouvrir, fermer et focaliser des onglets,
- savoir explicitement sur quelle target il agit.

## 4.2 Navigation

Le système doit pouvoir :

- naviguer vers une URL autorisée,
- distinguer navigation attendue, redirection et navigation imprévue,
- attendre un état de page suffisant avant action.

## 4.3 DOM inspection

Le système doit pouvoir :

- capturer un snapshot DOM utile,
- identifier les régions principales de page,
- résoudre les éléments interactifs pertinents,
- inspecter un élément avant action.

## 4.4 DOM interaction

Le système doit pouvoir :

- cliquer,
- focus,
- hover,
- saisir du texte,
- remplacer un contenu de façon contrôlée,
- sélectionner une option,
- cocher/décocher,
- préparer puis éventuellement soumettre un formulaire sous bonne policy.

## 4.5 Scroll et viewport

Le système doit pouvoir :

- scroll dans le viewport ou le bon conteneur,
- amener une cible dans le viewport,
- gérer un lazy loading simple sans exploration infinie.

## 4.6 Surfaces complexes

Le système doit pouvoir :

- gérer des modals non engageantes,
- changer de contexte de frame,
- traiter prudemment les éditeurs riches,
- reconnaître une surface authentifiée ou un blocage de login.

## 4.7 Vérification

Le système doit pouvoir :

- vérifier qu'une action a effectivement produit l'outcome attendu,
- distinguer tentative, succès, échec et ambiguïté,
- exporter une preuve utile.

## 5. Exigences non fonctionnelles

## 5.1 Fiabilité

- pas d'action sans target explicite,
- pas d'action sans vérification minimale d'actionnabilité,
- pas de succès déclaré sans vérification d'outcome.

## 5.2 Lisibilité

- les actions doivent être expliquables,
- la sélection d'élément doit être auditables,
- le lien entre action et mission doit rester visible.

## 5.3 Observabilité

- familles d'événements spécifiques navigateur,
- preuves ciblées,
- diagnostics d'échec classifiés,
- traces exploitables par UI, audit et debugging.

## 5.4 Bornage

- domaines et surfaces autorisés explicites,
- nombre d'itérations de collecte ou de scroll borné,
- actions engageantes explicitement gouvernées.

## 6. Sécurité

Le browser control doit respecter les principes suivants :

- `DOM-first`,
- refus par défaut des actes externes engageants non validés,
- aucune tentative de stealth ou de contournement,
- aucun CAPTCHA bypass,
- aucune saisie de secret confiée au modèle,
- minimisation des preuves sensibles,
- arrêt propre si la plateforme ou la page devient ambiguë.

## 7. Auditabilité

Chaque action significative doit pouvoir être reliée à :

- un run,
- une target,
- un élément ou une région,
- une approval éventuelle,
- un résultat observé,
- une preuve utile.

## 8. Observabilité

Le browser control doit produire :

- événements de session,
- événements de target,
- événements de navigation,
- événements DOM,
- événements d'interaction,
- événements de blocage,
- événements de vérification,
- événements de recovery.

## 9. UX de supervision

L'opérateur doit pouvoir comprendre :

- quelle page est ouverte,
- ce que l'agent cherche,
- ce qu'il a trouvé,
- ce qu'il s'apprête à faire,
- ce qui nécessite approval,
- ce qui a effectivement réussi,
- pourquoi le moteur s'arrête si nécessaire.

## 10. Risques principaux

- clic sur mauvaise cible,
- navigation sur mauvais domaine,
- soumission involontaire,
- session authentifiée mal gouvernée,
- DOM trop ambigu,
- éditeurs riches non fiables,
- fuite sensible par preuves ou artefacts,
- fatigue d'approbation.

## 11. Critères d'acceptation V1

La capacité sera considérée acceptable pour une première phase sérieuse si :

- au moins plusieurs benchmarks `V1` sont couverts,
- le moteur sait lire, naviguer, extraire et remplir partiellement des surfaces bornées,
- la politique d'approval navigateur est respectée,
- la vérification d'outcome est démontrée,
- les refus et arrêts propres sont correctement gérés,
- aucune dérive vers spam, stealth ou action de masse n'apparaît.

## 12. Dépendances

- runtime agentique,
- taxonomie d'événements,
- modèle d'approvals,
- modèle de sources et d'artefacts,
- UI opérateur,
- threat model.

## 13. Questions encore ouvertes

- niveau exact de workflow authentifié en v1,
- degré de tolérance au fallback visuel,
- profondeur initiale des éditeurs riches,
- granularité optimale des approvals navigateur répétées.

## 14. Documents de référence

- [browser-control-spec.md](./browser-control-spec.md)
- [browser-control-primitives.md](./browser-control-primitives.md)
- [browser-control-dom-strategy.md](./browser-control-dom-strategy.md)
- [browser-control-task-patterns.md](./browser-control-task-patterns.md)
- [browser-control-linkedin-upwork-boundaries.md](./browser-control-linkedin-upwork-boundaries.md)
- [browser-control-observability.md](./browser-control-observability.md)
- [browser-control-failure-recovery.md](./browser-control-failure-recovery.md)
- [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md)
