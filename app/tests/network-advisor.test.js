import assert from "node:assert/strict";
import { analyzeNetwork, buildNetworkAdvice } from "../src/server/network-advisor.js";

// Reproduces the exact failure the user hit: the desktop has Wi-Fi (LAN),
// ProtonVPN (WireGuard), Tailscale, and a WSL vEthernet adapter all up at once.
// Pairing must (1) flag the active VPN as the likely LAN blocker and (2) offer
// the Tailscale route as a working alternate.
const REAL_WORLD_IFACES = {
  "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.16" }],
  "ProtonVPN": [{ family: "IPv4", internal: false, address: "10.2.0.2" }],
  "Tailscale": [{ family: "IPv4", internal: false, address: "100.72.115.67" }],
  "vEthernet (WSL (Hyper-V firewall))": [{ family: "IPv4", internal: false, address: "172.27.192.1" }],
  "Loopback Pseudo-Interface 1": [{ family: "IPv4", internal: true, address: "127.0.0.1" }]
};

export async function run() {
  // ── analyzeNetwork: classification ──────────────────────────────────────────
  const analysis = analyzeNetwork(REAL_WORLD_IFACES, { primaryLanIp: "192.168.1.16" });
  assert.equal(analysis.vpnActive, true, "ProtonVPN must be detected as an active VPN");
  assert.ok(
    analysis.vpnInterfaces.some((v) => v.name === "ProtonVPN"),
    "ProtonVPN listed among vpn interfaces"
  );
  assert.equal(analysis.tailscaleIp, "100.72.115.67", "Tailscale CGNAT address detected");
  // Tailscale must NOT be miscounted as a blocking VPN.
  assert.ok(!analysis.vpnInterfaces.some((v) => /tailscale/i.test(v.name)), "Tailscale is not a blocking VPN");

  // ── buildNetworkAdvice: warning + alternate URLs ────────────────────────────
  const advice = buildNetworkAdvice(REAL_WORLD_IFACES, {
    scheme: "http", port: 41732, primaryLanIp: "192.168.1.16", pairingCode: "ABC123"
  });
  assert.ok(advice.warning, "a VPN warning is produced");
  assert.equal(advice.warning.code, "vpn_lan_isolation");
  assert.match(advice.warning.vpn, /ProtonVPN/);
  assert.equal(advice.warning.hasTailscaleAlternate, true);

  assert.equal(advice.alternates.length, 1, "one alternate (Tailscale) offered");
  const ts = advice.alternates[0];
  assert.equal(ts.label, "Tailscale");
  assert.equal(ts.mobileUrl, "http://100.72.115.67:41732/mobile/");
  assert.equal(ts.pairingUrl, "http://100.72.115.67:41732/mobile/?code=ABC123");

  // ── No VPN present: no warning, no alternate ────────────────────────────────
  const clean = buildNetworkAdvice(
    { "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.16" }] },
    { scheme: "http", port: 41732, primaryLanIp: "192.168.1.16" }
  );
  assert.equal(clean.warning, null, "no warning without a VPN");
  assert.equal(clean.alternates.length, 0, "no alternate without Tailscale");
  assert.equal(clean.vpnActive, false);

  // ── VPN active but no Tailscale: warn, but flag there is no easy alternate ───
  const vpnOnly = buildNetworkAdvice(
    {
      "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.16" }],
      "NordLynx": [{ family: "IPv4", internal: false, address: "10.5.0.2" }]
    },
    { scheme: "http", port: 41732, primaryLanIp: "192.168.1.16" }
  );
  assert.ok(vpnOnly.warning, "still warns for NordVPN/NordLynx");
  assert.equal(vpnOnly.warning.hasTailscaleAlternate, false);
  assert.equal(vpnOnly.alternates.length, 0);

  // ── Tailscale should not appear as its own alternate if it IS the primary ───
  const tsPrimary = buildNetworkAdvice(REAL_WORLD_IFACES, {
    scheme: "http", port: 41732, primaryLanIp: "100.72.115.67"
  });
  assert.equal(tsPrimary.alternates.length, 0, "no redundant alternate when Tailscale is already primary");
}
