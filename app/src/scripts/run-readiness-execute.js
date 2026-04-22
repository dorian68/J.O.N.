import { executeReadinessFlow } from "../pilot/pilot-flow.js";

const result = await executeReadinessFlow();

console.log(JSON.stringify({
  status: result.summary.report.overallStatus,
  currentLevel: result.summary.report.readiness.currentLevel,
  prepareLatestPath: result.prepare.persisted.latestPath,
  validateLatestPath: result.validate.persisted.latestPath,
  summaryLatestPath: result.summary.persisted.latestPath
}, null, 2));

if (result.validate.report.overallStatus === "automation_failed") {
  process.exitCode = 1;
}
