import fs from "node:fs/promises";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";

function detail(label, passed, expected, observed, reason, refs = {}) {
  return {
    label,
    expected,
    observed,
    reason,
    refs,
    passed
  };
}

export async function runWindowsProviderDiagnostics() {
  if (process.platform !== "win32") {
    return {
      status: "skipped",
      summary: "Windows provider diagnostic skipped because the environment is not Windows.",
      assertions: {},
      assertionDetails: {},
      cases: []
    };
  }

  const provider = new PowerShellWindowProvider();
  try {
    const visibleWindows = await provider.listVisibleWindows();
    const activeWindow = await provider.detectActiveWindow();

    let focusResult = null;
    let inspection = null;
    let capture = null;

    if (activeWindow?.id) {
      focusResult = await provider.focusWindow(activeWindow.id);
      inspection = await provider.inspectVisibleUi(activeWindow.id);
      capture = await provider.captureWindow(activeWindow.id);
    }

    const captureReadable = capture?.outputPath
      ? await fs.access(capture.outputPath).then(() => true).catch(() => false)
      : false;

    const assertions = {
      providerResponsive: true,
      visibleWindowsListed: Array.isArray(visibleWindows) && visibleWindows.length >= 1,
      activeWindowDetected: Boolean(activeWindow?.id),
      focusRoundTrip: Boolean(activeWindow?.id && focusResult?.id === activeWindow.id),
      inspectVisibleUi: Boolean(inspection && typeof inspection.title === "string"),
      captureProducedAsset: captureReadable
    };

    const assertionDetails = {
      providerResponsive: detail(
        "PowerShell provider responded",
        true,
        "provider returns structured data",
        "structured responses received",
        "Provider returned results without raising an error."
      ),
      visibleWindowsListed: detail(
        "Visible windows listed",
        assertions.visibleWindowsListed,
        "At least one visible window",
        `${visibleWindows?.length ?? 0} window(s)`,
        assertions.visibleWindowsListed
          ? "Visible windows were enumerated."
          : "Provider did not return any visible window."
      ),
      activeWindowDetected: detail(
        "Active window detected",
        assertions.activeWindowDetected,
        "One active window",
        activeWindow?.title ?? null,
        assertions.activeWindowDetected
          ? "Active window was detected."
          : "Provider could not identify an active window."
      ),
      focusRoundTrip: detail(
        "Focus same active window",
        assertions.focusRoundTrip,
        activeWindow?.id ?? "same active window id",
        focusResult?.id ?? null,
        assertions.focusRoundTrip
          ? "Provider focused the same active window without context expansion."
          : "Provider could not re-focus the active window safely."
      ),
      inspectVisibleUi: detail(
        "Inspect visible UI",
        assertions.inspectVisibleUi,
        "Structured visible inspection",
        inspection?.title ?? null,
        assertions.inspectVisibleUi
          ? "Visible UI inspection returned structured output."
          : "Visible UI inspection did not return a usable payload."
      ),
      captureProducedAsset: detail(
        "Capture active window",
        assertions.captureProducedAsset,
        "Readable screenshot artifact",
        capture?.outputPath ?? null,
        assertions.captureProducedAsset
          ? "Window capture produced a readable artifact."
          : "Window capture did not produce a readable artifact.",
        { outputPath: capture?.outputPath ?? null }
      )
    };

    return {
      status: Object.values(assertions).every((value) => value === true) ? "pass" : "fail",
      summary: "Diagnostic of the bounded real Windows provider.",
      visibleWindows,
      activeWindow,
      capture,
      assertions,
      assertionDetails,
      cases: [
        {
          id: "active-window-diagnostic",
          label: "Active window observation/focus/proof",
          summary: "Checks the bounded real Windows provider without expanding the capability surface.",
          relatedEvidenceIds: [],
          relatedArtifactIds: [],
          relatedSourceIds: [],
          assertions,
          assertionDetails
        }
      ]
    };
  } catch (error) {
    return {
      status: "fail",
      summary: "Windows provider diagnostic failed to execute.",
      assertions: {
        providerResponsive: false
      },
      assertionDetails: {
        providerResponsive: detail(
          "PowerShell provider responded",
          false,
          "provider returns structured data",
          error.message,
          "Provider raised an error while executing the bounded diagnostic."
        )
      },
      error: {
        message: error.message,
        stack: error.stack
      },
      cases: [
        {
          id: "active-window-diagnostic",
          label: "Active window observation/focus/proof",
          summary: "Checks the bounded real Windows provider without expanding the capability surface.",
          assertions: {
            providerResponsive: false
          },
          assertionDetails: {
            providerResponsive: detail(
              "PowerShell provider responded",
              false,
              "provider returns structured data",
              error.message,
              "Provider raised an error while executing the bounded diagnostic."
            )
          }
        }
      ]
    };
  }
}
