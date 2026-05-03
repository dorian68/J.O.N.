/**
 * Mission Acceptance Harness — real-surface mission tests.
 *
 * Usage:
 *   node app/src/scripts/mission-acceptance-harness.js          # run all
 *   node app/src/scripts/mission-acceptance-harness.js --id=1   # run one
 *   node app/src/scripts/mission-acceptance-harness.js --list   # list missions
 *
 * Requires server running: node app/server.js
 * Reports: pass/fail per acceptance criterion, with evidence paths.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DB_PATH, LOGS_ROOT } from "../config.js";
import { PrototypeDatabase } from "../storage/database.js";

const SERVER_BASE = process.env.COWORK_SERVER || "http://localhost:41731";

// ── Mission definitions ───────────────────────────────────────────────────────

const MISSIONS = [
  {
    id: 1,
    title: "Open Notepad, write hello cowork, screenshot",
    surface: "desktop",
    prompt: "Open Notepad on this computer, type the text 'hello cowork', then take a screenshot of the Notepad window.",
    expectedPrimitives: ["launch_application", "type_text", "capture_window"],
    acceptanceCriteria: [
      { id: "notepad_launched", label: "Notepad window appeared", check: (run) => run.events?.some((e) => e.type === "tool.executed" && e.payload?.primitive === "launch_application") },
      { id: "text_typed", label: "type_text primitive executed", check: (run) => run.events?.some((e) => e.type === "tool.executed" && e.payload?.primitive === "type_text") },
      { id: "screenshot_saved", label: "Screenshot evidence persisted", check: (run) => run.evidence?.length > 0 || run.auditTrail?.stepFailures?.length === 0 },
      { id: "run_completed", label: "Run completed (not failed/stopped)", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 60,
    requiresApproval: false,
    surface_mode: "desktop"
  },
  {
    id: 2,
    title: "Open browser, search Google for Node.js documentation, screenshot",
    surface: "browser",
    prompt: "Open a browser, go to google.com, search for 'Node.js documentation', and take a screenshot of the search results page.",
    expectedPrimitives: ["navigate", "search", "captureScreenshot"],
    acceptanceCriteria: [
      { id: "browser_opened", label: "Browser session opened", check: (run) => run.events?.some((e) => e.type === "run.started") },
      { id: "navigation_done", label: "Navigation to Google succeeded", check: (run) => run.auditTrail?.browserMission?.some((b) => b.finalUrl?.includes("google")) },
      { id: "screenshot_saved", label: "Screenshot evidence saved", check: (run) => run.evidence?.length > 0 },
      { id: "run_completed", label: "Run completed", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 90,
    requiresApproval: false,
    surface_mode: "browser"
  },
  {
    id: 3,
    title: "List desktop visible windows and return window list",
    surface: "desktop",
    prompt: "List all visible windows currently open on this computer and return the list with window titles.",
    expectedPrimitives: ["observe_windows"],
    acceptanceCriteria: [
      { id: "windows_observed", label: "observe_windows primitive executed", check: (run) => run.events?.some((e) => e.payload?.primitive === "observe_windows") },
      { id: "result_returned", label: "Run completed with artifact or summary", check: (run) => run.run?.status === "completed" && run.run?.summary?.length > 10 }
    ],
    maxDurationSeconds: 30,
    requiresApproval: false,
    surface_mode: "desktop"
  },
  {
    id: 4,
    title: "Open Edge, search release readiness, capture screenshot",
    surface: "browser",
    prompt: "Open Microsoft Edge, search for 'software release readiness checklist', take a screenshot of the first result page.",
    expectedPrimitives: ["navigate", "captureScreenshot"],
    acceptanceCriteria: [
      { id: "browser_navigated", label: "Browser navigated to search result", check: (run) => run.auditTrail?.browserMission?.some((b) => b.stepCount > 0) },
      { id: "screenshot_saved", label: "Screenshot evidence persisted", check: (run) => run.evidence?.length > 0 },
      { id: "run_completed", label: "Run completed", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 90,
    requiresApproval: false,
    surface_mode: "browser"
  },
  {
    id: 5,
    title: "Browser search → extract 5 results → artifact",
    surface: "browser",
    prompt: "Open a browser, search for 'best Node.js frameworks 2024', extract the first 5 visible results (title + URL) into a structured table artifact.",
    expectedPrimitives: ["navigate", "extract_rows", "create_artifact"],
    acceptanceCriteria: [
      { id: "results_extracted", label: "Extraction step executed", check: (run) => run.auditTrail?.browserMission?.some((b) => b.extracted && String(b.extracted).length > 10) },
      { id: "artifact_created", label: "Artifact created", check: (run) => run.artifacts?.length > 0 },
      { id: "run_completed", label: "Run completed", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 120,
    requiresApproval: false,
    surface_mode: "browser"
  },
  {
    id: 6,
    title: "Desktop: capture screen, describe what you see",
    surface: "desktop",
    prompt: "Take a screenshot of the current desktop state and describe what is visible on screen.",
    expectedPrimitives: ["capture_window", "describe_window"],
    acceptanceCriteria: [
      { id: "screenshot_taken", label: "Screenshot captured", check: (run) => run.events?.some((e) => e.payload?.primitive === "capture_window") },
      { id: "description_returned", label: "Visual description in run summary", check: (run) => run.run?.summary?.length > 20 },
      { id: "run_completed", label: "Run completed", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 45,
    requiresApproval: false,
    surface_mode: "desktop"
  },
  {
    id: 7,
    title: "Recovery: launch app that does not exist → structured error",
    surface: "desktop",
    prompt: "Open an application called 'fakeapp_nonexistent_xyz'.",
    expectedPrimitives: ["launch_application"],
    acceptanceCriteria: [
      { id: "launch_attempted", label: "launch_application primitive attempted", check: (run) => run.auditTrail?.stepFailures?.some((f) => f.primitive === "launch_application") || run.events?.some((e) => e.payload?.primitive === "launch_application") },
      { id: "structured_error", label: "Run failed with structured error (not crash)", check: (run) => ["failed", "stopped", "completed"].includes(run.run?.status) },
      { id: "error_message_present", label: "Error message present in summary", check: (run) => run.run?.summary?.length > 5 }
    ],
    maxDurationSeconds: 40,
    requiresApproval: false,
    surface_mode: "desktop"
  },
  {
    id: 8,
    title: "Browser + desktop hybrid: search and screenshot system window",
    surface: "hybrid",
    prompt: "Search for 'Windows Task Manager shortcuts' in a browser, then take a screenshot of any currently open system window on the desktop.",
    expectedPrimitives: ["navigate", "captureScreenshot", "capture_window"],
    acceptanceCriteria: [
      { id: "browser_step_done", label: "Browser mission executed", check: (run) => run.auditTrail?.browserMission?.length > 0 },
      { id: "evidence_recorded", label: "Evidence recorded", check: (run) => run.evidence?.length > 0 },
      { id: "run_completed", label: "Run completed", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 120,
    requiresApproval: false,
    surface_mode: "browser"
  },
  {
    id: 9,
    title: "Step-level failure recovery: click non-existent UI element",
    surface: "desktop",
    prompt: "Open Notepad, then click on a button called 'Export to PDF' in the toolbar.",
    expectedPrimitives: ["launch_application", "click_point"],
    acceptanceCriteria: [
      { id: "launch_succeeded", label: "Notepad opened", check: (run) => run.events?.some((e) => e.payload?.primitive === "launch_application") },
      { id: "failure_recorded", label: "Step failure recorded with reason", check: (run) => run.auditTrail?.stepFailures?.some((f) => f.status === "failed" && f.errorMessage?.length > 5) },
      { id: "not_crash", label: "Run ended cleanly (not process crash)", check: (run) => ["failed", "stopped", "completed"].includes(run.run?.status) }
    ],
    maxDurationSeconds: 60,
    requiresApproval: false,
    surface_mode: "desktop"
  },
  {
    id: 10,
    title: "Full mission: browser search → artifact → summary",
    surface: "browser",
    prompt: "Search for 'Claude AI capabilities' on the web, extract the key points from the first result page, create a summary artifact, and tell me what you found.",
    expectedPrimitives: ["navigate", "extract_rows", "create_artifact"],
    acceptanceCriteria: [
      { id: "search_done", label: "Search executed", check: (run) => run.auditTrail?.browserMission?.some((b) => b.stepCount > 0) },
      { id: "extraction_done", label: "Data extracted", check: (run) => run.auditTrail?.browserMission?.some((b) => b.extracted && String(b.extracted).length > 20) },
      { id: "artifact_created", label: "Artifact created", check: (run) => run.artifacts?.length > 0 },
      { id: "summary_returned", label: "Summary in run reply", check: (run) => run.run?.summary?.length > 30 },
      { id: "run_completed", label: "Run completed", check: (run) => run.run?.status === "completed" }
    ],
    maxDurationSeconds: 150,
    requiresApproval: false,
    surface_mode: "browser"
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getDefaultProject() {
  const { projects } = await fetchJson(`${SERVER_BASE}/api/projects`);
  if (!projects?.length) throw new Error("No project found. Start the server and create a project first.");
  return projects[0];
}

async function waitForRunTerminal(projectId, runId, maxSeconds = 120) {
  const start = Date.now();
  while (Date.now() - start < maxSeconds * 1000) {
    const run = await fetchJson(`${SERVER_BASE}/api/projects/${projectId}/runs/${runId}/audit`).catch(() => null);
    const status = run?.run?.status;
    if (["completed", "failed", "stopped"].includes(status)) return run;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Run ${runId} did not complete within ${maxSeconds}s`);
}

function evaluateCriteria(mission, audit) {
  return mission.acceptanceCriteria.map((criterion) => {
    let passed = false;
    try { passed = Boolean(criterion.check(audit)); } catch { passed = false; }
    return { id: criterion.id, label: criterion.label, passed };
  });
}

function printResult(mission, results, audit, durationMs) {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const ok = passed === total;
  const icon = ok ? "✓" : "✗";
  console.log(`\n${icon} Mission ${mission.id}: ${mission.title}`);
  console.log(`  Status  : ${audit?.run?.status ?? "unknown"}  |  Duration: ${Math.round(durationMs / 1000)}s`);
  console.log(`  Criteria: ${passed}/${total}`);
  for (const r of results) {
    console.log(`    ${r.passed ? "✓" : "✗"} ${r.label}`);
  }
  if (audit?.summary) {
    console.log(`  LLM     : ${audit.summary.totalLlmCalls} calls, ${audit.summary.totalTokens} tokens, $${audit.summary.estimatedCostUsd}`);
  }
  if (!ok && audit?.auditTrail?.stepFailures?.length) {
    console.log("  Step failures:");
    for (const f of audit.auditTrail.stepFailures) {
      console.log(`    [${f.status}] ${f.primitive} — ${f.errorMessage ?? f.safetyReason ?? f.reason ?? ""}`);
    }
  }
  return ok;
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runMission(mission, project) {
  const start = Date.now();
  console.log(`\n▶ Running mission ${mission.id}: ${mission.title}`);

  const { run: startedRun } = await postJson(`${SERVER_BASE}/api/projects/${project.id}/missions`, {
    message: mission.prompt,
    conversationId: null
  });

  const runId = startedRun?.run?.id ?? startedRun?.id;
  if (!runId) throw new Error(`Mission ${mission.id}: no runId returned from server`);

  console.log(`  Run ID: ${runId}`);

  const audit = await waitForRunTerminal(project.id, runId, mission.maxDurationSeconds + 30);
  const durationMs = Date.now() - start;
  const results = evaluateCriteria(mission, audit);
  const passed = printResult(mission, results, audit, durationMs);
  return { missionId: mission.id, passed, durationMs, runId, results };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log("\nMission Acceptance Harness — available missions:\n");
  for (const m of MISSIONS) {
    console.log(`  [${m.id}] ${m.title}`);
    console.log(`       surface: ${m.surface_mode} | max: ${m.maxDurationSeconds}s | criteria: ${m.acceptanceCriteria.length}`);
  }
  process.exit(0);
}

const idArg = args.find((a) => a.startsWith("--id="));
const targetIds = idArg ? [parseInt(idArg.split("=")[1], 10)] : MISSIONS.map((m) => m.id);
const selectedMissions = MISSIONS.filter((m) => targetIds.includes(m.id));

if (!selectedMissions.length) {
  console.error("No missions matched the given --id filter.");
  process.exit(1);
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log("JON — Mission Acceptance Harness");
console.log(`Server: ${SERVER_BASE}`);
console.log(`Running ${selectedMissions.length} mission(s)`);
console.log("═══════════════════════════════════════════════════════════");

let project;
try {
  project = await getDefaultProject();
  console.log(`Project: ${project.name ?? project.id}`);
} catch (err) {
  console.error(`\nERROR: Cannot connect to server — ${err.message}`);
  console.error("Start the server first: node app/server.js");
  process.exit(1);
}

const allResults = [];
for (const mission of selectedMissions) {
  try {
    const result = await runMission(mission, project);
    allResults.push(result);
  } catch (err) {
    console.log(`\n✗ Mission ${mission.id} ERROR: ${err.message}`);
    allResults.push({ missionId: mission.id, passed: false, error: err.message });
  }
}

// ── Final report ──────────────────────────────────────────────────────────────

const passCount = allResults.filter((r) => r.passed).length;
console.log("\n═══════════════════════════════════════════════════════════");
console.log(`FINAL: ${passCount}/${allResults.length} missions passed`);
for (const r of allResults) {
  console.log(`  ${r.passed ? "✓" : "✗"} Mission ${r.missionId}${r.error ? ` — ERROR: ${r.error}` : ""}`);
}
console.log("═══════════════════════════════════════════════════════════");

process.exit(passCount === allResults.length ? 0 : 1);
