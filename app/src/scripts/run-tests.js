import path from "node:path";
import { RELEASE_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";

const suites = [
  {
    name: "policy",
    modulePath: "../../tests/policy.test.js"
  },
  {
    name: "storage",
    modulePath: "../../tests/storage.test.js"
  },
  {
    name: "artifact-builders",
    modulePath: "../../tests/artifact-builders.test.js"
  },
  {
    name: "computer-control-service",
    modulePath: "../../tests/computer-control-service.test.js"
  },
  {
    name: "capability-graph",
    modulePath: "../../tests/capability-graph.test.js"
  },
  {
    name: "operational-deep-readiness",
    modulePath: "../../tests/operational-deep-readiness.test.js"
  },
  {
    name: "desktop-perception",
    modulePath: "../../tests/desktop-perception.test.js"
  },
  {
    name: "file-primitives",
    modulePath: "../../tests/file-primitives.test.js"
  },
  {
    name: "advanced-desktop-scenarios",
    modulePath: "../../tests/advanced-desktop-scenarios.test.js"
  },
  {
    name: "os-secret-store",
    modulePath: "../../tests/os-secret-store.test.js"
  },
  {
    name: "redaction",
    modulePath: "../../tests/redaction.test.js"
  },
  {
    name: "benchmark-review-model",
    modulePath: "../../tests/benchmark-review-model.test.js"
  },
  {
    name: "benchmark-service",
    modulePath: "../../tests/benchmark-service.test.js"
  },
  {
    name: "release-doctor",
    modulePath: "../../tests/release-doctor.test.js"
  },
  {
    name: "readiness-report",
    modulePath: "../../tests/readiness-report.test.js"
  },
  {
    name: "pilot-flow",
    modulePath: "../../tests/pilot-flow.test.js"
  },
  {
    name: "runtime-retention",
    modulePath: "../../tests/runtime-retention.test.js"
  },
  {
    name: "operator-service",
    modulePath: "../../tests/operator-service.test.js"
  },
  {
    name: "mission-entry",
    modulePath: "../../tests/mission-entry.test.js"
  },
  {
    name: "mission-understanding",
    modulePath: "../../tests/mission-understanding.test.js"
  },
  {
    name: "conversation-turn",
    modulePath: "../../tests/conversation-turn.test.js"
  },
  {
    name: "i18n",
    modulePath: "../../tests/i18n.test.js"
  },
  {
    name: "desktop-plan",
    modulePath: "../../tests/desktop-plan.test.js"
  },
  {
    name: "desktop-autonomy-runtime",
    modulePath: "../../tests/desktop-autonomy-runtime.test.js"
  },
  {
    name: "run-handoff-decision",
    modulePath: "../../tests/run-handoff-decision.test.js"
  },
  {
    name: "operator-cleanup",
    modulePath: "../../tests/operator-cleanup.test.js"
  },
  {
    name: "operator-server",
    modulePath: "../../tests/operator-server.test.js"
  },
  {
    name: "desktop-shell-foundation",
    modulePath: "../../tests/desktop-shell-foundation.test.js"
  },
  {
    name: "desktop-bundle",
    modulePath: "../../tests/desktop-bundle.test.js"
  },
  {
    name: "real-surface-validation",
    modulePath: "../../tests/real-surface-validation.test.js"
  },
  {
    name: "real-surface-runtime-config",
    modulePath: "../../tests/real-surface-runtime-config.test.js"
  },
  {
    name: "real-surface-summary",
    modulePath: "../../tests/real-surface-summary.test.js"
  },
  {
    name: "operator-service-real-surfaces",
    modulePath: "../../tests/operator-service-real-surfaces.test.js"
  },
  {
    name: "browser-benchmarks",
    modulePath: "../../tests/browser-benchmarks.test.js"
  },
  {
    name: "computer-benchmarks",
    modulePath: "../../tests/computer-benchmarks.test.js"
  },
  {
    name: "llm-prompt-registry",
    modulePath: "../../tests/llm-prompt-registry.test.js"
  },
  {
    name: "reasoning-layer",
    modulePath: "../../tests/reasoning-layer.test.js"
  },
  {
    name: "reasoning-benchmarks",
    modulePath: "../../tests/reasoning-benchmarks.test.js"
  },
  {
    name: "llm-analytics",
    modulePath: "../../tests/llm-analytics.test.js"
  },
  {
    name: "evaluator",
    modulePath: "../../tests/evaluator.test.js"
  },
  {
    name: "llm-runtime-config",
    modulePath: "../../tests/llm-runtime-config.test.js"
  },
  {
    name: "llm-runtime-env",
    modulePath: "../../tests/llm-runtime-env.test.js"
  },
  {
    name: "structured-output-normalizers",
    modulePath: "../../tests/structured-output-normalizers.test.js"
  },
  {
    name: "openai-compatible-provider",
    modulePath: "../../tests/openai-compatible-provider.test.js"
  },
  {
    name: "llm-gateway",
    modulePath: "../../tests/llm-gateway.test.js"
  },
  {
    name: "llm-gateway-resilience",
    modulePath: "../../tests/llm-gateway-resilience.test.js"
  },
  {
    name: "token-governance",
    modulePath: "../../tests/token-governance.test.js"
  },
  {
    name: "runtime-llm-integration",
    modulePath: "../../tests/runtime-llm-integration.test.js"
  },
  {
    name: "runtime-reasoning-integration",
    modulePath: "../../tests/runtime-reasoning-integration.test.js"
  },
  {
    name: "runtime-llm-degraded-mode",
    modulePath: "../../tests/runtime-llm-degraded-mode.test.js"
  }
];

let failures = 0;
const results = [];

// Force Playwright to use the bundled Chromium to avoid OS-level launch restrictions.
process.env.COWORK_BROWSER_CHANNEL = process.env.COWORK_BROWSER_CHANNEL || "chromium";
process.env.COWORK_HEADLESS = process.env.COWORK_HEADLESS || "1";
process.env.COWORK_LLM_PROVIDER_MODE = process.env.COWORK_LLM_PROVIDER_MODE || "mock_offline";
process.env.COWORK_LLM_ALLOW_MOCK_FALLBACK = process.env.COWORK_LLM_ALLOW_MOCK_FALLBACK || "1";
process.env.COWORK_LLM_REQUIRE_OS_SECRET_STORE = process.env.COWORK_LLM_REQUIRE_OS_SECRET_STORE || "0";

for (const suite of suites) {
  try {
    const module = await import(suite.modulePath);
    await module.run();
    console.log(`PASS ${suite.name}`);
    results.push({
      name: suite.name,
      status: "pass"
    });
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${suite.name}`);
    console.error(error);
    results.push({
      name: suite.name,
      status: "fail",
      error: error.message
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  status: failures > 0 ? "fail" : "pass",
  suiteCount: suites.length,
  passCount: results.filter((entry) => entry.status === "pass").length,
  failCount: failures,
  results
};
await ensureDir(RELEASE_ROOT);
await writeJson(path.join(RELEASE_ROOT, `test-report-${report.generatedAt.replace(/[:.]/g, "-")}.json`), report);
await writeJson(path.join(RELEASE_ROOT, "test-report-latest.json"), report);

if (failures > 0) {
  process.exitCode = 1;
}
