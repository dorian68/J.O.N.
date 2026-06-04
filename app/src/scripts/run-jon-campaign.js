#!/usr/bin/env node
// JON backend-first test campaign runner.
//
// Runs JON's backend flows independently of any UI, with structured logs and a
// final diagnosis — the CLI-first testing standard from
// docs/jon-backend-first-testing.md.
//
// Usage:
//   node src/scripts/run-jon-campaign.js                  # run all flows
//   node src/scripts/run-jon-campaign.js --flow=mission-research,deliverables
//   node src/scripts/run-jon-campaign.js --category=mission
//   node src/scripts/run-jon-campaign.js --list           # list flows
//   node src/scripts/run-jon-campaign.js --json           # machine-readable logs
//
// Exit code: 0 if every selected REQUIRED flow passed, 1 otherwise.
import { FLOWS, listFlows } from "../testing/jon-flows.js";
import { StepLogger } from "../testing/structured-log.js";

function parseArgs(argv) {
  const args = { flows: null, categories: null, list: false, json: false };
  for (const raw of argv) {
    if (raw === "--list") args.list = true;
    else if (raw === "--json") args.json = true;
    else if (raw.startsWith("--flow=")) args.flows = raw.slice("--flow=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (raw.startsWith("--category=")) args.categories = raw.slice("--category=".length).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

function selectFlows(args) {
  let selected = FLOWS;
  if (args.flows) selected = selected.filter((f) => args.flows.includes(f.id));
  if (args.categories) selected = selected.filter((f) => args.categories.includes(f.category));
  return selected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("Available JON test flows:\n");
    for (const f of listFlows()) {
      console.log(`  ${f.id.padEnd(20)} [${f.category}]${f.required ? "" : " (optional)"} — ${f.label}`);
    }
    process.exit(0);
  }

  const selected = selectFlows(args);
  if (selected.length === 0) {
    console.error("No flows matched the selection.");
    process.exit(2);
  }

  const startedAt = new Date();
  console.log(`\n=== JON backend-first test campaign — ${selected.length} flow(s) ===`);
  console.log(`Started: ${startedAt.toISOString()}\n`);

  const results = [];
  const ctx = { env: process.env };

  for (const flow of selected) {
    console.log(`\n── Flow: ${flow.id} — ${flow.label} ─────────────────────────`);
    const log = new StepLogger({ flowId: flow.id, json: args.json });
    const t0 = Date.now();
    let result;
    try {
      result = await flow.run(ctx, log);
    } catch (error) {
      result = {
        success: false,
        step: "uncaught",
        error: { code: "UNCAUGHT_EXCEPTION", message: String(error?.message ?? error), stack: error?.stack ? String(error.stack).split("\n").slice(0, 4).join(" | ") : null }
      };
      log.fail("uncaught_exception", { error: result.error });
    }
    const durationMs = Date.now() - t0;
    const skipped = result?.skipped === true;
    results.push({ id: flow.id, label: flow.label, required: flow.required, success: Boolean(result?.success), skipped, durationMs, summary: result?.summary ?? null, error: result?.error ?? null });
    const verdict = skipped ? "⏭️  SKIPPED" : result?.success ? "✅ PASS" : "❌ FAIL";
    console.log(`   → ${verdict}  (${durationMs} ms)  ${result?.summary ?? result?.error?.message ?? ""}`);
  }

  // ── Final diagnosis ───────────────────────────────────────────────────────
  console.log(`\n\n=== FINAL DIAGNOSIS ===`);
  for (const r of results) {
    const icon = r.skipped ? "⏭️ " : r.success ? "✅" : "❌";
    const tag = r.required ? "" : " (optional)";
    console.log(`${icon} ${r.id}${tag}: ${r.summary ?? r.error?.message ?? r.success ? "ok" : "failed"}`);
    if (!r.success && !r.skipped && r.error) {
      if (Array.isArray(r.error.possibleCauses) && r.error.possibleCauses.length) {
        console.log(`     causes: ${r.error.possibleCauses.join("; ")}`);
      }
      if (Array.isArray(r.error.nextActions) && r.error.nextActions.length) {
        console.log(`     next:   ${r.error.nextActions.join("; ")}`);
      }
    }
  }

  const requiredFailures = results.filter((r) => r.required && !r.success && !r.skipped);
  const passed = results.filter((r) => r.success && !r.skipped).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  console.log(`\nSummary: ${passed} passed, ${requiredFailures.length} required failure(s), ${skippedCount} skipped, of ${results.length} flow(s).`);
  console.log(requiredFailures.length === 0
    ? "Verdict: ✅ Backend validated — safe to exercise the UI."
    : `Verdict: ❌ Backend NOT validated — fix required flow(s): ${requiredFailures.map((r) => r.id).join(", ")}.`);

  process.exit(requiredFailures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Campaign runner crashed:", error);
  process.exit(2);
});
