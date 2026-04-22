# Décisions ouvertes

Ce document sert à guider la suite du brainstorming. Chaque point contient une recommandation courte pour éviter de rester trop longtemps dans l'indécision.

## 1. Quelle verticale lancer en premier ?

### Options

- production documentaire et synthèse,
- business ops / reporting,
- e-commerce / Shopify,
- copilote de code et opérations repo.

### Recommandation

Commencer par `production documentaire + reporting`.

### Pourquoi

- valeur claire,
- besoins fréquents,
- artefacts faciles à évaluer,
- risque plus faible que le contrôle applicatif lourd.

## 2. Faut-il partir tout de suite sur plusieurs agents ?

### Options

- oui, architecture multi-agent dès la v1,
- non, mono-agent d'abord.

### Recommandation

Choisir `mono-agent supervisé` pour la v1.

### Pourquoi

- débogage plus simple,
- coût plus prévisible,
- timeline plus lisible,
- moins de comportements incohérents.

## 3. Le produit doit-il être local, cloud ou hybride ?

### Options

- local uniquement,
- cloud uniquement,
- local-first hybride.

### Recommandation

Choisir `local-first hybride`.

### Pourquoi

- cohérent avec fichiers locaux et desktop automation,
- meilleur ressenti de contrôle,
- possibilité d'évoluer plus tard vers du cloud.

## 4. Quel shell desktop choisir ?

### Options

- Electron,
- Tauri.

### Recommandation

Choisir `Electron` pour la v1.

### Pourquoi

- itération plus rapide,
- écosystème plus large,
- moins de friction pour connecter UI, IPC et outillage JS.

## 5. Quel niveau d'autonomie autoriser au lancement ?

### Options

- lecture seule,
- écriture contrôlée,
- autonomie forte.

### Recommandation

Choisir `lecture + écriture contrôlée avec approbation`.

### Pourquoi

- équilibre entre utilité réelle et sécurité,
- confiance utilisateur plus facile à construire.

## 6. Comment piloter le navigateur ?

### Options

- navigateur interne seulement,
- Chrome externe via CDP,
- Playwright uniquement.

### Recommandation

Choisir `Playwright + CDP`, avec possibilité d'attachement à Chrome.

### Pourquoi

- bon compromis entre robustesse et profondeur technique,
- permet navigation standard et inspection fine.

## 7. Faut-il intégrer Codex CLI dès le départ ?

### Options

- oui, comme composant central,
- oui, comme outil spécialisé,
- non, plus tard.

### Recommandation

Choisir `outil spécialisé`.

### Pourquoi

- utile pour les sous-tâches de code,
- inutilement coûteux en complexité si placé au centre du produit,
- plus sûr s'il reste derrière un système de permissions.

## 8. Quel périmètre desktop pour la v1 ?

### Options

- contrôle complet souris/clavier,
- APIs d'accessibilité et screenshots,
- aucune automation desktop.

### Recommandation

Choisir `APIs d'accessibilité + screenshots`, avec actions simples seulement.

### Pourquoi

- meilleur compromis fiabilité/sécurité,
- évite un produit trop fragile dès le départ.

## 9. Quel système de mémoire utiliser au début ?

### Options

- full RAG avec base vectorielle,
- SQLite + index texte + résumés,
- aucun stockage mémoire.

### Recommandation

Choisir `SQLite + index texte + résumés`.

### Pourquoi

- largement suffisant pour un MVP,
- plus simple à expliquer et débugger,
- moins de coûts et moins de dérive contextuelle.

## 10. Quels artefacts doivent être non négociables au MVP ?

### Recommandation

Les trois artefacts minimums :

- note de synthèse,
- email draft,
- document ou deck de travail.

## 11. Questions à trancher dans les prochains échanges

- nom du produit,
- verticale exacte de la v1,
- niveau d'autonomie souhaité par défaut,
- priorité entre navigateur et desktop,
- fournisseurs modèles visés,
- degré d'ouverture aux plugins/MCP,
- choix du premier format d'artefact à industrialiser,
- périmètre exact du mode code/Codex CLI.

## 12. Séquence de documentation conseillée

Les prochains `.md` utiles à produire sont :

1. `vision-produit.md`
2. `user-flows-v1.md`
3. `modele-de-permissions.md`
4. `architecture-runtime.md`
5. `spec-outils-browser-desktop.md`
6. `backlog-mvp.md`
