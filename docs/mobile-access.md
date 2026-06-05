# Accès mobile à JON — guide fiable

## TL;DR — quelle URL utiliser sur le téléphone

1. **Route stable recommandée (Tailscale)** — survit au changement d'IP DHCP **et** à l'isolation des clients Wi-Fi (Livebox) :
   - `http://100.72.115.67:41732/mobile/`
   - ou via MagicDNS : `http://msi.tail1934f9.ts.net:41732/mobile/`
   - Prérequis : l'app **Tailscale** connectée sur le téléphone avec le **même compte** que le PC.
2. **Route LAN (même Wi-Fi)** — si tu ne veux pas Tailscale :
   - `http://192.168.1.16:41732/mobile/`
   - ⚠️ l'IP est en **DHCP** : elle peut changer (un lien sauvegardé casse alors). Bloquée si la box isole les clients Wi-Fi.

> Ne sauvegarde pas une URL LAN en favori/PWA : l'IP DHCP change. Préfère l'URL Tailscale (stable) ou relance `npm run debug:mobile` pour obtenir l'IP du jour.

## Diagnostic intégré (plus d'archéologie manuelle)

JON embarque un **doctor de connectivité mobile** :

- CLI : `npm run debug:mobile`
- HTTP : `GET /api/mobile/connectivity` (aucune session requise — utile justement quand on ne peut pas se connecter)

Il rapporte : bind/port du serveur, écoute sur `0.0.0.0`, IP LAN, IP Tailscale, VPN actif, URLs classées (Tailscale > LAN > loopback), checks pass/warn/fail, et une sonde HTTP locale confirmant que le port sert réellement.

Implémentation : `src/server/network-advisor.js` (`buildMobileConnectivityReport`, `pickPrimaryLanIp`), `src/scripts/run-mobile-doctor.js`. Tests : `tests/mobile-connectivity.test.js`, `tests/network-advisor.test.js`.

## Ce que le doctor PEUT et NE PEUT PAS voir

- ✅ Côté PC : bind `0.0.0.0`, port ouvert, IP LAN/Tailscale, VPN, le port sert.
- ❌ Le chemin **téléphone → PC** ne se teste que depuis le téléphone (isolation Wi-Fi, réseau invité, 4G/5G).

## Si le téléphone affiche « connexion refusée / délai dépassé »

Le serveur est sain mais les paquets du téléphone n'arrivent pas. Dans l'ordre :

1. **Tailscale** (le plus fiable) : ouvre l'app Tailscale sur le téléphone (même compte), puis l'URL Tailscale ci-dessus. Contourne l'isolation Livebox et le DHCP.
2. **Même réseau** : le téléphone doit être sur le **même SSID** que le PC (pas le « réseau invité », pas la 4G/5G).
3. **Livebox** : `http://192.168.1.1` → Wi-Fi → désactive « isolation des clients/appareils ».
4. **Test rapide depuis le téléphone** : ouvre `http://192.168.1.1`. Si même la box ne s'ouvre pas, le téléphone n'est pas réellement sur le LAN.

## Serveur — rappel de configuration

- Bind par défaut : `0.0.0.0` (toutes interfaces). Forcer : `COWORK_LAN=1`. Restreindre au PC : `COWORK_BIND_HOST=127.0.0.1`.
- Port par défaut : `41732` (`COWORK_OPERATOR_PORT` pour changer).
- Le pairing (`/api/mobile/pairing/start`) renvoie aussi un bloc `network` avec l'avertissement VPN et les routes alternatives.
