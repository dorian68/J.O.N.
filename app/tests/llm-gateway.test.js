import assert from "node:assert/strict";
import { createDefaultLlmGateway } from "../src/llm/create-default-llm-gateway.js";
import { LLM_CALL_TYPE, LLM_RESULT_STATUS } from "../src/config.js";

export async function run() {
  const gateway = await createDefaultLlmGateway({
    providerMode: "mock_offline",
    env: {
      ...process.env,
      COWORK_LLM_RUNTIME_PROFILE: "test",
      COWORK_LLM_PRODUCTION_STRICT: "0",
      COWORK_LLM_LOG_SCOPE: "test"
    }
  });

  const plan = await gateway.generateStructured({
    runId: "run_test",
    projectId: "prj_test",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" },
      { promptId: "task.plan_generation", version: "1.0.0", bindings: { mission: "Test mission", scenarioType: "research", allowlistedDomains: '["127.0.0.1"]' } }
    ],
    input: { mission: "Test mission", scenarioType: "research", allowlistedDomains: ["127.0.0.1"] },
    validateOutput: (output) => output
  });
  assert.ok(plan.output.steps.length > 0);
  assert.equal(plan.callRecord.resultStatus, LLM_RESULT_STATUS.SUCCESS);
  assert.equal(plan.callRecord.providerAlias, "mock_offline");

  const draft = await gateway.generateStructured({
    runId: "run_test",
    projectId: "prj_test",
    callType: LLM_CALL_TYPE.DECISION_NOTE_DRAFT,
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" },
      { promptId: "task.decision_note_draft", version: "1.0.0", bindings: { mission: "Test mission", records: "[]", sourceReferences: "[]" } }
    ],
    input: { mission: "Test mission", records: [], sourceReferences: [] },
    validateOutput: (output) => output
  });
  assert.ok(draft.output.recommendation.length > 0);
  assert.equal(draft.callRecord.promptRefs.length, 2);
}
