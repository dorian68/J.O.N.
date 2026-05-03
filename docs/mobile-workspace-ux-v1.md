# Mobile Workspace UX V1

## Statut

`active` — PWA mobile disponible à `/mobile/` sur le desktop host.

---

## 1. Philosophie UX mobile

Le mobile n'est pas une version compressée du desktop.

**Desktop JON** = workspace de travail dense (conversation, terminaux, browser, artefacts, config).
**Mobile JON** = cockpit de supervision et d'intervention rapide.

Principes UX :
- **Chat en premier** — la conversation est le point d'entrée
- **Gros boutons, actions rapides** — pensé pour le pouce
- **Cards lisibles** — état simplifié, pas de tableaux denses
- **Alertes en haut** — approvals et terminal waits toujours visibles
- **Pas d'admin** — configuration, billing, paramètres → desktop uniquement

---

## 2. Structure de navigation mobile (5 tabs)

```
[Chat] [Live] [Terminals] [Proofs] [Admin]
```

### Tab Chat
- Zone de conversation avec JON
- Input texte + bouton envoi
- Messages JON avec markdown simplifié
- Bouton rapide : "Lancer une mission"
- Scroll vers le bas automatique

### Tab Live
- Run en cours : statut, progression, étapes récentes
- Timeline compacte : icône + label + timestamp
- Approval cards en attente (priorité haute, toujours en haut)
- Boutons : Stopper / Continuer / Clarifier

### Tab Terminals
- Liste des terminaux actifs
- Statut : running / waiting_for_input / completed / error
- Badge "INPUT REQUIS" si terminal en attente
- Dernier output affiché (dernières 5 lignes)
- Bouton : Répondre (ouvre un input)
- Screen preview : dernier screenshot disponible

### Tab Proofs
- Liste des preuves / captures liées aux runs
- Miniature screenshot si disponible
- Artefacts produits : titre, type, timestamp
- Accès lecture-seule

### Tab Admin (light)
- Appareils pairés + statut session
- Bouton déconnecter cet appareil
- Info sur le desktop host (version, run en cours)
- Pas d'accès à la config, aux secrets, ou aux routes admin

---

## 3. Écrans spéciaux

### Pairing screen (avant connexion)
- Champ code court (6 chars) ou scan QR
- Nom de l'appareil (pré-rempli avec `navigator.userAgent`)
- Bouton Connecter
- Message d'erreur si code invalide ou expiré

### Approval card
```
┌──────────────────────────────────┐
│ ⚠ Action requires approval       │
│                                  │
│ JON wants to: submit a form      │
│ On: linkedin.com/apply           │
│ Risk: medium                     │
│                                  │
│   [Approve]        [Deny]        │
└──────────────────────────────────┘
```

### Terminal alert card
```
┌──────────────────────────────────┐
│ ⌁ Terminal waiting               │
│ claude-code · task: refactor...  │
│                                  │
│ > Please confirm: overwrite?     │
│                                  │
│ [Type response]    [Stop]        │
└──────────────────────────────────┘
```

### Mission launch sheet
- Input texte grande zone
- Bouton "Lancer"
- Retour visuel : mission démarrée + run ID

---

## 4. Comportement SSE mobile

L'app mobile maintient une connexion SSE vers `GET /api/mobile/events`.

Sur chaque événement reçu :
- `approval.required` → badge rouge sur tab Live + card en haut
- `terminal.waiting_for_input` → badge orange sur tab Terminals + card
- `run.started` → animation de démarrage sur tab Live
- `run.completed` → notification visuelle + résumé
- `run.failed` → alerte rouge
- `jon.needs_user` → popup modale urgente
- `proof.created` → badge +1 sur tab Proofs
- `cost.threshold_warning` → bandeau warning en haut

---

## 5. Design tokens mobile

```css
--mobile-bg: #0d1117;
--mobile-surface: #161b22;
--mobile-border: #30363d;
--mobile-text: #e6edf3;
--mobile-muted: #7d8590;
--mobile-accent: #238636;
--mobile-warn: #d29922;
--mobile-danger: #f85149;
--mobile-tab-height: 3.5rem;
--mobile-input-radius: 12px;
```

---

## 6. Règles UX strictes

- Pas de tables complexes
- Pas de formulaires multi-champs
- Pas de sidebar ou panneau coulissant dense
- Toute action destructive demande une confirmation modale
- Toute commande au terminal nécessite une confirmation si `sensible`
- Le mobile ne lance jamais d'action irréversible sans double tap
