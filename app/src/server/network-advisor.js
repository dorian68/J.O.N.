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
