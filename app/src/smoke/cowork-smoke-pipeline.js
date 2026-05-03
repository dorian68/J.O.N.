import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_LLM_BUDGETS, DATA_ROOT, APPROVAL_DECISION } from "../config.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { OperatorService } from "../service/operator-service.js";
import { getTokenGovernancePolicy } from "../llm/token-governance.js";
import { REASONING_STAGE } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { createId, nowIso } from "../utils/ids.js";
import {
  buildRealSurfaceTraceabilityFromRunBundle,
  evaluateRealSurfaceTraceability
} from "../validation/real-surface-harness.js";

const SMOKE_ROOT = path.join(DATA_ROOT, "smoke", "cowork-pipeline");
const REPORTS_ROOT = path.join(SMOKE_ROOT, "reports");
const LATEST_REPORT_PATH = path.join(SMOKE_ROOT, "latest.json");

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture research cowork smoke mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture computer cowork smoke mission."
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportFileName(createdAt) {
  return createdAt.replace(/[:.]/g, "-");
}

function summarizeAssertions(assertions = []) {
  const blockingFailures = assertions.filter((entry) => !entry.passed && entry.severity === "critical");
  return {
    total: assertions.length,
    passed: assertions.filter((entry) => entry.passed).length,
    failed: assertions.filter((entry) => !entry.passed).length,
    blockingFailures: blockingFailures.map((entry) => entry.id)
  };
}

function caseStatus(assertions = []) {
  if (assertions.some((entry) => !entry.passed && entry.severity === "critical")) {
    return "fail";
  }
  if (assertions.some((entry) => !entry.passed)) {
    return "degraded";
  }
  return "pass";
}

function reportStatus(cases = []) {
  if (cases.some((entry) => entry.status === "fail")) {
    return "fail";
  }
  if (cases.some((entry) => entry.status === "degraded" || entry.status === "skipped")) {
    return "degraded";
  }
  return "pass";
}

function createControlledComputerProvider() {
  return new FakeWindowProvider([
    {
      id: "win_hub",
      title: "Controlled Browser Fixture Window",
      active: false,
      allowlisted: true,
      content: "state=loading",
      controls: [
        {
          id: "search_box",
          name: "Search",
          controlType: "ControlType.Edit"
        }
      ]
    },
    {
      id: "win_notes",
      title: "Operator Notes Window",
      active: true,
      allowlisted: false,
      content: "operator smoke notes"
    }
  ], {
    applications: [
      {
        id: "notepad",
        label: "Notepad",
        kind: "text_editor",
        processName: "notepad",
        executablePath: "C:\\Windows\\System32\\notepad.exe"
      },
      {
        id: "obsidian",
        label: "Obsidian",
        kind: "notes",
        processName: "Obsidian",
        executablePath: "C:\\Users\\Labry\\AppData\\Local\\Obsidian\\Obsidian.exe"
      }
    ],
    browsers: [
      {
        id: "edge",
        label: "Microsoft Edge",
        processName: "msedge",
        executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      },
      {
        id: "chrome",
        label: "Google Chrome",
        processName: "chrome",
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
    ]
  });
}

async function waitForPendingApproval(service, { runId = null, timeoutMs = 5_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const approvals = service.listPendingApprovals(runId).filter(Boolean);
    if (approvals.length > 0) {
      return approvals[0];
    }
    await sleep(100);
  }
  return null;
}

async function waitForRunLifecycleStage(service, runId, lifecycleStage, { timeoutMs = 5_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const detail = await service.getRunDetail(runId);
    if (detail?.run?.lifecycleStage === lifecycleStage) {
      return detail;
    }
    await sleep(100);
  }
  return await service.getRunDetail(runId);
}

async function waitForRunTerminal(service, runId, { timeoutMs = 25_000 } = {}) {
  const terminalStatuses = new Set(["completed", "failed", "stopped"]);
  const startedAt = Date.now();
  let detail = null;
  while (Date.now() - startedAt < timeoutMs) {
    detail = await service.getRunDetail(runId);
    if (terminalStatuses.has(detail?.run?.status)) {
      return detail;
    }
    const approval = service.listPendingApprovals(runId)[0] ?? null;
    if (approval) {
      await service.resolveApproval(approval.id, APPROVAL_DECISION.APPROVED_ONCE, "Controlled smoke pipeline approval.");
    }
    await sleep(150);
  }
  return detail;
}

async function createIsolatedOperatorService() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-smoke-pipeline-"));
  const dbPath = path.join(tempDir, "cowork-smoke.sqlite");
  const service = await OperatorService.create({
    dbPath,
    realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
    computerProvider: createControlledComputerProvider()
  });
  return {
    service,
    dbPath,
    tempDir,
    async close() {
      await service.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function recommendationForCase(smokeCase) {
  if (smokeCase.status === "pass") {
    return null;
  }
  const firstFailure = smokeCase.assertions.find((entry) => !entry.passed);
  return {
    caseId: smokeCase.id,
    label: smokeCase.label,
    reason: firstFailure?.reason ?? "Smoke case did not pass.",
    nextStep: firstFailure?.nextStep ?? "Inspect case diagnostics and add a focused regression test before widening the smoke gate."
  };
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

  assert(id, label, passed, {
    severity = "critical",
    expected = null,
    observed = null,
    reason = "",
    nextStep = null
  } = {}) {
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
      this.diagnostics.error = {
        message: error.message,
        stack: error.stack
      };
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

export async function runCoworkSmokePipeline({
  includeBrowser = true,
  persist = true,
  runner = "backoffice",
  serviceHandle = null
} = {}) {
  const createdAt = nowIso();
  const pipelineId = createId("smoke");
  const ownedHandle = serviceHandle ?? await createIsolatedOperatorService();
  const service = ownedHandle.service ?? ownedHandle;
  const context = {
    service,
    project: null,
    researchRunDetail: null
  };
  const cases = [];

  try {
    context.project = await service.ensureDemoProject();

    cases.push(await runCase({
      id: "budget_governance",
      label: "Budget token and stage governance",
      category: "llm_budget",
      context,
      execute: async (smoke) => {
        const conversationPolicy = getTokenGovernancePolicy(REASONING_STAGE.CONVERSATION_TURN);
        const browserPlanPolicy = getTokenGovernancePolicy(REASONING_STAGE.BROWSER_PLAN);
        smoke.assert("per_run_budget", "Per-run token budget supports long missions", DEFAULT_LLM_BUDGETS.perRunTokens >= 50_000, {
          expected: ">= 50000",
          observed: DEFAULT_LLM_BUDGETS.perRunTokens,
          reason: `Configured per-run budget is ${DEFAULT_LLM_BUDGETS.perRunTokens}.`,
          nextStep: "Raise DEFAULT_LLM_BUDGETS.perRunTokens and environment defaults."
        });
        smoke.assert("per_session_budget", "Per-session token budget supports multi-stage sessions", DEFAULT_LLM_BUDGETS.perSessionTokens >= 200_000, {
          expected: ">= 200000",
          observed: DEFAULT_LLM_BUDGETS.perSessionTokens,
          reason: `Configured per-session budget is ${DEFAULT_LLM_BUDGETS.perSessionTokens}.`,
          nextStep: "Raise DEFAULT_LLM_BUDGETS.perSessionTokens and check runtime config overrides."
        });
        smoke.assert("conversation_request_budget", "Conversation stage has room for memory and context", conversationPolicy.requestTokenTarget >= 3_000, {
          expected: ">= 3000",
          observed: conversationPolicy.requestTokenTarget,
          reason: `Conversation requested budget is ${conversationPolicy.requestTokenTarget}.`
        });
        smoke.assert("browser_plan_budget", "Browser planning stage can handle non-trivial web tasks", browserPlanPolicy.requestTokenTarget >= 8_000, {
          expected: ">= 8000",
          observed: browserPlanPolicy.requestTokenTarget,
          reason: `Browser plan requested budget is ${browserPlanPolicy.requestTokenTarget}.`
        });
        smoke.diagnostics.policies = {
          conversationPolicy,
          browserPlanPolicy,
          defaultBudgets: DEFAULT_LLM_BUDGETS
        };
      }
    }));

    cases.push(await runCase({
      id: "conversation_memory",
      label: "Qualitative memory and startup recall",
      category: "memory",
      context,
      execute: async (smoke, { project }) => {
        const first = await service.handleConversationTurn(project.id, {
          message: "Je suis consultant data. Je prefere Codex et PowerShell pour les validations, et Claude etait indisponible avant."
        });
        const second = await service.handleConversationTurn(project.id, {
          conversationId: first.conversation.id,
          message: "Quand une mission browser bloque, evite de conclure sans preuve et garde le contexte de workflow."
        });
        const conversation = service.runtimeHandle.database.getConversation(first.conversation.id);
        const records = service.listUserMemoryRecords({ projectId: project.id, limit: 80 });
        const startup = service.getStartupMemoryContext(project.id);
        smoke.assert("profile_fact_recorded", "User profile facts are persisted", records.some((record) => record.category === "profile_fact"), {
          observed: records.map((record) => record.category),
          reason: "Expected at least one profile_fact memory record.",
          nextStep: "Improve user-memory extraction patterns for French profile statements."
        });
        smoke.assert("preference_recorded", "User preferences are persisted", records.some((record) => record.category === "preference"), {
          observed: records.map((record) => record.category),
          reason: "Expected at least one preference memory record."
        });
        smoke.assert("blocker_recorded", "Recurring blockers are persisted", records.some((record) => record.category === "blocker"), {
          observed: records.map((record) => record.category),
          reason: "Expected at least one blocker memory record."
        });
        smoke.assert("rolling_summary", "Conversation summary keeps multiple turns", String(conversation.summary ?? "").split("\n").length >= 2, {
          observed: conversation.summary,
          reason: "Expected rolling conversation summary with at least two entries."
        });
        smoke.assert("startup_records", "Startup context recalls memory records", startup.memoryRecords.length >= 3, {
          observed: startup.memoryRecords.length,
          reason: "Expected startup memory context to include recent records."
        });
        smoke.diagnostics.conversationId = first.conversation.id;
        smoke.diagnostics.memoryRecordCategories = records.map((record) => record.category);
        smoke.diagnostics.startupMemory = startup;
      }
    }));

    cases.push(await runCase({
      id: "mission_preflight",
      label: "Mission preflight routing",
      category: "planner",
      context,
      execute: async (smoke, { project }) => {
        const researchPreview = await service.previewMission(project.id, {
          objective: "Compare les pages fixture et produis une note courte avec preuves."
        });
        const browserPreview = await service.previewMission(project.id, {
          objective: "Open my browser on this machine.",
          parameters: {
            browserLaunch: {
              browserId: "edge"
            }
          }
        });
        smoke.assert("research_frame", "Research mission routes to research frame", researchPreview.preflight.understanding.chosenExecutionFrame === "research", {
          expected: "research",
          observed: researchPreview.preflight.understanding.chosenExecutionFrame,
          reason: "Expected controlled comparison mission to route to browser research."
        });
        smoke.assert("browser_launch_frame", "Browser launch mission routes to computer observation", browserPreview.preflight.understanding.chosenExecutionFrame === "computer_observation", {
          expected: "computer_observation",
          observed: browserPreview.preflight.understanding.chosenExecutionFrame,
          reason: "Expected browser launch to route through computer observation."
        });
        smoke.assert("browser_selected", "Requested browser selection survives preflight", browserPreview.preflight.understanding.selectedBrowser?.id === "edge", {
          expected: "edge",
          observed: browserPreview.preflight.understanding.selectedBrowser?.id,
          reason: "Expected selected Edge browser in preflight output."
        });
        smoke.diagnostics.researchPreflight = researchPreview.preflight.understanding;
        smoke.diagnostics.browserPreflight = browserPreview.preflight.understanding;
      }
    }));

    cases.push(await runCase({
      id: "surface_concurrency",
      label: "Surface-aware simultaneity and queueing",
      category: "orchestration",
      context,
      execute: async (smoke, { project }) => {
        const first = await service.startScenario(project.id, "computer");
        const second = await service.startScenario(project.id, "computer");
        const queued = await waitForRunLifecycleStage(service, second.runId, "queued_surface_lock");
        const firstApproval = await waitForPendingApproval(service, { runId: first.runId, timeoutMs: 12_000 });
        smoke.addRun(first.runId);
        smoke.addRun(second.runId);
        smoke.assert("first_approval_category", "Desktop approval is well typed when requested", !firstApproval || firstApproval.category === "local_focus", {
          expected: "null or local_focus",
          observed: firstApproval?.category ?? null,
          reason: "If the controlled desktop smoke path requests approval, it must request local_focus approval.",
          nextStep: "Inspect desktop policy routing for unexpected approval categories."
        });
        smoke.assert("same_surface_queued", "Second desktop run is queued on same surface", queued?.run?.lifecycleStage === "queued_surface_lock", {
          expected: "queued_surface_lock",
          observed: queued?.run?.lifecycleStage ?? null,
          reason: "Expected second desktop run to queue instead of conflicting with the first run."
        });
        smoke.assert("desktop_surface_busy", "Desktop surface is reported busy", service.hasActiveRunOnSurface(project.id, "desktop"), {
          observed: service.listActiveRunSurfaces(project.id),
          reason: "Expected active desktop surface lock to be visible from service state."
        });
        smoke.assert("browser_surface_free", "Browser surface remains independently available", !service.hasActiveRunOnSurface(project.id, "browser"), {
          observed: service.listActiveRunSurfaces(project.id),
          reason: "Expected desktop queue not to block browser surface."
        });
        if (firstApproval) {
          await service.resolveApproval(firstApproval.id, APPROVAL_DECISION.APPROVED_ONCE, "Controlled smoke approval for first desktop run.");
        }
        const firstDetail = await waitForRunTerminal(service, first.runId);
        const secondApproval = await waitForPendingApproval(service, { runId: second.runId, timeoutMs: 5_000 });
        if (secondApproval) {
          await service.resolveApproval(secondApproval.id, APPROVAL_DECISION.APPROVED_ONCE, "Controlled smoke approval for queued desktop run.");
        }
        const secondDetail = await waitForRunTerminal(service, second.runId);
        smoke.assert("first_completed", "First desktop run completes", firstDetail?.run?.status === "completed", {
          expected: "completed",
          observed: firstDetail?.run?.status ?? null,
          reason: "Expected first controlled desktop run to complete after approval."
        });
        smoke.assert("second_completed", "Queued desktop run completes after dequeue", secondDetail?.run?.status === "completed", {
          expected: "completed",
          observed: secondDetail?.run?.status ?? null,
          reason: "Expected queued desktop run to complete after first releases surface."
        });
        smoke.assert("dequeue_event", "Queued run records dequeue event", (secondDetail?.events ?? []).some((event) => event.type === "run.dequeued"), {
          observed: (secondDetail?.events ?? []).map((event) => event.type),
          reason: "Expected run.dequeued event for queued desktop run."
        });
      }
    }));

    if (includeBrowser) {
      cases.push(await runCase({
        id: "controlled_browser_research",
        label: "Controlled browser research execution",
        category: "browser",
        context,
        execute: async (smoke, { project }) => {
          const launch = await service.startScenario(project.id, "research");
          smoke.addRun(launch.runId);
          const detail = await service.waitForRun(launch.runId, { timeoutMs: 120_000 }).catch(async (error) => {
            smoke.diagnostics.waitError = {
              message: error.message,
              code: error.code ?? null
            };
            return service.getRunDetail(launch.runId);
          });
          context.researchRunDetail = detail;
          smoke.assert("research_completed", "Research run completes", detail?.run?.status === "completed", {
            expected: "completed",
            observed: detail?.run?.status ?? null,
            reason: "Expected controlled browser research run to complete."
          });
          smoke.assert("evidence_captured", "Research run captures evidence", (detail?.evidence ?? []).length >= 2, {
            expected: ">= 2",
            observed: detail?.evidence?.length ?? 0,
            reason: "Expected at least two persisted evidence records."
          });
          smoke.assert("artifacts_created", "Research run creates artifacts", (detail?.artifacts ?? []).length >= 2, {
            expected: ">= 2",
            observed: detail?.artifacts?.length ?? 0,
            reason: "Expected collection and decision artifacts."
          });
          smoke.assert("llm_traced", "LLM calls are traced", (detail?.llmCalls ?? []).length >= 2, {
            expected: ">= 2",
            observed: detail?.llmCalls?.length ?? 0,
            reason: "Expected at least mission understanding and planning/decision LLM calls."
          });
          smoke.assert("reasoning_snapshots", "Reasoning snapshots are persisted", (detail?.reasoningSnapshots ?? []).length >= 2, {
            expected: ">= 2",
            observed: detail?.reasoningSnapshots?.length ?? 0,
            reason: "Expected persisted reasoning snapshots linked to run."
          });
          smoke.diagnostics.runSummary = detail?.run?.summary ?? null;
          smoke.diagnostics.verificationSummary = detail?.run?.metadata?.verificationSummary ?? null;
        }
      }));

      cases.push(await runCase({
        id: "real_surface_traceability",
        label: "Real-surface traceability gate from run bundle",
        category: "validation",
        context,
        execute: async (smoke) => {
          const detail = context.researchRunDetail;
          const traceability = buildRealSurfaceTraceabilityFromRunBundle({
            run: detail?.run,
            evidence: detail?.evidence,
            artifacts: detail?.artifacts,
            llmCalls: detail?.llmCalls,
            reasoningSnapshots: detail?.reasoningSnapshots
          }, {
            scenarioId: "bounded_real_web_research"
          });
          const review = evaluateRealSurfaceTraceability({
            scenarioId: "bounded_real_web_research",
            traceability
          });
          smoke.assert("traceability_passes", "Run bundle satisfies bounded web research traceability gates", review.passed, {
            expected: "all minimum traceability gates pass",
            observed: review,
            reason: review.passed ? "Traceability gates passed." : `Missing gates: ${review.missing.map((entry) => entry.id).join(", ")}`,
            nextStep: "Ensure browser runs persist artifacts, evidence, LLM calls, reasoning snapshots, and log paths before claiming real-surface pass."
          });
          smoke.diagnostics.traceability = traceability;
          smoke.diagnostics.traceabilityReview = review;
        }
      }));
    } else {
      cases.push({
        id: "controlled_browser_research",
        label: "Controlled browser research execution",
        category: "browser",
        status: "skipped",
        startedAt: nowIso(),
        completedAt: nowIso(),
        durationMs: 0,
        assertionSummary: {
          total: 0,
          passed: 0,
          failed: 0,
          blockingFailures: []
        },
        assertions: [],
        diagnostics: {
          reason: "includeBrowser=false"
        },
        relatedRunIds: []
      });
    }

    cases.push(await runCase({
      id: "dashboard_observability",
      label: "Backoffice observability after smoke",
      category: "backoffice",
      context,
      execute: async (smoke, { project }) => {
        const dashboard = await service.getDashboard(project.id);
        smoke.assert("dashboard_has_llm_usage", "Dashboard exposes LLM usage", Number(dashboard.llmDashboard?.callCount ?? 0) >= 1, {
          expected: ">= 1",
          observed: dashboard.llmDashboard?.callCount ?? 0,
          reason: "Expected LLM dashboard to reflect smoke calls."
        });
        smoke.assert("dashboard_has_memory", "Dashboard exposes user memory records", Array.isArray(dashboard.userMemoryRecords) && dashboard.userMemoryRecords.length >= 1, {
          observed: dashboard.userMemoryRecords?.length ?? 0,
          reason: "Expected dashboard userMemoryRecords to be populated."
        });
        smoke.assert("dashboard_has_surface_state", "Dashboard exposes active surface state", Array.isArray(dashboard.activeRunSurfaces), {
          observed: dashboard.activeRunSurfaces,
          reason: "Expected activeRunSurfaces array in dashboard."
        });
        smoke.diagnostics.llmDashboard = dashboard.llmDashboard;
        smoke.diagnostics.userMemoryRecordCount = dashboard.userMemoryRecords?.length ?? 0;
      }
    }));
  } finally {
    if (!serviceHandle) {
      await ownedHandle.close();
    }
  }

  const completedAt = nowIso();
  const status = reportStatus(cases);
  const recommendations = cases.map(recommendationForCase).filter(Boolean);
  const report = {
    id: pipelineId,
    createdAt,
    completedAt,
    runner,
    mode: includeBrowser ? "controlled_full" : "controlled_no_browser",
    status,
    summary: {
      caseCount: cases.length,
      passed: cases.filter((entry) => entry.status === "pass").length,
      degraded: cases.filter((entry) => entry.status === "degraded").length,
      failed: cases.filter((entry) => entry.status === "fail").length,
      skipped: cases.filter((entry) => entry.status === "skipped").length,
      durationMs: new Date(completedAt).getTime() - new Date(createdAt).getTime()
    },
    cases,
    recommendations,
    limits: [
      "This pipeline proves controlled JON behavior, not arbitrary production reliability on every real website or desktop app.",
      "Real-site validation still needs operator-reviewed runs recorded through the real-surface validation pack."
    ]
  };

  if (persist) {
    return persistCoworkSmokeReport(report);
  }
  return report;
}

export async function persistCoworkSmokeReport(report) {
  await ensureDir(SMOKE_ROOT);
  await ensureDir(REPORTS_ROOT);
  const outputPath = path.join(REPORTS_ROOT, `${reportFileName(report.createdAt)}.json`);
  const persisted = {
    ...report,
    outputPath,
    latestPath: LATEST_REPORT_PATH
  };
  await writeJson(outputPath, persisted);
  await writeJson(LATEST_REPORT_PATH, persisted);
  return persisted;
}

export async function getLatestCoworkSmokeReport() {
  try {
    return JSON.parse(await fs.readFile(LATEST_REPORT_PATH, "utf8"));
  } catch {
    return null;
  }
}

export async function listCoworkSmokeReports({ limit = 10 } = {}) {
  try {
    const files = await fs.readdir(REPORTS_ROOT);
    return Promise.all(files
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)))
      .map(async (file) => JSON.parse(await fs.readFile(path.join(REPORTS_ROOT, file), "utf8"))));
  } catch {
    return [];
  }
}

export class CoworkSmokeBackofficeService {
  constructor() {
    this.running = null;
  }

  async run(options = {}) {
    if (this.running) {
      throw new Error("A cowork smoke pipeline is already running.");
    }
    this.running = runCoworkSmokePipeline(options);
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  getStatus() {
    return {
      running: Boolean(this.running)
    };
  }

  getLatest() {
    return getLatestCoworkSmokeReport();
  }

  listReports(options = {}) {
    return listCoworkSmokeReports(options);
  }
}
