import { runPilotPrepare } from "../pilot/pilot-flow.js";

const { report, persisted } = await runPilotPrepare();

console.log(JSON.stringify({
  status: report.overallStatus,
  currentLevel: report.readiness.currentLevel,
  outputPath: persisted.outputPath,
  latestPath: persisted.latestPath,
  markdownPath: persisted.latestMarkdownPath
}, null, 2));

if (report.overallStatus === "prepare_failed") {
  process.exitCode = 1;
}
