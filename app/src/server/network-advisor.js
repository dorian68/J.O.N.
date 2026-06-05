// Network advisor for mobile pairing.
//
// A very common "JON mobile ne marche plus" cause is NOT a JON bug: a VPN
// (ProtonVPN/WireGuard, NordVPN, Mullvad…) is connected on the desktop and its
// kill-switch / LAN-isolation drops inbound packets from the phone on the same
// Wi-Fi. The server is healthy and bound to 0.0.0.0, but the phone can't reach
// it. This module classifies the local interfaces so pairing can WARN about an
// active VPN and OFFER a working alternate route (Tailscale), which tunnels
// around LAN isolation.
//
// Pure functions over the shape returned by os.networkInterfaces() so they are
// trivially unit-testable without touching the real machine.

const VPN_NAME = /wireguard|proton|nordlynx|nordvpn|mullvad|expressvpn|openvpn|wintun|\bwg\d*\b|\btun\d*\b|\bvpn\b/i;
const TAILSCALE_NAME = /tailscale/i;

// Tailscale hands out CGNAT addresses in 100.64.0.0/10.
function isTailscaleAddress(address) {
  if (!/^100\./.test(address)) return false;
  const secondOctet = Number(address.split(".")[1]);
  return secondOctet >= 64 && secondOctet <= 127;
}

// Scores an IPv4 address for "best LAN address a phone should target". Higher is
// better. Private ranges win; physical Wi-Fi/Ethernet names get a bonus; virtual
// / VPN / Tailscale adapters are penalised so they never beat the real Wi-Fi.
export function scoreLanAddress(address, interfaceName = "") {
  let score = 0;
  if (/^192\.168\./.test(address)) score += 100;
  if (/^10\./.test(address)) score += 95;
  const secondOctet = Number(address.split(".")[1]);
  if (/^172\./.test(address) && secondOctet >= 16 && secondOctet <= 31) score += 95;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) score += 20; // tailscale CGNAT
  if (/wi-?fi|ethernet/i.test(interfaceName)) score += 25;
  if (/tailscale|wsl|hyper-v|vethernet|virtual|vpn|bluetooth|hotspot/i.test(interfaceName)) score -= 50;
  return score;
}

// Picks the single best LAN IPv4 a phone on the same network should target.
// Shared by the server's startup banner and the mobile connectivity doctor so
// there is one source of truth for "which IP do we advertise".
export function pickPrimaryLanIp(ifaces) {
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces ?? {})) {
    for (const iface of list ?? []) {
      if (!iface || iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      candidates.push({ address: iface.address, score: scoreLanAddress(iface.address, name) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? "127.0.0.1";
}

// Classifies interfaces into: any active blocking-VPN adapters, plus a Tailscale
// address if present (Tailscale is treated as a SOLUTION, not a blocker).
export function analyzeNetwork(ifaces, { primaryLanIp = null } = {}) {
  const vpnInterfaces = [];
  let tailscaleIp = null;

  for (const [name, list] of Object.entries(ifaces ?? {})) {
    for (const iface of list ?? []) {
      if (!iface || iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;

      // Tailscale first: it is an overlay that survives VPN LAN isolation, so we
      // never count it as a blocking VPN even though its adapter is a tunnel.
      if (TAILSCALE_NAME.test(name) || isTailscaleAddress(iface.address)) {
        tailscaleIp = tailscaleIp ?? iface.address;
        continue;
      }
      if (VPN_NAME.test(name)) {
        vpnInterfaces.push({ name, address: iface.address });
      }
    }
  }

  return {
    vpnActive: vpnInterfaces.length > 0,
    vpnInterfaces,
    tailscaleIp,
    primaryLanIp
  };
}

// Builds the pairing-time advice: a human warning when a VPN is active, plus
// alternate reachable URLs (currently Tailscale) the user can use right away.
export function buildNetworkAdvice(ifaces, {
  scheme = "http",
  port,
  primaryLanIp = null,
  pathSuffix = "/mobile/",
  pairingCode = null
} = {}) {
  const analysis = analyzeNetwork(ifaces, { primaryLanIp });

  const makeUrls = (ip) => {
    const base = `${scheme}://${ip}:${port}`;
    const mobileUrl = `${base}${pathSuffix}`;
    return {
      base,
      mobileUrl,
      pairingUrl: pairingCode ? `${mobileUrl}?code=${pairingCode}` : mobileUrl
    };
  };

  const alternates = [];
  if (analysis.tailscaleIp && analysis.tailscaleIp !== primaryLanIp) {
    alternates.push({
      label: "Tailscale",
      address: analysis.tailscaleIp,
      reason: "Fonctionne même quand un VPN isole le réseau local. Le téléphone doit être connecté au même tailnet.",
      ...makeUrls(analysis.tailscaleIp)
    });
  }

  let warning = null;
  if (analysis.vpnActive) {
    const names = analysis.vpnInterfaces.map((entry) => entry.name).join(", ");
    warning = {
      code: "vpn_lan_isolation",
      vpn: names,
      message: `VPN détecté (${names}). S'il isole le réseau local, ton téléphone ne pourra pas joindre JON sur le Wi-Fi. Active « Allow LAN connections » dans le VPN, déconnecte-le le temps d'utiliser JON mobile, ou utilise l'URL Tailscale ci-dessous.`,
      hasTailscaleAlternate: Boolean(analysis.tailscaleIp)
    };
  }

  return {
    vpnActive: analysis.vpnActive,
    vpnInterfaces: analysis.vpnInterfaces,
    tailscaleIp: analysis.tailscaleIp,
    warning,
    alternates
  };
}

// Full mobile-connectivity diagnostic. Composes the bind/port facts (from the
// server) with the interface analysis to produce: ranked reachable URLs, a list
// of pass/warn/fail checks, and human-readable hints. Pure over its inputs so it
// can be unit-tested and reused by both the HTTP endpoint and the CLI doctor.
export function buildMobileConnectivityReport(ifaces, {
  bindHost = "0.0.0.0",
  scheme = "http",
  port,
  pathSuffix = "/mobile/"
} = {}) {
  const primaryLanIp = pickPrimaryLanIp(ifaces);
  const analysis = analyzeNetwork(ifaces, { primaryLanIp });
  const listensOnAllInterfaces = bindHost === "0.0.0.0" || bindHost === "::";
  const mk = (ip) => `${scheme}://${ip}:${port}${pathSuffix}`;

  // Ranked URLs: Tailscale first (stable IP, survives DHCP changes AND router
  // client-isolation), then the LAN IP (works on the same Wi-Fi but the DHCP
  // address can change), then loopback (PC only).
  const urls = [];
  if (analysis.tailscaleIp) {
    urls.push({
      kind: "tailscale",
      url: mk(analysis.tailscaleIp),
      address: analysis.tailscaleIp,
      stable: true,
      recommended: true,
      requiresPhoneApp: "Tailscale (même compte) installé sur le téléphone",
      note: "IP stable. Contourne l'isolation des clients Wi-Fi (Livebox) et les changements d'IP DHCP."
    });
  }
  if (listensOnAllInterfaces && primaryLanIp && primaryLanIp !== "127.0.0.1") {
    urls.push({
      kind: "lan",
      url: mk(primaryLanIp),
      address: primaryLanIp,
      stable: false,
      recommended: !analysis.tailscaleIp,
      note: "Même Wi-Fi requis. IP DHCP : peut changer (alors un lien sauvegardé casse). Bloquée si la box isole les clients Wi-Fi."
    });
  }
  urls.push({
    kind: "loopback",
    url: mk("127.0.0.1"),
    address: "127.0.0.1",
    stable: true,
    recommended: false,
    note: "Accessible uniquement depuis ce PC, pas depuis le téléphone."
  });

  const checks = [];
  const addCheck = (id, status, label, detail) => checks.push({ id, status, label, detail });

  addCheck(
    "bind_all_interfaces",
    listensOnAllInterfaces ? "pass" : "fail",
    "Le serveur écoute sur toutes les interfaces (0.0.0.0)",
    listensOnAllInterfaces
      ? `bindHost=${bindHost}`
      : `bindHost=${bindHost} — le serveur n'écoute QUE en local; le téléphone ne pourra jamais joindre JON. Démarre avec COWORK_LAN=1.`
  );
  addCheck(
    "lan_ip_present",
    primaryLanIp && primaryLanIp !== "127.0.0.1" ? "pass" : "warn",
    "Une IP LAN exploitable est détectée",
    primaryLanIp && primaryLanIp !== "127.0.0.1" ? `IP LAN = ${primaryLanIp}` : "Aucune IP LAN privée détectée (pas connecté au Wi-Fi/Ethernet ?)."
  );
  addCheck(
    "vpn_inactive",
    analysis.vpnActive ? "warn" : "pass",
    "Aucun VPN susceptible d'isoler le LAN",
    analysis.vpnActive ? `VPN détecté: ${analysis.vpnInterfaces.map((v) => v.name).join(", ")}` : "Aucun VPN bloquant détecté."
  );
  addCheck(
    "stable_route_available",
    analysis.tailscaleIp ? "pass" : "warn",
    "Une route stable (Tailscale) est disponible",
    analysis.tailscaleIp
      ? `Tailscale IP = ${analysis.tailscaleIp} (recommandée pour le téléphone)`
      : "Pas de Tailscale sur ce PC. La seule route est le LAN, vulnérable à l'isolation Livebox et au changement d'IP DHCP."
  );

  const recommended = urls.find((u) => u.recommended) ?? urls.find((u) => u.kind === "lan") ?? urls[0];
  const ok = listensOnAllInterfaces && urls.some((u) => u.kind === "tailscale" || u.kind === "lan");

  // Hints the user can act on when the phone still can't connect even though the
  // server side is healthy — i.e. the block is in the network path.
  const hints = [];
  if (!analysis.tailscaleIp) {
    hints.push("Installe Tailscale sur le PC ET le téléphone (même compte) pour une URL stable qui ignore l'isolation Wi-Fi et le DHCP.");
  } else {
    hints.push(`Sur le téléphone, installe/active Tailscale (même compte) et ouvre ${mk(analysis.tailscaleIp)}.`);
  }
  hints.push("Si tu restes sur le Wi-Fi local: vérifie que le téléphone est sur le MÊME SSID que le PC (pas le réseau invité, pas la 4G/5G).");
  hints.push("Sur Livebox: désactive « isolation des clients/appareils » Wi-Fi (interface http://192.168.1.1).");
  hints.push("Test côté téléphone: ouvre http://192.168.1.1 — si la box elle-même ne s'ouvre pas, le téléphone n'est pas réellement sur le LAN.");

  return {
    ok,
    server: { bindHost, listensOnAllInterfaces, port, scheme },
    primaryLanIp,
    tailscaleIp: analysis.tailscaleIp,
    vpnActive: analysis.vpnActive,
    vpnInterfaces: analysis.vpnInterfaces,
    urls,
    recommendedUrl: recommended?.url ?? null,
    checks,
    hints
  };
}
