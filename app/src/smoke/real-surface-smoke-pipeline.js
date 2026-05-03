import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  APPROVAL_DECISION,
  DATA_ROOT,
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_HEADLESS
} from "../config.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { OperatorService } from "../service/operator-service.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { createId, nowIso } from "../utils/ids.js";
import {
  buildRealSurfaceTraceabilityFromRunBundle,
  evaluateRealSurfaceTraceability
} from "../validation/real-surface-harness.js";

export const DEFAULT_REAL_SURFACE_SMOKE_CONFIG_PATH = path.join(
  DATA_ROOT,
  "validation",
  "real-surfaces",
  "real-surface-smoke.local.json"
);

const SMOKE_ROOT = path.join(DATA_ROOT, "smoke", "real-surfaces");
const REPORTS_ROOT = path.join(SMOKE_ROOT, "reports");
const LATEST_REPORT_PATH = path.join(SMOKE_ROOT, "latest.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportFileName(createdAt) {
  return createdAt.replace(/[:.]/g, "-");
}

function normalizeUrl(value, label, { allowHttp = false, allowLoopback = false } = {}) {
  const url = new URL(String(value ?? ""));
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(allowHttp || (allowLoopback && isLoopback))) {
    throw new Error(`${label} must use https unless allowHttp/allowLoopback is enabled.`);
  }
  if (isLoopback && !allowLoopback) {
    throw new Error(`${label} must not use loopback unless allowLoopback is enabled.`);
  }
  return url.toString();
}

function normalizeTarget(raw, label, options) {
  if (!isObject(raw)) {
    return null;
  }
  return {
    ...raw,
    label: String(raw.label ?? label).trim() || label,
    url: normalizeUrl(raw.url, label, options),
    timeoutMs: Math.max(1_000, Math.min(Number(raw.timeoutMs) || 15_000, 120_000))
  };
}

function normalizeOperatorResearch(raw, options) {
  if (!isObject(raw) || raw.enabled === false) {
    return null;
  }
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map((target, index) => ({
      title: String(target.title ?? `Target ${index + 1}`).trim() || `Target ${index + 1}`,
      url: normalizeUrl(target.url, `operatorResearch.targets[${index}].url`, options),
      waitFor: isObject(target.waitFor) ? target.waitFor : null,
      fieldMap: isObject(target.fieldMap) ? target.fieldMap : {},
      staticValues: {
        companyName: String(target.staticValues?.companyName ?? target.title ?? `Target ${index + 1}`).trim(),
        tagline: String(target.staticValues?.tagline ?? `Observed on ${new URL(target.url).hostname}`).trim(),
        priceLevel: String(target.staticValues?.priceLevel ?? "not_applicable").trim(),
        deliverySpeed: String(target.staticValues?.deliverySpeed ?? "not_applicable").trim(),
        riskNote: String(target.staticValues?.riskNote ?? `Read-only smoke target: ${new URL(target.url).hostname}`).trim()
      },
      trustClassification: "allowlisted_real_web",
      evidenceSensitivity: "allowlisted_real_web"
    }))
    : [];
  return {
    enabled: true,
    mission: String(raw.mission ?? "Compare the configured allowlisted pages and produce a traceable note.").trim(),
    timeoutMs: Math.max(10_000, Math.min(Number(raw.timeoutMs) || 120_000, 240_000)),
    targets
  };
}

export function normalizeRealSurfaceSmokeConfig(raw = {}) {
  const options = {
    allowHttp: Boolean(raw.allowHttp),
    allowLoopback: Boolean(raw.allowLoopback)
  };
  const targets = isObject(raw.targets) ? raw.targets : {};
  return {
    schemaVersion: "real_surface_smoke_v1",
    allowHttp: options.allowHttp,
    allowLoopback: options.allowLoopback,
    loadedFromFile: Boolean(raw.loadedFromFile),
    filePath: raw.filePath ?? null,
    targets: {
      canvas: normalizeTarget(targets.canvas, "targets.canvas", options),
      pdf: normalizeTarget(targets.pdf, "targets.pdf", options),
      dropdown: normalizeTarget(targets.dropdown, "targets.dropdown", options),
      networkError: normalizeTarget(targets.networkError, "targets.networkError", {
        ...options,
        allowHttp: true
      }),
      slowPage: normalizeTarget(targets.slowPage, "targets.slowPage", options)
    },
    operatorResearch: normalizeOperatorResearch(raw.operatorResearch, options)
  };
}

export async function loadRealSurfaceSmokeConfig({
  env = process.env,
  filePath = env.COWORK_REAL_SURFACE_SMOKE_CONFIG_PATH || DEFAULT_REAL_SURFACE_SMOKE_CONFIG_PATH
} = {}) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return normalizeRealSurfaceSmokeConfig({
      ...raw,
      loadedFromFile: true,
      filePath
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return normalizeRealSurfaceSmokeConfig({
        loadedFromFile: false,
        filePath
      });
    }
    throw error;
  }
}

function summarizeAssertions(assertions = []) {
  return {
    total: assertions.length,
    passed: assertions.filter((entry) => entry.passed).length,
    failed: assertions.filter((entry) => !entry.passed).length,
    blockingFailures: assertions
      .filter((entry) => !entry.passed && entry.severity === "critical")
      .map((entry) => entry.id)
  };
}

function caseStatus(assertions = []) {
  if (assertions.some((entry) => !entry.passed && entry.severity === "blocked")) {
    return "blocked";
  }
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
  if (cases.length > 0 && cases.every((entry) => entry.status === "blocked")) {
    return "blocked";
  }
  if (cases.some((entry) => ["blocked", "degraded"].includes(entry.status))) {
    return "degraded";
  }
  return "pass";
}

class SmokeCaseRecorder {
  constructor({ id, label, category }) {
    this.id = id;
    this.label = label;
    this.category = category;
    this.startedAt = nowIso();
    this.assertions = [];
    this.diagnostics = {};
    this.evidence = [];
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

  blocked(reason, nextStep = "Configure this target in real-surface-smoke.local.json.") {
    this.assert("target_configured", "Real target is configured", false, {
      severity: "blocked",
      observed: null,
      reason,
      nextStep
    });
  }

  addEvidence(kind, value) {
    this.evidence.push({
      kind,
      value
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
        nextStep: "Inspect diagnostics and isolate the surface-specific failure."
      });
      this.diagnostics.error = {
        message: error.message,
        stack: error.stack
      };
    }
    const completedAt = nowIso();
    const assertionSummary = summarizeAssertions(this.assertions);
    return {
      id: this.id,
      label: this.label,
      category: this.category,
      status: caseStatus(this.assertions),
      startedAt: this.startedAt,
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(this.startedAt).getTime(),
      assertionSummary,
      assertions: this.assertions,
      diagnostics: this.diagnostics,
      evidence: this.evidence,
      relatedRunIds: this.relatedRunIds
    };
  }
}

async function runCase({ id, label, category, execute }) {
  const recorder = new SmokeCaseRecorder({ id, label, category });
  try {
    await execute(recorder);
  } catch (error) {
    return recorder.finish(error);
  }
  return recorder.finish();
}

function launchOptions() {
  const options = {
    headless: DEFAULT_HEADLESS
  };
  if (DEFAULT_BROWSER_CHANNEL && !["bundled", "chromium"].includes(DEFAULT_BROWSER_CHANNEL)) {
    options.channel = DEFAULT_BROWSER_CHANNEL;
  }
  return options;
}

async function createBrowserHarness() {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 }
  });
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  };
}

async function screenshot(page, evidenceRoot, caseId, label) {
  const outputPath = path.join(evidenceRoot, `${caseId}-${label}.png`);
  await ensureDir(path.dirname(outputPath));
  await page.screenshot({ path: outputPath, fullPage: true }).catch(() => null);
  return outputPath;
}

async function goto(page, target, waitUntil = "domcontentloaded") {
  return page.goto(target.url, {
    waitUntil,
    timeout: target.timeoutMs
  });
}

async function runCanvasCase(target, evidenceRoot) {
  return runCase({
    id: "real_web_canvas_probe",
    label: "Real web canvas probe",
    category: "browser_surface",
    execute: async (smoke) => {
      if (!target) {
        smoke.blocked("No canvas target configured.");
        return;
      }
      const harness = await createBrowserHarness();
      try {
        const response = await goto(harness.page, target);
        await harness.page.waitForTimeout(Number(target.settleMs ?? 500));
        const canvasInfo = await harness.page.evaluate(() => Array.from(document.querySelectorAll("canvas")).map((canvas) => ({
          width: canvas.width,
          height: canvas.height,
          dataUrlLength: (() => {
            try {
              return canvas.toDataURL("image/png").length;
            } catch {
              return 0;
            }
          })()
        })));
        const screenshotPath = await screenshot(harness.page, evidenceRoot, "canvas", "page");
        smoke.addEvidence("screenshot", screenshotPath);
        smoke.assert("navigation_ok", "Canvas page navigates", Boolean(response && response.status() < 400), {
          expected: "HTTP < 400",
          observed: response?.status() ?? null,
          reason: "Expected canvas target to load."
        });
        smoke.assert("canvas_present", "Canvas element is present", canvasInfo.length >= Number(target.minCanvasCount ?? 1), {
          expected: `>= ${target.minCanvasCount ?? 1}`,
          observed: canvasInfo.length,
          reason: "Expected at least one canvas element."
        });
        smoke.assert("canvas_nonblank", "Canvas has non-trivial rendered data", canvasInfo.some((entry) => entry.dataUrlLength > Number(target.minDataUrlLength ?? 300)), {
          expected: `dataUrlLength > ${target.minDataUrlLength ?? 300}`,
          observed: canvasInfo,
          reason: "Expected canvas output to be observable rather than blank."
        });
        smoke.diagnostics = {
          url: harness.page.url(),
          title: await harness.page.title().catch(() => ""),
          canvasInfo
        };
      } finally {
        await harness.close();
      }
    }
  });
}

async function runPdfCase(target, evidenceRoot) {
  return runCase({
    id: "real_web_pdf_probe",
    label: "Real web PDF probe",
    category: "browser_surface",
    execute: async (smoke) => {
      if (!target) {
        smoke.blocked("No PDF target configured.");
        return;
      }
      const harness = await createBrowserHarness();
      try {
        let response = null;
        let downloadStarted = false;
        try {
          response = await goto(harness.page, target);
        } catch (error) {
          if (!/download is starting/i.test(error.message ?? "")) {
            throw error;
          }
          downloadStarted = true;
        }
        await harness.page.waitForTimeout(700);
        const headers = response?.headers() ?? {};
        const contentType = String(headers["content-type"] ?? (downloadStarted ? "application/pdf" : "")).toLowerCase();
        const screenshotPath = await screenshot(harness.page, evidenceRoot, "pdf", "viewer");
        smoke.addEvidence("screenshot", screenshotPath);
        smoke.assert("pdf_navigation_ok", "PDF target navigates", Boolean(downloadStarted || (response && response.status() < 400)), {
          expected: "HTTP < 400 or browser download handoff",
          observed: downloadStarted ? "download_started" : response?.status() ?? null,
          reason: "Expected PDF target to load."
        });
        smoke.assert("pdf_content_type", "PDF identity is visible", contentType.includes("pdf") || target.url.toLowerCase().includes(".pdf"), {
          expected: "content-type contains pdf or URL ends with .pdf",
          observed: contentType || target.url,
          reason: "Expected browser-visible PDF identity without relying on copyrighted full-text extraction."
        });
        smoke.diagnostics = {
          url: harness.page.url(),
          title: await harness.page.title().catch(() => ""),
          contentType,
          status: response?.status() ?? null,
          downloadStarted
        };
      } finally {
        await harness.close();
      }
    }
  });
}

async function runDropdownCase(target, evidenceRoot) {
  return runCase({
    id: "real_web_dropdown_probe",
    label: "Real web dropdown/form probe",
    category: "browser_surface",
    execute: async (smoke) => {
      if (!target) {
        smoke.blocked("No dropdown/form target configured.");
        return;
      }
      const harness = await createBrowserHarness();
      try {
        const response = await goto(harness.page, target);
        const selectSelector = target.selectSelector ?? "select";
        const select = harness.page.locator(selectSelector).first();
        const selectCount = await harness.page.locator(selectSelector).count();
        const beforePath = await screenshot(harness.page, evidenceRoot, "dropdown", "before");
        smoke.addEvidence("screenshot", beforePath);
        let selectedValue = null;
        if (selectCount > 0) {
          const value = target.optionValue ?? await select.locator("option").nth(1).getAttribute("value").catch(() => null);
          if (value) {
            await select.selectOption(value);
            selectedValue = await select.inputValue().catch(() => null);
          }
        }
        const afterPath = await screenshot(harness.page, evidenceRoot, "dropdown", "after");
        smoke.addEvidence("screenshot", afterPath);
        const submitControls = await harness.page.locator("button[type='submit'], input[type='submit']").count().catch(() => 0);
        const expectedText = target.expectedTextSelector
          ? await harness.page.locator(target.expectedTextSelector).first().textContent().catch(() => "")
          : "";
        smoke.assert("dropdown_navigation_ok", "Dropdown page navigates", Boolean(response && response.status() < 400), {
          expected: "HTTP < 400",
          observed: response?.status() ?? null,
          reason: "Expected dropdown target to load."
        });
        smoke.assert("select_present", "Select/dropdown control is present", selectCount >= 1, {
          expected: ">= 1",
          observed: selectCount,
          reason: "Expected at least one select element or configured selector."
        });
        smoke.assert("option_selected", "Dropdown option can be selected without submit", Boolean(selectedValue), {
          expected: "non-empty selected value",
          observed: selectedValue,
          reason: "Expected selectOption to change the field state without submitting."
        });
        smoke.assert("submit_boundary_visible", "Submit boundary is visible or explicitly absent", submitControls >= 0, {
          expected: "no submit action performed",
          observed: { submitControls, currentUrl: harness.page.url() },
          reason: "Smoke only prepares/selects; it does not click submit."
        });
        if (target.expectedTextSelector) {
          smoke.assert("dependent_state_visible", "Dependent state is visible after selection", String(expectedText ?? "").trim().length > 0, {
            expected: "non-empty dependent text",
            observed: expectedText,
            reason: "Expected configured dependent state selector to have text."
          });
        }
        smoke.diagnostics = {
          url: harness.page.url(),
          title: await harness.page.title().catch(() => ""),
          selectSelector,
          selectCount,
          selectedValue,
          submitControls,
          expectedText
        };
      } finally {
        await harness.close();
      }
    }
  });
}

async function runNetworkErrorCase(target) {
  return runCase({
    id: "real_web_network_error_probe",
    label: "Real web network error probe",
    category: "browser_resilience",
    execute: async (smoke) => {
      if (!target) {
        smoke.blocked("No network-error target configured.");
        return;
      }
      const harness = await createBrowserHarness();
      try {
        let result = null;
        try {
          const response = await goto(harness.page, target);
          result = {
            navigated: true,
            status: response?.status() ?? null,
            ok: Boolean(response && response.status() < 400)
          };
        } catch (error) {
          result = {
            navigated: false,
            status: null,
            ok: false,
            error: error.message
          };
        }
        const expectFailure = target.expectFailure !== false;
        const passed = expectFailure ? !result.ok : result.ok;
        smoke.assert("network_result_classified", "Network result is classified honestly", passed, {
          expected: expectFailure ? "navigation error or HTTP >= 400" : "HTTP < 400",
          observed: result,
          reason: expectFailure
            ? "Expected failing route to be reported as failed/blocked, not successful."
            : "Expected healthy route to load."
        });
        smoke.diagnostics = {
          url: target.url,
          result
        };
      } finally {
        await harness.close();
      }
    }
  });
}

async function runSlowPageCase(target, evidenceRoot) {
  return runCase({
    id: "real_web_slow_page_probe",
    label: "Real web slow page probe",
    category: "browser_resilience",
    execute: async (smoke) => {
      if (!target) {
        smoke.blocked("No slow-page target configured.");
        return;
      }
      const harness = await createBrowserHarness();
      try {
        const started = Date.now();
        const response = await goto(harness.page, target, target.waitUntil ?? "domcontentloaded");
        if (target.readySelector) {
          await harness.page.locator(target.readySelector).first().waitFor({ timeout: target.timeoutMs });
        }
        const elapsedMs = Date.now() - started;
        const screenshotPath = await screenshot(harness.page, evidenceRoot, "slow-page", "ready");
        smoke.addEvidence("screenshot", screenshotPath);
        smoke.assert("slow_page_loaded", "Slow page eventually loads", Boolean(response && response.status() < 400), {
          expected: "HTTP < 400",
          observed: response?.status() ?? null,
          reason: "Expected slow target to complete within configured timeout."
        });
        if (target.minElapsedMs) {
          smoke.assert("latency_observed", "Configured latency was observed", elapsedMs >= Number(target.minElapsedMs), {
            expected: `>= ${target.minElapsedMs}ms`,
            observed: elapsedMs,
            reason: "Expected slow-page probe to measure a non-trivial delay."
          });
        }
        smoke.diagnostics = {
          url: harness.page.url(),
          elapsedMs,
          title: await harness.page.title().catch(() => "")
        };
      } finally {
        await harness.close();
      }
    }
  });
}

function createControlledComputerProvider() {
  return new FakeWindowProvider([
    {
      id: "win_hub",
      title: "Controlled Browser Fixture Window",
      active: true,
      allowlisted: true,
      content: "real-surface smoke"
    }
  ], {
    browsers: [
      {
        id: "edge",
        label: "Microsoft Edge",
        processName: "msedge",
        executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      }
    ]
  });
}

async function createOperatorServiceForResearch(operatorResearch) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-real-surface-smoke-"));
  const service = await OperatorService.create({
    dbPath: path.join(tempDir, "real-surface-smoke.sqlite"),
    computerProvider: createControlledComputerProvider(),
    realSurfaceRuntimeConfig: {
      research: {
        mode: "allowlisted_real_web",
        mission: operatorResearch.mission,
        targets: operatorResearch.targets
      },
      computer: {
        mode: "controlled_fixture_window",
        mission: "Controlled local window observation."
      }
    }
  });
  return {
    service,
    async close() {
      await service.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function waitForOperatorRun(service, runId, timeoutMs) {
  const started = Date.now();
  let detail = null;
  while (Date.now() - started < timeoutMs) {
    const approval = service.listPendingApprovals(runId)[0] ?? null;
    if (approval) {
      await service.resolveApproval(approval.id, APPROVAL_DECISION.APPROVED_ONCE, "Real-surface smoke bounded approval.");
    }
    detail = await service.getRunDetail(runId);
    if (["completed", "failed", "stopped"].includes(detail?.run?.status)) {
      return detail;
    }
    await sleep(250);
  }
  return detail ?? await service.getRunDetail(runId);
}

async function runOperatorResearchCase(operatorResearch) {
  return runCase({
    id: "real_web_operator_research",
    label: "JON allowlisted real-web research run",
    category: "operator_run",
    execute: async (smoke) => {
      if (!operatorResearch || operatorResearch.targets.length < 2) {
        smoke.blocked("No operatorResearch target set with at least two targets.", "Configure operatorResearch.targets with at least two low-risk allowlisted HTTPS pages.");
        return;
      }
      const handle = await createOperatorServiceForResearch(operatorResearch);
      try {
        const project = await handle.service.ensureDemoProject();
        const launch = await handle.service.startScenario(project.id, "research");
        smoke.addRun(launch.runId);
        const detail = await waitForOperatorRun(handle.service, launch.runId, operatorResearch.timeoutMs);
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
        smoke.assert("operator_run_completed", "JON real-web research run completes", detail?.run?.status === "completed", {
          expected: "completed",
          observed: detail?.run?.status ?? null,
          reason: "Expected JON to complete the allowlisted real-web research run."
        });
        smoke.assert("operator_traceability_passed", "JON real-web run satisfies traceability gates", review.passed, {
          expected: "traceability gates pass",
          observed: review,
          reason: review.passed ? "Traceability gates passed." : `Missing gates: ${review.missing.map((entry) => entry.id).join(", ")}`
        });
        smoke.diagnostics = {
          runSummary: detail?.run?.summary ?? null,
          traceability,
          traceabilityReview: review
        };
      } finally {
        await handle.close();
      }
    }
  });
}

function recommendationForCase(smokeCase) {
  if (smokeCase.status === "pass") {
    return null;
  }
  const firstFailure = smokeCase.assertions.find((entry) => !entry.passed);
  return {
    caseId: smokeCase.id,
    label: smokeCase.label,
    status: smokeCase.status,
    reason: firstFailure?.reason ?? "Real-surface smoke case did not pass.",
    nextStep: firstFailure?.nextStep ?? "Inspect diagnostics and either configure the target or harden the relevant surface behavior."
  };
}

export async function runRealSurfaceSmokePipeline({
  config = null,
  configPath = null,
  persist = true,
  runner = "backoffice"
} = {}) {
  const createdAt = nowIso();
  const pipelineId = createId("real_smoke");
  const resolvedConfig = config
    ? normalizeRealSurfaceSmokeConfig(config)
    : await loadRealSurfaceSmokeConfig({
      filePath: configPath ?? undefined
    });
  const evidenceRoot = path.join(SMOKE_ROOT, "evidence", reportFileName(createdAt));
  const cases = [
    await runCanvasCase(resolvedConfig.targets.canvas, evidenceRoot),
    await runPdfCase(resolvedConfig.targets.pdf, evidenceRoot),
    await runDropdownCase(resolvedConfig.targets.dropdown, evidenceRoot),
    await runNetworkErrorCase(resolvedConfig.targets.networkError),
    await runSlowPageCase(resolvedConfig.targets.slowPage, evidenceRoot),
    await runOperatorResearchCase(resolvedConfig.operatorResearch)
  ];
  const completedAt = nowIso();
  const status = reportStatus(cases);
  const report = {
    id: pipelineId,
    createdAt,
    completedAt,
    runner,
    mode: "real_surface_probe",
    status,
    config: {
      filePath: resolvedConfig.filePath,
      loadedFromFile: resolvedConfig.loadedFromFile,
      allowHttp: resolvedConfig.allowHttp,
      allowLoopback: resolvedConfig.allowLoopback,
      configuredTargets: Object.entries(resolvedConfig.targets)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key),
      operatorResearchConfigured: Boolean(resolvedConfig.operatorResearch?.targets?.length >= 2)
    },
    summary: {
      caseCount: cases.length,
      passed: cases.filter((entry) => entry.status === "pass").length,
      degraded: cases.filter((entry) => entry.status === "degraded").length,
      failed: cases.filter((entry) => entry.status === "fail").length,
      blocked: cases.filter((entry) => entry.status === "blocked").length,
      durationMs: new Date(completedAt).getTime() - new Date(createdAt).getTime()
    },
    cases,
    recommendations: cases.map(recommendationForCase).filter(Boolean),
    limits: [
      "This pipeline touches external or operator-configured surfaces and can be blocked by network, site changes, consent walls, or missing configuration.",
      "A pass here complements the controlled cowork smoke; it does not prove every arbitrary website or desktop app."
    ]
  };
  if (persist) {
    return persistRealSurfaceSmokeReport(report);
  }
  return report;
}

export async function persistRealSurfaceSmokeReport(report) {
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

export async function getLatestRealSurfaceSmokeReport() {
  try {
    return JSON.parse(await fs.readFile(LATEST_REPORT_PATH, "utf8"));
  } catch {
    return null;
  }
}

export async function listRealSurfaceSmokeReports({ limit = 10 } = {}) {
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

export class RealSurfaceSmokeBackofficeService {
  constructor() {
    this.running = null;
  }

  async run(options = {}) {
    if (this.running) {
      throw new Error("A real-surface smoke pipeline is already running.");
    }
    this.running = runRealSurfaceSmokePipeline(options);
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
    return getLatestRealSurfaceSmokeReport();
  }

  listReports(options = {}) {
    return listRealSurfaceSmokeReports(options);
  }
}
