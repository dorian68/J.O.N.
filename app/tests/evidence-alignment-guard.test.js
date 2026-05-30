import assert from "node:assert/strict";
import { EvidenceAlignmentGuard } from "../src/runtime/evidence-alignment-guard.js";

export async function run() {
  const guard = new EvidenceAlignmentGuard();

  {
    const result = guard.evaluate({
      mission: "Capture proof from https://nodejs.org/en/docs",
      evidenceRequired: true,
      evidence: [{ id: "ev1", url: "https://nodejs.org/en/docs", type: "page_screenshot" }]
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.targetDomains, ["nodejs.org"]);
  }

  {
    const result = guard.evaluate({
      mission: "Capture proof from nodejs.org",
      evidenceRequired: true,
      evidence: [{ id: "ev2", url: "https://example.com", type: "page_screenshot" }]
    });
    assert.equal(result.passed, false);
    assert(result.failureReasons.some((reason) => reason.includes("nodejs.org")));
  }

  {
    const result = guard.evaluate({
      mission: "Open Notepad and take a screenshot",
      evidenceRequired: true,
      evidence: [{ id: "ev3", label: "Notepad screenshot", linkedSurface: "Untitled - Notepad" }]
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.appTargets, ["notepad"]);
  }

  {
    const result = guard.evaluate({
      mission: "Open Edge and capture the page",
      evidenceRequired: true,
      evidence: [{ id: "ev4", type: "page_screenshot", label: "Browser screenshot" }]
    });
    assert.equal(result.passed, true, "browser screenshot type can satisfy browser app target");
  }

  {
    const result = guard.evaluate({
      mission: "Open Chrome or Edge, search for Node.js documentation, and capture proof.",
      evidenceRequired: true,
      evidence: [{
        id: "ev5",
        type: "window_capture",
        label: "Desktop browser launch evidence",
        linkedSurface: "Google Chrome",
        metadata: {
          browserId: "chrome",
          browserLabel: "Google Chrome",
          url: "https://www.google.com/search?q=Node.js%20documentation",
          targetWindowTitle: "Google Chrome - https://www.google.com/search?q=Node.js%20documentation"
        }
      }]
    });
    assert.equal(result.passed, true, "one matched browser is enough when the mission offers browser alternatives");
  }
}
