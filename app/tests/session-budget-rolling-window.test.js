import assert from "node:assert/strict";
import { createDefaultLlmGateway } from "../src/llm/create-default-llm-gateway.js";
import { LLM_CALL_TYPE } from "../src/config.js";

// Reproduces the "last run didn't work" failure: cumulative session tokens
// crossed perSessionTokens (250k) and every subsequent run was blocked with
// "Session token budget remaining is insufficient" — permanently, because the
// session counter never reset short of a server restart. The fix makes the
// session budget a ROLLING window that auto-recovers.
async function makeGateway(extraEnv = {}) {
  return createDefaultLlmGateway({
    providerMode: "mock_offline",
    env: {
      ...process.env,
      COWORK_LLM_RUNTIME_PROFILE: "test",
      COWORK_LLM_PRODUCTION_STRICT: "0",
      COWORK_LLM_LOG_SCOPE: "test",
      ...extraEnv
    }
  });
}

function genPlan(gateway, runId = "run_test") {
  return gateway.generateStructured({
    runId,
    projectId: "prj_test",
    callType: LLM_CALL_TYPE.PLAN_GENERATION,
    promptRefs: [
      { promptId: "system.primary_reasoning", version: "1.0.0" },
      { promptId: "task.plan_generation", version: "1.0.0", bindings: { mission: "Test mission", scenarioType: "research", allowlistedDomains: '["127.0.0.1"]' } }
    ],
    input: { mission: "Test mission", scenarioType: "research", allowlistedDomains: ["127.0.0.1"] },
    validateOutput: (output) => output
  });
}

export async function run() {
  // ── Window NOT due: exhausted session usage stays exhausted ─────────────────
  const g1 = await makeGateway({ COWORK_LLM_BUDGET_SESSION_WINDOW_MS: "3600000" }); // 1h
  assert.equal(g1.runtimeConfig.budgets.sessionWindowMs, 3_600_000, "window parsed from env");
  // Simulate a process that has accumulated past the 250k ceiling.
  g1.sessionUsage.totalTokens = 304_919;
  const before = g1.getStatus().sessionUsage.totalTokens;
  assert.equal(before, 304_919, "fresh window keeps accumulated usage (guard still active)");

  // ── Window due: usage auto-resets, the agent recovers ───────────────────────
  g1.sessionWindowStartedAt = Date.now() - (3_600_000 + 5_000); // window elapsed
  const status = g1.getStatus(); // triggers the roll
  assert.equal(status.sessionUsage.totalTokens, 0, "session usage resets once the window elapses");

  // And a real request now goes through instead of being blocked.
  const recovered = await genPlan(g1);
  assert.ok(recovered.output.steps.length > 0, "generation succeeds after the window rolled");

  // ── A fresh window keeps accumulating across calls (guard still counts) ─────
  const g2 = await makeGateway({ COWORK_LLM_BUDGET_SESSION_WINDOW_MS: "3600000" });
  await genPlan(g2, "run_a");
  const afterOne = g2.sessionUsage.totalTokens;
  assert.ok(afterOne > 0, "usage accumulates within the window");
  g2.sessionWindowStartedAt = Date.now() - (3_600_000 + 5_000); // elapse
  await genPlan(g2, "run_b"); // triggers roll at the start of generateStructured
  assert.ok(
    g2.sessionUsage.totalTokens > 0 && g2.sessionUsage.totalTokens <= afterOne,
    "window rolled mid-life: counter reset then only the new call counts"
  );

  // ── Non-positive window falls back to a safe default (no accidental disable) ─
  const g3 = await makeGateway({ COWORK_LLM_BUDGET_SESSION_WINDOW_MS: "0" });
  // 0 is non-positive -> parser falls back to default; assert it is still a positive window
  assert.ok(g3.runtimeConfig.budgets.sessionWindowMs > 0, "non-positive window falls back to a safe default");
}
