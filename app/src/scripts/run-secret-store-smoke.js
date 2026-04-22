import { persistSecretStoreSmokeResult, runSecretStoreSmoke } from "../security/secret-store-smoke.js";

const result = await runSecretStoreSmoke();
const persisted = await persistSecretStoreSmokeResult(result);

console.log(JSON.stringify({
  ...result,
  outputPath: persisted.outputPath,
  latestPath: persisted.latestPath
}, null, 2));

if (result.status === "fail") {
  process.exitCode = 1;
}
