import { runCoworkSmokePipeline } from "../smoke/cowork-smoke-pipeline.js";

function parseArgs(argv = []) {
  const options = {
    includeBrowser: true,
    runner: "cli"
  };
  for (const token of argv) {
    if (token === "--no-browser") {
      options.includeBrowser = false;
    }
  }
  return options;
}

const report = await runCoworkSmokePipeline(parseArgs(process.argv.slice(2)));
console.log(JSON.stringify({
  id: report.id,
  status: report.status,
  summary: report.summary,
  recommendations: report.recommendations,
  outputPath: report.outputPath ?? null
}, null, 2));

if (report.status === "fail") {
  process.exitCode = 1;
}
