// JON-ify auto smoke test — observes a local fixture app, lets JON auto-generate
// the jonification manifest, validates, simulates a workflow, and prints a report.
import { run } from "../../tests/jonify.test.js";

try {
  const r = await run();
  console.log("\n[JON-ify Auto Smoke Test]\n");
  console.log("Observation: OK");
  console.log(`Interactive elements detected: ${r.interactive}`);
  console.log(`Surfaces detected: ${r.surfaces}`);
  console.log(`Actions detected: ${r.actions}`);
  console.log(`Workflows inferred: ${r.workflows}`);
  console.log(`Sensitive actions detected: ${r.sensitive}`);
  console.log("Manifest generated: OK");
  console.log("Manifest validation: OK");
  console.log("Workflow simulation: OK");
  console.log(`Human review questions: ${r.humanReview}`);
  console.log("Safety contract: OK");
  console.log(`Confidence: ${r.confidence}`);
  console.log("\nVerdict: PASS\n");
  process.exit(0);
} catch (error) {
  console.error("\n[JON-ify Auto Smoke Test]\nVerdict: FAIL —", error.message);
  console.error(error.stack);
  process.exit(1);
}
