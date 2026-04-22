import fs from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { nowIso } from "../utils/ids.js";
import { ComputerControlService } from "../computer/computer-control-service.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";
import { desktopSandboxSummary } from "../computer/desktop-safety.js";

export const ADVANCED_DESKTOP_SCENARIOS = Object.freeze([
  {
    id: "browser_search_capture_sequence",
    label: "Browser search plus proof capture",
    mission: "Open a supported browser, search for a bounded topic, capture visible proof, and summarize what was verified.",
    requiredCapabilities: ["browser", "screen_capture", "accessibility", "ocr_or_accessibility_text"],
    proofRequirements: ["browser inventory", "desktop snapshot", "screenshot", "OCR/accessibility text"]
  },
  {
    id: "browser_compare_then_next_run",
    label: "Browser comparison with next-run handoff",
    mission: "Research two allowlisted pages, compare them, then recommend the next bounded screenshot or filing step.",
    requiredCapabilities: ["browser", "multi_run_handoff", "evidence_manifest"],
    proofRequirements: ["source evidence", "run handoff decision", "artifact links"]
  },
  {
    id: "text_editor_draft_capture",
    label: "Text editor draft and capture",
    mission: "Open a local text editor, draft a short note, verify the note is visible, and capture proof.",
    requiredCapabilities: ["text_editor", "typing", "accessibility", "screen_capture"],
    proofRequirements: ["app inventory", "approval log", "typed action checkpoint", "screenshot"]
  },
  {
    id: "file_explorer_observe_readonly",
    label: "File Explorer read-only observation",
    mission: "Observe a local folder surface, identify what is visible, and capture proof without modifying files.",
    requiredCapabilities: ["file_manager", "readonly_observation", "screen_capture"],
    proofRequirements: ["app inventory", "readonly safety decision", "screenshot"]
  },
  {
    id: "calculator_result_capture",
    label: "Calculator visible result capture",
    mission: "Open calculator, perform a bounded visible calculation, verify the displayed result, and capture proof.",
    requiredCapabilities: ["calculator", "semantic_targeting", "screen_capture"],
    proofRequirements: ["app inventory", "semantic target evidence", "result proof"]
  },
  {
    id: "active_window_ocr_extract",
    label: "Active window OCR extraction",
    mission: "Capture the active window, extract visible text with OCR/accessibility, and report what was read.",
    requiredCapabilities: ["active_window", "screen_capture", "ocr_or_accessibility_text"],
    proofRequirements: ["window capture", "OCR/accessibility result", "extraction summary"]
  },
  {
    id: "semantic_button_targeting",
    label: "Semantic button targeting",
    mission: "Find a visible button or menu item by semantic label, request approval, click it, and verify the post-action state.",
    requiredCapabilities: ["accessibility", "semantic_targeting", "approval", "checkpoint_recovery"],
    proofRequirements: ["semantic target candidates", "approval record", "before/after checkpoint"]
  },
  {
    id: "blocked_sensitive_action_recovery",
    label: "Blocked sensitive action recovery",
    mission: "Detect a request that would submit, delete, install, or enter credentials, block it, and explain the safe alternative.",
    requiredCapabilities: ["safety_policy", "recovery", "operator_explanation"],
    proofRequirements: ["policy block event", "recovery note", "no-action proof"]
  }
]);

function appMatches(application, scenarioId) {
  const text = [application.id, application.label, application.kind, application.processName].join(" ").toLowerCase();
  if (scenarioId.includes("browser")) {
    return text.includes("browser") || text.includes("chrome") || text.includes("edge") || text.includes("firefox") || text.includes("brave");
  }
  if (scenarioId.includes("text_editor")) {
    return text.includes("notepad") || text.includes("bloc") || text.includes("notes") || text.includes("text");
  }
  if (scenarioId.includes("file_explorer")) {
    return text.includes("explorer") || text.includes("file") || text.includes("fichier") || text.includes("dossier");
  }
  if (scenarioId.includes("calculator")) {
    return text.includes("calculator") || text.includes("calculatrice") || text.includes("calc");
  }
  return false;
}

function capabilityStatus({ scenario, apps, browsers, desktopSnapshot, screenCapture, ocr }) {
  const matchedApps = apps.filter((application) => appMatches(application, scenario.id));
  const accessibilityAvailable = desktopSnapshot.windows.some((windowState) => windowState.accessibility?.available);
  const semanticTargetCount = desktopSnapshot.windows.reduce((count, windowState) => count + (windowState.semanticTargets?.length ?? 0), 0);
  const capabilities = {
    browser: browsers.length > 0,
    text_editor: matchedApps.length > 0,
    file_manager: matchedApps.length > 0,
    calculator: matchedApps.length > 0,
    active_window: Boolean(desktopSnapshot.activeWindow),
    screen_capture: Boolean(screenCapture?.outputPath),
    accessibility: accessibilityAvailable,
    ocr_or_accessibility_text: Boolean(ocr?.available || accessibilityAvailable),
    semantic_targeting: semanticTargetCount > 0,
    approval: true,
    checkpoint_recovery: true,
    safety_policy: true,
    recovery: true,
    operator_explanation: true,
    readonly_observation: true,
    typing: true,
    evidence_manifest: true,
    multi_run_handoff: true
  };
  const missing = scenario.requiredCapabilities.filter((capability) => !capabilities[capability]);
  return {
    status: missing.length === 0 ? "ready" : missing.length < scenario.requiredCapabilities.length ? "partial" : "blocked",
    missingCapabilities: missing,
    matchedApplications: matchedApps.slice(0, 5).map((application) => ({
      id: application.id,
      label: application.label,
      kind: application.kind ?? "application"
    })),
    semanticTargetCount,
    accessibilityAvailable,
    ocrAvailable: Boolean(ocr?.available)
  };
}

function fixtureProvider() {
  return new FakeWindowProvider([
    {
      id: "win_browser",
      title: "Fixture Browser - Example",
      active: true,
      allowlisted: true,
      content: "Example Domain Search button Result list",
      processName: "msedge",
      controls: [
        { id: "query", name: "Search query", controlType: "ControlType.Edit" },
        { id: "search", name: "Search", controlType: "ControlType.Button" }
      ]
    },
    {
      id: "win_notes",
      title: "Fixture Notes",
      active: false,
      allowlisted: true,
      content: "Draft note area",
      processName: "notepad",
      controls: [
        { id: "editor", name: "Text editor", controlType: "ControlType.Edit" }
      ]
    }
  ], {
    applications: [
      { id: "notepad", label: "Notepad", kind: "text_editor", processName: "notepad" },
      { id: "calculator", label: "Calculator", kind: "utility", processName: "CalculatorApp" },
      { id: "file_explorer", label: "File Explorer", kind: "file_manager", processName: "explorer" }
    ],
    browsers: [
      { id: "edge", label: "Microsoft Edge", processName: "msedge" }
    ]
  });
}

export async function runAdvancedDesktopScenarioPack({ realSafe = false } = {}) {
  const outputRoot = path.join(DATA_ROOT, "validation", "advanced-desktop");
  await ensureDir(outputRoot);
  const provider = realSafe ? new PowerShellWindowProvider() : fixtureProvider();
  const computer = new ComputerControlService(provider);
  const apps = await computer.listInstalledApplications();
  const browsers = await computer.listInstalledBrowsers();
  const desktopSnapshot = await computer.inspectDesktop({
    maxWindows: realSafe ? 5 : 4,
    maxDepth: 2,
    maxNodes: 60
  });
  const screenCapture = await computer.captureScreen();
  const ocr = screenCapture?.outputPath
    ? await computer.extractTextFromImage(screenCapture.outputPath).catch((error) => ({
      available: false,
      reason: error.message,
      text: "",
      lines: [],
      words: []
    }))
    : {
      available: false,
      reason: "No screen capture path available.",
      text: "",
      lines: [],
      words: []
    };

  const scenarios = ADVANCED_DESKTOP_SCENARIOS.map((scenario) => ({
    ...scenario,
    executionMode: realSafe ? "real_safe_capability_probe" : "fixture_capability_probe",
    ...capabilityStatus({
      scenario,
      apps,
      browsers,
      desktopSnapshot,
      screenCapture,
      ocr
    })
  }));
  const report = {
    generatedAt: nowIso(),
    status: scenarios.every((scenario) => scenario.status === "ready") ? "ready" : "partial",
    executionMode: realSafe ? "real_safe_capability_probe" : "fixture_capability_probe",
    note: realSafe
      ? "This probe captures real local desktop evidence without launching or mutating apps."
      : "This probe validates the scenario pack against fixture capabilities only.",
    sandbox: desktopSandboxSummary(),
    environment: {
      appCount: apps.length,
      browserCount: browsers.length,
      visibleWindowCount: desktopSnapshot.visibleWindowCount,
      inspectedWindowCount: desktopSnapshot.windows.length,
      activeWindowTitle: desktopSnapshot.activeWindow?.title ?? null
    },
    proofs: {
      screenCapturePath: screenCapture?.outputPath ?? null,
      ocrAvailable: Boolean(ocr?.available),
      ocrEngine: ocr?.engine ?? null,
      ocrTextPreview: String(ocr?.text ?? "").slice(0, 500),
      accessibilityWindows: desktopSnapshot.windows.filter((windowState) => windowState.accessibility?.available).length,
      semanticTargetCount: desktopSnapshot.windows.reduce((count, windowState) => count + (windowState.semanticTargets?.length ?? 0), 0)
    },
    scenarios
  };
  const reportPath = path.join(outputRoot, `advanced-desktop-scenarios-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  const latestPath = path.join(outputRoot, "advanced-desktop-scenarios-latest.json");
  await writeJson(reportPath, report);
  await writeJson(latestPath, report);
  await fs.writeFile(path.join(outputRoot, "advanced-desktop-scenarios-latest.md"), [
    "# Advanced Desktop Scenario Pack",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Mode: ${report.executionMode}`,
    "",
    "## Scenarios",
    ...report.scenarios.map((scenario) => [
      "",
      `### ${scenario.label}`,
      "",
      `- id: ${scenario.id}`,
      `- status: ${scenario.status}`,
      `- missing: ${scenario.missingCapabilities.join(", ") || "none"}`,
      `- mission: ${scenario.mission}`
    ].join("\n"))
  ].join("\n"), "utf8");
  return {
    report,
    reportPath,
    latestPath
  };
}
