import assert from "node:assert/strict";
import { PrototypeAgent } from "../src/runtime/prototype-agent.js";

export async function run() {
  const agent = new PrototypeAgent({
    database: null,
    browserController: null,
    computerControlService: null,
    policyEngine: null,
    llmGateway: null
  });

  // Unknown run is not aborted.
  assert.equal(agent.isRunAborted("run_x"), false);

  // requestAbort flags the run; returns true when given a runId.
  assert.equal(agent.requestAbort("run_x"), true);
  assert.equal(agent.isRunAborted("run_x"), true);

  // Empty runId is a no-op.
  assert.equal(agent.requestAbort(""), false);

  // Abort is scoped per run.
  assert.equal(agent.isRunAborted("run_y"), false);
}
