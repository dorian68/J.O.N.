import assert from "node:assert/strict";
import { SemanticOutcomeVerifier } from "../src/runtime/semantic-outcome-verifier.js";

export async function run() {
  const verifier = new SemanticOutcomeVerifier();

  {
    const result = verifier.verify({
      mission: "Open Notepad, type 'hello cowork', take a screenshot",
      actionLog: [
        { status: "completed", primitive: "launch_application", label: "Open Notepad" },
        { status: "completed", primitive: "type_text", label: "Type hello cowork", step: { input: { text: "hello cowork" } } },
        { status: "completed", primitive: "capture_window", label: "Screenshot" }
      ],
      evidence: [{
        id: "ev-001",
        type: "window_capture",
        label: "Notepad screenshot",
        storagePath: "notepad.png",
        linkedSurface: "Untitled - Notepad",
        metadata: { screenshotPath: "notepad.png", targetWindowTitle: "Untitled - Notepad" }
      }]
    });
    assert.equal(result.verifiedByOutcomes, true);
    assert.equal(result.verificationVerdict, "pass");
    assert.equal(result.objectiveSatisfied, true);
  }

  {
    const result = verifier.verify({
      mission: "Open Notepad and type text",
      actionLog: [
        { status: "failed", primitive: "launch_application", label: "Open Notepad", recoveryAttempted: false }
      ],
      evidence: []
    });
    assert.equal(result.verifiedByOutcomes, false);
    assert.equal(result.verificationVerdict, "fail");
    assert(result.criticalBlockers.includes("required_evidence_collected"));
    assert(result.criticalBlockers.includes("no_critical_failures"));
  }

  {
    const result = verifier.verify({
      mission: "Open Notepad",
      actionLog: [],
      evidence: []
    });
    assert.equal(result.verifiedByOutcomes, false);
    assert.equal(result.checks.find((c) => c.id === "work_executed")?.passed, false);
  }

  {
    const result = verifier.verify({
      mission: "Open Calculator app",
      actionLog: [{ status: "completed", primitive: "type_text", label: "type text" }],
      evidence: [{ id: "ev-1", label: "Calculator proof", linkedSurface: "Calculator" }]
    });
    assert.equal(result.checks.find((c) => c.id === "launch_primitive_executed")?.passed, false);
    assert.equal(result.verifiedByOutcomes, false, "missing requested launch now blocks completion");
  }

  {
    const result = verifier.verify({
      mission: "Take a screenshot of the desktop",
      actionLog: [{ status: "completed", primitive: "observe_windows", label: "Observe" }],
      evidence: [{ id: "ev-1", type: "action_summary", label: "Observation only" }]
    });
    assert.equal(result.checks.find((c) => c.id === "desktop_screenshot_captured")?.passed, false);
    assert.equal(result.verifiedByOutcomes, false, "missing requested screenshot blocks completion");
  }

  {
    const result = verifier.verify({
      mission: "Open Calculator",
      actionLog: [
        { status: "failed", primitive: "launch_application", label: "Open Calculator", recoveryAttempted: true },
        { status: "completed", primitive: "launch_application", label: "Open Calculator (retry)" }
      ],
      evidence: [{ id: "ev-1", label: "Calculator proof", linkedSurface: "Calculator" }]
    });
    assert.equal(result.checks.find((c) => c.id === "no_critical_failures")?.passed, true);
  }

  {
    const result = verifier.verify({
      mission: "Open Notepad",
      actionLog: [{ status: "completed", primitive: "launch_application", label: "Open Notepad" }],
      evidence: [{ id: "ev-1", label: "Notepad proof", linkedSurface: "Notepad" }],
      trackerSnapshot: { steps: { consecutiveFailures: 3 } }
    });
    assert.equal(result.verifiedByOutcomes, false);
    assert.equal(result.checks.find((c) => c.id === "no_failure_cascade")?.passed, false);
  }

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
    assert.equal(result.verifiedByOutcomes, false);
    assert.equal(result.checks.find((c) => c.id === "browser_fully_completed")?.passed, false);
  }

  {
    const result = verifier.verify({
      mission: "Search for Node.js documentation on Google",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "type" }],
        evidence: [{ id: "ev-br-1", type: "page_screenshot", screenshotPath: "/tmp/shot.png", url: "https://www.google.com/search?q=Node.js%20documentation" }],
        browserState: { url: "https://www.google.com/search?q=Node.js%20documentation", title: "Node.js documentation - Google Search" },
        errors: []
      }
    });
    assert.equal(result.verifiedByOutcomes, true);
    assert.equal(result.verificationVerdict, "pass");
  }

  {
    const result = verifier.verify({
      mission: "Search for frameworks and extract the results into a table artifact",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "type" }],
        evidence: [{ id: "ev-1", type: "page_screenshot", url: "https://www.google.com/search?q=frameworks" }],
        browserState: { url: "https://www.google.com/search?q=frameworks", title: "frameworks - Google Search" },
        extracted: {},
        errors: []
      },
      artifacts: []
    });
    assert.equal(result.checks.find((c) => c.id === "extraction_delivered")?.passed, false);
    assert.equal(result.checks.find((c) => c.id === "required_artifact_exists")?.passed, false);
    assert.equal(result.verifiedByOutcomes, false, "missing requested extraction/artifact blocks completion");
  }

  {
    const result = verifier.verify({
      mission: "Extract the first 5 results from Google into an artifact",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "extract_structured_rows" }],
        evidence: [{ id: "ev-1", type: "page_screenshot", url: "https://www.google.com/search?q=results" }],
        browserState: { url: "https://www.google.com/search?q=results", title: "results - Google Search" },
        extracted: { results: [{ title: "Result 1", url: "http://example.com" }] },
        errors: []
      },
      artifacts: [{ id: "art-1", title: "Results artifact" }]
    });
    assert.equal(result.checks.find((c) => c.id === "extraction_delivered")?.passed, true);
    assert.equal(result.verifiedByOutcomes, true);
  }

  {
    const result = verifier.verify({
      mission: "Navigate to a site and capture a screenshot",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }],
        evidence: [{ id: "ev-1", type: "page_screenshot", screenshotPath: "shot.png", url: "https://example.com" }],
        browserState: { url: "https://example.com", title: "Example" },
        blockers: [{ reason: "CAPTCHA detected", resolved: false }],
        errors: []
      }
    });
    assert.equal(result.checks.find((c) => c.id === "browser_no_blockers")?.passed, false);
    assert.equal(result.verifiedByOutcomes, false);
  }

  {
    const result = verifier.verify({
      mission: "Search nodejs.org documentation and capture proof",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }],
        evidence: [{ id: "ev-wrong", type: "page_screenshot", url: "https://example.com" }],
        browserState: { url: "https://example.com", title: "Example" },
        errors: []
      }
    });
    assert.equal(result.checks.find((c) => c.id === "evidence_aligned_with_mission")?.passed, false);
    assert.equal(result.verifiedByOutcomes, false);
  }

  {
    const result = verifier.verify({
      mission: "Find upcoming tech conferences in Europe for the next 3 months with dates",
      browserResult: {
        status: "completed",
        stepResults: [{ action: "navigate" }, { action: "extract_structured_rows" }],
        evidence: [{
          id: "ev-fixture",
          type: "page_screenshot",
          url: "http://127.0.0.1:41731/company-alpha.html",
          sensitivity: "controlled_fixture"
        }],
        browserState: { url: "http://127.0.0.1:41731/company-alpha.html", title: "Alpha Analytics" },
        extracted: { results: [{ title: "Alpha Analytics" }] },
        errors: []
      },
      artifacts: [{ id: "art-fixture", title: "Fixture table" }]
    });
    assert.equal(result.checks.find((c) => c.id === "evidence_aligned_with_mission")?.passed, false);
    assert.equal(result.failureReason.includes("controlled fixture/local pages"), true);
    assert.equal(result.verifiedByOutcomes, false);
  }

  {
    const result = verifier.verify({
      mission: "Monitor terminal until it asks for confirmation",
      actionLog: [{ status: "completed", primitive: "observe_terminal" }],
      evidence: [{ id: "ev-term", label: "Terminal observation", linkedSurface: "Codex terminal" }],
      workspaceSnapshot: { terminal: { sessions: [{ id: "term1", status: "waiting_for_input" }] } }
    });
    assert.equal(result.checks.find((c) => c.id === "no_terminal_blocker")?.passed, false);
    assert.equal(result.verifiedByOutcomes, false);
    assert.equal(result.requiresUserInput, true);
  }

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
    assert(Array.isArray(result.criticalBlockers));
    assert(typeof result.requiresUserInput === "boolean");
  }
}
