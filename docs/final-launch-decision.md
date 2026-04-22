# Final Launch Decision

## Statut

Decision document.

Ce document donne la décision finale d'autorisation ou de refus du lancement de la phase de développement du prototype.

Documents liés :
- [final-coherence-and-launch-review.md](./final-coherence-and-launch-review.md)
- [prototype-slice-v1.md](./prototype-slice-v1.md)
- [browser-control-prototype-gate.md](./browser-control-prototype-gate.md)
- [computer-control-spec.md](./computer-control-spec.md)
- [computer-control-prototype-reassessment.md](./computer-control-prototype-reassessment.md)
- [development-guidelines-v1.md](./development-guidelines-v1.md)
- [development-roadmap-v1.md](./development-roadmap-v1.md)
- [implementation-readiness-checklist.md](./implementation-readiness-checklist.md)

## Décision finale

Décision d'architecte principal :

- `oui, sous conditions finales strictes`

Cette décision autorise le lancement de la phase de développement du prototype au prochain run.

Elle n'autorise pas :

- un élargissement du périmètre ;
- une réinterprétation du prototype ;
- une démo hors benchmark ;
- une dérive vers un système plus autonome que ce qui a été fermé.

## Périmètre exact autorisé

Le développement autorisé porte uniquement sur ce prototype :

- un `desktop coworker` à `mono-agent supervisé` ;
- `browser-first` ;
- `DOM-first` ;
- surfaces contrôlées seulement :
  - browser sandbox pages ;
  - controlled local windows and sandbox surfaces ;
- lecture multi-pages, comparaison multi-tabs, collecte structurée, scroll, inspection DOM, vérification d'outcome ;
- fondation bornée de `computer control` :
  - détection de fenêtre active,
  - focus de fenêtre allowlistée,
  - capture de fenêtre ou région,
  - attente d'état visible,
  - vérification visible d'outcome,
  - export de preuves ;
- édition partielle de formulaires simples sans soumission ;
- approvals explicites pour tout write intent dans le slice ;
- production de deux artefacts seulement :
  - `Tableau de collecte navigateur`
  - `Note de decision`
- persistance locale minimale, restart-safe, sans secrets ni données navigateur excessives ;
- benchmark-first, evidence-first.

## Ce qui est explicitement non autorisé

Le lancement n'autorise pas :

- computer control généralisé ;
- second agent autonome vérificateur, critique ou reviewer ;
- login réel, credential entry, session hijacking ;
- attach à une session navigateur existante ;
- upload ;
- rich editors ;
- frames/iframes comme capacité requise du premier slice ;
- click, drag, keyboard input, hotkeys, ou autres actuations desktop générales ;
- submit, publish, send, delete, ou toute action irréversible ;
- LinkedIn, Upwork ou autre plateforme sensible comme terrain principal de la première itération ;
- stealth, anti-bot evasif, CAPTCHA bypass ;
- persistance large de données de navigation brutes.

## Conditions finales strictes

Le développement reste autorisé uniquement si toutes les conditions suivantes sont tenues :

1. [prototype-slice-v1.md](./prototype-slice-v1.md) reste la définition du scope de build.
2. [browser-control-prototype-gate.md](./browser-control-prototype-gate.md) reste la gate d'autorisation et de retrait.
3. [development-guidelines-v1.md](./development-guidelines-v1.md) est traité comme document normatif pendant le build.
4. [operator-approval-ux-contract.md](./operator-approval-ux-contract.md) est appliqué sans raccourci.
5. [persistence-and-local-state-decisions.md](./persistence-and-local-state-decisions.md) est appliqué sans persistance opportuniste.
6. [artifact-quality-rubrics-v1.md](./artifact-quality-rubrics-v1.md) reste la barre minimale de qualité artefact.
7. [browser-control-test-fixtures-plan.md](./browser-control-test-fixtures-plan.md) guide la matérialisation des fixtures avant toute revendication de robustesse.
8. [browser-control-benchmark-pack-v1.md](./browser-control-benchmark-pack-v1.md), [computer-control-benchmark-pack-v1.md](./computer-control-benchmark-pack-v1.md) et [benchmark-review-protocol-v1.md](./benchmark-review-protocol-v1.md) gouvernent tout jugement de succès.
9. Aucune capacité hors périmètre n'est ajoutée pour servir une démo.
10. Toute ambiguïté majeure rouvre la gate au lieu d'être contournée dans le code.

## Conditions de retrait immédiat de l'autorisation

L'autorisation doit être retirée immédiatement si l'un des cas suivants se produit :

- le slice est élargi sans révision documentaire ;
- une action engageante hors scope est ajoutée, même sous feature flag ;
- un second agent autonome est introduit sans décision formelle ;
- le build commence à dépendre des plateformes sensibles comme preuve principale ;
- le fallback visuel devient le mécanisme principal de pilotage ;
- le `computer control` borné dérive vers une actuation desktop générale ;
- les preuves et l'audit deviennent secondaires par rapport à l'effet démo ;
- la persistance locale s'élargit à des données sensibles ou inutilement volumineuses ;
- les benchmarks ne sont plus le juge principal du succès ;
- une “réussite” est revendiquée sans protocole de revue humain défini.

## Ce qui reste ouvert sans bloquer le lancement

Les points suivants restent ouverts, mais ne bloquent pas le démarrage :

- choix final du shell desktop ;
- contrat exact de certains payloads d'événements ;
- politique par domaine plus détaillée ;
- raffinements ultérieurs de timeline opérateur ;
- stratégie future de sync cloud ;
- éventuel `shadow verifier` read-only après stabilisation.

## Interprétation correcte de la décision

Cette décision ne dit pas :

- que le produit est prêt ;
- que le MVP est entièrement cadré ;
- que les plateformes réelles sont prêtes à être attaquées ;
- que l'architecture future complète est figée.

Elle dit uniquement :

- le prototype V1 est suffisamment fermé pour être développé sans construire une mauvaise première version, à condition de rester dans la coupe autorisée.

Point de clarification désormais fermé :

- `computer control` n'est pas hors produit ;
- `computer control généralisé` reste hors du premier build ;
- `computer control borné` entre bien dans le prototype autorisé.

## Verdict exploitable

Réponse explicite à la question finale :

- `oui, la phase de développement peut maintenant être lancée`
- `oui, uniquement selon le périmètre autorisé dans ce document`
- `oui, l'autorisation tombe immédiatement si ce cadre est violé`
