# Remote Control Security Model V1

## Statut

`active` — implémenté en V1. Voir aussi `docs/threat-model.md` et `docs/permissions-trust-safety.md`.

---

## 1. Principes fondamentaux

1. **Pairing explicite obligatoire** — aucun appareil n'a accès sans pairing initié depuis le desktop.
2. **Session token runtime-only** — le token n'est pas persisté sur disque côté desktop. Un redémarrage invalide toutes les sessions.
3. **Permissions minimales** — le mobile n'expose pas l'API admin complète. Chaque commande est vérifiée.
4. **Audit obligatoire** — toute commande mobile est enregistrée dans `mobile_audit_log`.
5. **Révocation immédiate** — l'opérateur peut révoquer un appareil depuis le desktop à tout moment.
6. **Pas d'exposition Internet par défaut** — V1 : LAN uniquement.
7. **Commandes dangereuses bloquées** — exécution terminal arbitraire, suppression fichier, credential access → refusées.

---

## 2. Modèle de confiance des appareils

```
UNKNOWN → PENDING_PAIRING → TRUSTED → REVOKED
```

- `UNKNOWN` : appareil jamais vu
- `PENDING_PAIRING` : code généré, pas encore confirmé
- `TRUSTED` : pairing confirmé, session active ou expirée
- `REVOKED` : désactivé manuellement, plus aucun accès possible

---

## 3. Flux de pairing

```
1. Opérateur desktop : POST /api/mobile/pairing/start
   → Génère pairingCode (6 chars alphanum, TTL 5 min)
   → Retourne { pairingCode, qrData, expiresAt }

2. Mobile : POST /api/mobile/pairing/confirm { pairingCode, deviceName, deviceFingerprint }
   → Valide le code et le TTL
   → Crée un device TRUSTED + session token (UUID v4, TTL 4h)
   → Retourne { sessionToken, expiresAt, deviceId }

3. Mobile stocke sessionToken en mémoire (sessionStorage)
   → Envoie dans chaque requête : Authorization: Bearer <sessionToken>

4. Desktop valide le token à chaque requête mobile
```

---

## 4. Session token

- Format : UUID v4 généré avec `crypto.randomUUID()`
- TTL par défaut : 4 heures (configurable via `COWORK_MOBILE_SESSION_TTL_MS`)
- Non persisté : stocké uniquement en mémoire dans `MobileDeviceRegistry.sessions`
- Un redémarrage du desktop invalide toutes les sessions → le mobile doit re-paire
- Un token expiré retourne 401 avec `{ error: "session_expired" }`

---

## 5. Commandes autorisées vs bloquées

### Autorisées

| Commande | Permission requise |
|----------|--------------------|
| `sendChatMessage` | session valide |
| `startMission` | session valide |
| `approveAction` | session valide + approval existe + appartient au projet |
| `denyAction` | session valide |
| `stopRun` | session valide |
| `continueRun` | session valide |
| `answerTerminalPrompt` | session valide + terminal actif + input attendu |
| `requestScreenshot` | session valide |
| `openProof` | session valide (read-only) |

### Bloquées (catégories refusées)

| Commande | Raison |
|----------|--------|
| Exécution terminal arbitraire | Risque RCE trop élevé via mobile |
| Suppression / remplacement de fichier | Action destructive nécessite confirmation desktop |
| Soumission formulaire | Risque credentials / paiement |
| Installation logiciel | Action système irréversible |
| Accès aux secrets | DPAPI / credential store hors périmètre mobile |
| Modification de la config serveur | Réservé à l'admin desktop |

---

## 6. Journalisation

Chaque commande mobile est enregistrée dans `mobile_audit_log` avec :
- `deviceId`, `sessionToken` (hashed), `commandType`, `payload` (redacté), `status`, `createdAt`
- Les entrées ne sont jamais supprimées automatiquement
- Consultables depuis l'admin desktop : panneau "Mobile / Remote"

---

## 7. Surface d'attaque et mitigations

| Surface | Risque | Mitigation V1 |
|---------|--------|---------------|
| Token mobile intercepté | Accès non autorisé | LAN only, TTL court, révocation |
| Pairing code intercepté | Appareil non-légitime pairé | TTL 5 min, code à usage unique |
| Commande mobile forgée | Action non autorisée | Validation + permission check systématique |
| Token persisté sur le mobile | Accès après perte du téléphone | sessionStorage (pas localStorage), expiration 4h |
| Exposition sur Internet | Accès depuis l'extérieur | LAN only par défaut, pas de port forwarding |
| Replay attack | Réexécution d'une commande | Token révocable + TTL |

---

## 8. Configuration

```bash
COWORK_MOBILE_ENABLED=true           # activer la gateway mobile
COWORK_MOBILE_SESSION_TTL_MS=14400000  # 4 heures
COWORK_MOBILE_PAIRING_TTL_MS=300000    # 5 minutes
COWORK_MOBILE_MAX_DEVICES=5            # max appareils en parallèle
```
