import { recordRealSurfaceValidationResult } from "../validation/real-surface-harness.js";

function parseArgs(argv) {
  const options = {
    scenarioId: null,
    reviewer: "operator",
    result: null,
    notes: "",
    traceability: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (!next) {
      continue;
    }
    switch (token) {
      case "--scenario":
        options.scenarioId = next;
        index += 1;
        break;
      case "--reviewer":
        options.reviewer = next;
        index += 1;
        break;
      case "--result":
        options.result = next;
        index += 1;
        break;
      case "--notes":
        options.notes = next;
        index += 1;
        break;
      case "--run-id":
        options.traceability.runId = next;
        index += 1;
        break;
      case "--benchmark-created-at":
        options.traceability.benchmarkCreatedAt = next;
        index += 1;
        break;
      case "--artifact-id":
        options.traceability.artifactIds ??= [];
        options.traceability.artifactIds.push(next);
        index += 1;
        break;
      case "--evidence-id":
        options.traceability.evidenceIds ??= [];
        options.traceability.evidenceIds.push(next);
        index += 1;
        break;
      case "--llm-call-id":
        options.traceability.llmCallIds ??= [];
        options.traceability.llmCallIds.push(next);
        index += 1;
        break;
      case "--reasoning-snapshot-id":
        options.traceability.reasoningSnapshotIds ??= [];
        options.traceability.reasoningSnapshotIds.push(next);
        index += 1;
        break;
      case "--log-path":
        options.traceability.logPaths ??= [];
        options.traceability.logPaths.push(next);
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

if (!options.scenarioId || !options.result) {
  console.error("Usage: node src/scripts/record-real-surface-validation.js --scenario <id> --result <pass|partial|fail|blocked> [--notes ...]");
  process.exit(1);
}

const { outputPath, payload } = await recordRealSurfaceValidationResult(options);

console.log(JSON.stringify({
  status: "recorded",
  outputPath,
  scenarioId: payload.scenarioId,
  result: payload.result
}, null, 2));

