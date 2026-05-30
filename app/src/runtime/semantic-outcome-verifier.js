/**
 * SemanticOutcomeVerifier verifies the user's objective, not just executed
 * steps. `verifiedByOutcomes === true` is the only valid gate for COMPLETED.
 */

import { EvidenceAlignmentGuard } from "./evidence-alignment-guard.js";

const CRITICAL_CHECK_IDS = new Set([
  "work_executed",
  "required_evidence_collected",
  "required_screenshot_captured",
  "no_critical_failures",
  "browser_fully_completed",
  "browser_no_blockers",
  "browser_search_executed",
  "browser_requested_target_observed",
  "launch_primitive_executed",
  "type_primitive_executed",
  "requested_text_verified",
  "desktop_screenshot_captured",
  "extraction_delivered",
  "required_artifact_exists",
  "evidence_aligned_with_mission",
  "no_failure_cascade",
  "no_terminal_blocker"
]);

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMissionIntentText(mission) {
  return String(mission ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = normalizeText(line);
      return !normalized.startsWith("browser launch url if needed")
        && !normalized.startsWith("browser search url if needed")
        && !normalized.startsWith("browser search query if needed")
        && !normalized.startsWith("browser target site if needed")
        && !normalized.startsWith("preferred browser if needed")
        && !normalized.startsWith("bounded desktop action if needed")
        && !normalized.startsWith("requested browser result");
    })
    .join("\n");
}

function check(id, label, passed, detail = {}) {
  return { id, label, passed, status: passed ? "pass" : "fail", detail };
}

function failedCheckReason(entry = {}) {
  if (entry.id === "evidence_aligned_with_mission") {
    const reasons = Array.isArray(entry.detail?.failureReasons)
      ? entry.detail.failureReasons.filter(Boolean)
      : [];
    if (reasons.length > 0) {
      return reasons.join("; ");
    }
  }
  return entry.label;
}

function allEvidenceRecords(evidence = [], browserResult = null) {
  return [
    ...(evidence ?? []),
    ...(browserResult?.evidence ?? [])
  ].filter(Boolean);
}

function evidenceId(record) {
  return record?.id ?? record?.evidenceId ?? null;
}

function isScreenshotEvidence(record = {}) {
  const text = normalizeText([
    record.type,
    record.evidenceType,
    record.label,
    record.storagePath,
    record.screenshotPath,
    record.metadata?.screenshotPath,
    record.metadata?.beforeCapturePath,
    record.metadata?.afterCapturePath
  ].filter(Boolean).join(" "));
  return text.includes("screenshot")
    || text.includes("window_capture")
    || text.includes("page_screenshot")
    || text.includes("region_capture")
    || /\.(png|jpe?g|webp)\b/i.test(String(record.storagePath ?? record.screenshotPath ?? record.metadata?.screenshotPath ?? ""));
}

function primitive(entry = {}) {
  return String(entry.primitive ?? entry.step?.primitive ?? entry.action ?? "").trim();
}

function completedDesktopActions(actionLog = []) {
  return actionLog.filter((entry) => entry?.status === "completed" || entry?.status === "pass");
}

function completedPrimitiveIncludes(actionLog = [], fragments = []) {
  const completed = completedDesktopActions(actionLog).map(primitive);
  return completed.some((name) => fragments.some((fragment) => name.includes(fragment)));
}

function actionSearchText(actionLog = []) {
  return normalizeText(actionLog.map((entry) => [
    entry.label,
    entry.step?.label,
    entry.step?.input?.text,
    entry.input?.text,
    entry.result?.typed?.text,
    entry.result?.text,
    entry.result?.content,
    entry.result?.visibleText,
    entry.result?.entries?.join?.(" "),
    entry.perceptionAfter?.text,
    entry.perceptionAfter?.ocrText
  ].filter(Boolean).join(" ")).join("\n"));
}

function extractQuotedText(mission = "") {
  const raw = String(mission ?? "");
  const quoted = raw.match(/["'“”‘’]([^"'“”‘’]{2,200})["'“”‘’]/);
  if (quoted?.[1]) return quoted[1].trim();
  const patterns = [
    /\b(?:type|write|enter)\b\s+(.+?)(?:\s+(?:in|into|dans|sur)\b|,\s*(?:then|and|puis|take|capture|prends)\b|[.?!]|$)/i,
    /\b(?:ecris|écris|tape|saisis)\b\s+(.+?)(?:\s+(?:in|into|dans|sur)\b|,\s*(?:puis|et|take|capture|prends)\b|[.?!]|$)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = String(match?.[1] ?? "")
      .replace(/^the text\s+/i, "")
      .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
      .trim();
    if (candidate.length >= 2 && candidate.length <= 200) return candidate;
  }
  return "";
}

function hasExtractionPayload(browserResult = null, actionLog = []) {
  if (browserResult?.extracted && Object.keys(browserResult.extracted).length > 0) {
    return true;
  }
  return actionLog.some((entry) => {
    const p = primitive(entry);
    return entry.status === "completed" && (
      p === "list_directory"
      || p === "read_visible_text"
      || p.includes("extract")
      || Array.isArray(entry.result?.entries)
      || Array.isArray(entry.result?.rows)
      || typeof entry.result?.content === "string"
    );
  });
}

function browserSearchObserved(browserResult = null) {
  const stepResults = browserResult?.stepResults ?? [];
  return stepResults.some((step) => ["navigate", "search", "type", "read_dom", "extract_text", "extract_structured_rows"].includes(step.action));
}

function browserTargetObserved(browserResult = null) {
  if (!browserResult) return true;
  const stateText = normalizeText([
    browserResult.browserState?.url,
    browserResult.browserState?.title,
    browserResult.finalUrl,
    ...(browserResult.evidence ?? []).flatMap((entry) => [entry.url, entry.title, entry.linkedSurface])
  ].filter(Boolean).join(" "));
  return stateText.length > 0;
}

function terminalBlockers(trackerSnapshot = null, workspaceSnapshot = null) {
  const sessions = [
    ...(trackerSnapshot?.terminal?.sessions ?? []),
    ...(workspaceSnapshot?.terminal?.sessions ?? [])
  ];
  return sessions.filter((session) => ["waiting_for_input", "needs_attention", "error"].includes(session?.status));
}

export class SemanticOutcomeVerifier {
  constructor({ evidenceAlignmentGuard = new EvidenceAlignmentGuard() } = {}) {
    this.evidenceAlignmentGuard = evidenceAlignmentGuard;
  }

  verify({
    mission = "",
    planOutcomes = [],
    actionLog = [],
    evidence = [],
    artifacts = [],
    browserResult = null,
    desktopState = null,
    trackerSnapshot = null,
    workspaceSnapshot = null
  } = {}) {
    const intentMission = normalizeMissionIntentText(mission);
    const missionLower = normalizeText(intentMission);
    const checks = [];
    const completedActions = completedDesktopActions(actionLog);
    const browserStepCount = browserResult?.stepResults?.length ?? 0;
    const totalWork = completedActions.length + browserStepCount;
    const allEvidence = allEvidenceRecords(evidence, browserResult);
    const screenshotEvidence = allEvidence.filter(isScreenshotEvidence);

    const desktopOrBrowserMission = actionLog.length > 0 || Boolean(browserResult);
    const explicitProofRequested = /\b(screenshot|screen shot|capture|preuve|proof|evidence|photo|image|montre moi|show me)\b/.test(missionLower);
    const screenshotRequested = /\b(screenshot|screen shot|capture|capture d ecran|capture d écran|photo|image)\b/.test(missionLower);
    const evidenceRequired = explicitProofRequested || desktopOrBrowserMission;
    const artifactRequired = /\b(artifact|artefact|file|fichier|csv|json|table artifact|export)\b/.test(missionLower);
    const extractionRequested = /\b(extract|extraire|résum|resum|summary|summar|table|list|liste|lister|quels dossiers|what folders|export)\b/.test(missionLower);

    checks.push(check(
      "work_executed",
      "Actions were executed toward the objective",
      totalWork > 0,
      { completedDesktopActions: completedActions.length, browserSteps: browserStepCount }
    ));

    if (evidenceRequired) {
      checks.push(check(
        "required_evidence_collected",
        "Required mission evidence was captured",
        allEvidence.length > 0,
        { evidenceCount: allEvidence.length }
      ));
    }

    if (screenshotRequested) {
      checks.push(check(
        browserResult ? "required_screenshot_captured" : "desktop_screenshot_captured",
        "Requested screenshot/capture proof exists",
        screenshotEvidence.length > 0 || completedPrimitiveIncludes(actionLog, ["capture", "screenshot"]),
        {
          screenshotEvidenceCount: screenshotEvidence.length,
          completedPrimitives: completedActions.map(primitive)
        }
      ));
    }

    const criticalFailures = actionLog.filter((entry) =>
      ["failed", "blocked", "skipped"].includes(entry?.status)
      && !entry.recoveryAttempted
      && entry.reason !== "approval_denied"
    );
    const browserErrors = browserResult?.errors ?? [];
    const hasBrowserHardError = Boolean(browserResult && browserResult.status !== "completed" && browserErrors.length > 0);
    checks.push(check(
      "no_critical_failures",
      "No critical unrecovered failures during execution",
      criticalFailures.length === 0 && !hasBrowserHardError,
      {
        criticalFailureCount: criticalFailures.length,
        browserErrorCount: browserErrors.length,
        failedPrimitives: criticalFailures.map((entry) => primitive(entry) || "unknown")
      }
    ));

    if (browserResult) {
      checks.push(check(
        "browser_fully_completed",
        "Browser mission reached full completion (not partial or failed)",
        browserResult.status === "completed",
        { browserStatus: browserResult.status }
      ));

      const unresolvedBlockers = (browserResult.blockers ?? []).filter((blocker) => !blocker.resolved);
      checks.push(check(
        "browser_no_blockers",
        "No unresolved browser blockers remained",
        unresolvedBlockers.length === 0,
        {
          blockerCount: unresolvedBlockers.length,
          blockers: unresolvedBlockers.map((blocker) => blocker.reason ?? blocker.type ?? "unknown").slice(0, 3)
        }
      ));

      const searchRequested = /\b(search|find|look up|query|google|bing|duckduckgo|cherche|chercher|recherche)\b/.test(missionLower);
      if (searchRequested) {
        checks.push(check(
          "browser_search_executed",
          "Browser search/navigation was executed",
          browserSearchObserved(browserResult),
          { totalBrowserSteps: browserStepCount }
        ));
      }

      checks.push(check(
        "browser_requested_target_observed",
        "Browser URL/title/evidence was observed after execution",
        browserTargetObserved(browserResult),
        {
          finalUrl: browserResult.browserState?.url ?? browserResult.finalUrl ?? null,
          finalTitle: browserResult.browserState?.title ?? null
        }
      ));
    }

    if (actionLog.length > 0 && !browserResult) {
      const launchRequested = /\b(open|launch|start|run|ouvrir|ouvre|lance|demarre|démarre)\b/.test(missionLower);
      if (launchRequested) {
        checks.push(check(
          "launch_primitive_executed",
          "Application/window launch was requested and executed",
          completedPrimitiveIncludes(actionLog, ["launch", "open"]),
          { completedPrimitives: completedActions.map(primitive).slice(0, 8) }
        ));
      }

      const typeRequested = /\b(type|write|enter|input|ecris|écris|tape|saisis)\b/.test(missionLower);
      if (typeRequested) {
        const typed = completedPrimitiveIncludes(actionLog, ["type", "input", "write"]);
        checks.push(check(
          "type_primitive_executed",
          "Text input was requested and executed",
          typed,
          { completedPrimitives: completedActions.map(primitive).slice(0, 8) }
        ));

        const requestedText = extractQuotedText(intentMission);
        if (requestedText) {
          const actionText = actionSearchText(actionLog);
          checks.push(check(
            "requested_text_verified",
            "Requested text is present in action log or post-action perception",
            actionText.includes(normalizeText(requestedText)),
            { requestedText }
          ));
        }
      }
    }

    if (extractionRequested) {
      checks.push(check(
        "extraction_delivered",
        "Requested extraction/list/summary data was delivered",
        hasExtractionPayload(browserResult, actionLog) || artifacts.length > 0,
        {
          artifactCount: artifacts.length,
          hasExtractedData: Boolean(browserResult?.extracted && Object.keys(browserResult.extracted).length > 0)
        }
      ));
    }

    if (artifactRequired) {
      checks.push(check(
        "required_artifact_exists",
        "Requested artifact/file exists",
        artifacts.length > 0 || actionLog.some((entry) => entry.status === "completed" && /create|write|export/.test(primitive(entry))),
        { artifactCount: artifacts.length }
      ));
    }

    const alignment = this.evidenceAlignmentGuard.evaluate({
      mission,
      evidence,
      artifacts,
      browserResult,
      desktopState,
      evidenceRequired
    });
    checks.push(check(
      "evidence_aligned_with_mission",
      "Evidence aligns with the requested target surface/site/app",
      alignment.passed,
      alignment
    ));

    const consecutiveFailures = trackerSnapshot?.steps?.consecutiveFailures ?? 0;
    const totalTrackedSteps = Math.max(
      (trackerSnapshot?.steps?.completed ?? 0) +
      (trackerSnapshot?.steps?.failed ?? 0) +
      (trackerSnapshot?.steps?.blocked ?? 0) +
      (trackerSnapshot?.steps?.skipped ?? 0),
      completedActions.length + browserStepCount
    );
    // Adaptive threshold: at least 3 consecutive failures, but never tolerate >25% cascade ratio
    const cascadeThreshold = Math.max(3, Math.ceil(totalTrackedSteps * 0.25));
    if (consecutiveFailures >= cascadeThreshold || (totalTrackedSteps >= 4 && consecutiveFailures >= 3 && consecutiveFailures >= totalTrackedSteps * 0.5)) {
      checks.push(check(
        "no_failure_cascade",
        "No consecutive failure cascade remained unresolved",
        false,
        { consecutiveFailures, cascadeThreshold, totalTrackedSteps }
      ));
    }

    const blockedTerminals = terminalBlockers(trackerSnapshot, workspaceSnapshot);
    if (blockedTerminals.length > 0) {
      checks.push(check(
        "no_terminal_blocker",
        "No terminal is blocked or waiting for input",
        false,
        { blockedTerminalCount: blockedTerminals.length, terminalIds: blockedTerminals.map((terminal) => terminal.id ?? null).filter(Boolean) }
      ));
    }

    const failedChecks = checks.filter((entry) => !entry.passed);
    const passedChecks = checks.filter((entry) => entry.passed);
    const criticalBlockers = failedChecks.filter((entry) => CRITICAL_CHECK_IDS.has(entry.id));
    const advisoryFailures = failedChecks.filter((entry) => !CRITICAL_CHECK_IDS.has(entry.id));
    const verifiedByOutcomes = criticalBlockers.length === 0;

    let verificationVerdict = "pass";
    let confidence = "high";
    if (!verifiedByOutcomes) {
      verificationVerdict = "fail";
      confidence = "high";
    } else if (advisoryFailures.length > 0) {
      verificationVerdict = "partial";
      confidence = "medium";
    } else if (checks.length < 4) {
      confidence = "medium";
    }

    const failureReason = failedChecks.length > 0
      ? failedChecks.map(failedCheckReason).join("; ")
      : null;

    return {
      verifiedByOutcomes,
      objectiveSatisfied: verifiedByOutcomes,
      verificationVerdict,
      confidence,
      evidenceUsed: allEvidence.map(evidenceId).filter(Boolean),
      missingEvidence: failedChecks
        .filter((entry) => entry.id.includes("evidence") || entry.id.includes("screenshot") || entry.id.includes("artifact") || entry.id.includes("extraction"))
        .map(failedCheckReason),
      satisfiedOutcomes: passedChecks.map((entry) => entry.label),
      unsatisfiedOutcomes: failedChecks.map(failedCheckReason),
      failureReason,
      nextBestAction: this.#suggestNextAction(failedChecks),
      requiresUserInput: failedChecks.some((entry) => entry.id === "no_terminal_blocker"),
      userQuestion: failedChecks.some((entry) => entry.id === "no_terminal_blocker")
        ? "A terminal is waiting or blocked. Review it before JON continues."
        : null,
      criticalBlockers: criticalBlockers.map((entry) => entry.id),
      checks
    };
  }

  #suggestNextAction(failedChecks) {
    if (!failedChecks.length) return null;
    const ids = failedChecks.map((entry) => entry.id);
    if (ids.includes("required_evidence_collected")) return "Collect mission evidence before completing the run.";
    if (ids.includes("required_screenshot_captured") || ids.includes("desktop_screenshot_captured")) return "Capture the requested window/page screenshot and link it to the run.";
    if (ids.includes("evidence_aligned_with_mission")) return "Reobserve the requested target surface and collect aligned proof.";
    if (ids.includes("browser_fully_completed")) return "Retry or replan the browser mission; partial browser runs cannot complete.";
    if (ids.includes("browser_no_blockers")) return "Resolve the browser blocker or ask the user for help.";
    if (ids.includes("browser_search_executed")) return "Navigate/search in the controlled browser before verification.";
    if (ids.includes("launch_primitive_executed")) return "Launch or focus the requested app/window before continuing.";
    if (ids.includes("type_primitive_executed") || ids.includes("requested_text_verified")) return "Type the requested text and verify it from perception or action evidence.";
    if (ids.includes("extraction_delivered")) return "Extract the requested rows/list/summary and persist it as data or artifact.";
    if (ids.includes("required_artifact_exists")) return "Create and persist the requested artifact before completion.";
    if (ids.includes("no_terminal_blocker")) return "Handle the terminal waiting state before completing the mission.";
    if (ids.includes("no_critical_failures")) return "Recover or stop cleanly after critical execution failures.";
    if (ids.includes("work_executed")) return "No action ran; dispatch the mission loop before verifying.";
    return "Review the failed verification checks and continue only after objective proof is available.";
  }
}
