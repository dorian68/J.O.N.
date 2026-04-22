import assert from "node:assert/strict";
import { APPROVAL_DECISION } from "../src/config.js";
import { OperatorService } from "../src/service/operator-service.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPendingApproval(service, { timeoutMs = 4000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pending = service.listPendingApprovals();
    if (pending.length > 0) {
      return pending[0];
    }
    await sleep(100);
  }
  throw new Error("Timed out while waiting for a pending approval.");
}

class RealLocalWindowProviderStub {
  constructor() {
    this.focusCalls = [];
    this.windows = [
      {
        id: "win_other",
        title: "Operator Notes Window",
        active: true,
        allowlisted: false,
        bounds: { x: 50, y: 50, width: 900, height: 700 }
      },
      {
        id: "win_allowlisted",
        title: "PowerShell - Allowlisted Observation Window",
        active: false,
        allowlisted: true,
        bounds: { x: 100, y: 100, width: 1200, height: 800 }
      }
    ];
  }

  async listVisibleWindows() {
    return this.windows.map(({ id, title, allowlisted, bounds }) => ({
      id,
      title,
      allowlisted,
      bounds
    }));
  }

  async detectActiveWindow() {
    const active = this.windows.find((windowState) => windowState.active) ?? null;
    return active ? {
      id: active.id,
      title: active.title,
      allowlisted: active.allowlisted,
      bounds: active.bounds
    } : null;
  }

  async focusWindow(windowId) {
    this.focusCalls.push(windowId);
    this.windows.forEach((windowState) => {
      windowState.active = windowState.id === windowId;
    });
    return this.detectActiveWindow();
  }

  async captureWindow(windowId) {
    const windowState = this.windows.find((candidate) => candidate.id === windowId);
    return {
      capturedAt: new Date().toISOString(),
      window: {
        id: windowState.id,
        title: windowState.title,
        bounds: windowState.bounds
      },
      outputPath: `C:\\temp\\${windowId}.png`
    };
  }

  async captureRegion(region) {
    return {
      capturedAt: new Date().toISOString(),
      region,
      outputPath: "C:\\temp\\region.png"
    };
  }

  async inspectVisibleUi(windowId) {
    const windowState = this.windows.find((candidate) => candidate.id === windowId);
    return {
      windowId: windowState.id,
      title: windowState.title,
      content: windowState.title,
      allowlisted: windowState.allowlisted,
      active: windowState.active
    };
  }

  async detectBlockingOverlay() {
    return {
      blocked: false,
      reason: null
    };
  }
}

export async function run() {
  const provider = new RealLocalWindowProviderStub();
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: {
      research: {
        mode: "allowlisted_real_web",
        mission: "Inspect the allowlisted public pages only.",
        targets: [
          {
            title: "Example Dot Com",
            url: "https://example.com/",
            fieldMap: {
              companyName: { css: "h1" }
            },
            staticValues: {
              tagline: "Example Domain",
              riskNote: "Static public page."
            }
          },
          {
            title: "Example Dot Org",
            url: "https://example.org/",
            fieldMap: {
              companyName: { css: "h1" }
            },
            staticValues: {
              tagline: "Example Domain",
              riskNote: "Static public page."
            }
          }
        ]
      },
      computer: {
        mode: "real_local_window",
        mission: "Observe the allowlisted local window only.",
        windowMatch: {
          titleIncludes: "Allowlisted Observation Window"
        }
      }
    },
    computerProvider: provider
  });

  try {
    const project = await service.ensureDemoProject();
    assert.equal(project.allowlistedDomains.includes("example.com"), true);
    assert.equal(project.allowlistedDomains.includes("example.org"), true);

    const scenarios = service.listScenarios();
    assert.equal(scenarios.find((scenario) => scenario.id === "research")?.evidenceFocus, "allowlisted_real_web");
    assert.equal(scenarios.find((scenario) => scenario.id === "computer")?.evidenceFocus, "real_local_window");

    const launch = await service.startScenario(project.id, "computer");
    const pendingApproval = await waitForPendingApproval(service);

    assert.equal(pendingApproval.category, "local_focus");
    assert.equal(provider.focusCalls.length, 0);

    await service.resolveApproval(pendingApproval.id, APPROVAL_DECISION.APPROVED_ONCE, "Real bounded local focus approved for test.");
    const completedDetail = await service.waitForRun(launch.runId);

    assert.equal(provider.focusCalls.length, 1);
    assert.equal(provider.focusCalls[0], "win_allowlisted");
    assert.equal(completedDetail.run.status, "completed");

    const focusEvidence = completedDetail.evidence.find((entry) => entry.label === "Computer focus approval context");
    const observationEvidence = completedDetail.evidence.find((entry) => entry.label === "Computer control observation evidence");

    assert.equal(focusEvidence?.sensitivity, "real_local_window");
    assert.equal(observationEvidence?.sensitivity, "real_local_window");

    const focusManifest = await service.readEvidenceManifest(launch.runId, focusEvidence.id);
    const observationManifest = await service.readEvidenceManifest(launch.runId, observationEvidence.id);

    assert.equal(focusManifest.content.payload.surfaceClassification, "real_local_window");
    assert.equal(observationManifest.content.payload.surfaceClassification, "real_local_window");
    assert.equal(observationManifest.content.payload.verification.validated, true);
    assert.equal(observationManifest.content.payload.targetWindowLabel, "PowerShell - Allowlisted Observation Window");
  } finally {
    await service.close();
  }
}
