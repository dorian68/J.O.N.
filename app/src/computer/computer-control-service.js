import path from "node:path";
import { EVIDENCE_TYPE, TEMP_RUNTIME_ROOT } from "../config.js";
import { createId, nowIso } from "../utils/ids.js";
import { ensureDir, writeJson } from "../utils/files.js";
import {
  buildSemanticTargets,
  comparePerception,
  resolveSemanticTarget,
  summarizeAccessibility
} from "./desktop-perception.js";
import { executeFilePrimitive } from "./file-primitives.js";

async function persistSyntheticCapture(kind, payload) {
  await ensureDir(TEMP_RUNTIME_ROOT);
  const outputPath = path.join(TEMP_RUNTIME_ROOT, `${kind}-${createId("capture")}.json`);
  await writeJson(outputPath, {
    syntheticCapture: true,
    kind,
    createdAt: nowIso(),
    payload
  });
  return outputPath;
}

export class ComputerControlService {
  constructor(provider) {
    this.provider = provider;
  }

  listVisibleWindows() {
    return this.provider.listVisibleWindows();
  }

  detectActiveWindow() {
    return this.provider.detectActiveWindow();
  }

  listInstalledBrowsers() {
    return this.provider.listInstalledBrowsers?.() ?? [];
  }

  listInstalledApplications() {
    return this.provider.listInstalledApplications?.() ?? [];
  }

  focusWindow(windowId) {
    return this.provider.focusWindow(windowId);
  }

  launchBrowser(browserId, options = {}) {
    if (!this.provider.launchBrowser) {
      throw new Error("This computer provider does not support browser launch.");
    }
    return this.provider.launchBrowser(browserId, options);
  }

  launchApplication(appId, options = {}) {
    if (!this.provider.launchApplication) {
      throw new Error("This computer provider does not support application launch.");
    }
    return this.provider.launchApplication(appId, options);
  }

  typeText(windowId, text) {
    if (!this.provider.typeText) {
      throw new Error("This computer provider does not support text input.");
    }
    return this.provider.typeText(windowId, text);
  }

  sendHotkey(windowId, keys) {
    if (!this.provider.sendHotkey) {
      throw new Error("This computer provider does not support hotkeys.");
    }
    return this.provider.sendHotkey(windowId, keys);
  }

  clickPoint(windowId, point) {
    if (!this.provider.clickPoint) {
      throw new Error("This computer provider does not support pointer clicks.");
    }
    return this.provider.clickPoint(windowId, point);
  }

  scrollWindow(windowId, delta) {
    if (!this.provider.scrollWindow) {
      throw new Error("This computer provider does not support scrolling.");
    }
    return this.provider.scrollWindow(windowId, delta);
  }

  async captureWindow(windowId) {
    const capture = await this.provider.captureWindow(windowId);
    if (capture?.outputPath) {
      return capture;
    }
    return {
      ...(capture ?? {}),
      outputPath: await persistSyntheticCapture("window", {
        windowId,
        capture
      })
    };
  }

  async captureRegion(region) {
    const capture = await this.provider.captureRegion(region);
    if (capture?.outputPath) {
      return capture;
    }
    return {
      ...(capture ?? {}),
      outputPath: await persistSyntheticCapture("region", {
        region,
        capture
      })
    };
  }

  async captureScreen() {
    if (!this.provider.captureScreen) {
      return {
        outputPath: await persistSyntheticCapture("screen", {
          reason: "Provider does not expose a full-screen capture primitive."
        }),
        syntheticCapture: true
      };
    }
    const capture = await this.provider.captureScreen();
    if (capture?.outputPath) {
      return capture;
    }
    return {
      ...(capture ?? {}),
      outputPath: await persistSyntheticCapture("screen", {
        capture
      }),
      syntheticCapture: true
    };
  }

  async extractTextFromImage(imagePath) {
    if (!this.provider.ocrImage) {
      return {
        available: false,
        engine: "unavailable",
        reason: "Provider does not expose an OCR primitive.",
        text: "",
        lines: [],
        words: []
      };
    }
    return this.provider.ocrImage(imagePath);
  }

  async inspectVisibleUi(windowId) {
    const inspection = await this.provider.inspectVisibleUi(windowId);
    const accessibilitySummary = summarizeAccessibility(inspection?.accessibility ?? null);
    return {
      ...inspection,
      accessibilitySummary,
      semanticTargets: buildSemanticTargets(inspection?.accessibility ?? null)
    };
  }

  async inspectAccessibilityTree(windowId, options = {}) {
    if (this.provider.inspectAccessibilityTree) {
      return this.provider.inspectAccessibilityTree(windowId, options);
    }
    const inspection = await this.inspectVisibleUi(windowId);
    return inspection?.accessibility ?? {
      available: false,
      reason: "Provider does not expose an accessibility tree.",
      tree: null
    };
  }

  async inspectDesktop({ maxWindows = 6, maxDepth = 2, maxNodes = 60 } = {}) {
    const visibleWindows = await this.listVisibleWindows();
    const activeWindow = await this.detectActiveWindow();
    const activeId = activeWindow?.id ?? null;
    const prioritized = [
      ...visibleWindows.filter((windowState) => windowState.id === activeId),
      ...visibleWindows.filter((windowState) => windowState.id !== activeId)
    ].slice(0, maxWindows);
    const windows = [];
    for (const windowState of prioritized) {
      const accessibility = await this.inspectAccessibilityTree(windowState.id, {
        maxDepth,
        maxNodes
      }).catch((error) => ({
        available: false,
        reason: error.message,
        tree: null
      }));
      const accessibilitySummary = summarizeAccessibility(accessibility);
      windows.push({
        ...windowState,
        isActive: windowState.id === activeId,
        accessibility,
        accessibilitySummary,
        semanticTargets: accessibilitySummary.semanticTargets
      });
    }
    return {
      capturedAt: nowIso(),
      activeWindow,
      visibleWindowCount: visibleWindows.length,
      windows,
      omittedWindowCount: Math.max(0, visibleWindows.length - windows.length)
    };
  }

  async buildWindowVisionSnapshot(windowId, { capture = true, maxDepth = 3, maxNodes = 100 } = {}) {
    const [inspection, screenshot] = await Promise.all([
      this.inspectVisibleUi(windowId).catch((error) => ({
        windowId,
        available: false,
        reason: error.message
      })),
      capture ? this.captureWindow(windowId).catch((error) => ({
        outputPath: null,
        error: error.message
      })) : null
    ]);
    const accessibility = await this.inspectAccessibilityTree(windowId, {
      maxDepth,
      maxNodes
    }).catch((error) => ({
      available: false,
      reason: error.message,
      tree: null
    }));
    const ocr = screenshot?.outputPath
      ? await this.extractTextFromImage(screenshot.outputPath).catch((error) => ({
        available: false,
        engine: "windows_media_ocr",
        reason: error.message,
        text: "",
        lines: [],
        words: []
      }))
      : {
        available: false,
        engine: "unavailable",
        reason: "No screenshot path was available for OCR.",
        text: "",
        lines: [],
        words: []
      };
    const accessibilitySummary = summarizeAccessibility(accessibility);
    return {
      capturedAt: nowIso(),
      windowId,
      title: inspection?.title ?? null,
      bounds: inspection?.bounds ?? null,
      screenshot,
      accessibility,
      accessibilitySummary,
      semanticTargets: accessibilitySummary.semanticTargets,
      ocr
    };
  }

  async resolveSemanticTarget(windowId, selector, options = {}) {
    const accessibility = await this.inspectAccessibilityTree(windowId, {
      maxDepth: options.maxDepth ?? 4,
      maxNodes: options.maxNodes ?? 160
    });
    return resolveSemanticTarget(accessibility, selector, options);
  }

  comparePerception(before, after) {
    return comparePerception(before, after);
  }

  async waitForUiState(windowId, matcher, { timeoutMs = 3000, intervalMs = 100 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const inspection = await this.inspectVisibleUi(windowId);
      if (matcher(inspection)) {
        return {
          validated: true,
          ambiguous: false,
          inspection
        };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return {
      validated: false,
      ambiguous: true,
      inspection: await this.inspectVisibleUi(windowId)
    };
  }

  async waitForVisibleWindowMatch(matcher, { timeoutMs = 4000, intervalMs = 120 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const visibleWindows = await this.listVisibleWindows();
      const matchedWindow = visibleWindows.find((windowState) => matcher(windowState)) ?? null;
      if (matchedWindow) {
        return {
          validated: true,
          ambiguous: false,
          matchedWindow,
          visibleWindows
        };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const visibleWindows = await this.listVisibleWindows();
    return {
      validated: false,
      ambiguous: true,
      matchedWindow: visibleWindows.find((windowState) => matcher(windowState)) ?? null,
      visibleWindows
    };
  }

  verifyVisibleOutcome(before, after, predicate) {
    const validated = predicate(before, after);
    return {
      validated,
      ambiguous: !validated,
      observed: {
        before,
        after
      }
    };
  }

  async detectBlockingOverlay(windowId) {
    return this.provider.detectBlockingOverlay(windowId);
  }

  async executeFilePrimitive(step, options = {}) {
    return executeFilePrimitive(step, options);
  }

  async exportActionEvidence(evidenceDir, label, payload) {
    const evidenceId = createId("ev");
    const outputPath = path.join(evidenceDir, `${label}-${evidenceId}.json`);
    await writeJson(outputPath, {
      evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
      label,
      createdAt: nowIso(),
      payload
    });
    return {
      evidenceId,
      evidenceType: EVIDENCE_TYPE.ACTION_SUMMARY,
      outputPath
    };
  }
}
