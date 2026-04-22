import assert from "node:assert/strict";
import { ComputerControlService } from "../src/computer/computer-control-service.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";

class AsyncProviderStub {
  constructor() {
    this.calls = 0;
  }

  async inspectVisibleUi(windowId) {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      windowId,
      title: "Async provider window",
      content: this.calls >= 2 ? "state=ready" : "state=loading"
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
  const service = new ComputerControlService(new AsyncProviderStub());
  const result = await service.waitForUiState("win_async", (inspection) => inspection.content?.includes("ready"), {
    timeoutMs: 1000,
    intervalMs: 20
  });

  assert.equal(result.validated, true);
  assert.equal(result.inspection.content, "state=ready");

  const desktopService = new ComputerControlService(new FakeWindowProvider([], {
    browsers: [
      {
        id: "edge",
        label: "Microsoft Edge",
        processName: "msedge",
        executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      }
    ]
  }));
  const browsers = desktopService.listInstalledBrowsers();
  assert.equal(browsers.length, 1);
  assert.equal(browsers[0].id, "edge");
  await desktopService.launchBrowser("edge");
  const browserWindow = await desktopService.waitForVisibleWindowMatch((windowState) => windowState.processName === "msedge");
  assert.equal(browserWindow.validated, true);
  assert.equal(browserWindow.matchedWindow?.processName, "msedge");
  const capture = await desktopService.captureWindow(browserWindow.matchedWindow.id);
  assert.equal(typeof capture.outputPath, "string");

  desktopService.provider.mutateWindow(browserWindow.matchedWindow.id, {
    controls: [
      {
        id: "search",
        name: "Search",
        controlType: "ControlType.Button",
        bounds: { x: 400, y: 220, width: 120, height: 44 }
      }
    ]
  });
  const desktopSnapshot = await desktopService.inspectDesktop({ maxWindows: 2 });
  assert.equal(desktopSnapshot.windows.length > 0, true);
  assert.equal(desktopSnapshot.windows[0].semanticTargets.some((target) => target.label === "Search"), true);

  const semanticTarget = await desktopService.resolveSemanticTarget(browserWindow.matchedWindow.id, {
    query: "Search",
    role: "button"
  });
  assert.equal(semanticTarget.found, true);
  assert.equal(semanticTarget.target.center.x, 460);
}
