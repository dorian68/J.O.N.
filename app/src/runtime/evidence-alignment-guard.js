const SEARCH_ENGINE_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
  "duckduckgo.com"
]);

const APP_TARGET_HINTS = [
  { id: "notepad", labels: ["notepad", "bloc-notes", "bloc notes"] },
  { id: "chrome", labels: ["chrome", "google chrome"] },
  { id: "edge", labels: ["edge", "microsoft edge", "msedge"] },
  { id: "firefox", labels: ["firefox", "mozilla firefox"] },
  { id: "brave", labels: ["brave"] },
  { id: "terminal", labels: ["terminal", "powershell", "cmd", "codex", "claude code"] },
  { id: "desktop", labels: ["desktop", "bureau"] }
];
const BROWSER_APP_TARGETS = new Set(["chrome", "edge", "firefox", "brave"]);

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hostFromValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractTargetDomains(mission) {
  const text = String(mission ?? "");
  const matches = text.match(/(?:https?:\/\/[^\s"'<>]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>]*)?)/gi) ?? [];
  return unique(matches.map(hostFromValue).filter((host) => host && !SEARCH_ENGINE_HOSTS.has(host)));
}

function extractAppTargets(mission) {
  const normalized = normalizeText(mission);
  return APP_TARGET_HINTS
    .filter((hint) => hint.labels.some((label) => normalized.includes(normalizeText(label))))
    .map((hint) => hint.id);
}

function evidenceToSearchableText(evidence = [], browserResult = null, desktopState = null, artifacts = []) {
  const parts = [];
  for (const item of evidence ?? []) {
    if (!item || typeof item !== "object") continue;
    parts.push(
      item.id,
      item.evidenceId,
      item.type,
      item.evidenceType,
      item.label,
      item.url,
      item.title,
      item.linkedSurface,
      item.storagePath,
      item.screenshotPath,
      item.summaryPath,
      item.metadata?.url,
      item.metadata?.title,
      item.metadata?.browserId,
      item.metadata?.browserLabel,
      item.metadata?.targetWindowTitle,
      item.metadata?.targetWindowLabel,
      item.metadata?.selectedApplicationId,
      item.metadata?.screenshotPath
    );
  }
  for (const item of artifacts ?? []) {
    if (!item || typeof item !== "object") continue;
    parts.push(item.id, item.title, item.artifactType, item.storagePath, item.metadata?.url);
  }
  parts.push(
    browserResult?.browserState?.url,
    browserResult?.browserState?.title,
    browserResult?.finalUrl,
    desktopState?.activeWindow?.title,
    desktopState?.activeWindow?.id,
    desktopState?.activeWindow?.processName
  );
  return normalizeText(parts.filter(Boolean).join("\n"));
}

function evidenceUrls(evidence = [], browserResult = null, artifacts = []) {
  const values = [];
  for (const item of evidence ?? []) {
    values.push(item?.url, item?.linkedSurface, item?.metadata?.url, item?.summaryPath, item?.storagePath);
  }
  for (const item of artifacts ?? []) {
    values.push(item?.metadata?.url, item?.storagePath);
  }
  values.push(browserResult?.browserState?.url, browserResult?.finalUrl);
  return unique(values.map(hostFromValue));
}

function evidenceLooksControlledFixture(evidence = [], browserResult = null, artifacts = []) {
  const searchable = normalizeText([
    ...((evidence ?? []).flatMap((item) => [
      item?.sensitivity,
      item?.trustClassification,
      item?.linkedSurface,
      item?.url,
      item?.storagePath,
      item?.metadata?.sourceSurfaceType,
      item?.metadata?.trustClassification,
      item?.metadata?.url,
      item?.metadata?.browserState?.url
    ])),
    ...((artifacts ?? []).flatMap((item) => [
      item?.status,
      item?.storagePath,
      item?.metadata?.sourceSurfaceType,
      item?.metadata?.trustClassification,
      item?.metadata?.url
    ])),
    browserResult?.browserState?.url,
    browserResult?.finalUrl
  ].filter(Boolean).join(" "));
  const hosts = evidenceUrls(evidence, browserResult, artifacts);
  return searchable.includes("controlled_fixture")
    || hosts.some((host) => host === "127.0.0.1" || host === "localhost");
}

function missionRequiresLiveWebEvidence(mission = "", targetDomains = []) {
  const normalized = normalizeText(mission);
  return targetDomains.length > 0
    || /\b(browser search url if needed|browser launch url if needed|browser target site if needed|preferred browser if needed)\b/.test(normalized)
    || /\b(current|live|latest|recent|upcoming|a venir|prochains?|next)\b/.test(normalized)
    || /\b(upwork|ebay|amazon|google|linkedin|indeed|github|nodejs|docs?|documentation|internet|web)\b/.test(normalized)
    || /\b(cherche|chercher|recherche|search|find|look up|go to|aller sur|va sur)\b/.test(normalized);
}

function domainMatchesEvidence(targetDomain, observedHosts = [], searchableText = "") {
  const normalizedTarget = targetDomain.replace(/^www\./i, "");
  if (observedHosts.some((host) => host === targetDomain || host.replace(/^www\./i, "") === normalizedTarget)) {
    return true;
  }
  return searchableText.includes(normalizeText(normalizedTarget));
}

function appMatchesEvidence(appTarget, searchableText, evidence = []) {
  if (appTarget === "desktop") {
    return true;
  }
  if (appTarget === "terminal") {
    return searchableText.includes("terminal")
      || searchableText.includes("powershell")
      || searchableText.includes("codex")
      || searchableText.includes("claude");
  }
  const hints = APP_TARGET_HINTS.find((entry) => entry.id === appTarget)?.labels ?? [appTarget];
  if (hints.some((label) => searchableText.includes(normalizeText(label)))) {
    return true;
  }
  if (["chrome", "edge", "firefox", "brave"].includes(appTarget)) {
    return (evidence ?? []).some((item) => {
      const type = normalizeText(item?.type ?? item?.evidenceType ?? "");
      return type.includes("page_screenshot") || type.includes("browser");
    });
  }
  return false;
}

export class EvidenceAlignmentGuard {
  evaluate({
    mission = "",
    evidence = [],
    artifacts = [],
    browserResult = null,
    desktopState = null,
    evidenceRequired = false
  } = {}) {
    const allEvidence = [
      ...(evidence ?? []),
      ...(browserResult?.evidence ?? [])
    ].filter(Boolean);
    const targetDomains = extractTargetDomains(mission);
    const appTargets = extractAppTargets(mission);
    const searchableText = evidenceToSearchableText(allEvidence, browserResult, desktopState, artifacts);
    const observedHosts = evidenceUrls(allEvidence, browserResult, artifacts);
    const checks = [];

    if (evidenceRequired) {
      checks.push({
        id: "evidence_present_for_alignment",
        passed: allEvidence.length > 0,
        reason: allEvidence.length > 0
          ? "Evidence exists for alignment checks."
          : "No evidence exists for a mission that requires proof."
      });
    }

    for (const domain of targetDomains) {
      const passed = domainMatchesEvidence(domain, observedHosts, searchableText);
      checks.push({
        id: `target_domain:${domain}`,
        passed,
        reason: passed
          ? `Evidence matches target domain ${domain}.`
          : `No evidence URL/title/surface matched target domain ${domain}.`
      });
    }

    if (missionRequiresLiveWebEvidence(mission, targetDomains) && evidenceLooksControlledFixture(allEvidence, browserResult, artifacts)) {
      checks.push({
        id: "live_web_not_controlled_fixture",
        passed: false,
        reason: "The mission requires live/external web evidence, but the collected proof came from controlled fixture/local pages."
      });
    }

    const browserTargets = appTargets.filter((target) => BROWSER_APP_TARGETS.has(target));
    if (browserTargets.length > 1) {
      const matchedBrowser = browserTargets.find((target) => appMatchesEvidence(target, searchableText, allEvidence));
      checks.push({
        id: `target_app:any_browser:${browserTargets.join("|")}`,
        passed: Boolean(matchedBrowser),
        reason: matchedBrowser
          ? `Evidence matches browser target ${matchedBrowser} from the allowed alternatives.`
          : `No evidence label/surface/window matched any requested browser alternative: ${browserTargets.join(", ")}.`
      });
    }

    for (const appTarget of appTargets) {
      if (browserTargets.length > 1 && BROWSER_APP_TARGETS.has(appTarget)) {
        continue;
      }
      const passed = appMatchesEvidence(appTarget, searchableText, allEvidence);
      checks.push({
        id: `target_app:${appTarget}`,
        passed,
        reason: passed
          ? `Evidence matches target app/surface ${appTarget}.`
          : `No evidence label/surface/window matched target app/surface ${appTarget}.`
      });
    }

    const failed = checks.filter((check) => !check.passed);
    return {
      passed: failed.length === 0,
      targetDomains,
      appTargets,
      observedHosts,
      checks,
      failureReasons: failed.map((check) => check.reason)
    };
  }
}

export function buildEvidenceAlignmentGuard() {
  return new EvidenceAlignmentGuard();
}
