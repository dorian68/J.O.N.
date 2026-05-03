import { runRealSurfaceSmokePipeline } from "../smoke/real-surface-smoke-pipeline.js";

function parseArgs(argv = []) {
  const options = {
    runner: "cli"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--config" && argv[index + 1]) {
      options.configPath = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

const report = await runRealSurfaceSmokePipeline(parseArgs(process.argv.slice(2)));
console.log(JSON.stringify({
  id: report.id,
  status: report.status,
  config: report.config,
  summary: report.summary,
  recommendations: report.recommendations,
  outputPath: report.outputPath ?? null
}, null, 2));

if (report.status === "fail") {
  process.exitCode = 1;
}
