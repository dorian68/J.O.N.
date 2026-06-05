// Golden-path journey smoke (CLI_TESTABILITY_CONTRACT): boots a real operator
// server (ephemeral port, fixture surfaces + fake desktop), drives the full HTTP
// user journey — start mission → run settles → dashboard reflects it → run
// artifacts route responds — and fails loudly. Backed by the operator-server HTTP
// integration test so the journey is exercised end-to-end, not mocked away.
import os from "node:os";
import path from "node:path";

// Deterministic, offline env (same as the test harness) — set BEFORE importing
// any module that reads env at load time.
process.env.COWORK_DATA_ROOT ||= path.join(os.tmpdir(), `cowork-journey-smoke-${process.pid}`);
process.env.COWORK_HEADLESS ||= "1";
process.env.COWORK_LLM_RUNTIME_PROFILE ||= "test";
process.env.COWORK_LLM_PRODUCTION_STRICT ||= "0";
process.env.COWORK_LLM_PROVIDER_MODE ||= "mock_offline";
process.env.COWORK_LLM_ALLOW_MOCK_FALLBACK ||= "1";
process.env.COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK ||= "1";
process.env.COWORK_LLM_REQUIRE_OS_SECRET_STORE ||= "0";
process.env.COWORK_LLM_LOG_SCOPE ||= "test";

try {
  const { run } = await import("../../tests/operator-server.test.js");
  await run();
  console.log("✅ smoke:journey PASS — start mission → settle → dashboard → artifacts (full HTTP journey)");
  process.exit(0);
} catch (error) {
  console.error("❌ smoke:journey FAIL:", error.message);
  console.error(error.stack);
  process.exit(1);
}
