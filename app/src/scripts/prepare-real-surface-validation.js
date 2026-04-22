import { buildRealSurfaceValidationPack, persistRealSurfaceValidationPack } from "../validation/real-surface-harness.js";

function parseArgs(argv) {
  const options = {
    scenarioId: "all",
    reviewer: "operator"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--scenario" && argv[index + 1]) {
      options.scenarioId = argv[index + 1];
      index += 1;
    } else if (token === "--reviewer" && argv[index + 1]) {
      options.reviewer = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const pack = buildRealSurfaceValidationPack(options);
const persisted = await persistRealSurfaceValidationPack(pack);

console.log(JSON.stringify({
  status: "ready",
  scenarioCount: pack.scenarios.length,
  outputPath: persisted.outputPath,
  latestPath: persisted.latestPath
}, null, 2));

