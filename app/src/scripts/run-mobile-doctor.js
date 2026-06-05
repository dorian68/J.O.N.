// Mobile connectivity doctor (CLI).
//
//   npm run debug:mobile
//
// Answers "why can't my phone reach JON?" without manual archaeology:
//   - confirms the server bind host / port and that it listens on 0.0.0.0;
//   - lists ranked reachable URLs (Tailscale > LAN > loopback);
//   - runs pass/warn/fail checks;
//   - live-probes the URLs FROM THIS PC to confirm the port actually serves;
//   - prints the exact URL to type on the phone.
//
// It only diagnoses what is observable from the PC. The phone↔PC path (Wi-Fi
// isolation, guest network, 4G) can only be confirmed from the phone — the
// report says so explicitly.
import http from "node:http";
import os from "node:os";
import { DEFAULT_OPERATOR_PORT } from "../config.js";
import { buildMobileConnectivityReport } from "../server/network-advisor.js";

const env = process.env;
const bindHost = env.COWORK_LAN === "1" ? "0.0.0.0" : (env.COWORK_BIND_HOST ?? "0.0.0.0");
const port = Number.parseInt(env.COWORK_OPERATOR_PORT, 10) || DEFAULT_OPERATOR_PORT;
const scheme = env.COWORK_TLS === "1" ? "https" : "http";

const report = buildMobileConnectivityReport(os.networkInterfaces(), { bindHost, scheme, port });

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode < 400, status: res.statusCode });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: "timeout" }); });
    req.on("error", (e) => resolve({ ok: false, status: e.code || e.message }));
  });
}

const ICON = { pass: "✅", warn: "⚠️ ", fail: "❌" };

console.log("\n=== JON — Mobile connectivity doctor ===\n");
console.log(`Server bind : ${report.server.bindHost}:${report.server.port} (${report.server.scheme})`);
console.log(`Listens on all interfaces (0.0.0.0): ${report.server.listensOnAllInterfaces ? "yes" : "NO"}`);
console.log(`Primary LAN IP : ${report.primaryLanIp}`);
console.log(`Tailscale IP   : ${report.tailscaleIp ?? "(none)"}`);
console.log(`VPN active     : ${report.vpnActive ? report.vpnInterfaces.map((v) => v.name).join(", ") : "no"}`);

console.log("\n--- Checks ---");
for (const c of report.checks) console.log(`${ICON[c.status] ?? "  "} ${c.label}\n      ${c.detail}`);

console.log("\n--- Live reachability from THIS PC (does the port actually serve?) ---");
for (const u of report.urls) {
  if (u.kind === "loopback" && report.urls.length > 1) { /* still probe loopback as a server-up signal */ }
  const r = await probe(u.url);
  const tag = r.ok ? "✅ serves" : `❌ ${r.status}`;
  console.log(`  [${u.kind}] ${u.url}  -> ${tag}`);
}
console.log("  (Note: these probes run from the PC. They confirm the server is up and the port serves,");
console.log("   but CANNOT test the phone↔PC path — Wi-Fi client isolation / guest network / 4G.)");

console.log("\n--- URL to use on the PHONE (ranked) ---");
for (const u of report.urls.filter((x) => x.kind !== "loopback")) {
  const star = u.recommended ? "★ RECOMMENDED" : "";
  console.log(`  ${star ? star + "  " : ""}${u.url}`);
  console.log(`     ${u.note}${u.requiresPhoneApp ? `  (requiert: ${u.requiresPhoneApp})` : ""}`);
}
if (report.recommendedUrl) console.log(`\n>>> URL recommandée: ${report.recommendedUrl}`);

console.log("\n--- If the phone still can't connect (network path) ---");
for (const h of report.hints) console.log(`  • ${h}`);

const fails = report.checks.filter((c) => c.status === "fail");
console.log(`\nVerdict: ${fails.length === 0 ? "✅ server side healthy" : "❌ server-side problem — fix the failed checks above"}\n`);
process.exit(fails.length === 0 ? 0 : 1);
