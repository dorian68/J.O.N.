import fs from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { nowIso } from "../utils/ids.js";
import { runBrowserBenchmarks } from "../benchmarks/browser-benchmarks.js";
import { runComputerBenchmarks } from "../benchmarks/computer-benchmarks.js";
import { runReasoningBenchmarks } from "../benchmarks/reasoning-benchmarks.js";
import { runWindowsProviderDiagnostics } from "../benchmarks/windows-provider-diagnostics.js";
import { applySuiteHumanReview, buildBenchmarkReviewModel } from "./benchmark-review-model.js";

const BENCHMARKS_ROOT = path.join(DATA_ROOT, "benchmarks");
const LATEST_REPORT_PATH = path.join(BENCHMARKS_ROOT, "latest.json");
const REPORTS_ROOT = path.join(BENCHMARKS_ROOT, "reports");

function allPassed(assertions) {
  return Object.values(assertions).every((value) => value === true);
}

function summarizeAssertions(assertions) {
  const entries = Object.entries(assertions);
  return {
    total: entries.length,
    passed: entries.filter(([, value]) => value === true).length,
    failedKeys: entries.filter(([, value]) => value !== true).map(([key]) => key)
  };
}

function reportFileName(createdAt) {
  return createdAt.replace(/[:.]/g, "-");
}

function historicalReportPath(createdAt) {
  return path.join(REPORTS_ROOT, `${reportFileName(createdAt)}.json`);
}

function ensureReview(report) {
  if (!report.review) {
    report.review = buildBenchmarkReviewModel(report);
  }
  if (!report.summary.overallStatus) {
    report.summary.overallStatus = report.review.overallStatus;
  }
  if (!("windowsProviderStatus" in report.summary)) {
    report.summary.windowsProviderStatus = report.windowsProvider?.status ?? "unavailable";
  }
  return report;
}

export class BenchmarkService {
  async runFullBenchmarkSuite() {
    await ensureDir(BENCHMARKS_ROOT);
    await ensureDir(REPORTS_ROOT);
    const browser = await runBrowserBenchmarks();
    const computer = await runComputerBenchmarks();
    const reasoning = await runReasoningBenchmarks();
    const windowsProvider = await runWindowsProviderDiagnostics();
    const createdAt = nowIso();
    const report = {
      createdAt,
      browser,
      computer,
      reasoning,
      windowsProvider,
      summary: {
        browserPassed: allPassed(browser.assertions),
        computerPassed: allPassed(computer.assertions),
        reasoningPassed: allPassed(reasoning.assertions),
        windowsProviderStatus: windowsProvider.status,
        browserAssertions: summarizeAssertions(browser.assertions),
        computerAssertions: summarizeAssertions(computer.assertions),
        reasoningAssertions: summarizeAssertions(reasoning.assertions)
      }
    };
    report.review = buildBenchmarkReviewModel(report);
    report.summary.overallStatus = report.review.overallStatus;
    const historicalPath = historicalReportPath(createdAt);
    await writeJson(historicalPath, report);
    await writeJson(LATEST_REPORT_PATH, report);
    return report;
  }

  async getLatestBenchmarkReport() {
    try {
      const content = await fs.readFile(LATEST_REPORT_PATH, "utf8");
      return ensureReview(JSON.parse(content));
    } catch {
      return null;
    }
  }

  async listBenchmarkReports({ limit = 10 } = {}) {
    try {
      const files = await fs.readdir(REPORTS_ROOT);
      const jsonFiles = files
        .filter((file) => file.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit);

      return Promise.all(jsonFiles.map(async (file) => {
        const filePath = path.join(REPORTS_ROOT, file);
        const content = await fs.readFile(filePath, "utf8");
        return ensureReview(JSON.parse(content));
      }));
    } catch {
      return [];
    }
  }

  async submitSuiteReview({ createdAt, suiteId, classification, notes = "", reviewer = "operator" }) {
    const reportPath = historicalReportPath(createdAt);
    const content = await fs.readFile(reportPath, "utf8");
    const report = ensureReview(JSON.parse(content));
    const updated = applySuiteHumanReview(report, {
      suiteId,
      classification,
      notes,
      reviewer
    });
    await writeJson(reportPath, updated);

    const latest = await this.getLatestBenchmarkReport();
    if (latest?.createdAt === createdAt) {
      await writeJson(LATEST_REPORT_PATH, updated);
    }
    return updated;
  }
}
