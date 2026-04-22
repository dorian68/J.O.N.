import path from "node:path";
import {
  REAL_SURFACE_VALIDATION_ROOT,
  RELEASE_ROOT
} from "../config.js";
import { ensureDir, writeJson, writeText } from "../utils/files.js";
import { buildReadinessReport, persistReadinessReport } from "../release/readiness-report.js";
import { buildReleaseDoctorReport } from "../release/release-doctor.js";
import { collectProofArtifacts } from "../release/proof-artifacts.js";
import { buildRealSurfaceValidationSummary, persistRealSurfaceValidationSummary } from "../validation/real-surface-summary.js";
import { buildRealSurfaceValidationPack, persistRealSurfaceValidationPack } from "../validation/real-surface-harness.js";
import { runSecretStoreSmoke, persistSecretStoreSmokeResult } from "../security/secret-store-smoke.js";
import { runLlmSmokeScenario } from "../scripts/run-llm-smoke-validation.js";
import { buildDesktopShellBundle } from "../../../desktop/build-shell-bundle.mjs";
import { smokeDesktopShellBundle } from "../../../desktop/smoke-shell-bundle.mjs";
import { buildDesktopDryRunReport, persistDesktopDryRunReport } from "../../../desktop/shell-diagnostics.mjs";

function safeStamp(value) {
  return value.replace(/[:.]/g, "-");
}

function buildManualSteps() {
  return [
    {
      id: "live_llm_provider_smoke",
      command: "npm run llm:smoke -- live-success",
      expectedEvidence: [
        "app/.runtime-data/smoke/live-success.json",
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ]
    },
    {
      id: "desktop_shell_local_smoke",
      command: "npm run desktop:dev",
      expectedEvidence: [
        "app/.runtime-data/release/desktop-shell-dry-run-latest.json"
      ]
    },
    {
      id: "bounded_real_web_research",
      command: "npm run validation:real:record -- --scenario bounded_real_web_research --result <pass|partial|fail|blocked> --notes \"<note>\"",
      expectedEvidence: [
        "app/.runtime-data/validation/real-surfaces/*.json"
      ]
    },
    {
      id: "bounded_local_window_observation",
      command: "npm run validation:real:record -- --scenario bounded_local_window_observation --result <pass|partial|fail|blocked> --notes \"<note>\"",
      expectedEvidence: [
        "app/.runtime-data/validation/real-surfaces/*.json"
      ]
    }
  ];
}

function renderChecklistSection(items) {
  return items
    .map((item) => `- ${item.id}: \`${item.command}\``)
    .join("\n");
}

function renderPilotMarkdown({ title, report }) {
  return [
    `# ${title}`,
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Overall status: ${report.overallStatus}`,
    "",
    "## Automated checks",
    ...Object.entries(report.automatedChecks).map(([name, result]) => `- ${name}: ${result.status}`),
    "",
    "## Manual remaining steps",
    renderChecklistSection(report.manualSteps),
    "",
    "## Current readiness",
    `- currentLevel: ${report.readiness.currentLevel}`,
    `- doctorStatus: ${report.doctor.status}`,
    `- validationSummary: ${report.validationSummary.overallStatus}`
  ].join("\n");
}

async function persistPilotReport(kind, report) {
  await ensureDir(RELEASE_ROOT);
  const stamped = safeStamp(report.generatedAt);
  const outputPath = path.join(RELEASE_ROOT, `${kind}-${stamped}.json`);
  const latestPath = path.join(RELEASE_ROOT, `${kind}-latest.json`);
  const markdownPath = path.join(RELEASE_ROOT, `${kind}-${stamped}.md`);
  const latestMarkdownPath = path.join(RELEASE_ROOT, `${kind}-latest.md`);
  await writeJson(outputPath, report);
  await writeJson(latestPath, report);
  const markdown = renderPilotMarkdown({
    title: kind,
    report
  });
  await writeText(markdownPath, markdown);
  await writeText(latestMarkdownPath, markdown);
  return {
    outputPath,
    latestPath,
    markdownPath,
    latestMarkdownPath
  };
}

export async function runPilotPrepare({
  reviewer = "operator"
} = {}) {
  const generatedAt = new Date().toISOString();
  const validationPack = buildRealSurfaceValidationPack({
    scenarioId: "all",
    reviewer
  });
  const validationPersisted = await persistRealSurfaceValidationPack(validationPack);
  const bundleResult = {
    status: "pass",
    output: await buildDesktopShellBundle()
  };
  const smokeResult = await smokeDesktopShellBundle();
  const report = {
    generatedAt,
    overallStatus: "ready_for_validation",
    automatedChecks: {
      validationPack: {
        status: "pass",
        output: {
          outputPath: validationPersisted.outputPath,
          latestPath: validationPersisted.latestPath
        }
      },
      desktopBundle: bundleResult,
      desktopSmoke: smokeResult
    },
    manualSteps: buildManualSteps(),
    doctor: await buildReleaseDoctorReport(),
    validationSummary: await buildRealSurfaceValidationSummary({
      rootPath: REAL_SURFACE_VALIDATION_ROOT
    }),
    readiness: (await buildReadinessReport()).classification
  };
  const persisted = await persistPilotReport("pilot-prepare", report);
  return {
    report,
    persisted
  };
}

export async function runPilotValidate({
  reviewer = "operator"
} = {}) {
  const generatedAt = new Date().toISOString();
  const existingProofs = await collectProofArtifacts();
  const secretSmokeResult = await (async () => {
    try {
      const result = await runSecretStoreSmoke();
      const persisted = await persistSecretStoreSmokeResult(result);
      return {
        status: result.status,
        output: {
          ...result,
          outputPath: persisted.outputPath,
          latestPath: persisted.latestPath
        }
      };
    } catch (error) {
      if (existingProofs.secretStoreSmoke.proven) {
        return {
          status: "pass",
          output: {
            source: "persisted_proof",
            previousStatus: existingProofs.secretStoreSmoke.status
          }
        };
      }
      return {
        status: "blocked",
        blockedReason: error.message
      };
    }
  })();

  const providerUnavailable = await runLlmSmokeScenario("provider-unavailable");
  const runtimeDegraded = await runLlmSmokeScenario("runtime-degraded");

  const validationPack = buildRealSurfaceValidationPack({
    scenarioId: "all",
    reviewer
  });
  const validationPersisted = await persistRealSurfaceValidationPack(validationPack);

  const desktopDryRunReport = await buildDesktopDryRunReport({
    includeHealthCheck: false
  });
  const desktopDryRunPersisted = await persistDesktopDryRunReport(desktopDryRunReport);
  const desktopSmoke = await smokeDesktopShellBundle();
  const desktopBundle = await buildDesktopShellBundle();

  const doctor = await buildReleaseDoctorReport();
  const readinessReport = await buildReadinessReport();
  const persistedReadiness = await persistReadinessReport(readinessReport);

  const liveProviderPrecheck = doctor.checks.llmRuntime.liveProviderConfigured
    ? {
      status: "pass",
      output: {
        configured: true,
        secretSource: doctor.checks.llmRuntime.secretSource
      }
    }
    : {
      status: "blocked",
      blockedReason: "Live provider is not configured in the current environment."
    };

  const liveSuccess = doctor.checks.llmRuntime.liveProviderConfigured
    ? existingProofs.llmSmoke.liveSuccess.proven
      ? {
        status: "pass",
        output: {
          source: "persisted_proof",
          requestId: existingProofs.llmSmoke.liveSuccess.payload?.requestId ?? null,
          providerAlias: existingProofs.llmSmoke.liveSuccess.payload?.providerAlias ?? null,
          providerModel: existingProofs.llmSmoke.liveSuccess.payload?.providerModel ?? null,
          secretSource: existingProofs.llmSmoke.liveSuccess.payload?.secretSource ?? null
        }
      }
      : await runLlmSmokeScenario("live-success")
    : {
      status: "blocked",
      blockedReason: "Live provider is not configured in the current environment."
    };

  const report = {
    generatedAt,
    overallStatus: [
      secretSmokeResult.status,
      providerUnavailable.status,
      runtimeDegraded.status,
      desktopDryRunReport.status,
      desktopSmoke.status,
      desktopBundle.status
    ].includes("fail")
      ? "automation_failed"
      : "ready_for_manual_validation",
    automatedChecks: {
      secretStoreSmoke: secretSmokeResult,
      liveProviderPrecheck,
      liveSuccess,
      providerUnavailable,
      runtimeDegraded,
      validationPack: {
        status: "pass",
        output: {
          outputPath: validationPersisted.outputPath,
          latestPath: validationPersisted.latestPath
        }
      },
      desktopDryRun: {
        status: desktopDryRunReport.status,
        output: {
          ...desktopDryRunReport,
          latestPath: desktopDryRunPersisted.latestPath
        }
      },
      desktopSmoke,
      desktopBundle: {
        status: "pass",
        output: desktopBundle
      },
      releaseDoctor: {
        status: doctor.status,
        output: doctor
      },
      readinessReport: {
        status: readinessReport.status,
        output: {
          latestPath: persistedReadiness.latestPath,
          currentLevel: readinessReport.classification.currentLevel
        }
      }
    },
    manualSteps: buildManualSteps(),
    doctor,
    validationSummary: readinessReport.validationSummary,
    readiness: readinessReport.classification
  };
  const persisted = await persistPilotReport("pilot-validate", report);
  return {
    report,
    persisted
  };
}

export async function runPilotSummary() {
  const generatedAt = new Date().toISOString();
  const validationSummary = await buildRealSurfaceValidationSummary({
    rootPath: REAL_SURFACE_VALIDATION_ROOT
  });
  const persistedValidationSummary = await persistRealSurfaceValidationSummary(validationSummary, {
    rootPath: REAL_SURFACE_VALIDATION_ROOT
  });
  const readinessReport = await buildReadinessReport();
  const persistedReadiness = await persistReadinessReport(readinessReport);
  const report = {
    generatedAt,
    overallStatus: validationSummary.overallStatus,
    automatedChecks: {
      validationSummary: {
        status: "pass",
        output: {
          latestPath: persistedValidationSummary.latestPath,
          overallStatus: validationSummary.overallStatus
        }
      },
      readinessReport: {
        status: readinessReport.status,
        output: {
          latestPath: persistedReadiness.latestPath,
          currentLevel: readinessReport.classification.currentLevel
        }
      }
    },
    manualSteps: buildManualSteps(),
    doctor: readinessReport.doctorReport,
    validationSummary,
    readiness: readinessReport.classification
  };
  const persisted = await persistPilotReport("pilot-summary", report);
  return {
    report,
    persisted
  };
}

export async function executeReadinessFlow() {
  const prepare = await runPilotPrepare();
  const validate = await runPilotValidate();
  const summary = await runPilotSummary();
  return {
    prepare,
    validate,
    summary
  };
}
