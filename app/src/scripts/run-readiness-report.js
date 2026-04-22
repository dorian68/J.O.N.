import { buildReadinessReport, persistReadinessReport } from "../release/readiness-report.js";

const report = await buildReadinessReport();
const persisted = await persistReadinessReport(report);

console.log(JSON.stringify({
  status: report.status,
  outputPath: persisted.outputPath,
  latestPath: persisted.latestPath,
  currentLevel: report.classification.currentLevel,
  tiers: report.tiers,
  validationOverallStatus: report.validationSummary.overallStatus
}, null, 2));
