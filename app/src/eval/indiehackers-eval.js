/**
 * IndieHackers Mission Evaluation
 *
 * Runs JON on the mission:
 *   "récupère moi 3 story sur indiehacker, tu me les stock dans un .txt et tu me renvois l'addresse"
 *
 * Scores JON's orchestration quality on multiple dimensions and produces a
 * structured evaluation report. Designed to be run iteratively as JON evolves
 * toward production readiness.
 *
 * Usage:
 *   node app/src/eval/indiehackers-eval.js
 *   node app/src/eval/indiehackers-eval.js --persist
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APPROVAL_DECISION, DATA_ROOT, LOGS_ROOT } from "../config.js";
import { OperatorService } from "../service/operator-service.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { createId, nowIso } from "../utils/ids.js";

const EVAL_ROOT = path.join(DATA_ROOT, "eval", "indiehackers");
const MISSION = "récupère moi 3 story sur indiehacker, tu me les stock dans un .txt et tu me renvois l'addresse";
const TIMEOUT_MS = 120_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAuditEntriesForRun(runId) {
  const filePath = path.join(LOGS_ROOT, "jon-audit.jsonl");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry) => entry?.runId === runId);
  } catch {
    return [];
  }
}

async function waitForRunTerminal(service, runId, { timeoutMs = TIMEOUT_MS } = {}) {
  const terminal = new Set(["completed", "failed", "stopped"]);
  const startedAt = Date.now();
  let detail = null;
  let approvalCount = 0;

  while (Date.now() - startedAt < timeoutMs) {
    detail = await service.getRunDetail(runId);
    if (terminal.has(detail?.run?.status)) return { detail, approvalCount };

    const approval = service.listPendingApprovals(runId)[0] ?? null;
    if (approval) {
      await service.resolveApproval(approval.id, APPROVAL_DECISION.APPROVED_ONCE, "IndieHackers eval auto-approval.");
      approvalCount++;
    }
    await sleep(300);
  }
  return { detail, approvalCount };
}

async function createIsolatedService() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jon-indiehackers-eval-"));
  const dbPath = path.join(tempDir, "eval.sqlite");

  const service = await OperatorService.create({
    dbPath,
    realSurfaceRuntimeConfig: {
      research: { mode: "open_web" },
      computer: { mode: "controlled_fixture_window" }
    },
    // FakeWindowProvider with default browsers (Edge + Chrome) so JON's
    // mission understanding sees a real browser context, while keeping the
    // test isolated from the operator desktop.
    computerProvider: new FakeWindowProvider([], {})
  });

  return {
    service,
    tempDir,
    async close() {
      await service.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreToGrade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "F";
}

function buildEvaluation(checks) {
  const weights = {
    run_auto_launched:        { label: "JON auto-launched a run from the mission message",        points: 15, critical: true },
    run_terminal:             { label: "Run reached a terminal state (no hang/crash)",             points: 15, critical: true },
    run_completed:            { label: "Run completed successfully (status=completed)",             points: 10, critical: false },
    navigation_attempted:     { label: "JON attempted navigation to indiehackers.com",             points: 15, critical: false },
    evidence_captured:        { label: "Browser evidence (screenshots/pages) was captured",        points: 10, critical: false },
    artifacts_produced:       { label: "At least one artifact was produced",                       points: 10, critical: false },
    file_artifact_created:    { label: "A .txt or file artifact was created",                      points: 10, critical: false },
    file_path_returned:       { label: "JON returned a file path in its reply",                    points: 10, critical: false },
    no_allowlist_error:       { label: "No allowlist/navigation-blocked error in run summary",     points: 5,  critical: false },
    decision_note_attempted:  { label: "Decision note LLM call was attempted",                     points: 5,  critical: false },
    llm_calls_logged:         { label: "LLM calls were logged to audit trail",                     points: 5,  critical: false }
  };

  let totalPoints = 0;
  let earnedPoints = 0;
  const results = [];

  for (const [key, cfg] of Object.entries(weights)) {
    const passed = Boolean(checks[key]);
    totalPoints += cfg.points;
    if (passed) earnedPoints += cfg.points;
    results.push({
      key,
      label: cfg.label,
      passed,
      points: cfg.points,
      critical: cfg.critical,
      earned: passed ? cfg.points : 0
    });
  }

  const score = Math.round((earnedPoints / totalPoints) * 100);
  const grade = scoreToGrade(score);
  const criticalFails = results.filter((r) => r.critical && !r.passed);

  return { score, grade, earnedPoints, totalPoints, results, criticalFails };
}

// ── Main evaluation ───────────────────────────────────────────────────────────

async function runIndieHackersEval({ persist = false } = {}) {
  const startedAt = nowIso();
  const evalId = createId("eval");
  console.log(`\n[${ evalId }] Starting IndieHackers mission evaluation…`);
  console.log(`Mission: "${MISSION}"\n`);

  const handle = await createIsolatedService();
  const service = handle.service;
  const diagnostics = {};

  try {
    const project = await service.ensureDemoProject();
    diagnostics.projectId = project.id;
    diagnostics.projectAllowlistedDomains = project.allowlistedDomains;

    // ── Step 1: Submit the mission via conversation ────────────────────────────
    console.log("→ Submitting mission via handleConversationTurn…");
    const turnResult = await service.handleConversationTurn(project.id, {
      message: MISSION
    });

    const autoLaunchedRunId = turnResult?.autoLaunchedRunId ?? null;
    const jonReply = String(turnResult?.turn?.reply ?? "");
    const action = turnResult?.turn?.action ?? null;
    const preflight = turnResult?.preflight ?? null;

    diagnostics.action = action;
    diagnostics.jonReply = jonReply.slice(0, 500);
    diagnostics.preflight = preflight?.understanding ?? null;
    diagnostics.autoLaunchedRunId = autoLaunchedRunId;

    console.log(`  action: ${action}`);
    console.log(`  autoLaunchedRunId: ${autoLaunchedRunId ?? "none"}`);
    console.log(`  JON reply (first 200 chars): ${jonReply.slice(0, 200)}`);

    if (!autoLaunchedRunId) {
      console.log("\n  [!] JON did not auto-launch a run. Checking if clarification was requested…");
      if (preflight?.understanding?.requiresClarification) {
        console.log(`  clarificationQuestion: ${preflight.understanding.clarificationQuestion}`);
      }
    }

    // ── Step 2: Wait for run completion ───────────────────────────────────────
    let runDetail = null;
    let approvalCount = 0;
    let runStatus = null;
    let runSummary = null;

    if (autoLaunchedRunId) {
      console.log(`\n→ Waiting up to ${TIMEOUT_MS / 1000}s for run ${autoLaunchedRunId}…`);
      const waitResult = await waitForRunTerminal(service, autoLaunchedRunId, { timeoutMs: TIMEOUT_MS });
      runDetail = waitResult.detail;
      approvalCount = waitResult.approvalCount;
      runStatus = runDetail?.run?.status ?? null;
      runSummary = runDetail?.run?.summary ?? null;
      console.log(`  run status: ${runStatus ?? "unknown"}`);
      console.log(`  approvals auto-granted: ${approvalCount}`);
      if (runSummary) console.log(`  run summary: ${runSummary.slice(0, 200)}`);
    }

    // ── Step 3: Collect evidence ───────────────────────────────────────────────
    const evidence = runDetail?.evidence ?? [];
    const artifacts = runDetail?.artifacts ?? [];
    const events = runDetail?.events ?? [];
    const llmCalls = runDetail?.llmCalls ?? [];

    diagnostics.runStatus = runStatus;
    diagnostics.runSummary = runSummary;
    diagnostics.evidenceCount = evidence.length;
    diagnostics.artifactCount = artifacts.length;
    diagnostics.eventTypes = events.map((e) => e.type);
    diagnostics.llmCallCount = llmCalls.length;
    diagnostics.artifacts = artifacts.map((a) => ({
      id: a.id,
      type: a.type,
      label: a.label,
      mimeType: a.mimeType,
      uri: a.uri,
      sizeBytes: a.sizeBytes
    }));

    // ── Step 4: Read audit log ────────────────────────────────────────────────
    const auditEntries = autoLaunchedRunId ? await readAuditEntriesForRun(autoLaunchedRunId) : [];
    const auditCallTypes = auditEntries.filter((e) => e.type === "jon.llm.output").map((e) => e.callType);
    const browserEvents = auditEntries.filter((e) => e.type === "jon.browser.mission");

    diagnostics.auditEntryCount = auditEntries.length;
    diagnostics.auditCallTypes = auditCallTypes;
    diagnostics.browserEventsCount = browserEvents.length;

    // Check for indiehackers navigation in browser events and audit entries
    const allText = [
      jonReply,
      runSummary ?? "",
      ...auditEntries.map((e) => JSON.stringify(e)).join(" "),
      ...events.map((e) => JSON.stringify(e)).join(" ")
    ].join(" ").toLowerCase();

    const indiehackersNavigated = allText.includes("indiehacker") || allText.includes("indiehackers.com");
    const filePathInReply = /[a-zA-Z]:[\\\/].*\.(txt|md)|\/tmp\/.*\.(txt|md)|\.txt/.test(jonReply);
    const txtArtifactExists = artifacts.some(
      (a) => (a.uri ?? "").endsWith(".txt") || (a.mimeType ?? "").includes("text/plain") || (a.label ?? "").toLowerCase().includes(".txt")
    );

    diagnostics.indiehackersNavigated = indiehackersNavigated;
    diagnostics.filePathInReply = filePathInReply;
    diagnostics.txtArtifactExists = txtArtifactExists;

    // ── Step 5: Score ─────────────────────────────────────────────────────────
    const checks = {
      run_auto_launched:        Boolean(autoLaunchedRunId),
      run_terminal:             ["completed", "failed", "stopped"].includes(runStatus),
      run_completed:            runStatus === "completed",
      navigation_attempted:     indiehackersNavigated,
      evidence_captured:        evidence.length >= 1,
      artifacts_produced:       artifacts.length >= 1,
      file_artifact_created:    txtArtifactExists,
      file_path_returned:       filePathInReply,
      no_allowlist_error:       !(runSummary ?? "").includes("not allowlisted") && !(runSummary ?? "").includes("allowlist"),
      decision_note_attempted:  auditCallTypes.includes("decision_note_draft"),
      llm_calls_logged:         auditCallTypes.length >= 1
    };

    const evaluation = buildEvaluation(checks);
    diagnostics.checks = checks;

    // ── Step 6: Recommendations ───────────────────────────────────────────────
    const recommendations = [];

    if (!checks.run_auto_launched) {
      recommendations.push({
        dimension: "orchestration",
        issue: "JON did not auto-launch a run from the mission message.",
        detail: `action=${action}, requiresClarification=${preflight?.understanding?.requiresClarification}`,
        nextStep: "Check handleConversationTurn mission routing logic. JON should auto-launch on clear missions."
      });
    }
    if (!checks.run_terminal) {
      recommendations.push({
        dimension: "reliability",
        issue: "Run did not reach a terminal state within the timeout.",
        detail: `runStatus=${runStatus}`,
        nextStep: "Check for infinite loops, hung approvals, or unhandled promise rejections in the agent."
      });
    }
    if (checks.run_terminal && !checks.run_completed) {
      recommendations.push({
        dimension: "success_rate",
        issue: `Run terminated with status="${runStatus}" instead of "completed".`,
        detail: runSummary?.slice(0, 300) ?? "no summary",
        nextStep: "Inspect run events and audit log for the root cause of the failure."
      });
    }
    if (!checks.navigation_attempted) {
      recommendations.push({
        dimension: "browser",
        issue: "JON did not navigate to indiehackers.com.",
        detail: `browserEventsCount=${diagnostics.browserEventsCount}, evidenceCount=${evidence.length}`,
        nextStep: "Check open_web mode allowlist config and browser planner URL resolution."
      });
    }
    if (!checks.evidence_captured) {
      recommendations.push({
        dimension: "browser",
        issue: "No browser evidence was captured.",
        detail: `evidenceCount=0`,
        nextStep: "Verify browser controller captures screenshots and page content during navigation."
      });
    }
    if (!checks.file_artifact_created) {
      recommendations.push({
        dimension: "file_output",
        issue: "JON did not produce a .txt file artifact.",
        detail: `artifactCount=${artifacts.length}`,
        nextStep: "JON needs to write file artifacts. Check if the file-writing tool is available in browser/research missions."
      });
    }
    if (!checks.file_path_returned) {
      recommendations.push({
        dimension: "user_communication",
        issue: "JON did not return a file path in its reply.",
        detail: `jonReply preview: ${jonReply.slice(0, 200)}`,
        nextStep: "Ensure JON's final reply includes the output file location."
      });
    }

    const report = {
      id: evalId,
      mission: MISSION,
      startedAt,
      completedAt: nowIso(),
      evaluation,
      diagnostics,
      recommendations
    };

    // ── Print report ──────────────────────────────────────────────────────────
    printReport(report);

    if (persist) {
      await ensureDir(EVAL_ROOT);
      const reportPath = path.join(EVAL_ROOT, `${startedAt.replace(/[:.]/g, "-")}.json`);
      await writeJson(reportPath, report);
      console.log(`\nFull report saved: ${reportPath}`);
      report.outputPath = reportPath;
    }

    return report;

  } finally {
    await handle.close();
  }
}

function printReport(report) {
  const { evaluation, recommendations, diagnostics } = report;
  const { score, grade, results, criticalFails } = evaluation;

  const gradeColors = { A: "✓✓", B: "✓", C: "~", D: "~!", F: "✗✗" };
  const icon = gradeColors[grade] ?? "?";

  console.log("\n" + "─".repeat(64));
  console.log(`  INDIEHACKERS MISSION EVALUATION — Grade: ${grade} (${score}/100)  ${icon}`);
  console.log("─".repeat(64));

  console.log("\nScoring breakdown:");
  for (const r of results) {
    const status = r.passed ? "✓" : "✗";
    const pts = r.passed ? `+${r.points}` : ` 0`;
    console.log(`  [${status}] ${pts.padStart(3)}pts  ${r.label}`);
  }

  console.log(`\n  Total: ${evaluation.earnedPoints}/${evaluation.totalPoints} pts → ${score}/100 → Grade ${grade}`);

  if (criticalFails.length > 0) {
    console.log("\nCritical failures:");
    for (const f of criticalFails) {
      console.log(`  ✗ [CRITICAL] ${f.label}`);
    }
  }

  console.log("\nDiagnostics:");
  console.log(`  projectId:           ${diagnostics.projectId}`);
  console.log(`  allowlistedDomains:  ${JSON.stringify(diagnostics.projectAllowlistedDomains)}`);
  console.log(`  action:              ${diagnostics.action}`);
  console.log(`  autoLaunchedRunId:   ${diagnostics.autoLaunchedRunId ?? "none"}`);
  console.log(`  runStatus:           ${diagnostics.runStatus ?? "n/a"}`);
  console.log(`  evidenceCount:       ${diagnostics.evidenceCount}`);
  console.log(`  artifactCount:       ${diagnostics.artifactCount}`);
  console.log(`  auditCallTypes:      ${JSON.stringify(diagnostics.auditCallTypes)}`);
  console.log(`  llmCallCount:        ${diagnostics.llmCallCount}`);
  console.log(`  navigationDetected:  ${diagnostics.indiehackersNavigated}`);
  console.log(`  filePathInReply:     ${diagnostics.filePathInReply}`);
  console.log(`  txtArtifact:         ${diagnostics.txtArtifactExists}`);

  if (diagnostics.runSummary) {
    console.log(`\n  Run summary: ${diagnostics.runSummary.slice(0, 300)}`);
  }

  if (recommendations.length > 0) {
    console.log("\nRecommendations:");
    for (const r of recommendations) {
      console.log(`\n  [${r.dimension.toUpperCase()}] ${r.issue}`);
      if (r.detail) console.log(`    detail:   ${r.detail}`);
      console.log(`    nextStep: ${r.nextStep}`);
    }
  } else {
    console.log("\nNo recommendations — mission executed flawlessly.");
  }

  console.log("\n" + "─".repeat(64) + "\n");
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const persist = process.argv.includes("--persist");
const report = await runIndieHackersEval({ persist });
process.exitCode = report.evaluation.grade === "F" ? 1 : 0;
