import path from "node:path";
import { DATA_ROOT } from "../config.js";
import { BrowserController } from "../browser/browser-controller.js";
import { BrowserOperator } from "../browser/browser-operator.js";
import { createFixtureServer } from "../fixtures/fixture-server.js";
import { createDefaultLlmGateway } from "../llm/create-default-llm-gateway.js";
import { ensureDir, writeJson } from "../utils/files.js";

const startedAt = new Date().toISOString();
const smokeRoot = path.join(DATA_ROOT, "smoke");
const useLivePlanner = process.argv.includes("--live") || process.argv.includes("--require-live");
const requireLivePlanner = process.argv.includes("--require-live");

function assertionMap(execution) {
  const actionTypes = execution.stepResults.map((step) => step.action);
  const activeTarget = execution.browserState?.targets?.find((target) => target.id === execution.browserState?.activeTargetId) ?? null;
  return {
    planGenerated: execution.plan?.schemaVersion === "browser_plan_v1" && execution.plan.steps.length >= 6,
    plannerExecutedDomFirst: ["read_state", "read_dom", "detect_blockers"].every((action) => actionTypes.includes(action)),
    clickAndVerificationExecuted: actionTypes.includes("click") && actionTypes.includes("verify_outcome"),
    evidenceCaptured: execution.evidence.length >= 1,
    browserStateTracked: Boolean(activeTarget?.url) && activeTarget.recentActions.length >= 4,
    noBlocker: execution.blockers.length === 0,
    completed: execution.status === "completed"
  };
}

try {
  const fixtureServer = await createFixtureServer();
  try {
    const browser = new BrowserController({ headless: true });
    const llmGateway = useLivePlanner ? await createDefaultLlmGateway() : null;
    const runId = `browser_planner_smoke_${Date.now()}`;
    const operator = new BrowserOperator({
      browserController: browser,
      llmGateway,
      runId,
      projectId: "browser_planner_smoke",
      evidenceRoot: path.join(smokeRoot, "browser-planner-evidence")
    });
    const execution = await operator.runMission({
      mission: "Open the controlled outcome page, click the status promotion button, verify the status, and capture proof.",
      startUrl: fixtureServer.manifest.outcome,
      allowlistedHosts: ["127.0.0.1"],
      intentType: "site_navigation",
      stepHints: [
        {
          id: "promote_status",
          action: "click",
          label: "Click the controlled status button",
          selector: { testId: "button-promote-status" },
          requiresApproval: false,
          riskLevel: "medium",
          stopOnFailure: true
        },
        {
          id: "verify_ready_status",
          action: "verify_outcome",
          label: "Verify the status became ready",
          expectation: {
            type: "text_visible",
            selector: { testId: "status-value" },
            expectedText: "ready"
          },
          requiresApproval: false,
          riskLevel: "low",
          stopOnFailure: true
        }
      ]
    });
    const assertions = assertionMap(execution);
    if (requireLivePlanner && execution.generationMode !== "llm") {
      assertions.livePlannerUsed = false;
    } else if (requireLivePlanner) {
      assertions.livePlannerUsed = true;
    }
    const smoke = {
      scenario: "browser-planner-v1",
      createdAt: startedAt,
      completedAt: new Date().toISOString(),
      status: Object.values(assertions).every(Boolean) ? "pass" : "fail",
      requestedLivePlanner: useLivePlanner,
      requireLivePlanner,
      controlledSurface: true,
      trustClassification: "controlled_fixture",
      generationMode: execution.generationMode,
      plan: {
        schemaVersion: execution.plan.schemaVersion,
        intentType: execution.plan.intentType,
        coverageStatus: execution.plan.coverageStatus,
        stepActions: execution.plan.steps.map((step) => step.action),
        verificationGoals: execution.plan.verificationGoals,
        expectedEvidence: execution.plan.expectedEvidence
      },
      execution: {
        status: execution.status,
        stepResults: execution.stepResults.map((step) => ({
          id: step.id,
          action: step.action,
          status: step.status
        })),
        evidenceCount: execution.evidence.length,
        blockerCount: execution.blockers.length,
        errorCount: execution.errors.length,
        summaryPath: execution.summaryPath
      },
      browserState: {
        sessionId: execution.browserState?.sessionId ?? null,
        activeTargetId: execution.browserState?.activeTargetId ?? null,
        activeUrl: execution.browserState?.targets?.find((target) => target.id === execution.browserState?.activeTargetId)?.url ?? null,
        recentActionTypes: execution.browserState?.recentActions?.map((action) => action.action).slice(-14) ?? []
      },
      assertions,
      limitations: [
        "This smoke proves Browser Planner v1 on a controlled allowlisted fixture.",
        "It does not prove arbitrary real-site production reliability, authenticated navigation, CAPTCHA handling, or anti-bot bypass. Those must be blocked or handed off."
      ]
    };
    await ensureDir(smokeRoot);
    const outputPath = path.join(smokeRoot, "browser-planner.json");
    await writeJson(outputPath, smoke);
    console.log(JSON.stringify({ ...smoke, outputPath }, null, 2));
    if (smoke.status !== "pass") {
      process.exitCode = 1;
    }
  } finally {
    await fixtureServer.close();
  }
} catch (error) {
  const smoke = {
    scenario: "browser-planner-v1",
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
    status: "fail",
    error: {
      message: error?.message ?? String(error),
      code: error?.code ?? null
    }
  };
  await ensureDir(smokeRoot);
  const outputPath = path.join(smokeRoot, "browser-planner.json");
  await writeJson(outputPath, smoke);
  console.error(JSON.stringify({ ...smoke, outputPath }, null, 2));
  process.exitCode = 1;
}
