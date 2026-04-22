import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createPrototypeRuntime } from "../src/runtime/create-prototype-runtime.js";
import { createFixtureServer } from "../src/fixtures/fixture-server.js";
import { createDefaultLlmGateway } from "../src/llm/create-default-llm-gateway.js";

async function tempDbPath(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, "prototype.sqlite");
}

function isSpawnEperm(error) {
  return error?.message?.includes("spawn EPERM");
}

export async function run() {
  const fixtureServer = await createFixtureServer();
  const dbPath = await tempDbPath("llm-integration");
  const llmGateway = await createDefaultLlmGateway({ providerMode: "mock_offline" });
  const runtimeHandle = await createPrototypeRuntime({
    dbPath,
    llmGateway,
    browserOptions: { headless: true }
  });

  try {
    const project = runtimeHandle.runtime.createProject({
      id: "prj_llm",
      name: "LLM Integration Project",
      description: "LLM integration test",
      allowlistedDomains: ["127.0.0.1"],
      createdAt: new Date().toISOString()
    });

    const result = await runtimeHandle.runtime.runResearchMission({
      projectId: project.id,
      mission: "Test LLM-integrated research mission",
      hubUrl: fixtureServer.manifest.hub,
      linkSpecs: [
        { testId: "link-alpha", title: "Alpha Analytics" },
        { testId: "link-beta", title: "Beta Commerce" }
      ],
      fieldMap: {
        companyName: { testId: "company-name" },
        tagline: { testId: "company-tagline" },
        priceLevel: { testId: "price-level" },
        deliverySpeed: { testId: "delivery-speed" },
        riskNote: { testId: "risk-note" }
      }
    });

    const llmCalls = runtimeHandle.database.listLlmCalls(result.run.id);
    assert.ok(llmCalls.length >= 3, "Expected mission understanding, plan generation, and decision draft LLM calls.");
    const missionCall = llmCalls.find((call) => call.callType === "mission_understanding");
    const planCall = llmCalls.find((call) => call.callType === "plan_generation");
    const decisionCall = llmCalls.find((call) => call.callType === "decision_note_draft");
    assert.ok(missionCall, "Mission-understanding call missing.");
    assert.ok(planCall, "Plan generation call missing.");
    assert.ok(decisionCall, "Decision note draft call missing.");
    assert.equal(missionCall.metadata?.reasoningStage, "mission_understanding");
    assert.equal(missionCall.metadata?.tokenGovernance?.policyId, "stage.mission_understanding");
    assert.equal(planCall.metadata?.reasoningStage, "plan_generation");
    assert.equal(planCall.metadata?.tokenGovernance?.policyId, "stage.plan_generation");
    assert.equal(decisionCall.metadata?.tokenGovernance?.policyId, "stage.decision_note_draft");
    assert.ok(typeof decisionCall.metadata?.inputCompaction?.estimatedTokensAfter === "number");

    const artifact = result.artifacts.find((art) => art.artifactType === "note_de_decision");
    assert.ok(artifact?.metadata?.llmCallId, "Decision artifact missing llmCallId metadata.");
    assert.ok(artifact?.metadata?.llmPromptRefs, "Decision artifact missing llm prompt refs.");

    assert.equal(result.run.plan.steps.length > 0, true, "Plan steps should come from LLM output.");
    assert.equal(result.run.plan.missionUnderstanding?.chosenExecutionFrame, "research");
    assert.equal(result.run.metadata?.verificationSummary?.overallStatus, "pass");
  } catch (error) {
    if (isSpawnEperm(error)) {
      console.warn("runtime-llm-integration test skipped: browser launch blocked (EPERM).");
      return;
    }
    throw error;
  } finally {
    await runtimeHandle.close();
    await fixtureServer.close();
  }
}
