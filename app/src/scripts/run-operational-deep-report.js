import {
  buildOperationalDeepReadinessReport,
  persistOperationalDeepReadinessReport
} from "../release/operational-deep-readiness.js";

const report = await buildOperationalDeepReadinessReport();
const persisted = await persistOperationalDeepReadinessReport(report);

console.log(JSON.stringify({
  status: report.status,
  implementationStatus: report.classification.implementationStatus,
  fieldProofStatus: report.classification.fieldProofStatus,
  contractsPassed: report.skillValidation.passed,
  contractsTotal: report.skillValidation.skillCount,
  fieldSupported: report.classification.fieldSupported,
  partial: report.classification.partial,
  fixtureOnly: report.classification.fixtureOnly,
  missing: report.classification.missing,
  latestPath: persisted.latestPath,
  markdownPath: persisted.markdownPath
}, null, 2));
