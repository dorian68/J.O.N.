import assert from "node:assert/strict";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { OperatorService } from "../src/service/operator-service.js";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: { mode: "controlled_fixture", mission: "External terminal test." },
  computer: { mode: "controlled_fixture_window", mission: "External terminal computer test." }
});

const FAKE_EXTERNAL_TERMINALS = [
  {
    processId: 1234,
    windowHandle: "99001",
    processName: "powershell",
    title: "PowerShell — C:\\Users\\Labry",
    label: "PowerShell",
    canReadBuffer: true,
    executablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    bounds: { x: 100, y: 100, width: 900, height: 600 }
  },
  {
    processId: 5678,
    windowHandle: "99002",
    processName: "windowsterminal",
    title: "Windows Terminal",
    label: "Windows Terminal",
    canReadBuffer: false,
    executablePath: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\wt.exe",
    bounds: { x: 200, y: 200, width: 1200, height: 800 }
  }
];

async function createService(externalTerminals = []) {
  const provider = new FakeWindowProvider([], {});
  provider.setExternalTerminals(externalTerminals);
  return OperatorService.create({
    realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
    computerProvider: provider
  });
}

export async function run() {
  // --- detectExternalTerminals ---

  {
    const service = await createService([]);
    const project = await service.ensureDemoProject();
    const result = await service.detectExternalTerminals(project.id);
    assert.ok(Array.isArray(result.terminals), "terminals should be an array");
    assert.equal(result.terminals.length, 0, "no terminals when provider returns empty");
    assert.equal(result.unsupported, false, "unsupported should be false");
    await service.close();
  }

  {
    const service = await createService(FAKE_EXTERNAL_TERMINALS);
    const project = await service.ensureDemoProject();
    const result = await service.detectExternalTerminals(project.id);
    assert.equal(result.terminals.length, 2, "should return 2 detected terminals");
    const ps = result.terminals.find((t) => t.processName === "powershell");
    assert.ok(ps, "powershell terminal present");
    assert.equal(ps.canReadBuffer, true, "powershell can read buffer");
    const wt = result.terminals.find((t) => t.processName === "windowsterminal");
    assert.ok(wt, "windows terminal present");
    assert.equal(wt.canReadBuffer, false, "windows terminal cannot read buffer (ConPTY)");
    await service.close();
  }

  // --- adoptExternalTerminal ---

  {
    const service = await createService(FAKE_EXTERNAL_TERMINALS);
    const project = await service.ensureDemoProject();
    const result = await service.adoptExternalTerminal(project.id, {
      label: "My PowerShell",
      windowHandle: "99001",
      processId: 1234,
      canReadBuffer: true,
      processName: "powershell",
      autonomyMode: "assisted"
    });
    assert.ok(result?.terminal?.id, "adopted terminal has an id");
    assert.equal(result.terminal.label, "My PowerShell", "label preserved");
    assert.equal(result.terminal.metadata?.terminalType, "external", "terminalType is external");
    assert.equal(result.terminal.metadata?.windowHandle, "99001", "windowHandle stored");
    assert.equal(result.terminal.metadata?.externalProcessId, 1234, "processId stored");
    assert.equal(result.terminal.metadata?.canReadBuffer, true, "canReadBuffer stored");

    // Verify the adopted terminal is visible in the workspace
    const workspace = service.getWorkspaceState(project.id);
    const found = workspace.terminals.find((t) => t.id === result.terminal.id);
    assert.ok(found, "adopted terminal appears in workspace terminals");
    assert.equal(found.metadata?.terminalType, "external");

    await service.close();
  }

  // --- detectExternalTerminals filters out already-adopted terminals ---

  {
    const service = await createService(FAKE_EXTERNAL_TERMINALS);
    const project = await service.ensureDemoProject();

    // Adopt the powershell terminal
    await service.adoptExternalTerminal(project.id, {
      label: "PS",
      windowHandle: "99001",
      processId: 1234,
      canReadBuffer: true,
      processName: "powershell",
      autonomyMode: "assisted"
    });

    const result = await service.detectExternalTerminals(project.id);
    const adoptedAgain = result.terminals.find((t) => t.windowHandle === "99001");
    assert.ok(adoptedAgain, "already-adopted terminal still appears in detection results");
    assert.equal(adoptedAgain.alreadyAdopted, true, "already-adopted terminal is flagged");
    const notAdopted = result.terminals.find((t) => t.windowHandle === "99002");
    assert.equal(notAdopted?.alreadyAdopted ?? false, false, "non-adopted terminal is not flagged");
    await service.close();
  }

  // --- stopExternalTerminalAdoption ---

  {
    const service = await createService(FAKE_EXTERNAL_TERMINALS);
    const project = await service.ensureDemoProject();

    const adopted = await service.adoptExternalTerminal(project.id, {
      label: "WT",
      windowHandle: "99002",
      processId: 5678,
      canReadBuffer: false,
      processName: "windowsterminal",
      autonomyMode: "assisted"
    });

    const terminalId = adopted.terminal.id;
    const stopResult = await service.stopExternalTerminalAdoption(project.id, terminalId);
    assert.ok(stopResult, "stopExternalTerminalAdoption returns a result");

    const workspace = service.getWorkspaceState(project.id);
    const detached = workspace.terminals.find((t) => t.id === terminalId);
    assert.equal(detached?.status, "detached", "terminal status is detached after stop");
    await service.close();
  }

  // --- writeWorkspaceTerminalInput routes to external provider ---

  {
    const provider = new FakeWindowProvider([], {});
    provider.setExternalTerminals(FAKE_EXTERNAL_TERMINALS);
    const service = await OperatorService.create({
      realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
      computerProvider: provider
    });
    const project = await service.ensureDemoProject();

    const adopted = await service.adoptExternalTerminal(project.id, {
      label: "PS Input Test",
      windowHandle: "99001",
      processId: 1234,
      canReadBuffer: true,
      processName: "powershell",
      autonomyMode: "assisted"
    });

    const terminalId = adopted.terminal.id;
    await service.writeWorkspaceTerminalInput(project.id, terminalId, { input: "echo hello" });

    // Verify the fake provider received the input (buffer now contains the echoed line)
    const buffer = provider.readExternalTerminalBuffer(1234);
    assert.ok(buffer.success, "buffer read succeeded");
    assert.ok(buffer.lines.some((line) => line.includes("echo hello")), "input was recorded by fake provider");

    await service.close();
  }

  // --- FakeWindowProvider standalone external terminal methods ---

  {
    const provider = new FakeWindowProvider([], {});
    provider.setExternalTerminals([
      { processId: 42, windowHandle: "77", processName: "pwsh", title: "pwsh", label: "pwsh", canReadBuffer: true, fakeBuffer: ["initial line"] }
    ]);

    const listed = provider.listExternalTerminals();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].processId, 42);

    const bufferResult = provider.readExternalTerminalBuffer(42);
    assert.equal(bufferResult.success, true);
    assert.ok(bufferResult.lines.includes("initial line"));

    const sendResult = provider.sendExternalTerminalInput(42, "hello world");
    assert.equal(sendResult.success, true);
    assert.equal(sendResult.method, "fake_provider");

    const bufferAfter = provider.readExternalTerminalBuffer(42);
    assert.ok(bufferAfter.lines.some((line) => line.includes("hello world")));

    const unknownBuffer = provider.readExternalTerminalBuffer(9999);
    assert.equal(unknownBuffer.success, false);

    const unknownSend = provider.sendExternalTerminalInput(9999, "test");
    assert.equal(unknownSend.success, false);
  }
}
