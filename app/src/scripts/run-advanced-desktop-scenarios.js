import { runAdvancedDesktopScenarioPack } from "../validation/advanced-desktop-scenarios.js";

const realSafe = process.argv.includes("--real-safe") || process.env.COWORK_ADVANCED_DESKTOP_REAL_SAFE === "1";
const { report, latestPath } = await runAdvancedDesktopScenarioPack({ realSafe });

console.log(JSON.stringify({
  status: report.status,
  executionMode: report.executionMode,
  latestPath,
  scenarioCount: report.scenarios.length,
  readyCount: report.scenarios.filter((scenario) => scenario.status === "ready").length,
  partialCount: report.scenarios.filter((scenario) => scenario.status === "partial").length,
  blockedCount: report.scenarios.filter((scenario) => scenario.status === "blocked").length,
  proofs: report.proofs
}, null, 2));
