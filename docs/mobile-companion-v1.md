# Mobile Companion V1

## Statut

`active` — chantier en cours. Implémentation initiale backend + PWA mobile disponible.

---

## 1. Vision : companion app, pas une copie mobile du desktop

JON est un workspace AI desktop. Le mobile ne le remplace pas — il y donne accès depuis n'importe où.

```
[Desktop JON — host principal]
  ├── chat, missions, terminaux, browser, artefacts, preuves
  └── expose une Mobile Gateway sécurisée
           ↓
[Mobile JON — companion app]
  ├── parler à JON
  ├── lancer / suivre une mission
  ├── approuver une action sensible
  ├── répondre à un terminal qui attend
  └── consulter preuves / artefacts / état
```

Le mobile est une **télécommande intelligente** de JON. Il voit ce qui compte, permet d'agir sur les décisions critiques, et reste simple.

---

## 2. Cas d'usage mobiles

| Cas | Action mobile |
|-----|--------------|
| Lancer une mission depuis le téléphone | Taper en langage naturel → JON lance sur le desktop |
| Surveiller un run à distance | Voir la timeline live du run |
| Approuver une action sensible | Approval card → Approuver / Refuser |
| Répondre à Codex CLI / Claude Code qui attend | Terminal alert → taper une réponse |
| Voir le résultat d'une mission | Consulter artefacts / preuves |
| Demander à JON de continuer / stopper | Commande stopRun / continueRun |
| Recevoir "JON needs you" | Push notification / alerte en temps réel |
| Voir une capture de surface active | Screen preview (screenshot polling V1) |

---

## 3. Architecture réseau

### V1 — LAN only (implémenté)

```
[Mobile browser] ── WiFi/LAN ──> [Desktop host :3000/mobile]
```

- Pas d'exposition Internet
- Pairing par QR code ou code court
- Session token runtime-only (non persisté sur disque)
- TLS optionnel en V1, recommandé en V2

### V2 — WebRTC (roadmap)

```
[Mobile] <──── WebRTC data channel ────> [Desktop]
            signaling via local relay
```

- Screen streaming via WebRTC MediaStream
- Data channel pour events/commands
- Signaling minimal via le desktop host lui-même
- Pas de relay tiers par défaut

### V3 — Relay optionnel (roadmap)

- Pour connexion hors LAN
- Relay self-hosted ou service tiers choisi par l'opérateur
- Jamais activé par défaut

---

## 4. Modèle de pairing

```
Desktop UI → "Pair a device"
→ Génère un code court (6 chars) + QR code
→ Mobile scanne ou entre le code
→ POST /api/mobile/pairing/confirm { code, deviceName }
→ Desktop valide et émet un session token
→ Mobile stocke le token (sessionStorage ou secure cookie)
→ Session active pendant SESSION_TTL_MS (default: 4h)
```

Révocation :
- L'opérateur peut révoquer depuis l'admin desktop
- Le mobile peut se déconnecter lui-même
- Expiration automatique si inactif

---

## 5. Structure d'implémentation

| Fichier | Type | Description |
|---------|------|-------------|
| `app/src/mobile/mobile-device-registry.js` | Nouveau | Devices, sessions, pairing codes, révocation |
| `app/src/mobile/mobile-gateway.js` | Nouveau | Command intake, validation, permission, audit log |
| `app/src/mobile/mobile-event-stream.js` | Nouveau | Événements filtrés pour mobile depuis le runtime |
| `app/src/storage/database.js` | Modifié | Tables `mobile_devices`, `mobile_audit_log` |
| `app/src/service/operator-service.js` | Modifié | méthodes mobile: pairing, commands, event stream |
| `app/src/server/operator-server.js` | Modifié | Routes `/api/mobile/*` |
| `app/ui/mobile/index.html` | Nouveau | PWA mobile entry point |
| `app/ui/mobile/app.js` | Nouveau | React PWA mobile |
| `app/ui/mobile/styles.css` | Nouveau | Styles mobile |

---

## 6. Périmètre V1

**Dans scope V1 :**
- Pairing LAN + session token
- Event stream SSE mobile filtré
- Commands : chat, startMission, approveAction, denyAction, stopRun, answerTerminalPrompt, requestScreenshot
- PWA mobile responsive (7 écrans)
- Screen preview via screenshot polling
- Terminal alerts
- Audit log des commandes mobiles

**Hors scope V1 :**
- WebRTC (V2)
- Relay hors-LAN (V3)
- Push notifications natives (V2 — requiert service worker + VAPID)
- Biometric auth (V2)
- Multi-user / multi-device simultané (V2)
