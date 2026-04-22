import { BENCHMARK_REVIEW_CLASSIFICATION } from "../config.js";

const SUITE_KEY_MAP = Object.freeze({
  browser: "browser",
  computer: "computer",
  reasoning: "reasoning",
  windows_provider: "windowsProvider"
});

function normalizeAssertionRows(assertions = {}, assertionDetails = {}) {
  return Object.entries(assertions).map(([key, passed]) => ({
    key,
    passed: passed === true,
    label: assertionDetails[key]?.label ?? key,
    expected: assertionDetails[key]?.expected ?? null,
    observed: assertionDetails[key]?.observed ?? null,
    reason: assertionDetails[key]?.reason ?? (passed === true ? "Assertion satisfied." : "Assertion failed."),
    refs: assertionDetails[key]?.refs ?? {}
  }));
}

function summarizeRows(rows) {
  return {
    total: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failed: rows.filter((row) => !row.passed).length
  };
}

function deriveStatus(rows, fallback = null) {
  if (fallback === "skipped") {
    return "skipped";
  }
  return rows.every((row) => row.passed) ? "pass" : "fail";
}

function normalizeClassification(value) {
  if (!value) {
    return null;
  }
  const lower = String(value).toLowerCase();
  return Object.values(BENCHMARK_REVIEW_CLASSIFICATION).includes(lower) ? lower : null;
}

function reviewStatusFor(classification) {
  return classification ? "reviewed" : "pending";
}

function classificationLabel(classification) {
  switch (classification) {
    case BENCHMARK_REVIEW_CLASSIFICATION.REAL_SUCCESS:
      return "Real success";
    case BENCHMARK_REVIEW_CLASSIFICATION.PARTIAL_SUCCESS:
      return "Partial success";
    case BENCHMARK_REVIEW_CLASSIFICATION.FALSE_POSITIVE:
      return "False positive";
    case BENCHMARK_REVIEW_CLASSIFICATION.ACCEPTABLE_FAILURE:
      return "Acceptable failure";
    case BENCHMARK_REVIEW_CLASSIFICATION.BLOCKING_FAILURE:
      return "Blocking failure";
    default:
      return "Pending review";
  }
}

function buildHumanReview(rawReview = {}) {
  const classification = normalizeClassification(rawReview.classification);
  return {
    status: reviewStatusFor(classification),
    classification,
    classificationLabel: classificationLabel(classification),
    notes: rawReview.notes ?? "",
    reviewer: rawReview.reviewer ?? null,
    reviewedAt: rawReview.reviewedAt ?? null
  };
}

function buildCaseReview(definition = {}) {
  const rows = normalizeAssertionRows(definition.assertions, definition.assertionDetails);
  return {
    id: definition.id ?? "case",
    label: definition.label ?? definition.id ?? "Case",
    summary: definition.summary ?? "",
    status: deriveStatus(rows, definition.status ?? null),
    relatedRunId: definition.relatedRunId ?? null,
    relatedSourceIds: definition.relatedSourceIds ?? [],
    relatedEvidenceIds: definition.relatedEvidenceIds ?? [],
    relatedArtifactIds: definition.relatedArtifactIds ?? [],
    assertions: rows,
    assertionSummary: summarizeRows(rows),
    failureReasons: rows.filter((row) => !row.passed).map((row) => row.reason)
  };
}

function buildSuiteReview({ id, label, raw, gating }) {
  const rows = normalizeAssertionRows(raw?.assertions, raw?.assertionDetails);
  const cases = Array.isArray(raw?.cases)
    ? raw.cases.map((definition) => buildCaseReview(definition))
    : [];
  const humanReview = buildHumanReview(raw?.humanReview);

  return {
    id,
    label,
    gating,
    status: raw?.status ?? deriveStatus(rows),
    summary: raw?.summary ?? "",
    assertions: rows,
    assertionSummary: summarizeRows(rows),
    failureReasons: rows.filter((row) => !row.passed).map((row) => row.reason),
    cases,
    humanReviewStatus: humanReview.status,
    humanReviewClassification: humanReview.classification,
    humanReviewLabel: humanReview.classificationLabel,
    humanReviewNotes: humanReview.notes,
    humanReviewReviewer: humanReview.reviewer,
    humanReviewReviewedAt: humanReview.reviewedAt
  };
}

export function buildBenchmarkReviewModel(report) {
  const suites = [
    buildSuiteReview({
      id: "browser",
      label: "Browser control suite",
      raw: report.browser,
      gating: true
    }),
    buildSuiteReview({
      id: "computer",
      label: "Computer control bounded suite",
      raw: report.computer,
      gating: true
    }),
    buildSuiteReview({
      id: "reasoning",
      label: "Contextual reasoning suite",
      raw: report.reasoning,
      gating: true
    })
  ];

  if (report.windowsProvider) {
    suites.push(buildSuiteReview({
      id: "windows_provider",
      label: "Windows provider diagnostic",
      raw: report.windowsProvider,
      gating: false
    }));
  }

  const gatingSuites = suites.filter((suite) => suite.gating);
  const overallStatus = gatingSuites.every((suite) => suite.status === "pass")
    ? "gating_pass"
    : "gating_fail";
  const reviewedGatingSuites = gatingSuites.filter((suite) => suite.humanReviewStatus === "reviewed");

  return {
    overallStatus,
    suites,
    gatingSummary: {
      total: gatingSuites.length,
      passing: gatingSuites.filter((suite) => suite.status === "pass").length,
      failing: gatingSuites.filter((suite) => suite.status !== "pass").length
    },
    humanReviewRequired: true,
    humanReviewSummary: {
      totalSuites: suites.length,
      reviewedSuites: suites.filter((suite) => suite.humanReviewStatus === "reviewed").length,
      pendingSuites: suites.filter((suite) => suite.humanReviewStatus !== "reviewed").length,
      gatingReviewed: reviewedGatingSuites.length,
      gatingPending: gatingSuites.length - reviewedGatingSuites.length
    }
  };
}

export function applySuiteHumanReview(report, { suiteId, classification, notes = "", reviewer = "operator" }) {
  const suiteKey = SUITE_KEY_MAP[suiteId];
  if (!suiteKey || !report[suiteKey]) {
    throw new Error(`Unknown benchmark suite: ${suiteId}`);
  }
  const normalized = normalizeClassification(classification);
  if (!normalized) {
    throw new Error(`Unsupported review classification: ${classification}`);
  }
  report[suiteKey].humanReview = {
    classification: normalized,
    notes,
    reviewer,
    reviewedAt: new Date().toISOString()
  };
  report.review = buildBenchmarkReviewModel(report);
  report.summary.overallStatus = report.review.overallStatus;
  return report;
}
