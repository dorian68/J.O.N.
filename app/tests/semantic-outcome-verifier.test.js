import assert from "node:assert/strict";
import { SemanticOutcomeVerifier } from "../src/runtime/semantic-outcome-verifier.js";

export async function run() {
  const verifier = new SemanticOutcomeVerifier();

  // ── Desktop: pass case ─────────────────────────────────────────────────────
  {
    const result = verifier.verify({
      mission: "Open Notepad, type hello cowork, take a screenshot",
      actionLog: [
        { status: "completed", primitive: "launch_application", label: "Open Notepad" },
        { status: "completed", primitive: "type_text", label: "Type hello cowork" },
        { status: "completed", primitive: "capture_window", label: "Screenshot" }
      ],
      evidence: [{ id: "ev-001", type: "screenshot" }]
    });
    assert.equal(result.verifiedByOutcomes, true, "desktop all-completed should pass");
    assert.equal(result.verificationVerdict, "pass");
    assert.equal(result.objectiveSatisfied, true);
  }

  // ── Desktop: critical failure without recovery blocks completion ───────────
  {
    const result = verifier.verify({
      mission: "Open Notepad and type text",
      actionLog: [
        { status: "failed", primitive: "launch_application", label: "Open Notepad", recoveryAttempted: false }
      ],
      evidence: []
    });
    assert.equal(result.verifiedByOutcomes, false, "unrecovered failure must block completion");
    assert.equal(result.verificationVerdict, "fail");
    assert(result.unsatisfiedOutcomes.some((o) => o.includes("critical")), "should list critical failure as unsatisfied");
  }

  // ── Desktop: no work executed ─────────────────────────────────────────────
  {
    const result = verifier.verify({
      mission: "Open Notepad",
      actionLog: [],
      evidence: []
    });
    assert.equal(result.verifiedByOutcomes, false, "no work = no pass");
    const check = result.checks.find((c) => c.id === "work_executed");
    assert(check && !check.passed, "work_executed check should fail");
  }

  // ── Desktop: launch advisory check fires but doesn't block completion ─────
  {
    const result = verifier.verify({
      mission: "Open Calculator app",
      actionLog: [{ status: "completed", primitive: "type_text", label: "type text" }],
      evidence: [{ id: "ev-1" }]
    });
    const launchCheck = result.checks.find((c) => c.id === "launch_primitive_executed");
    assert(launchCheck && !launchCheck.passed, "launch advisory check should detect missing launch");
    // Advisory failures only lower confidence — they do NOT block verifiedByOutcomes
    assert.equal(result.verifiedByOutcomes, true, "advisory failure alone does not block completion");
    assert.equal(result.confidence, "medium", "advisory failure lowers confidence to medium");
  }

  // ── Desktop: screenshot advisory check fires but doesn't block ────────────
  {
    const result = verifier.verify({
      mission: "Take a screenshot of the desktop",
      actionLog: [{ status: "completed", primitive: "observe_windows", label: "Observe" }],
      evidence: [{ id: "ev-1" }]
    });
    const ssCheck = result.checks.find((c) => c.id === "screenshot_captured");
    assert(ssCheck && !ssCheck.passed, "screenshot advisory check should detect missing screenshot");
    assert.equal(result.verifiedByOutcomes, true, "advisory failure does not block completion");
  }

  // ── Desktop: nextBestAction provided when checks fail ─────────────────────
  {
    const result = verifier.verify({ mission: "Open Notepad", actionLog: [], evidence: [] });
    assert(typeof result.nextBestAction === "string" && result.nextBestAction.length > 0, "should provide nextBestAction");
  }

  // ── Desktop: recovered failure doesn't block ─────────────────────────────
  {
    const result = verifier.verify({
      mission: "Open Calculator",
      actionLog: [
        { status: "failed", primitive: "launch_application", label: "Open Calculator", recoveryAttempted: true },
        { status: "completed", primitive: "launch_application", label: "Open Calculator (retry)" }
      ],
      evidence: [{ id: "ev-1" }]
    });
    const critCheck = result.checks.find((c) => c.id === "no_critical_failures");
    assert(critCheck && critCheck.passed, "recovered failure should not count as critical");
  }

  // ── Desktop: consecutive failure cascade blocks ────────────────────────────
  {
    const result = verifier.verify({
      mission: "Open Notepad",
      actionLog: [{ status: "completed", primitive: "launch_application" }],
      evidence: [{ id: "ev-1" }],
      trackerSnapshot: { steps: { consecutiveFailures: 3 } }
    });
    assert.equal(result.verifiedByOutcomes, false, "consecutive failure cascade must block completion");
    const cascadeCheck = result.checks.find((c) => c.id === "no_failure_cascade");
    assert(cascadeCheck && !cascadeCheck.passed, "failure cascade check should fail");
  }

  // ── CRITICAL: browser partial must NOT pass verification ─────────────────
  {
    const result = verifier.verify({
      mission: "Search for something on Google and take a screenshot",
      browserResult: {
        status: "partial",
        stepResults: [{ action: "navigate" }],
        evidence: [],
        errors: [{ message: "step failed" }]
      }
    });
    assert.equal(result.verifiedByOutcomes, false, "CRITICAL: partial browser must NOT be verified as completed");
    const completedCheck = result.checks.find((c) => c.id === "browser_fully_completed");
    assert(completedCheck && !completedCheck.passed, "browser_fully_completed must fail for partial");
  }

  // ── Browser: completed with evidence ─────────────────────────────────────
  {
    const result = verifier.verify({
      mission: "Search for Node.js documentation on Google",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "type" }],
        evidence: [{ id: "ev-br-1", type: "page_screenshot", screenshotPath: "/tmp/shot.png" }],
        errors: []
      }
    });
    assert.equal(result.verifiedByOutcomes, true, "completed browser with evidence should pass");
    assert.equal(result.verificationVerdict, "pass");
  }

  // ── Browser: failed mission blocks ────────────────────────────────────────
  {
    const result = verifier.verify({
      mission: "Navigate to example.com",
      browserResult: {
        status: "failed",
        stepResults: [],
        evidence: [],
        errors: [{ message: "navigation error" }]
      }
    });
    assert.equal(result.verifiedByOutcomes, false, "failed browser must not pass");
    assert.equal(result.verificationVerdict, "fail");
  }

  // ── Browser: extraction advisory check fires but doesn't block ───────────
  {
    const result = verifier.verify({
      mission: "Search for frameworks and extract the results into a table artifact",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "type" }],
        evidence: [{ id: "ev-1" }],
        extracted: {},
        errors: []
      },
      artifacts: []
    });
    const extractCheck = result.checks.find((c) => c.id === "extraction_delivered");
    assert(extractCheck && !extractCheck.passed, "extraction advisory check should detect missing artifact");
    // Extraction is advisory — lower confidence, but doesn't block completion
    assert.equal(result.verifiedByOutcomes, true, "advisory check does not block verifiedByOutcomes");
    assert.equal(result.confidence, "medium", "advisory failure lowers confidence");
  }

  // ── Browser: extraction delivered via extracted data ──────────────────────
  {
    const result = verifier.verify({
      mission: "Extract the first 5 results from Google into an artifact",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "extract" }],
        evidence: [{ id: "ev-1" }],
        extracted: { results: [{ title: "Result 1", url: "http://example.com" }] },
        errors: []
      },
      artifacts: []
    });
    const extractCheck = result.checks.find((c) => c.id === "extraction_delivered");
    assert(extractCheck && extractCheck.passed, "extraction via extracted data should pass");
    assert.equal(result.verifiedByOutcomes, true);
  }

  // ── Browser: unresolved blockers block completion ─────────────────────────
  {
    const result = verifier.verify({
      mission: "Navigate to a site and capture a screenshot",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }],
        evidence: [{ id: "ev-1" }],
        blockers: [{ reason: "CAPTCHA detected", resolved: false }],
        errors: []
      }
    });
    const blockerCheck = result.checks.find((c) => c.id === "browser_no_blockers");
    assert(blockerCheck && !blockerCheck.passed, "unresolved blockers must block completion");
    assert.equal(result.verifiedByOutcomes, false);
  }

  // ── Output shape always has required fields ───────────────────────────────
  {
    const result = verifier.verify({ mission: "test" });
    assert(typeof result.verifiedByOutcomes === "boolean");
    assert(typeof result.objectiveSatisfied === "boolean");
    assert(["pass", "partial", "fail", "degraded"].includes(result.verificationVerdict));
    assert(["high", "medium", "low", "unknown"].includes(result.confidence));
    assert(Array.isArray(result.evidenceUsed));
    assert(Array.isArray(result.missingEvidence));
    assert(Array.isArray(result.satisfiedOutcomes));
    assert(Array.isArray(result.unsatisfiedOutcomes));
    assert(Array.isArray(result.checks));
    assert(typeof result.requiresUserInput === "boolean");
  }

  // ── Check objects have required shape ─────────────────────────────────────
  {
    const result = verifier.verify({
      mission: "Open Notepad",
      actionLog: [{ status: "completed", primitive: "launch_application" }],
      evidence: [{ id: "ev-1" }]
    });
    for (const check of result.checks) {
      assert(typeof check.id === "string", `check.id must be string, got ${typeof check.id}`);
      assert(typeof check.label === "string", `check.label must be string`);
      assert(typeof check.passed === "boolean", `check.passed must be boolean`);
      assert(check.status === "pass" || check.status === "fail", `check.status must be pass|fail`);
    }
  }
}
