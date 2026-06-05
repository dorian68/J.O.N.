import assert from "node:assert/strict";
import { buildMobileConnectivityReport, pickPrimaryLanIp } from "../src/server/network-advisor.js";

// Validates the mobile-connectivity doctor that JON now ships so the
// "why can't my phone reach JON" question is answered by JON itself.
const REAL_WORLD = {
  "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.16" }],
  "Tailscale": [{ family: "IPv4", internal: false, address: "100.72.115.67" }],
  "vEthernet (WSL (Hyper-V firewall))": [{ family: "IPv4", internal: false, address: "172.27.192.1" }],
  "Loopback Pseudo-Interface 1": [{ family: "IPv4", internal: true, address: "127.0.0.1" }]
};

export async function run() {
  // ── Primary LAN IP picker: Wi-Fi beats WSL/Tailscale ────────────────────────
  assert.equal(pickPrimaryLanIp(REAL_WORLD), "192.168.1.16", "Wi-Fi is the primary LAN IP");

  // ── Healthy server, Tailscale available → Tailscale is the recommended URL ──
  const r = buildMobileConnectivityReport(REAL_WORLD, { bindHost: "0.0.0.0", scheme: "http", port: 41732 });
  assert.equal(r.ok, true);
  assert.equal(r.server.listensOnAllInterfaces, true);
  assert.equal(r.primaryLanIp, "192.168.1.16");
  assert.equal(r.tailscaleIp, "100.72.115.67");
  assert.equal(r.recommendedUrl, "http://100.72.115.67:41732/mobile/", "stable Tailscale URL recommended");
  assert.ok(r.urls.some((u) => u.kind === "lan" && u.url === "http://192.168.1.16:41732/mobile/"));
  assert.ok(r.urls.some((u) => u.kind === "loopback"));
  assert.ok(r.checks.find((c) => c.id === "bind_all_interfaces").status === "pass");
  assert.ok(r.checks.find((c) => c.id === "stable_route_available").status === "pass");
  assert.ok(r.hints.length > 0);

  // ── localhost-only bind is a FAIL (phone can never connect) ──────────────────
  const local = buildMobileConnectivityReport(REAL_WORLD, { bindHost: "127.0.0.1", scheme: "http", port: 41732 });
  assert.equal(local.server.listensOnAllInterfaces, false);
  assert.equal(local.ok, false);
  assert.equal(local.checks.find((c) => c.id === "bind_all_interfaces").status, "fail");
  // No LAN URL should be offered when not listening on all interfaces.
  assert.ok(!local.urls.some((u) => u.kind === "lan"), "no LAN url when bound to localhost only");

  // ── No Tailscale → LAN is recommended but flagged unstable + warn check ─────
  const lanOnly = buildMobileConnectivityReport(
    { "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.16" }] },
    { bindHost: "0.0.0.0", scheme: "http", port: 41732 }
  );
  assert.equal(lanOnly.recommendedUrl, "http://192.168.1.16:41732/mobile/");
  assert.equal(lanOnly.tailscaleIp, null);
  assert.equal(lanOnly.checks.find((c) => c.id === "stable_route_available").status, "warn");
  const lanUrl = lanOnly.urls.find((u) => u.kind === "lan");
  assert.equal(lanUrl.stable, false, "LAN url flagged as not stable (DHCP)");

  // ── VPN active → warn check fires ───────────────────────────────────────────
  const withVpn = buildMobileConnectivityReport(
    { "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.16" }], "ProtonVPN": [{ family: "IPv4", internal: false, address: "10.2.0.2" }] },
    { bindHost: "0.0.0.0", scheme: "http", port: 41732 }
  );
  assert.equal(withVpn.vpnActive, true);
  assert.equal(withVpn.checks.find((c) => c.id === "vpn_inactive").status, "warn");
}
