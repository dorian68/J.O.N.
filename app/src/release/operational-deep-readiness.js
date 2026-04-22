import fs from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT, RELEASE_ROOT, REAL_SURFACE_VALIDATION_ROOT } from "../config.js";
import { validateOperationalDeepSkills } from "../capabilities/skill-validation-harness.js";
import { ensureDir, readJson, writeJson, writeText } from "../utils/files.js";
import { buildRealSurfaceValidationSummary } from "../validation/real-surface-summary.js";

export const OPERATIONAL_DEEP_FIELD_SCENARIOS = Object.freeze([
  {
    id: "explorer.deep.file_observe_and_mutation",
    skillId: "skill.explorer",
    label: "Explorer read/write/mutation proof",
    requiredEvidence: ["directory_listing", "rollback_manifest", "action_log"],
    relatedAdvancedScenarios: ["file_explorer_observe_readonly"],
    relatedRealSurfaceScenarios: ["bounded_local_window_observation"]
  },
  {
    id: "notepad.deep.open_type_save_verify",
    skillId: "skill.notepad",
    label: "Notepad open/type/capture/persist proof",
    requiredEvidence: ["visible_window_after_launch", "post_type_capture", "written_file_or_text_preview"],
    relatedAdvancedScenarios: ["text_editor_draft_capture"],
    relatedRealSurfaceScenarios: ["bounded_local_window_observation"]
  },
  {
    id: "browser.deep.search_capture_verify",
    skillId: "skill.browser",
    label: "Browser search/navigation/capture proof",
    requiredEvidence: ["browser_window_capture", "query_or_url_visible", "action_log"],
    relatedAdvancedScenarios: ["browser_search_capture_sequence"],
    relatedRealSurfaceScenarios: ["bounded_real_web_research"]
  },
  {
    id: "app_launch.deep.detect_launch_focus",
    skillId: "skill.app_launch",
    label: "App detection, launch and focus proof",
    requiredEvidence: ["app_inventory", "visible_window_after_launch", "focus_after_capture"],
    relatedAdvancedScenarios: ["text_editor_draft_capture", "calculator_result_capture"],
    relatedRealSurfaceScenarios: ["bounded_local_window_observation"]
  },
  {
    id: "review_capture.deep.before_after_proof",
    skillId: "skill.review_capture",
    label: "Review/capture before-after proof",
    requiredEvidence: ["window_capture", "capture_manifest", "before_after_pair"],
    relatedAdvancedScenarios: ["active_window_ocr_extract", "semantic_button_targeting"],
    relatedRealSurfaceScenarios: ["bounded_local_window_observation"]
  },
  {
    id: "clipboard_transfer.deep.visible_transfer",
    skillId: "skill.clipboard_transfer",
    label: "Clipboard/transfer visible proof",
    requiredEvidence: ["source_surface", "target_surface", "post_transfer_capture"],
    relatedAdvancedScenarios: ["text_editor_draft_capture"],
    relatedRealSurfaceScenarios: []
  },
  {
    id: "terminal_guarded.deep.command_preview_output",
    skillId: "skill.terminal_guarded",
    label: "Terminal guarded command proof",
    requiredEvidence: ["command_preview", "approval_record", "post_command_capture"],
    relatedAdvancedScenarios: ["blocked_sensitive_action_recovery"],
    relatedRealSurfaceScenarios: []
  },
  {
    id: "forms_basic.deep.field_fill_stop_before_submit",
    skillId: "skill.forms_basic",
    label: "Forms field-fill and stop-before-submit proof",
    requiredEvidence: ["before_capture", "post_field_capture", "approval_record_for_submit"],
    relatedAdvancedScenarios: ["semantic_button_targeting", "blocked_sensitive_action_recovery"],
    relatedRealSurfaceScenarios: []
  }
]);

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function scenarioById(items = []) {
  return new Map(items.map((item) => [item.id ?? item.scenarioId, item]));
}

function scenarioProofStatus({ scenario, advancedDesktopReport, realSurfaceSummary }) {
  const advanced = scenarioById(advancedDesktopReport?.scenarios ?? []);
  const realRecords = scenarioById(realSurfaceSummary?.scenarios ?? realSurfaceSummary?.records ?? []);
  const advancedMatches = scenario.relatedAdvancedScenarios
    .map((id) => advanced.get(id))
    .filter(Boolean);
  const realMatches = scenario.relatedRealSurfaceScenarios
    .map((id) => realRecords.get(id))
    .filter(Boolean);
  const advancedReady = advancedMatches.some((match) => match.status === "ready");
  const realPassed = realMatches.some((match) => ["pass", "passed"].includes(match.result ?? match.status));
  const advancedMode = advancedDesktopReport?.executionMode ?? null;
  const hasRealSafeProbe = advancedReady && advancedMode === "real_safe_capability_probe";
  const hasFixtureProbe = advancedReady && advancedMode === "fixture_capability_probe";
  let status = "missing";
  let proofLevel = "missing";
  if (realPassed && hasRealSafeProbe) {
    status = "field_supported";
    proofLevel = "real_surface_plus_real_safe_probe";
  } else if (realPassed || hasRealSafeProbe) {
    status = "partial";
    proofLevel = realPassed ? "real_surface_summary_only" : "real_safe_probe_only";
  } else if (hasFixtureProbe) {
    status = "contract_backed_by_fixture_probe";
    proofLevel = "fixture_probe_only";
  }
  return {
    ...scenario,
    status,
    proofLevel,
    advancedMatches: advancedMatches.map((match) => ({
      id: match.id,
      status: match.status,
      executionMode: advancedMode,
      missingCapabilities: match.missingCapabilities ?? []
    })),
    realSurfaceMatches: realMatches.map((match) => ({
      id: match.id ?? match.scenarioId,
      status: match.result ?? match.status,
      evidencePath: match.evidencePath ?? match.recordPath ?? null
    }))
  };
}

function classifyProductOperationalDeep({ skillValidation, fieldScenarios }) {
  const allContractsPass = skillValidation.status === "all_passed";
  const fieldSupported = fieldScenarios.filter((scenario) => scenario.status === "field_supported").length;
  const partial = fieldScenarios.filter((scenario) => scenario.status === "partial").length;
  const fixtureOnly = fieldScenarios.filter((scenario) => scenario.status === "contract_backed_by_fixture_probe").length;
  const missing = fieldScenarios.filter((scenario) => scenario.status === "missing").length;
  const fieldProofStatus = missing === 0 && partial === 0 && fixtureOnly === 0
    ? "field_validated"
    : fieldSupported > 0 || partial > 0 || fixtureOnly > 0
      ? "partial"
      : "missing";
  const implementationStatus = allContractsPass
    ? "operational_deep_contract"
    : "not_operational_deep";
  return {
    implementationStatus,
    fieldProofStatus,
    allContractsPass,
    fieldSupported,
    partial,
    fixtureOnly,
    missing,
    isJonOperationalDeepImplemented: allContractsPass,
    isJonOperationalDeepFieldProven: fieldProofStatus === "field_validated"
  };
}

function markdownReport(report) {
  return [
    "# JON Operational Deep Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Implementation status: ${report.classification.implementationStatus}`,
    `Field proof status: ${report.classification.fieldProofStatus}`,
    "",
    "## Contract Validation",
    "",
    `- built-in skills: ${report.skillValidation.passed}/${report.skillValidation.skillCount}`,
    `- status: ${report.skillValidation.status}`,
    `- proof level: ${report.skillValidation.proofLevel}`,
    "",
    "## Field Scenarios",
    "",
    ...report.fieldScenarios.map((scenario) => [
      `### ${scenario.label}`,
      "",
      `- id: ${scenario.id}`,
      `- skill: ${scenario.skillId}`,
      `- status: ${scenario.status}`,
      `- proofLevel: ${scenario.proofLevel}`,
      `- required evidence: ${scenario.requiredEvidence.join(", ")}`
    ].join("\n")),
    "",
    "## Boundary",
    "",
    "JON is operational_deep at implementation-contract level when all built-in skills pass the harness.",
    "Production-grade field reliability still requires long real-user scenario evidence on target machines."
  ].join("\n");
}

export async function buildOperationalDeepReadinessReport(options = {}) {
  const skillValidation = options.skillValidation ?? validateOperationalDeepSkills();
  const advancedDesktopReport = Object.hasOwn(options, "advancedDesktopReport")
    ? options.advancedDesktopReport
    : await readJsonIfExists(
      path.join(DATA_ROOT, "validation", "advanced-desktop", "advanced-desktop-scenarios-latest.json")
    );
  const realSurfaceSummary = Object.hasOwn(options, "realSurfaceSummary")
    ? options.realSurfaceSummary
    : await buildRealSurfaceValidationSummary({
      rootPath: options.realSurfaceRoot ?? REAL_SURFACE_VALIDATION_ROOT
    }).catch(() => null);
  const fieldScenarios = OPERATIONAL_DEEP_FIELD_SCENARIOS.map((scenario) => scenarioProofStatus({
    scenario,
    advancedDesktopReport,
    realSurfaceSummary
  }));
  const classification = classifyProductOperationalDeep({
    skillValidation,
    fieldScenarios
  });
  return {
    generatedAt: new Date().toISOString(),
    status: classification.isJonOperationalDeepImplemented ? "pass" : "fail",
    scope: "jon_product_operational_deep",
    definition: {
      implementationStatus: "All built-in foundation skills have operational_deep contracts and pass the deterministic repository harness.",
      fieldProofStatus: "Long real-surface scenario evidence proving the contracts on target machines."
    },
    classification,
    skillValidation,
    evidenceSources: {
      advancedDesktopReportPath: advancedDesktopReport ? path.join(DATA_ROOT, "validation", "advanced-desktop", "advanced-desktop-scenarios-latest.json") : null,
      advancedDesktopExecutionMode: advancedDesktopReport?.executionMode ?? null,
      realSurfaceSummaryStatus: realSurfaceSummary?.overallStatus ?? null,
      realSurfaceSummaryPath: realSurfaceSummary?.latestPath ?? null
    },
    fieldScenarios,
    nextRequiredProof: fieldScenarios
      .filter((scenario) => scenario.status !== "field_supported")
      .map((scenario) => ({
        id: scenario.id,
        skillId: scenario.skillId,
        requiredEvidence: scenario.requiredEvidence,
        reason: scenario.status === "missing"
          ? "No sufficient real-surface or real-safe probe evidence is recorded."
          : "Evidence exists but is not complete enough for field validation."
      }))
  };
}

export async function persistOperationalDeepReadinessReport(report) {
  await ensureDir(RELEASE_ROOT);
  const stamped = report.generatedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(RELEASE_ROOT, `operational-deep-readiness-${stamped}.json`);
  const latestPath = path.join(RELEASE_ROOT, "operational-deep-readiness-latest.json");
  const markdownPath = path.join(RELEASE_ROOT, "operational-deep-readiness-latest.md");
  await writeJson(outputPath, report);
  await writeJson(latestPath, report);
  await writeText(markdownPath, markdownReport(report));
  return {
    outputPath,
    latestPath,
    markdownPath
  };
}

export async function readLatestOperationalDeepReadiness() {
  const latestPath = path.join(RELEASE_ROOT, "operational-deep-readiness-latest.json");
  try {
    return JSON.parse(await fs.readFile(latestPath, "utf8"));
  } catch {
    return null;
  }
}
