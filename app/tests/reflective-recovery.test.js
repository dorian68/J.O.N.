import assert from "node:assert/strict";
import { runReflectiveRecovery, FAILURE_CAUSE, RECOVERY_ACTION } from "../src/recovery/reflective-recovery.js";
import { filterByPolicy } from "../src/recovery/policy-filter.js";
import { generateHeuristicAlternatives } from "../src/recovery/alternative-generator.js";
import { diagnoseFailure } from "../src/recovery/failure-diagnoser.js";
import { decideRecovery } from "../src/recovery/recovery-decision-engine.js";

function makeVerificationResult(overrides = {}) {
  return {
    objectiveSatisfied: overrides.objectiveSatisfied ?? false,
    verificationVerdict: overrides.verificationVerdict ?? "fail",
    failureReason: overrides.failureReason ?? "Objective not met.",
    ...overrides
  };
}

export async function run() {

  // Scenario 1: Anti-bot / Cloudflare — correct cause, no bypass alternatives
  {
    const diagnosis = diagnoseFailure({
      runStatus: "failed",
      runSummary: "Cloudflare challenge appeared — un instant… page blocked automation",
      blockerInfo: { type: "captcha_or_automation_block", observedUrl: "https://example.com/jobs", httpStatus: null },
      verificationResult: null,
      runError: null,
      runMetadata: {}
    });

    assert.equal(diagnosis.cause, FAILURE_CAUSE.ANTI_BOT, "anti-bot cause");
    assert.equal(diagnosis.severity, "high");
    assert.equal(diagnosis.isRecoverable, true);

    const alternatives = generateHeuristicAlternatives(diagnosis);
    const filtered = filterByPolicy(alternatives);

    for (const alt of filtered) {
      assert.notEqual(alt.approach, "captcha_bypass", `policy violation: captcha_bypass in ${alt.id}`);
      assert.notEqual(alt.approach, "anti_bot_bypass", `policy violation: anti_bot_bypass in ${alt.id}`);
      assert.notEqual(alt.safetyLevel, "forbidden", `policy violation: forbidden in ${alt.id}`);
    }

    const hasManual = filtered.some(a => a.approach === "manual_intervention");
    assert.ok(hasManual, "manual_intervention alternative required for anti-bot");
  }

  // Scenario 2: Shallow success (LinkedIn) — replan alternatives, auto-retry
  {
    const diagnosis = diagnoseFailure({
      runStatus: "completed",
      runSummary: "Opened LinkedIn conversations page",
      blockerInfo: null,
      verificationResult: makeVerificationResult({
        objectiveSatisfied: false,
        failureReason: "Only navigated to URL — no messages read."
      }),
      runError: null,
      runMetadata: {}
    });

    assert.equal(diagnosis.cause, FAILURE_CAUSE.SHALLOW_SUCCESS, "shallow success cause");

    const alternatives = generateHeuristicAlternatives(diagnosis);
    const hasReplan = alternatives.some(a => a.approach === "replan" || a.approach === "continue");
    assert.ok(hasReplan, "replan or continue alternative required for shallow success");

    const decision = decideRecovery({ alternatives, diagnosis });
    assert.equal(decision.action, RECOVERY_ACTION.AUTO_RETRY, "shallow success should auto-retry with replan");
  }

  // Scenario 3: Provider timeout → deterministic fallback auto-retry
  {
    const diagnosis = diagnoseFailure({
      runStatus: "failed",
      runSummary: "request timed out after 57 seconds waiting for provider",
      blockerInfo: null,
      verificationResult: null,
      runError: { category: "timeout" },
      runMetadata: {}
    });

    assert.equal(diagnosis.cause, FAILURE_CAUSE.PROVIDER_TIMEOUT, "provider timeout cause");

    const alternatives = generateHeuristicAlternatives(diagnosis);
    const hasDeterministic = alternatives.some(a => a.approach === "deterministic_fallback");
    assert.ok(hasDeterministic, "deterministic_fallback required for timeout");

    const best = alternatives.find(a => a.approach === "deterministic_fallback");
    assert.ok(best.estimatedSuccessProbability >= 0.65, "deterministic_fallback probability >= 0.65");
    assert.equal(best.safetyLevel, "safe");
    assert.equal(best.requiresUserInput, false);

    const decision = decideRecovery({ alternatives, diagnosis });
    assert.equal(decision.action, RECOVERY_ACTION.AUTO_RETRY, "timeout → auto-retry");
    assert.equal(decision.selectedAlternative.approach, "deterministic_fallback");
  }

  // Scenario 4: Malformed LLM output → deterministic fallback auto-retry
  {
    const diagnosis = diagnoseFailure({
      runStatus: "failed",
      runSummary: "malformed LLM output — could not parse plan from model response",
      blockerInfo: null,
      verificationResult: null,
      runError: { category: "malformed_output" },
      runMetadata: {}
    });

    assert.equal(diagnosis.cause, FAILURE_CAUSE.MALFORMED_LLM_OUTPUT, "malformed output cause");

    const alternatives = generateHeuristicAlternatives(diagnosis);
    const hasDeterministic = alternatives.some(a => a.approach === "deterministic_fallback");
    assert.ok(hasDeterministic, "deterministic_fallback required for malformed output");

    const decision = decideRecovery({ alternatives, diagnosis });
    assert.equal(decision.action, RECOVERY_ACTION.AUTO_RETRY, "malformed output → auto-retry");
  }

  // Scenario 5: Full pipeline offline (no LLM gateway)
  {
    const result = await runReflectiveRecovery({
      mission: "Extract the 5 most recent conversations from my LinkedIn inbox",
      runId: "run_test_001",
      projectId: "proj_test",
      runStatus: "completed",
      runSummary: "Opened LinkedIn but did not read any messages",
      blockerInfo: null,
      verificationResult: makeVerificationResult({
        objectiveSatisfied: false,
        failureReason: "No conversations extracted — only navigation performed."
      }),
      runError: null,
      runMetadata: { finalUrl: "https://www.linkedin.com/messaging" },
      llmGateway: null
    });

    assert.ok(result.id.startsWith("rec_"), `id should start with rec_, got ${result.id}`);
    assert.equal(result.runId, "run_test_001");
    assert.equal(result.diagnosis.cause, FAILURE_CAUSE.SHALLOW_SUCCESS);
    assert.ok(Array.isArray(result.alternatives));
    assert.ok(result.alternatives.length > 0, "at least one alternative");
    assert.ok(typeof result.message === "string" && result.message.length > 10, "non-empty message");
    assert.ok(typeof result.createdAt === "string");
    assert.ok(
      result.decision.action === RECOVERY_ACTION.AUTO_RETRY ||
      result.decision.action === RECOVERY_ACTION.ESCALATE
    );
  }

  // Scenario 6: Policy filter blocks forbidden approaches
  {
    const forbidden = [
      { id: "a", description: "bypass captcha", approach: "captcha_bypass", safetyLevel: "safe", requiresApproval: false, requiresUserInput: false },
      { id: "b", description: "stealth", approach: "stealth_bypass", safetyLevel: "safe", requiresApproval: false, requiresUserInput: false },
      { id: "c", description: "exfil", approach: "data_exfiltration", safetyLevel: "safe", requiresApproval: false, requiresUserInput: false }
    ];
    const allowed = [
      { id: "d", description: "web search", approach: "web_search", safetyLevel: "safe", requiresApproval: false, requiresUserInput: false }
    ];

    const filtered = filterByPolicy([...forbidden, ...allowed]);
    assert.equal(filtered.length, 1, `expected 1 allowed, got ${filtered.length}`);
    assert.equal(filtered[0].id, "d");
  }

  // Scenario 7: Tool limitation → not recoverable → immediate ESCALATE
  {
    const result = await runReflectiveRecovery({
      mission: "Perform an unsupported action",
      runId: "run_test_002",
      projectId: "proj_test",
      runStatus: "failed",
      runSummary: "not supported — capability missing",
      blockerInfo: null,
      verificationResult: null,
      runError: null,
      runMetadata: {},
      llmGateway: null
    });

    assert.equal(result.diagnosis.cause, FAILURE_CAUSE.TOOL_LIMITATION);
    assert.equal(result.diagnosis.isRecoverable, false);
    assert.equal(result.decision.action, RECOVERY_ACTION.ESCALATE);
    assert.equal(result.decision.reason, "not_recoverable");
    assert.equal(result.alternatives.length, 0);
  }

}
