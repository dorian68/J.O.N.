import { runPilotSummary } from "../pilot/pilot-flow.js";

const { report, persisted } = await runPilotSummary();

console.log(JSON.stringify({
  status: report.overallStatus,
  currentLevel: report.readiness.currentLevel,
  outputPath: persisted.outputPath,
  latestPath: persisted.latestPath,
  markdownPath: persisted.latestMarkdownPath
}, null, 2));
