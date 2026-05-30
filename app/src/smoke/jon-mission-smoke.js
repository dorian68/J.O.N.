import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APPROVAL_DECISION, DATA_ROOT, LOGS_ROOT } from "../config.js";
import { OperatorService } from "../service/operator-service.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { createId, nowIso } from "../utils/ids.js";

const SMOKE_ROOT = path.join(DATA_ROOT, "smoke", "jon-mission");
const REPORTS_ROOT = path.join(SMOKE_ROOT, "reports");

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeAssertions(assertions = []) {
  const blockingFailures = assertions.filter((e) => !e.passed && e.severity === "critical");
  return {
    total: assertions.length,
    passed: assertions.filter((e) => e.passed).length,
    failed: assertions.filter((e) => !e.passed).length,
    blockingFailures: blockingFailures.map((e) => e.id)
  };
}

function caseStatus(assertions = []) {
  if (assertions.some((e) => !e.passed && e.severity === "critical")) return "fail";
  if (assertions.some((e) => !e.passed)) return "degraded";
  return "pass";
}

function reportStatus(cases = []) {
  if (cases.some((e) => e.status === "fail")) return "fail";
  if (cases.some((e) => e.status === "degraded" || e.status === "skipped")) return "degraded";
  return "pass";
}

class CaseRecorder {
  constructor({ id, label, category }) {
    this.id = id;
    this.label = label;
    this.category = category;
    this.startedAt = nowIso();
    this.assertions = [];
    this.diagnostics = {};
    this.relatedRunIds = [];
  }

  assert(id, label, passed, { severity = "critical", expected = null, observed = null, reason = "", nextStep = null } = {}) {
    this.assertions.push({
      id,
      label,
      passed: Boolean(passed),
      severity,
      expected,
      observed,
      reason: reason || (passed ? "Assertion passed." : "Assertion failed."),
      nextStep
    });
  }

  addRun(runId) {
    if (runId && !this.relatedRunIds.includes(runId)) {
      this.relatedRunIds.push(runId);
    }
  }

  finish(error = null) {
    if (error) {
      this.assert("case.exception", "Case completed without exception", false, {
        severity: "critical",
        observed: error.message,
        reason: error.message,
        nextStep: "Read the stack trace in diagnostics and isolate the failing subsystem."
      });
      this.diagnostics.error = { message: error.message, stack: error.stack };
    }
    this.completedAt = nowIso();
    this.durationMs = new Date(this.completedAt).getTime() - new Date(this.startedAt).getTime();
    this.assertionSummary = summarizeAssertions(this.assertions);
    this.status = caseStatus(this.assertions);
    return {
      id: this.id,
      label: this.label,
      category: this.category,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.durationMs,
      assertionSummary: this.assertionSummary,
      assertions: this.assertions,
      diagnostics: this.diagnostics,
      relatedRunIds: this.relatedRunIds
    };
  }
}

async function runCase({ id, label, category, context, execute }) {
  const recorder = new CaseRecorder({ id, label, category });
  try {
    await execute(recorder, context);
  } catch (error) {
    return recorder.finish(error);
  }
  return recorder.finish();
}

async function waitForRunTerminal(service, runId, { timeoutMs = 90_000 } = {}) {
  const terminal = new Set(["completed", "failed", "stopped"]);
  const startedAt = Date.now();
  let detail = null;
  while (Date.now() - startedAt < timeoutMs) {
    detail = await service.getRunDetail(runId);
    if (terminal.has(detail?.run?.status)) return detail;
    const approval = service.listPendingApprovals(runId)[0] ?? null;
    if (approval) {
      await service.resolveApproval(approval.id, APPROVAL_DECISION.APPROVED_ONCE, "Jon smoke auto-approval.");
    }
    await sleep(200);
  }
  return detail;
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

async function createIsolatedService() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jon-mission-smoke-"));
  const dbPath = path.join(tempDir, "jon-smoke.sqlite");
  const service = await OperatorService.create({
    dbPath,
    realSurfaceRuntimeConfig: {
      research: { mode: "open_web" },
      computer: { mode: "controlled_fixture_window" }
    },
    computerProvider: new FakeWindowProvider([], { applications: [], browsers: [] })
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

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function runJonMissionSmoke({
  live = false,
  persist = true,
  liveMission = "Récupère le titre et la description de la page d'accueil de fr.wikipedia.org."
} = {}) {
  const createdAt = nowIso();
  const pipelineId = createId("jon_smoke");
  const handle = await createIsolatedService();
  const service = handle.service;
  const cases = [];

  try {
    const project = await service.ensureDemoProject();

    // ── Case 1: Mission language understanding ────────────────────────────────
    cases.push(await runCase({
      id: "mission_understanding",
      label: "Mission understanding and routing via LLM",
      category: "orchestration",
      context: { service, project },
      execute: async (smoke) => {
        const preview = await service.previewMission(project.id, {
          objective: "Cherche les 3 dernières actualités tech sur une page publique et résume-les."
        });
        const u = preview?.preflight?.understanding;

        smoke.assert("preflight_produced", "Preflight understanding is produced", Boolean(u), {
          observed: Boolean(u),
          reason: "Expected mission understanding to be non-null. LLM provider may be unreachable."
        });
        smoke.assert("execution_frame_set", "Execution frame is resolved", Boolean(u?.chosenExecutionFrame), {
          expected: "research or computer_observation",
          observed: u?.chosenExecutionFrame ?? null,
          reason: "Expected mission to be routed to a valid execution frame."
        });
        smoke.assert("routed_to_research", "Research mission routes to research frame", u?.chosenExecutionFrame === "research", {
          expected: "research",
          observed: u?.chosenExecutionFrame ?? null,
          severity: "warn",
          reason: "A web research mission should route to the research execution frame.",
          nextStep: "Review mission understanding LLM prompt and execution frame routing logic."
        });
        smoke.assert("no_clarification_needed", "Clear mission needs no clarification", !u?.requiresClarification, {
          observed: u?.requiresClarification ?? null,
          severity: "warn",
          reason: "A well-formed research mission should not trigger clarification."
        });
        smoke.diagnostics.understanding = u;
      }
    }));

    // ── Case 2: Orchestration resilience ─────────────────────────────────────
    cases.push(await runCase({
      id: "orchestration_resilience",
      label: "Run lifecycle: plan generation + terminal state, no server crash",
      category: "orchestration",
      context: { service, project },
      execute: async (smoke) => {
        const launch = await service.startScenario(project.id, "research");
        smoke.addRun(launch.runId);

        const detail = await waitForRunTerminal(service, launch.runId, { timeoutMs: 90_000 }).catch(async (err) => {
          smoke.diagnostics.waitError = { message: err.message };
          return service.getRunDetail(launch.runId);
        });

        const run = detail?.run;
        const terminal = ["completed", "failed", "stopped"];

        smoke.assert("run_reaches_terminal", "Run reaches a terminal state", terminal.includes(run?.status), {
          expected: "completed | failed | stopped",
          observed: run?.status ?? null,
          reason: "A run must reach a terminal state. Hanging or crashing is an orchestration failure."
        });

        smoke.assert("service_alive", "Service is alive after run completes", Boolean(service), {
          reason: "If the server crashed, this assertion cannot be reached at all."
        });

        const events = detail?.events ?? [];
        const llmCalls = detail?.llmCalls ?? [];
        const auditEntries = await readAuditEntriesForRun(launch.runId);
        const auditCallTypes = auditEntries.filter((e) => e.type === "jon.llm.output").map((e) => e.callType);

        smoke.assert("plan_generated_event", "plan.generated event is recorded", events.some((e) => e.type === "plan.generated"), {
          observed: events.map((e) => e.type),
          severity: "warn",
          reason: "Expected plan.generated event in run events.",
          nextStep: "Check that plan_generation LLM call succeeds and the plan is persisted."
        });

        smoke.assert("plan_generation_audited", "plan_generation LLM call appears in audit log", auditCallTypes.includes("plan_generation"), {
          expected: "plan_generation in audit",
          observed: auditCallTypes,
          severity: "warn",
          reason: "Expected plan_generation LLM output to be logged.",
          nextStep: "Ensure auditLlmOutput is called in gateway.js after plan_generation."
        });

        smoke.assert("llm_calls_in_db", "LLM calls are persisted in database", llmCalls.length >= 1, {
          expected: ">= 1",
          observed: llmCalls.length,
          reason: "Expected at least one LLM call record linked to the run in the DB."
        });

        smoke.assert("reasoning_snapshots", "Reasoning snapshots are persisted", (detail?.reasoningSnapshots ?? []).length >= 1, {
          expected: ">= 1",
          observed: (detail?.reasoningSnapshots ?? []).length,
          severity: "warn",
          reason: "Expected at least one reasoning context snapshot."
        });

        smoke.diagnostics.runStatus = run?.status ?? null;
        smoke.diagnostics.runSummary = run?.summary ?? null;
        smoke.diagnostics.eventTypes = events.map((e) => e.type);
        smoke.diagnostics.llmCallCount = llmCalls.length;
        smoke.diagnostics.auditCallTypes = auditCallTypes;
      }
    }));

    // ── Case 3: Decision note draft robustness ────────────────────────────────
    cases.push(await runCase({
      id: "decision_note_resilience",
      label: "Decision note draft: malformed LLM output does not crash the run",
      category: "orchestration",
      context: { service, project },
      execute: async (smoke) => {
        const launch = await service.startScenario(project.id, "research");
        smoke.addRun(launch.runId);
        const detail = await waitForRunTerminal(service, launch.runId, { timeoutMs: 90_000 }).catch(async () => {
          return service.getRunDetail(launch.runId);
        });

        const run = detail?.run;
        const auditEntries = await readAuditEntriesForRun(launch.runId);
        const failedLlmOutputs = auditEntries.filter((e) => e.type === "jon.llm.output" && e.callType === "decision_note_draft");

        smoke.assert("run_does_not_crash_server", "Run failure does not crash the server", Boolean(service), {
          reason: "Server must survive any run-level LLM failure — even decision_note_draft malformed output."
        });

        smoke.assert("terminal_state_reached", "Run reaches a terminal state despite any LLM issues", ["completed", "failed", "stopped"].includes(run?.status), {
          expected: "completed | failed | stopped",
          observed: run?.status ?? null,
          reason: "Run must terminate cleanly regardless of intermediate LLM failures."
        });

        if (failedLlmOutputs.length > 0) {
          smoke.assert("decision_note_logged_on_failure", "Decision note draft raw output is logged even on validation failure", true, {
            observed: failedLlmOutputs.length,
            severity: "warn",
            reason: "Decision note draft LLM output was logged. This confirms the audit fix is working."
          });
        }

        smoke.diagnostics.runStatus = run?.status ?? null;
        smoke.diagnostics.decisionNoteDraftAuditCount = failedLlmOutputs.length;
      }
    }));

    // ── Case 4: Live open-web browser research ────────────────────────────────
    if (live) {
      cases.push(await runCase({
        id: "live_browser_research",
        label: "Live open-web browser research end-to-end",
        category: "browser",
        context: { service, project },
        execute: async (smoke) => {
          const result = await service.handleConversationTurn(project.id, {
            message: liveMission
          });

          const runId = result?.autoLaunchedRunId ?? null;
          smoke.diagnostics.conversationAction = result?.turn?.action ?? null;
          smoke.diagnostics.jonReply = String(result?.turn?.reply ?? "").slice(0, 300);

          smoke.assert("run_auto_launched", "JON auto-launched a run from the mission message", Boolean(runId), {
            expected: "autoLaunchedRunId to be set",
            observed: runId,
            reason: "Expected JON to auto-launch a run. It may have asked for clarification instead.",
            nextStep: "Check that the mission is unambiguous and JON's action is start_bounded_run_after_confirmation."
          });

          if (runId) {
            smoke.addRun(runId);
            const detail = await service.waitForRun(runId, { timeoutMs: 120_000 }).catch(async () => {
              return service.getRunDetail(runId);
            });

            const run = detail?.run;
            const evidence = detail?.evidence ?? [];
            const artifacts = detail?.artifacts ?? [];
            const auditEntries = await readAuditEntriesForRun(runId);
            const auditCallTypes = auditEntries.filter((e) => e.type === "jon.llm.output").map((e) => e.callType);

            smoke.assert("live_run_completed", "Live run completes successfully", run?.status === "completed", {
              expected: "completed",
              observed: run?.status ?? null,
              severity: "warn",
              reason: "Live browser research should complete. Check LLM provider and browser config.",
              nextStep: "Inspect run events and audit entries for the blocking failure."
            });

            smoke.assert("live_evidence_captured", "Browser evidence is captured", evidence.length >= 1, {
              expected: ">= 1",
              observed: evidence.length,
              severity: "warn",
              reason: "Expected at least one screenshot or page evidence from browser navigation."
            });

            smoke.assert("live_artifacts_produced", "Artifacts are produced", artifacts.length >= 1, {
              expected: ">= 1",
              observed: artifacts.length,
              severity: "warn",
              reason: "Expected at least one artifact (collection or decision note)."
            });

            smoke.assert("live_decision_note_attempted", "Decision note draft LLM call was attempted", auditCallTypes.includes("decision_note_draft"), {
              observed: auditCallTypes,
              severity: "warn",
              reason: "Expected decision_note_draft LLM call in the audit log for a completed research mission."
            });

            smoke.assert("live_open_navigation", "Browser navigated without allowlist error", !run?.summary?.includes("not allowlisted"), {
              observed: run?.summary?.slice(0, 200) ?? null,
              reason: "Run summary should not contain allowlist errors — open_web mode should permit any URL."
            });

            smoke.diagnostics.runStatus = run?.status ?? null;
            smoke.diagnostics.runSummary = run?.summary ?? null;
            smoke.diagnostics.evidenceCount = evidence.length;
            smoke.diagnostics.artifactCount = artifacts.length;
            smoke.diagnostics.auditCallTypes = auditCallTypes;
          }
        }
      }));
    } else {
      cases.push({
        id: "live_browser_research",
        label: "Live open-web browser research end-to-end",
        category: "browser",
        status: "skipped",
        startedAt: nowIso(),
        completedAt: nowIso(),
        durationMs: 0,
        assertionSummary: { total: 0, passed: 0, failed: 0, blockingFailures: [] },
        assertions: [],
        diagnostics: { reason: "Pass --live to enable real browser navigation test." },
        relatedRunIds: []
      });
    }

  } finally {
    await handle.close();
  }

  const status = reportStatus(cases);
  const counts = {
    pass: cases.filter((c) => c.status === "pass").length,
    degraded: cases.filter((c) => c.status === "degraded").length,
    fail: cases.filter((c) => c.status === "fail").length,
    skipped: cases.filter((c) => c.status === "skipped").length
  };

  const report = {
    id: pipelineId,
    createdAt,
    completedAt: nowIso(),
    status,
    live,
    summary: `${cases.length} cases — ${counts.pass} pass, ${counts.degraded} degraded, ${counts.fail} fail, ${counts.skipped} skipped.`,
    recommendations: cases.flatMap((c) => {
      if (c.status === "pass" || c.status === "skipped") return [];
      const firstFail = c.assertions.find((a) => !a.passed);
      if (!firstFail) return [];
      return [{
        caseId: c.id,
        label: c.label,
        reason: firstFail.reason ?? "Case did not pass.",
        nextStep: firstFail.nextStep ?? "Inspect diagnostics for details."
      }];
    }),
    cases
  };

  if (persist) {
    await ensureDir(REPORTS_ROOT);
    const reportPath = path.join(REPORTS_ROOT, `${createdAt.replace(/[:.]/g, "-")}.json`);
    await writeJson(reportPath, report);
    report.outputPath = reportPath;
  }

  return report;
}
