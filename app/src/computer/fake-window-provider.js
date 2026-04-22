import { createId, nowIso } from "../utils/ids.js";

export class FakeWindowProvider {
  constructor(windows = [], options = {}) {
    this.applications = (options.applications ?? [
      {
        id: "notepad",
        label: "Notepad",
        kind: "text_editor",
        processName: "notepad",
        executablePath: "C:\\Windows\\System32\\notepad.exe"
      },
      {
        id: "calculator",
        label: "Calculator",
        kind: "utility",
        processName: "CalculatorApp",
        executablePath: "C:\\Windows\\System32\\calc.exe"
      }
    ]).map((application) => ({
      ...application
    }));
    this.browsers = (options.browsers ?? [
      {
        id: "edge",
        label: "Microsoft Edge",
        processName: "msedge",
        executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      },
      {
        id: "chrome",
        label: "Google Chrome",
        processName: "chrome",
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
    ]).map((browser) => ({
      ...browser
    }));
    this.windows = windows.map((windowState) => ({
      id: windowState.id ?? createId("win"),
      title: windowState.title,
      visible: windowState.visible ?? true,
      active: windowState.active ?? false,
      allowlisted: windowState.allowlisted ?? true,
      content: windowState.content ?? "",
      controls: windowState.controls ?? [],
      blocker: windowState.blocker ?? null,
      processName: windowState.processName ?? null,
      executablePath: windowState.executablePath ?? null,
      bounds: windowState.bounds ?? { x: 40, y: 40, width: 1200, height: 800 },
      updatedAt: nowIso()
    }));
  }

  listInstalledBrowsers() {
    return this.browsers.map((browser) => ({
      id: browser.id,
      label: browser.label,
      processName: browser.processName,
      executablePath: browser.executablePath
    }));
  }

  listInstalledApplications() {
    const browserApps = this.browsers.map((browser) => ({
      id: `browser_${browser.id}`,
      label: browser.label,
      kind: "browser",
      processName: browser.processName,
      executablePath: browser.executablePath,
      launchType: "executable",
      source: "known_browser"
    }));
    return [...this.applications, ...browserApps].map((application) => ({
      id: application.id,
      label: application.label,
      kind: application.kind ?? "application",
      processName: application.processName ?? null,
      executablePath: application.executablePath ?? null,
      launchType: application.launchType ?? "executable",
      source: application.source ?? "fake_provider"
    }));
  }

  listVisibleWindows() {
    return this.windows.filter((windowState) => windowState.visible).map((windowState) => ({
      id: windowState.id,
      title: windowState.title,
      allowlisted: windowState.allowlisted,
      processName: windowState.processName,
      executablePath: windowState.executablePath,
      bounds: windowState.bounds
    }));
  }

  detectActiveWindow() {
    const active = this.windows.find((windowState) => windowState.active && windowState.visible) ?? null;
    return active ? {
      id: active.id,
      title: active.title,
      allowlisted: active.allowlisted,
      processName: active.processName,
      executablePath: active.executablePath,
      bounds: active.bounds
    } : null;
  }

  focusWindow(windowId) {
    const windowState = this.#requireWindow(windowId);
    this.windows.forEach((candidate) => {
      candidate.active = false;
      candidate.updatedAt = nowIso();
    });
    windowState.active = true;
    windowState.updatedAt = nowIso();
    return {
      id: windowState.id,
      title: windowState.title,
      allowlisted: windowState.allowlisted,
      processName: windowState.processName,
      executablePath: windowState.executablePath,
      bounds: windowState.bounds
    };
  }

  launchBrowser(browserId, { url = null } = {}) {
    const browser = this.browsers.find((candidate) => candidate.id === browserId);
    if (!browser) {
      throw new Error(`Unsupported fake browser: ${browserId}`);
    }
    this.windows.forEach((candidate) => {
      candidate.active = false;
      candidate.updatedAt = nowIso();
    });
    const browserWindow = {
      id: createId("win"),
      title: `${browser.label}${url ? ` - ${url}` : " - New tab"}`,
      visible: true,
      active: true,
      allowlisted: false,
      content: url ? `url=${url}` : "state=browser_opened",
      blocker: null,
      processName: browser.processName,
      executablePath: browser.executablePath,
      bounds: { x: 80, y: 80, width: 1280, height: 860 },
      updatedAt: nowIso()
    };
    this.windows.push(browserWindow);
    return {
      launchedAt: nowIso(),
      browser: {
        id: browser.id,
        label: browser.label,
        processName: browser.processName,
        executablePath: browser.executablePath
      },
      window: {
        id: browserWindow.id,
        title: browserWindow.title
      },
      url
    };
  }

  launchApplication(appId) {
    const application = this.listInstalledApplications().find((candidate) => candidate.id === appId);
    if (!application) {
      throw new Error(`Unsupported fake application: ${appId}`);
    }
    this.windows.forEach((candidate) => {
      candidate.active = false;
      candidate.updatedAt = nowIso();
    });
    const windowState = {
      id: createId("win"),
      title: application.label,
      visible: true,
      active: true,
      allowlisted: false,
      content: "state=application_opened",
      blocker: null,
      processName: application.processName,
      executablePath: application.executablePath,
      bounds: { x: 120, y: 120, width: 960, height: 720 },
      updatedAt: nowIso()
    };
    this.windows.push(windowState);
    return {
      launchedAt: nowIso(),
      application,
      window: {
        id: windowState.id,
        title: windowState.title
      }
    };
  }

  typeText(windowId, text) {
    const windowState = windowId ? this.#requireWindow(windowId) : this.windows.find((candidate) => candidate.active);
    if (!windowState) {
      throw new Error("No fake window available for text input.");
    }
    windowState.content = `${windowState.content}\n${text ?? ""}`.trim();
    windowState.updatedAt = nowIso();
    return {
      typedAt: nowIso(),
      textLength: String(text ?? "").length,
      targetHandle: windowState.id
    };
  }

  sendHotkey(windowId, keys) {
    const windowState = windowId ? this.#requireWindow(windowId) : this.windows.find((candidate) => candidate.active);
    if (!windowState) {
      throw new Error("No fake window available for hotkey.");
    }
    windowState.content = `${windowState.content}\nhotkey=${keys ?? ""}`.trim();
    windowState.updatedAt = nowIso();
    return {
      sentAt: nowIso(),
      keys,
      targetHandle: windowState.id
    };
  }

  clickPoint(windowId, point) {
    const windowState = windowId ? this.#requireWindow(windowId) : this.windows.find((candidate) => candidate.active);
    if (!windowState) {
      throw new Error("No fake window available for click.");
    }
    windowState.content = `${windowState.content}\nclick=${point?.x ?? 0},${point?.y ?? 0}`.trim();
    windowState.updatedAt = nowIso();
    return {
      clickedAt: nowIso(),
      x: point?.x ?? 0,
      y: point?.y ?? 0,
      targetHandle: windowState.id
    };
  }

  scrollWindow(windowId, delta) {
    const windowState = windowId ? this.#requireWindow(windowId) : this.windows.find((candidate) => candidate.active);
    if (!windowState) {
      throw new Error("No fake window available for scroll.");
    }
    windowState.content = `${windowState.content}\nscroll=${delta ?? 0}`.trim();
    windowState.updatedAt = nowIso();
    return {
      scrolledAt: nowIso(),
      delta,
      targetHandle: windowState.id
    };
  }

  captureWindow(windowId) {
    const windowState = this.#requireWindow(windowId);
    return {
      capturedAt: nowIso(),
      window: {
        id: windowState.id,
        title: windowState.title,
        bounds: windowState.bounds
      },
      content: windowState.content,
      blocker: windowState.blocker
    };
  }

  captureRegion(region) {
    const active = this.detectActiveWindow();
    return {
      capturedAt: nowIso(),
      region,
      activeWindow: active,
      content: active ? this.#requireWindow(active.id).content : ""
    };
  }

  captureScreen() {
    return {
      capturedAt: nowIso(),
      virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 },
      visibleWindows: this.listVisibleWindows(),
      content: this.windows.filter((windowState) => windowState.visible).map((windowState) => windowState.content).join("\n")
    };
  }

  ocrImage(imagePath) {
    return {
      available: false,
      engine: "fake_provider",
      reason: `Fake provider does not OCR image files: ${imagePath}`,
      text: "",
      lines: [],
      words: []
    };
  }

  inspectVisibleUi(windowId) {
    const windowState = this.#requireWindow(windowId);
    const children = (windowState.controls ?? []).map((control, index) => ({
      name: control.name ?? control.label ?? `Control ${index + 1}`,
      automationId: control.automationId ?? control.id ?? `control_${index + 1}`,
      className: control.className ?? "FakeControl",
      controlType: control.controlType ?? "ControlType.Button",
      isEnabled: control.isEnabled ?? true,
      isOffscreen: control.isOffscreen ?? false,
      bounds: control.bounds ?? {
        x: windowState.bounds.x + 24,
        y: windowState.bounds.y + 48 + index * 40,
        width: 180,
        height: 32
      },
      children: []
    }));
    return {
      windowId: windowState.id,
      title: windowState.title,
      allowlisted: windowState.allowlisted,
      processName: windowState.processName,
      executablePath: windowState.executablePath,
      content: windowState.content,
      blocker: windowState.blocker,
      active: windowState.active,
      accessibility: {
        available: true,
        reason: null,
        maxDepth: 2,
        maxNodes: 12,
        nodesReturned: 1,
        tree: {
          name: windowState.title,
          automationId: windowState.id,
          className: "FakeWindow",
          controlType: "ControlType.Window",
          isEnabled: true,
          isOffscreen: false,
          bounds: windowState.bounds,
          children
        }
      }
    };
  }

  inspectAccessibilityTree(windowId) {
    return this.inspectVisibleUi(windowId).accessibility;
  }

  detectBlockingOverlay(windowId) {
    const windowState = this.#requireWindow(windowId);
    return {
      blocked: Boolean(windowState.blocker),
      reason: windowState.blocker
    };
  }

  mutateWindow(windowId, patch) {
    const windowState = this.#requireWindow(windowId);
    Object.assign(windowState, patch, { updatedAt: nowIso() });
  }

  #requireWindow(windowId) {
    const windowState = this.windows.find((candidate) => candidate.id === windowId);
    if (!windowState) {
      throw new Error(`Unknown fake window: ${windowId}`);
    }
    return windowState;
  }
}
