# JON-ify App

## Ce que c'est
**JON-ify App** transforme une application existante en **environnement opérable par l'agent** : JON observe l'app, comprend ses surfaces/actions/états/workflows, **génère lui-même** une carte opérationnelle (`jonification.manifest.json`), la valide par smoke test, puis s'en sert pour raisonner et agir en sécurité.

## Ce que ce n'est PAS
> JON-ify App n'est **pas un constructeur de formulaire**. C'est un **protocole d'auto-découverte et de cartographie opérationnelle** où **JON génère le manifest lui-même**, et l'utilisateur ne **valide que les ambiguïtés**.

Mauvais flow (rejeté) : l'utilisateur remplit surfaces/actions/selectors/workflows à la main.
Bon flow : « JON, jonifie cette app » → JON observe, explore, propose, teste, et ne pose que des questions ciblées.

## Comment JON observe une app
Via les capacités existantes (browser automation, extension Chrome, snapshot DOM, arbre d'accessibilité, capture) → un **DOM summary** structuré : titre, URL, titres, boutons, liens, champs, formulaires, menus, bannières succès/erreur. (`src/jonify/app-observer.js`)

## Comment JON génère la carte
1. **Surfaces** : pages/vues principales (dashboard, liste, formulaire, settings, login) inférées depuis la nav + la page. (`surface-detector.js`)
2. **Actions** : dérivées des éléments interactifs, typées (navigate/create/delete/submit/send/export…), avec inputs requis. (`action-discovery.js`)
3. **Safety** : chaque action classée low/medium/high/critical ; high/critical exigent confirmation et ne sont jamais auto en V1. (`safety-classifier.js`)
4. **Workflows** : séquences probables (créer, rechercher, supprimer, exporter). (`workflow-inference.js`)
5. **Manifest** : assemblé avec score de confiance + questions de validation + selectors préférés/candidats. (`manifest-generator.js`)
6. **Validation** : structure + références croisées + invariants de sécurité. (`manifest-validator.js`)
7. **Simulation** : dry-run d'un workflow, sans exécution. (`workflow-simulator.js`)

## L'utilisateur ne valide que les ambiguïtés
JON pose des questions ciblées (`humanReview.questions`), ex. :
« Cette app sert-elle à gérer des leads ? » · « ‘Delete’ supprime-t-il définitivement ? » · « ‘Send’ envoie-t-il un email réel ? »
Il ne remplit jamais le manifest.

## Comment JON s'en sert ensuite
Le manifest est enregistré (`registry.js`) puis exposé au planner via `jonifyContextProvider` : surfaces/actions/workflows/règles de sécurité disponibles. Sur « Va dans mon CRM et crée un lead », JON identifie l'app, trouve le workflow, vérifie les inputs/risques, demande confirmation si nécessaire, puis simule ou exécute.

## Pourquoi ça positionne JON comme agent OS
Une app desktop/web devient **indistinguable d'un serveur de tools** pour l'agent : c'est le pont « app → tools opérables » qui fait de JON un agent IA-OS, pas un simple chatbot.

## Essayer (V1)
```bash
npm run jonify:generate -- --html fixtures/jonify/sample-crm.html --url https://acme.example.com/dashboard --out app.manifest.json
npm run jonify:summarize -- app.manifest.json
npm run jonify:simulate -- app.manifest.json create-object-workflow
npm run smoke:jonify
```
