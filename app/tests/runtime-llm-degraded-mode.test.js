import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrototypeDatabase } from "../src/storage/database.js";
import { PrototypeAgent } from "../src/runtime/prototype-agent.js";
import { PolicyEngine } from "../src/policy/policy-engine.js";
import { LlmGatewayError } from "../src/llm/gateway.js";
import { LLM_CALL_TYPE, RUN_STATUS } from "../src/config.js";

async function tempDbPath(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, "prototype.sqlite");
}

class FakeBrowserController {
  constructor() {
    this.activeTargetId = "hub";
    this.targets = new Map([
      ["hub", { id: "hub", title: "Hub", url: "http://127.0.0.1/hub", data: null }],
      ["alpha", { id: "alpha", title: "Alpha Analytics", url: "http://127.0.0.1/alpha", data: {
        companyName: "Alpha Analytics",
        tagline: "Fast delivery for analytics buyers.",
        priceLevel: "Medium",
        deliverySpeed: "Fast",
        riskNote: "Capacity can fluctuate during month-end."
      } }],
      ["beta", { id: "beta", title: "Beta Commerce", url: "http://127.0.0.1/beta", data: {
        companyName: "Beta Commerce",
        tagline: "Lower cost but slower onboarding.",
        priceLevel: "Low",
        deliverySpeed: "Slow",
        riskNote: "Requires more operator follow-up."
      } }]
    ]);
  }

  async openBrowserSession() {}

  listTargets() {
    return Array.from(this.targets.values()).map(({ id, title, url }) => ({ id, title, url }));
  }

  focusTab(targetId) {
    this.activeTargetId = targetId;
    return targetId;
  }

  async navigate(targetId, url) {
    const target = this.targets.get(targetId);
    target.url = url;
  }

  async waitForPageState() {}

  async openLinkInNewTab(_hubTargetId, { testId }) {
    return {
      targetId: testId === "link-alpha" ? "alpha" : "beta"
    };
  }

  async getTargetMeta(targetId) {
    const target = this.targets.get(targetId);
    return {
      title: target.title,
      url: target.url
    };
  }

  async extractTextMap(targetId) {
    return this.targets.get(targetId).data;
  }

  async exportPageEvidence(targetId, evidenceRoot, safeName) {
    const target = this.targets.get(targetId);
    await fs.mkdir(evidenceRoot, { recursive: true });
    const summaryPath = path.join(evidenceRoot, `${safeName}.json`);
    const screenshotPath = path.join(evidenceRoot, `${safeName}.png`);
    await fs.writeFile(summaryPath, JSON.stringify({ title: target.title, url: target.url }, null, 2), "utf8");
    await fs.writeFile(screenshotPath, "fake-png", "utf8");
    return {
      evidenceId: `evidence_${targetId}`,
      summaryPath,
      screenshotPath,
      snapshot: {
        title: target.title
      }
    };
  }

  async close() {}
}

class AlwaysFailingGateway {
  constructor() {
    this.counter = 0;
  }

  getStatus() {
    return {
      providerMode: "openai_compatible",
      effectiveMode: "degraded_mock_only",
      availableProviders: [],
      promptEnvironment: "prototype",
      budgets: {
        perRunTokens: 12_000,
        perSessionTokens: 50_000,
        perRunUsd: 0.5,
        perSessionUsd: 2
      },
      configIssues: ["Live provider unavailable in test."],
      deterministicFallback: true
    };
  }

  async generateStructured({ runId, projectId, callType, promptRefs, metadata }) {
    this.counter += 1;
    throw new LlmGatewayError("Live provider unavailable.", {
      category: "provider_unavailable",
      callRecord: {
        id: `llm_fail_${this.counter}`,
        runId,
        projectId,
        callType,
        providerAlias: "openai_compatible",
        modelAlias: "primary_reasoning",
        providerModel: null,
        promptRefs: promptRefs.map((prompt) => ({ promptId: prompt.promptId, version: prompt.version })),
        inputSizeEstimate: 10,
        outputSizeEstimate: null,
        latencyMs: null,
        tokenUsage: null,
        estimatedCost: null,
        retryCount: 0,
        fallbackChain: [],
        resultStatus: "failed",
        errorCategory: "provider_unavailable",
        metadata: {
          requestId: `llmreq_fail_${this.counter}`,
          ...metadata
        },
        createdAt: new Date().toISOString()
      }
    });
  }
}

export async function run() {
  const dbPath = await tempDbPath("llm-degraded");
  const database = new PrototypeDatabase(dbPath);
  await database.open();

  const runtime = new PrototypeAgent({
    database,
    browserController: new FakeBrowserController(),
    computerControlService: {},
    policyEngine: new PolicyEngine(),
    llmGateway: new AlwaysFailingGateway()
  });

  try {
    const project = runtime.createProject({
      name: "Degraded LLM Project",
      description: "Tests deterministic fallback after live LLM failure.",
      allowlistedDomains: ["127.0.0.1"]
    });

    const result = await runtime.runResearchMission({
      projectId: project.id,
      mission: "Compare controlled pages and produce a decision note.",
      hubUrl: "http://127.0.0.1/hub",
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

    assert.equal(result.run.status, RUN_STATUS.COMPLETED);
    assert.equal(result.run.plan.generationMode, "deterministic_fallback");

    const degradedEvents = result.events.filter((event) => event.type === "llm.degraded_mode.activated");
    assert.ok(degradedEvents.length >= 5, "Expected degraded mode events for mission understanding, plan, draft, evaluation and ambiguity support.");

    const failedCalls = database.listLlmCalls(result.run.id);
    assert.equal(failedCalls.length, 5);
    assert.ok(failedCalls.every((call) => call.resultStatus === "failed"));

    const decisionArtifact = result.artifacts.find((artifact) => artifact.artifactType === "note_de_decision");
    assert.equal(decisionArtifact.metadata.generationMode, "deterministic_fallback");
    assert.ok(Array.isArray(decisionArtifact.metadata.reasoningContextSnapshotIds));
    assert.ok(decisionArtifact.metadata.reasoningContextSnapshotIds.length >= 3);
    assert.equal(result.run.plan?.missionUnderstanding?.generationMode, "deterministic_fallback");
    assert.equal(result.run.metadata?.verificationSummary?.overallStatus, "pass");

    const completedEvent = result.events.find((event) => event.type === "run.completed");
    assert.ok(completedEvent, "Expected completed event even in degraded deterministic mode.");
  } finally {
    database.close();
  }
}
