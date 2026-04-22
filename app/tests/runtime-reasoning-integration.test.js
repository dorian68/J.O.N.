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
  const dbPath = await tempDbPath("runtime-reasoning");
  const llmGateway = await createDefaultLlmGateway({ providerMode: "mock_offline" });
  const runtimeHandle = await createPrototypeRuntime({
    dbPath,
    llmGateway,
    browserOptions: { headless: true }
  });

  try {
    const project = runtimeHandle.runtime.createProject({
      name: "Reasoning Integration Project",
      description: "Reasoning integration test",
      allowlistedDomains: ["127.0.0.1"]
    });

    const result = await runtimeHandle.runtime.runResearchMission({
      projectId: project.id,
      mission: "Test reasoning-integrated research mission",
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

    assert.ok((result.reasoningSnapshots ?? []).length >= 4, "Expected persisted reasoning snapshots.");
    const llmCalls = runtimeHandle.database.listLlmCalls(result.run.id);
    assert.ok(llmCalls.every((call) => call.metadata?.contextSnapshotId), "All LLM calls should reference a reasoning snapshot.");
    assert.ok(llmCalls.every((call) => Array.isArray(call.metadata?.matchedObservationIds)), "LLM calls should persist matched observation ids.");
    assert.ok(llmCalls.every((call) => Array.isArray(call.metadata?.matchedGuidelineIds)), "LLM calls should persist matched guideline ids.");
    assert.ok(llmCalls.every((call) => Array.isArray(call.metadata?.resolvedVariableIds)), "LLM calls should persist resolved variable ids.");
    assert.ok(llmCalls.some((call) => call.callType === "mission_understanding"), "Expected mission-understanding LLM call.");
    assert.ok(llmCalls.some((call) => call.callType === "evaluation_support"), "Expected evaluation support LLM call.");
    assert.ok(llmCalls.some((call) => call.callType === "ambiguity_note"), "Expected ambiguity-note LLM call.");

    const decisionArtifact = result.artifacts.find((artifact) => artifact.artifactType === "note_de_decision");
    assert.ok(Array.isArray(decisionArtifact.metadata.reasoningContextSnapshotIds), "Decision artifact should reference reasoning snapshots.");
    assert.ok(decisionArtifact.metadata.reasoningContextSnapshotIds.length >= 2, "Decision artifact should reference multiple reasoning snapshots.");
    assert.equal(result.run.plan?.missionUnderstanding?.verificationGoals?.length > 0, true);
  } catch (error) {
    if (isSpawnEperm(error)) {
      console.warn("runtime-reasoning-integration test skipped: browser launch blocked (EPERM).");
      return;
    }
    throw error;
  } finally {
    await runtimeHandle.close();
    await fixtureServer.close();
  }
}
