import path from "node:path";
import { DATA_ROOT } from "../config.js";
import { runBrowserBenchmarks } from "../benchmarks/browser-benchmarks.js";
import { ensureDir, writeJson } from "../utils/files.js";

const smokeRoot = path.join(DATA_ROOT, "smoke");

function pickAssertionDetails(assertionDetails = {}) {
  return Object.fromEntries(Object.entries(assertionDetails)
    .filter(([key]) => [
      "researchCompleted",
      "researchArtifactCount",
      "researchSourceCount",
      "formCompleted",
      "formApprovalCount",
      "formEvidenceCount",
      "evidenceIncludesBrowserState",
      "refusalRunStopped",
      "refusalNoImplicitWrite",
      "ambiguousDomDetected",
      "blockerDetected",
      "blockerDismissed",
      "outcomeVerified",
      "browserStateTracked"
    ].includes(key)));
}

const startedAt = new Date().toISOString();

try {
  const result = await runBrowserBenchmarks();
  const activeTarget = result.browserSessionState?.targets?.find((target) => target.id === result.browserSessionState.activeTargetId) ?? null;
  const smoke = {
    scenario: "browser-operator",
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
    status: Object.values(result.assertions).every(Boolean) ? "pass" : "fail",
    controlledSurface: true,
    trustClassification: "controlled_fixture",
    runs: {
      researchRunId: result.researchRunId,
      formRunId: result.formRunId,
      deniedFormRunId: result.deniedFormRunId
    },
    proof: {
      researchArtifactCount: result.researchArtifacts.length,
      researchSourceCount: result.researchSources.length,
      researchEvidenceCount: result.researchEvidence.length,
      formEvidenceCount: result.formEvidence.length,
      formApprovalCount: result.formApprovals.length,
      deniedFormApprovalCount: result.deniedFormApprovals.length
    },
    browserState: {
      sessionId: result.browserSessionState?.sessionId ?? null,
      activeTargetId: result.browserSessionState?.activeTargetId ?? null,
      activeUrl: activeTarget?.url ?? null,
      activeTitle: activeTarget?.title ?? null,
      navigationHistoryCount: activeTarget?.navigationHistory?.length ?? 0,
      recentActionTypes: activeTarget?.recentActions?.map((action) => action.action).slice(-12) ?? [],
      blocker: activeTarget?.blocker ?? null
    },
    assertions: result.assertions,
    assertionDetails: pickAssertionDetails(result.assertionDetails),
    limitations: [
      "This smoke proves controlled allowlisted browser operation, not arbitrary real-site production reliability.",
      "Anti-bot, CAPTCHA, credential, and authentication blockers are not bypassed; they must be surfaced as blockers or manual handoff."
    ]
  };
  await ensureDir(smokeRoot);
  const outputPath = path.join(smokeRoot, "browser-operator.json");
  await writeJson(outputPath, smoke);
  console.log(JSON.stringify({
    ...smoke,
    outputPath
  }, null, 2));
  if (smoke.status !== "pass") {
    process.exitCode = 1;
  }
} catch (error) {
  const smoke = {
    scenario: "browser-operator",
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
    status: "fail",
    error: {
      message: error?.message ?? String(error),
      code: error?.code ?? null
    }
  };
  await ensureDir(smokeRoot);
  const outputPath = path.join(smokeRoot, "browser-operator.json");
  await writeJson(outputPath, smoke);
  console.error(JSON.stringify({
    ...smoke,
    outputPath
  }, null, 2));
  process.exitCode = 1;
}
