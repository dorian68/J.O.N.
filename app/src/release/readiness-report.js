import path from "node:path";
import { RELEASE_ROOT, REAL_SURFACE_VALIDATION_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { buildReleaseDoctorReport } from "./release-doctor.js";
import { buildRealSurfaceValidationSummary } from "../validation/real-surface-summary.js";
import { collectProofArtifacts } from "./proof-artifacts.js";
import { buildOperationalDeepReadinessReport } from "./operational-deep-readiness.js";

const READINESS_LEVELS = [
  "prototype-aligned",
  "stronger-local-build",
  "pilot-credible-local-build",
  "production-candidate",
  "production-ready"
];

function buildEvidenceSnapshot({ doctorReport, validationSummary, proofArtifacts }) {
  return {
    testsPass: proofArtifacts.tests.proven,
    desktopBundlePass: proofArtifacts.desktop.bundle.proven,
    desktopSmokePass: proofArtifacts.desktop.smoke.proven,
    desktopDryRunPass: proofArtifacts.desktop.dryRun.proven,
    secretStoreSmokePass: proofArtifacts.secretStoreSmoke.proven,
    llmLiveProofPass: proofArtifacts.llmSmoke.liveSuccess.proven,
    llmProviderUnavailablePass: proofArtifacts.llmSmoke.providerUnavailable.proven,
    llmRuntimeDegradedPass: proofArtifacts.llmSmoke.runtimeDegraded.proven,
    validationSummaryStatus: validationSummary.overallStatus,
    releaseDoctorPass: doctorReport.status === "pass",
    releaseDoctorBlocks: doctorReport.blocks.length,
    liveProviderConfigured: doctorReport.checks.llmRuntime.liveProviderConfigured,
    secretSource: doctorReport.checks.llmRuntime.secretSource,
    promptRegistryPass: doctorReport.checks.promptRegistry.status === "pass",
    realSurfaceHarnessReady: doctorReport.checks.realSurfaceHarness.latestPackExists === true
  };
}

function levelSatisfied(evidence, level) {
  switch (level) {
    case "prototype-aligned":
      return evidence.testsPass
        && evidence.promptRegistryPass
        && evidence.releaseDoctorBlocks === 0
        && evidence.realSurfaceHarnessReady;
    case "stronger-local-build":
      return levelSatisfied(evidence, "prototype-aligned")
        && evidence.desktopBundlePass
        && evidence.desktopSmokePass
        && evidence.desktopDryRunPass
        && evidence.llmProviderUnavailablePass
        && evidence.llmRuntimeDegradedPass;
    case "pilot-credible-local-build":
      return levelSatisfied(evidence, "stronger-local-build")
        && evidence.secretStoreSmokePass
        && evidence.secretSource === "os_secret_store"
        && evidence.liveProviderConfigured
        && evidence.llmLiveProofPass
        && evidence.validationSummaryStatus === "all_passed";
    case "production-candidate":
      return levelSatisfied(evidence, "pilot-credible-local-build")
        && evidence.releaseDoctorPass
        && false;
    case "production-ready":
      return levelSatisfied(evidence, "production-candidate") && false;
    default:
      return false;
  }
}

function buildReasons(evidence) {
  return {
    prototypeAligned: [
      !evidence.testsPass && "Persisted passing test report is missing.",
      !evidence.promptRegistryPass && "Prompt registry is not proven healthy.",
      evidence.releaseDoctorBlocks > 0 && "Release doctor still reports blocking issues.",
      !evidence.realSurfaceHarnessReady && "No real-surface validation pack has been prepared."
    ].filter(Boolean),
    strongerLocalBuild: [
      !evidence.desktopBundlePass && "Desktop bundle proof is missing or failing.",
      !evidence.desktopSmokePass && "Desktop shell smoke proof is missing or failing.",
      !evidence.desktopDryRunPass && "Desktop shell dry-run proof is missing or failing.",
      !evidence.llmProviderUnavailablePass && "Provider-unavailable LLM smoke proof is missing or failing.",
      !evidence.llmRuntimeDegradedPass && "Runtime-degraded LLM smoke proof is missing or failing."
    ].filter(Boolean),
    pilotCredibleLocalBuild: [
      !evidence.secretStoreSmokePass && "OS secret-store smoke proof is missing or failing.",
      evidence.secretSource !== "os_secret_store" && "Runtime secret source is not the OS-backed secret store.",
      !evidence.liveProviderConfigured && "Live provider is not configured.",
      !evidence.llmLiveProofPass && "Live provider success proof is missing or failing.",
      evidence.validationSummaryStatus !== "all_passed" && "Real-surface validation summary is not fully passed."
    ].filter(Boolean),
    productionCandidate: [
      "Signed/native desktop packaging and release posture are not yet proven in-repo."
    ],
    productionReady: [
      "Production operations, signing, and external release validation remain unproven."
    ]
  };
}

export function classifyReadiness({ doctorReport, validationSummary, proofArtifacts }) {
  const evidence = buildEvidenceSnapshot({
    doctorReport,
    validationSummary,
    proofArtifacts
  });
  const reasons = buildReasons(evidence);
  const tiers = {
    prototypeAligned: levelSatisfied(evidence, "prototype-aligned"),
    strongerLocalBuild: levelSatisfied(evidence, "stronger-local-build"),
    pilotCredibleLocalBuild: levelSatisfied(evidence, "pilot-credible-local-build"),
    productionCandidate: levelSatisfied(evidence, "production-candidate"),
    productionReady: levelSatisfied(evidence, "production-ready")
  };

  const currentLevel = [...READINESS_LEVELS].reverse().find((level) => {
    switch (level) {
      case "production-ready":
        return tiers.productionReady;
      case "production-candidate":
        return tiers.productionCandidate;
      case "pilot-credible-local-build":
        return tiers.pilotCredibleLocalBuild;
      case "stronger-local-build":
        return tiers.strongerLocalBuild;
      case "prototype-aligned":
        return tiers.prototypeAligned;
      default:
        return false;
    }
  }) ?? "not-classified";

  return {
    currentLevel,
    levels: READINESS_LEVELS,
    tiers,
    evidence,
    reasons
  };
}

export async function buildReadinessReport(options = {}) {
  const proofArtifacts = options.proofArtifacts ?? await collectProofArtifacts();
  const doctorReport = await buildReleaseDoctorReport({
    ...options,
    proofArtifacts
  });
  const validationSummary = await buildRealSurfaceValidationSummary({
    rootPath: REAL_SURFACE_VALIDATION_ROOT
  });
  const operationalDeep = options.operationalDeep ?? await buildOperationalDeepReadinessReport({
    realSurfaceSummary: validationSummary
  });
  const classification = classifyReadiness({
    doctorReport,
    validationSummary,
    proofArtifacts
  });

  return {
    generatedAt: new Date().toISOString(),
    status: doctorReport.blocks.length > 0 ? "fail" : doctorReport.status === "pass" ? "pass" : "warn",
    classification,
    tiers: classification.tiers,
    operationalDeep,
    doctorReport,
    validationSummary,
    proofArtifacts
  };
}

export async function persistReadinessReport(report) {
  await ensureDir(RELEASE_ROOT);
  const stamped = report.generatedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(RELEASE_ROOT, `readiness-report-${stamped}.json`);
  const latestPath = path.join(RELEASE_ROOT, "readiness-report-latest.json");
  await writeJson(outputPath, report);
  await writeJson(latestPath, report);
  return {
    outputPath,
    latestPath
  };
}
