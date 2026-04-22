import { pruneRuntimeData } from "../observability/runtime-retention.js";
import { DEFAULT_RUNTIME_RETENTION_DAYS } from "../config.js";

function parseArgs(argv) {
  let olderThanDays = DEFAULT_RUNTIME_RETENTION_DAYS;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--days" && argv[index + 1]) {
      olderThanDays = Number.parseInt(argv[index + 1], 10);
      index += 1;
    }
  }
  return {
    olderThanDays
  };
}

const options = parseArgs(process.argv.slice(2));
const result = await pruneRuntimeData(options);
console.log(JSON.stringify(result, null, 2));

