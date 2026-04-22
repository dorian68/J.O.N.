# Browser control failure recovery

## But du document

Documenter les modes d'échec typiques du `browser control` et la manière dont le système doit réagir.

Le but n'est pas de maximiser le nombre de retries. Le but est de :

- diagnostiquer proprement,
- tenter une reprise proportionnée,
- savoir quand demander une approval,
- savoir quand s'arrêter au lieu d'insister.

## Principes de recovery

- Toujours diagnostiquer avant de réagir.
- Toujours préférer une reprise explicable à une insistance opaque.
- Ne jamais augmenter le risque uniquement pour "faire passer" une étape.
- Reclasser l'état après chaque tentative de recovery.
- S'arrêter lorsque le contexte devient trop ambigu ou trop sensible.

## Taxonomie minimale des issues

| Statut | Sens |
| --- | --- |
| `recovered` | le problème a été levé et l'action peut reprendre proprement |
| `degraded` | la mission peut continuer, mais avec moins de couverture |
| `blocked` | une information, approval ou action externe manque |
| `aborted` | continuer serait trop risqué ou trop ambigu |

## Catégories d'échec

## 1. Élément introuvable

**Symptôme**

- aucun candidat cohérent,
- candidat attendu absent,
- résultat de recherche vide.

**Diagnostic**

- mauvaise région de page,
- DOM non chargé,
- élément dans une frame,
- sélecteur conceptuel trop faible,
- page différente de celle attendue.

**Réponse du système**

- re-vérifier target et URL,
- recapturer le DOM,
- raffiner le contrat de sélection,
- vérifier présence de frame ou de bloqueur.

**Approval éventuelle**

Non en général.

**Quand s'arrêter**

- après plusieurs requalifications sans meilleur candidat,
- si la page réelle ne correspond plus à la mission attendue.

## 2. Page pas chargée ou pas stable

**Symptôme**

- contenu partiel,
- spinner persistant,
- états changeants,
- navigation non finalisée.

**Diagnostic**

- chargement réseau incomplet,
- transition SPA,
- lazy loading,
- page en erreur.

**Réponse du système**

- attendre un état explicitement défini,
- vérifier présence du contenu principal,
- distinguer instabilité temporaire et échec durable.

**Approval éventuelle**

Non.

**Quand s'arrêter**

- si aucun état stable n'émerge dans une fenêtre raisonnable,
- si la page semble cassée ou hors périmètre.

## 3. Lazy loading ou infinite scroll

**Symptôme**

- contenu manquant,
- liste incomplète,
- éléments visibles seulement après scroll.

**Diagnostic**

- chargement paresseux normal,
- mauvais conteneur scrollable,
- infinite scroll non borné.

**Réponse du système**

- utiliser un scroll orienté objectif,
- vérifier ce qui a effectivement été chargé,
- borner le nombre d'itérations,
- produire un état dégradé si la collecte complète n'est pas réaliste.

**Approval éventuelle**

Non, sauf si le périmètre de collecte devient sensiblement plus large.

**Quand s'arrêter**

- si l'exploration devient ouverte et sans fin,
- si la plateforme semble traiter cela comme usage agressif,
- si l'apport marginal du scroll devient négligeable.

## 4. Modal bloquante

**Symptôme**

- overlay empêchant toute interaction,
- focus piégé,
- message de consentement ou dialogue inattendu.

**Diagnostic**

- modal informative,
- consent modal,
- confirmation engageante,
- popup non prévue.

**Réponse du système**

- qualifier le type de modal,
- fermer si elle est non engageante et la policy le permet,
- demander approval si elle implique consentement ou conséquence.

**Approval éventuelle**

Oui dès que la modal emporte effet non trivial.

**Quand s'arrêter**

- si la modal exige une décision humaine explicite,
- si sa portée n'est pas suffisamment claire.

## 5. Login expiré ou surface authentifiée non exploitable

**Symptôme**

- redirection vers login,
- contenu inaccessible,
- demande MFA,
- session périmée.

**Diagnostic**

- session expirée,
- attachement invalide,
- périmètre d'autorisation insuffisant.

**Réponse du système**

- signaler clairement que la surface n'est plus disponible,
- ne pas tenter de renseigner des secrets,
- proposer suspension ou reprise après intervention humaine.

**Approval éventuelle**

Oui pour réutiliser une session existante, mais pas pour saisir un secret par le modèle.

**Quand s'arrêter**

- dès qu'un secret, un CAPTCHA ou une authentification forte est requise.

## 6. Navigation imprévue

**Symptôme**

- URL inattendue,
- nouvel onglet inattendu,
- redirection vers une autre zone,
- changement de page non anticipé.

**Diagnostic**

- clic ayant déclenché une navigation,
- redirection plateforme,
- target secondaire ouverte,
- page d'erreur.

**Réponse du système**

- qualifier la target courante,
- comparer l'outcome attendu et l'outcome observé,
- soit reprendre sur la bonne target,
- soit s'arrêter et demander validation si le périmètre a changé.

**Approval éventuelle**

Oui si le domaine ou la surface change réellement.

**Quand s'arrêter**

- si la navigation emmène vers une surface sensible non prévue,
- si plusieurs targets concurrentes rendent l'action ambiguë.

## 7. Frames / iframes

**Symptôme**

- élément visible mais introuvable dans le DOM courant,
- interaction sans effet,
- cible présente dans une frame enfant.

**Diagnostic**

- mauvais contexte de frame,
- frame cross-origin,
- frame non prête.

**Réponse du système**

- résoudre explicitement la hiérarchie de frames,
- changer de contexte si possible,
- revalider la cible dans la bonne frame.

**Approval éventuelle**

Non en général.

**Quand s'arrêter**

- si la frame cross-origin reste insuffisamment observable pour agir en sécurité.

## 8. Rich editors

**Symptôme**

- focus instable,
- contenu inséré partiellement,
- structure DOM très non triviale,
- résultat visible difficile à vérifier.

**Diagnostic**

- éditeur custom,
- contenteditable complexe,
- virtualisation,
- interférence de raccourcis ou d'autoformat.

**Réponse du système**

- limiter la portée d'édition,
- vérifier après chaque action importante,
- préférer brouillon ou insertion bornée,
- s'arrêter si le résultat n'est pas vérifiable.

**Approval éventuelle**

Oui pour les surfaces engageantes.

**Quand s'arrêter**

- si l'éditeur ne permet pas une vérification fiable,
- si la frontière brouillon / publication devient ambiguë.

## 9. DOM muté après action

**Symptôme**

- élément devenu obsolète,
- référence invalide,
- liste rerendue,
- cible déplacée.

**Diagnostic**

- re-render normal,
- transition SPA,
- mutation après validation ou chargement.

**Réponse du système**

- recapturer le DOM,
- re-résoudre le candidat,
- ne jamais réutiliser aveuglément une ancienne référence.

**Approval éventuelle**

Non en général.

**Quand s'arrêter**

- si la mutation change trop fortement la page ou fait perdre la compréhension de l'état.

## 10. Anti-automation friction

**Symptôme**

- comportements de plateforme qui bloquent ou compliquent l'automatisation,
- challenge, rate limit, friction inhabituelle,
- signaux de sécurité ou d'abus.

**Diagnostic**

- plateforme sensible,
- usage trop rapide ou trop large,
- dispositif de protection.

**Réponse du système**

- ralentir ou arrêter selon la policy,
- expliciter le blocage,
- ne pas tenter de contournement furtif.

**Approval éventuelle**

Pas pour contourner. Une approval ne doit pas transformer une action interdite en action acceptable.

**Quand s'arrêter**

- dès qu'il faudrait contourner une protection,
- dès que la plateforme manifeste une friction de sécurité explicite.

## 11. Résultat ambigu

**Symptôme**

- pas de message de succès,
- pas d'erreur claire,
- état de page incertain,
- action possiblement effectuée sans preuve.

**Diagnostic**

- vérification insuffisante,
- interface silencieuse,
- changement d'état non lisible.

**Réponse du système**

- tenter une vérification complémentaire,
- chercher un état secondaire de confirmation,
- sinon classer l'action comme non confirmée.

**Approval éventuelle**

Peut être nécessaire avant toute nouvelle action engageante.

**Quand s'arrêter**

- si poursuivre risquerait de dupliquer une action externe ou d'aggraver l'ambiguïté.

## Règles d'arrêt explicite

Le système doit cesser d'insister quand l'un des cas suivants survient :

- la target réelle n'est plus clairement identifiée,
- la page sort du périmètre autorisé,
- une surface sensible exige un secret, un CAPTCHA ou une authentification forte,
- l'élément reste ambigu malgré re-résolution,
- le résultat d'une action engageante n'est pas vérifiable,
- la plateforme manifeste une friction de sécurité non triviale.

## Ce que ce document décide

- le recovery navigateur doit être borné et explicable,
- certaines catégories d'échec appellent une requalification, pas un retry aveugle,
- l'arrêt propre fait partie du comportement attendu,
- l'anti-automation friction n'est pas un problème à contourner, mais un signal d'arrêt.

## Liens avec le reste du corpus

- Primitives : [browser-control-primitives.md](./browser-control-primitives.md)
- Observabilité : [browser-control-observability.md](./browser-control-observability.md)
- Approval matrix : [browser-control-approval-matrix.md](./browser-control-approval-matrix.md)
- Threat model : [threat-model.md](./threat-model.md)
