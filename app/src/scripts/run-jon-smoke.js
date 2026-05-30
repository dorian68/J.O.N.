/**
 * JON Mission Smoke Test
 *
 * Tests JON's end-to-end mission orchestration: language understanding,
 * plan generation, run lifecycle, audit logging, and (optionally) live
 * browser navigation on real public URLs.
 *
 * Usage:
 *   node app/src/scripts/run-jon-smoke.js
 *   node app/src/scripts/run-jon-smoke.js --live
 *   node app/src/scripts/run-jon-smoke.js --live --mission "Trouve le cours de l'action Apple sur finance.yahoo.com."
 *   node app/src/scripts/run-jon-smoke.js --no-persist
 */

import { runJonMissionSmoke } from "../smoke/jon-mission-smoke.js";

function parseArgs(argv = []) {
  const options = { live: false, persist: true, mission: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--live") options.live = true;
    if (token === "--no-persist") options.persist = false;
    if (token === "--mission" && argv[i + 1]) {
      options.mission = argv[++i];
    }
  }
  return options;
}

const { live, persist, mission } = parseArgs(process.argv.slice(2));

console.log(`\nRunning JON mission smoke test${live ? " [LIVE]" : " [offline]"}…\n`);

const report = await runJonMissionSmoke({
  live,
  persist,
  ...(mission ? { liveMission: mission } : {})
});

// ── Summary output ─────────────────────────────────────────────────────────────

const statusEmoji = { pass: "✓", degraded: "~", fail: "✗", skipped: "-" };

for (const c of report.cases) {
  const icon = statusEmoji[c.status] ?? "?";
  console.log(`  [${icon}] ${c.label}  (${c.durationMs}ms)`);
  for (const a of c.assertions) {
    if (!a.passed) {
      console.log(`       ✗ ${a.label}`);
      if (a.reason) console.log(`         reason: ${a.reason}`);
      if (a.nextStep) console.log(`         next:   ${a.nextStep}`);
    }
  }
}

console.log(`\nStatus: ${report.status.toUpperCase()}  —  ${report.summary}`);

if (report.recommendations.length > 0) {
  console.log("\nRecommendations:");
  for (const r of report.recommendations) {
    console.log(`  • [${r.caseId}] ${r.reason}`);
    if (r.nextStep) console.log(`    → ${r.nextStep}`);
  }
}

if (report.outputPath) {
  console.log(`\nFull report: ${report.outputPath}`);
}

console.log();

process.exitCode = report.status === "fail" ? 1 : 0;
