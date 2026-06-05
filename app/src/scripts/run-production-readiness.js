// Production readiness doctor (audit Lot 1).
//   npm run smoke:production-readiness
// Prints pass/warn/fail checks for the current env and exits non-zero if a hard
// check fails (or, in production, would refuse startup).
import { evaluateProductionReadiness } from "../server/production-readiness.js";

const r = evaluateProductionReadiness(process.env);
const ICON = { pass: "✅", warn: "⚠️ ", fail: "❌" };

console.log("\n=== JON — Production readiness ===\n");
console.log(`Mode production : ${r.production ? "yes" : "no"}`);
console.log(`Bind host       : ${r.bindHost} (LAN ${r.lanEnabled ? "ENABLED" : "disabled"})\n`);
for (const c of r.checks) console.log(`${ICON[c.status] ?? "  "} ${c.label}\n      ${c.detail}`);
console.log(`\nfail=${r.failCount} warn=${r.warnCount}`);
console.log(`Verdict: ${r.ok ? "✅ ready (no hard failures)" : "❌ NOT ready — fix failed checks"}`);
if (r.shouldRefuseStart) console.log("In production this config would REFUSE to start.");
process.exit(r.ok ? 0 : 1);
