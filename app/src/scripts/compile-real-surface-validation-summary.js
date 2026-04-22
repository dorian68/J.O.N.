import { buildRealSurfaceValidationSummary, persistRealSurfaceValidationSummary } from "../validation/real-surface-summary.js";

const summary = await buildRealSurfaceValidationSummary();
const persisted = await persistRealSurfaceValidationSummary(summary);

console.log(JSON.stringify({
  status: "ready",
  overallStatus: summary.overallStatus,
  outputPath: persisted.outputPath,
  latestPath: persisted.latestPath,
  counts: summary.counts
}, null, 2));

