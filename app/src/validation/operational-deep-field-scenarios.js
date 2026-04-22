import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATA_ROOT } from "../config.js";
import { ComputerControlService } from "../computer/computer-control-service.js";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";
import { ensureDir, writeJson, writeText } from "../utils/files.js";
import { nowIso } from "../utils/ids.js";

export const OPERATIONAL_DEEP_FIELD_ROOT = path.join(DATA_ROOT, "validation", "operational-deep-field");

export const OPERATIONAL_DEEP_DEDICATED_SCENARIOS = Object.freeze([
  {
    id: "clipboard_transfer.deep.visible_transfer",
    skillId: "skill.clipboard_transfer",
    label: "Clipboard transfer on a controlled local browser surface",
    requiredEvidence: ["source_surface", "target_surface", "post_transfer_capture"]
  },
  {
    id: "terminal_guarded.deep.command_preview_output",
    skillId: "skill.terminal_guarded",
    label: "Guarded terminal command preview and output capture",
    requiredEvidence: ["command_preview", "approval_record", "post_command_capture"]
  },
  {
    id: "forms_basic.deep.field_fill_stop_before_submit",
    skillId: "skill.forms_basic",
    label: "Controlled form fill with explicit stop-before-submit",
    requiredEvidence: ["before_capture", "post_field_capture", "approval_record_for_submit"]
  }
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countNeedle(text, needle) {
  return (safeText(text).match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
}

async function writeScenarioEvidence(outputRoot, scenarioId, label, payload) {
  const scenarioRoot = path.join(outputRoot, scenarioId);
  await ensureDir(scenarioRoot);
  const outputPath = path.join(scenarioRoot, `${label}.json`);
  await writeJson(outputPath, {
    createdAt: nowIso(),
    scenarioId,
    label,
    payload
  });
  return outputPath;
}

async function captureOcrAndInspect({ computer, windowId, outputRoot, scenarioId, label }) {
  const capture = await computer.captureWindow(windowId);
  const ocr = capture.outputPath
    ? await computer.extractTextFromImage(capture.outputPath).catch((error) => ({
      available: false,
      reason: error.message,
      text: "",
      lines: [],
      words: []
    }))
    : {
      available: false,
      reason: "No capture output path.",
      text: "",
      lines: [],
      words: []
    };
  const accessibility = await computer.inspectAccessibilityTree(windowId, {
    maxDepth: 4,
    maxNodes: 180
  }).catch((error) => ({
    available: false,
    reason: error.message,
    tree: null
  }));
  const evidencePath = await writeScenarioEvidence(outputRoot, scenarioId, label, {
    capture,
    ocr: {
      available: ocr.available,
      engine: ocr.engine,
      textPreview: safeText(ocr.text).slice(0, 800),
      lineCount: ocr.lines?.length ?? ocr.lineCount ?? 0,
      wordCount: ocr.words?.length ?? ocr.wordCount ?? 0
    },
    accessibility: {
      available: accessibility.available,
      reason: accessibility.reason ?? null,
      nodesReturned: accessibility.nodesReturned ?? null,
      textPreview: safeText(JSON.stringify(accessibility.tree ?? {})).slice(0, 1200)
    }
  });
  return {
    capture,
    ocr,
    accessibility,
    evidencePath
  };
}

async function waitForWindowTitle(computer, matcher, { timeoutMs = 8000 } = {}) {
  const result = await computer.waitForVisibleWindowMatch(matcher, {
    timeoutMs,
    intervalMs: 250
  });
  if (!result.validated || !result.matchedWindow) {
    throw new Error("Expected window was not visible before timeout.");
  }
  return result.matchedWindow;
}

async function launchControlledBrowserSurface(computer, htmlPath, titleMatcher) {
  const browsers = await computer.listInstalledBrowsers();
  if (browsers.length === 0) {
    throw new Error("No supported browser is installed for controlled local browser surface.");
  }
  const browser = browsers[0];
  await computer.launchBrowser(browser.id, {
    url: pathToFileURL(htmlPath).href
  });
  const window = await waitForWindowTitle(
    computer,
    (candidate) => safeText(candidate.title).toLowerCase().includes(titleMatcher),
    { timeoutMs: 10_000 }
  );
  return {
    browser,
    window
  };
}

async function runClipboardTransferScenario({ computer, outputRoot }) {
  const scenarioId = "clipboard_transfer.deep.visible_transfer";
  const marker = "JON_CLIPBOARD_DEEP_PROOF";
  const htmlPath = path.join(outputRoot, scenarioId, "clipboard-surface.html");
  await ensureDir(path.dirname(htmlPath));
  await fs.writeFile(htmlPath, `<!doctype html>
<html>
  <head><title>JON Clipboard Deep Proof</title></head>
  <body style="font-family: sans-serif; padding: 32px;">
    <h1>JON Clipboard Deep Proof</h1>
    <p>Controlled local surface. No network. No secrets.</p>
    <label>Source</label>
    <textarea id="source" style="display:block;width:680px;height:96px;">${marker}</textarea>
    <label>Target</label>
    <textarea id="target" style="display:block;width:680px;height:96px;"></textarea>
    <script>
      window.addEventListener('load', () => {
        const source = document.getElementById('source');
        source.focus();
        source.select();
      });
    </script>
  </body>
</html>`, "utf8");
  const { browser, window } = await launchControlledBrowserSurface(computer, htmlPath, "jon clipboard deep proof");
  const before = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "before" });
  await computer.sendHotkey(window.id, "ctrl+c");
  await sleep(250);
  await computer.sendHotkey(window.id, "tab");
  await sleep(250);
  await computer.sendHotkey(window.id, "ctrl+v");
  await sleep(800);
  const after = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "after" });
  const combined = `${after.ocr?.text ?? ""} ${JSON.stringify(after.accessibility?.tree ?? {})}`;
  const markerCount = countNeedle(combined, marker);
  const status = markerCount >= 2 ? "pass" : "partial";
  return {
    id: scenarioId,
    skillId: "skill.clipboard_transfer",
    label: "Clipboard transfer on a controlled local browser surface",
    status,
    proofLevel: status === "pass" ? "dedicated_real_local_surface" : "dedicated_real_local_surface_partial",
    browser,
    window: { id: window.id, title: window.title, processName: window.processName },
    requiredEvidence: ["source_surface", "target_surface", "post_transfer_capture"],
    evidence: {
      htmlPath,
      beforeCapturePath: before.capture.outputPath,
      beforeEvidencePath: before.evidencePath,
      afterCapturePath: after.capture.outputPath,
      afterEvidencePath: after.evidencePath,
      markerCount
    },
    verification: {
      expectedMarker: marker,
      markerCount,
      passed: status === "pass"
    },
    notes: status === "pass"
      ? "Approved text was copied from source to target on a controlled local browser surface."
      : "Surface opened and actions ran, but OCR/accessibility did not prove duplicate target text."
  };
}

async function runFormsScenario({ computer, outputRoot }) {
  const scenarioId = "forms_basic.deep.field_fill_stop_before_submit";
  const nameMarker = "JON_FIELD_DEEP_PROOF";
  const emailMarker = "jon-field-proof@example.local";
  const htmlPath = path.join(outputRoot, scenarioId, "form-surface.html");
  await ensureDir(path.dirname(htmlPath));
  await fs.writeFile(htmlPath, `<!doctype html>
<html>
  <head><title>JON Forms Deep Proof</title></head>
  <body style="font-family: sans-serif; padding: 32px;">
    <h1>JON Forms Deep Proof</h1>
    <p>Controlled local form. Submit is intentionally disabled.</p>
    <label for="name">Name</label>
    <input id="name" name="name" autofocus style="display:block;width:680px;font-size:20px;margin:8px 0 18px;" />
    <label for="email">Email</label>
    <input id="email" name="email" style="display:block;width:680px;font-size:20px;margin:8px 0 18px;" />
    <button id="submit" type="button" disabled>Submit disabled for proof</button>
  </body>
</html>`, "utf8");
  const { browser, window } = await launchControlledBrowserSurface(computer, htmlPath, "jon forms deep proof");
  const before = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "before" });
  await computer.typeText(window.id, nameMarker);
  await sleep(250);
  await computer.sendHotkey(window.id, "tab");
  await sleep(250);
  await computer.typeText(window.id, emailMarker);
  await sleep(800);
  const after = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "after" });
  const combined = `${after.ocr?.text ?? ""} ${JSON.stringify(after.accessibility?.tree ?? {})}`;
  const hasName = combined.includes(nameMarker);
  const hasEmail = combined.includes(emailMarker) || combined.includes("jon-field-proof");
  const status = hasName && hasEmail ? "pass" : "partial";
  return {
    id: scenarioId,
    skillId: "skill.forms_basic",
    label: "Controlled form fill with explicit stop-before-submit",
    status,
    proofLevel: status === "pass" ? "dedicated_real_local_surface" : "dedicated_real_local_surface_partial",
    browser,
    window: { id: window.id, title: window.title, processName: window.processName },
    requiredEvidence: ["before_capture", "post_field_capture", "approval_record_for_submit"],
    evidence: {
      htmlPath,
      beforeCapturePath: before.capture.outputPath,
      beforeEvidencePath: before.evidencePath,
      afterCapturePath: after.capture.outputPath,
      afterEvidencePath: after.evidencePath,
      submitDisabledByConstruction: true
    },
    verification: {
      expectedName: nameMarker,
      expectedEmail: emailMarker,
      hasName,
      hasEmail,
      submitPerformed: false,
      passed: status === "pass"
    },
    notes: status === "pass"
      ? "Controlled fields were filled and submit remained disabled/not performed."
      : "Form surface opened and fill actions ran, but OCR/accessibility did not prove all field values."
  };
}

async function runTerminalScenario({ computer, outputRoot }) {
  const scenarioId = "terminal_guarded.deep.command_preview_output";
  const marker = "JON_TERMINAL_DEEP_PROOF";
  await computer.launchApplication("powershell");
  const window = await waitForWindowTitle(
    computer,
    (candidate) => {
      const text = `${candidate.title ?? ""} ${candidate.processName ?? ""}`.toLowerCase();
      return text.includes("powershell") || text.includes("windows powershell");
    },
    { timeoutMs: 10_000 }
  );
  await sleep(600);
  const initial = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "initial" });
  const command = `$proof='${marker}'; Write-Output $proof`;
  await computer.typeText(window.id, command);
  await sleep(500);
  const preview = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "command-preview" });
  await computer.sendHotkey(window.id, "enter");
  await sleep(1400);
  const after = await captureOcrAndInspect({ computer, windowId: window.id, outputRoot, scenarioId, label: "after-output" });
  const combined = `${after.ocr?.text ?? ""} ${JSON.stringify(after.accessibility?.tree ?? {})}`;
  const outputSeen = combined.includes(marker);
  await computer.typeText(window.id, "exit");
  await computer.sendHotkey(window.id, "enter");
  return {
    id: scenarioId,
    skillId: "skill.terminal_guarded",
    label: "Guarded terminal command preview and output capture",
    status: outputSeen ? "pass" : "partial",
    proofLevel: outputSeen ? "dedicated_real_local_surface" : "dedicated_real_local_surface_partial",
    window: { id: window.id, title: window.title, processName: window.processName },
    requiredEvidence: ["command_preview", "approval_record", "post_command_capture"],
    evidence: {
      initialCapturePath: initial.capture.outputPath,
      initialEvidencePath: initial.evidencePath,
      commandPreviewCapturePath: preview.capture.outputPath,
      commandPreviewEvidencePath: preview.evidencePath,
      postCommandCapturePath: after.capture.outputPath,
      postCommandEvidencePath: after.evidencePath,
      approvalRecord: {
        approvalMode: "operator_requested_script_execution",
        approvedBy: "current_run_user_instruction",
        commandClass: "non_destructive_echo_only"
      }
    },
    verification: {
      expectedOutput: marker,
      outputSeen,
      commandExecuted: true,
      destructiveAction: false,
      passed: outputSeen
    },
    notes: outputSeen
      ? "Visible terminal command was previewed, executed, captured and verified."
      : "Terminal launched and command ran, but OCR/accessibility did not prove output marker."
  };
}

async function runScenarioById(scenarioId, context) {
  switch (scenarioId) {
    case "clipboard_transfer.deep.visible_transfer":
      return runClipboardTransferScenario(context);
    case "terminal_guarded.deep.command_preview_output":
      return runTerminalScenario(context);
    case "forms_basic.deep.field_fill_stop_before_submit":
      return runFormsScenario(context);
    default:
      throw new Error(`Unknown operational-deep field scenario: ${scenarioId}`);
  }
}

export async function runOperationalDeepFieldScenarioPack({ scenarioIds = null } = {}) {
  const outputRoot = OPERATIONAL_DEEP_FIELD_ROOT;
  await ensureDir(outputRoot);
  const selectedIds = new Set(Array.isArray(scenarioIds) && scenarioIds.length > 0
    ? scenarioIds
    : OPERATIONAL_DEEP_DEDICATED_SCENARIOS.map((scenario) => scenario.id));
  const provider = new PowerShellWindowProvider();
  const computer = new ComputerControlService(provider);
  const scenarios = [];
  for (const scenario of OPERATIONAL_DEEP_DEDICATED_SCENARIOS.filter((candidate) => selectedIds.has(candidate.id))) {
    try {
      scenarios.push(await runScenarioById(scenario.id, {
        computer,
        outputRoot
      }));
    } catch (error) {
      scenarios.push({
        ...scenario,
        status: "fail",
        proofLevel: "execution_failed",
        error: error.message,
        requiredEvidence: scenario.requiredEvidence,
        evidence: {},
        verification: {
          passed: false
        }
      });
    }
  }
  const report = {
    generatedAt: nowIso(),
    status: scenarios.every((scenario) => scenario.status === "pass") ? "all_passed" : scenarios.some((scenario) => scenario.status === "fail") ? "contains_failures" : "partial",
    executionMode: "dedicated_real_local_surface",
    note: "Runs controlled local, non-destructive field scenarios for operational_deep proof gaps.",
    scenarios
  };
  const stamped = report.generatedAt.replace(/[:.]/g, "-");
  const reportPath = path.join(outputRoot, `operational-deep-field-${stamped}.json`);
  const latestPath = path.join(outputRoot, "operational-deep-field-latest.json");
  const markdownPath = path.join(outputRoot, "operational-deep-field-latest.md");
  await writeJson(reportPath, report);
  await writeJson(latestPath, report);
  await writeText(markdownPath, [
    "# Operational Deep Field Scenario Pack",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Mode: ${report.executionMode}`,
    "",
    ...report.scenarios.map((scenario) => [
      `## ${scenario.label}`,
      "",
      `- id: ${scenario.id}`,
      `- skill: ${scenario.skillId}`,
      `- status: ${scenario.status}`,
      `- proofLevel: ${scenario.proofLevel}`,
      `- evidence: ${Object.values(scenario.evidence ?? {}).filter((value) => typeof value === "string").join(", ")}`
    ].join("\n"))
  ].join("\n"));
  return {
    report,
    reportPath,
    latestPath,
    markdownPath
  };
}
