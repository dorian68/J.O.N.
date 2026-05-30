import { APPROVAL_CATEGORY } from "../config.js";
import { selectPreferredBrowser } from "../preferences/user-preferences.js";

const SURFACES = Object.freeze({
  DESKTOP: "desktop",
  BROWSER: "browser",
  TERMINAL: "terminal",
  FILES: "files",
  ARTIFACT: "artifact",
  APPROVAL: "approval",
  VERIFIER: "verifier"
});

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function existingParameters(missionSpec = {}) {
  return missionSpec?.parameters && typeof missionSpec.parameters === "object" && !Array.isArray(missionSpec.parameters)
    ? missionSpec.parameters
    : {};
}

function browserIdFromText(text = "") {
  if (/\b(chrome|google chrome)\b/i.test(text)) return "chrome";
  if (/\b(edge|microsoft edge|msedge)\b/i.test(text)) return "edge";
  if (/\b(firefox|mozilla firefox)\b/i.test(text)) return "firefox";
  if (/\b(brave)\b/i.test(text)) return "brave";
  return "";
}

function selectBrowser({ text = "", parameters = {}, availableBrowsers = [], userPreferences = null } = {}) {
  const explicit = lower(parameters.browserLaunch?.browserId ?? parameters.browserId ?? "");
  const hinted = explicit || browserIdFromText(text);
  if (hinted) {
    const matched = availableBrowsers.find((browser) => lower(browser.id) === hinted || lower(browser.label).includes(hinted));
    if (matched) return { browser: matched, source: explicit ? "mission_parameters" : "explicit_user_text", unavailablePreference: null };
    return { browser: { id: hinted, label: hinted }, source: explicit ? "mission_parameters" : "explicit_user_text", unavailablePreference: null };
  }
  const preferred = selectPreferredBrowser(availableBrowsers, userPreferences);
  if (preferred.browser) {
    return {
      browser: preferred.browser,
      source: preferred.preference?.source ?? "user_preferences",
      unavailablePreference: null
    };
  }
  const fallback = availableBrowsers.find((browser) => lower(browser.id) === "chrome")
    ?? availableBrowsers.find((browser) => lower(browser.id) === "edge")
    ?? availableBrowsers[0]
    ?? null;
  return {
    browser: fallback,
    source: fallback ? "local_default_order" : null,
    unavailablePreference: preferred.unavailablePreference
  };
}

function selectApplication({ text = "", parameters = {}, availableApplications = [] } = {}) {
  const explicit = lower(parameters.applicationLaunch?.applicationId ?? parameters.applicationId ?? "");
  if (explicit) {
    const matched = availableApplications.find((app) => lower(app.id) === explicit || lower(app.label).includes(explicit));
    if (matched) return matched;
    return { id: explicit, label: explicit };
  }
  if (/\b(notepad|bloc-?notes?|bloc notes)\b/i.test(text)) {
    return availableApplications.find((app) => lower(app.id) === "notepad" || /notepad|bloc/.test(lower(app.label)))
      ?? { id: "notepad", label: "Notepad" };
  }
  if (/\b(calculator|calculatrice|calc)\b/i.test(text)) {
    return availableApplications.find((app) => lower(app.id) === "calculator" || /calculator|calc/.test(lower(app.label)))
      ?? { id: "calculator", label: "Calculator" };
  }
  return null;
}

function quotedText(text = "") {
  const match = String(text).match(/["'“”‘’]([^"'“”‘’]{1,220})["'“”‘’]/);
  return cleanText(match?.[1] ?? "", 220);
}

function websiteHintFromText(text = "") {
  const raw = String(text ?? "");
  const known = [
    ["upwork", "upwork.com"],
    ["ebay", "ebay.com"],
    ["saastr", "saastr.com"],
    ["amazon", "amazon.com"],
    ["google", "google.com"],
    ["linkedin", "linkedin.com"],
    ["indeed", "indeed.com"],
    ["github", "github.com"],
    ["node.js", "nodejs.org"],
    ["nodejs", "nodejs.org"]
  ];
  const normalized = lower(raw);
  const matched = known.find(([label]) => normalized.includes(label));
  if (matched?.[1]) return matched[1];
  const domain = raw.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s"'<>]*)?/i)?.[1] ?? "";
  if (domain) return domain.toLowerCase().replace(/^www\./, "");
  return "";
}

function extractSearchQuery(text = "") {
  const quoted = quotedText(text);
  if (quoted) return quoted;
  if (/\bnode\.?js\b/i.test(text) && /\b(documentation|docs?)\b/i.test(text)) {
    return "Node.js documentation";
  }
  const patterns = [
    /\b(?:search|google|bing|look up|cherche|recherche)\b(?:\s+(?:for|sur|dans|google|web))?\s+(.+?)(?:,\s*(?:take|capture|prends|capture)|\s+(?:and|puis)\s+(?:take|capture|prends)|[.?!]|$)/i,
    /\b(?:documentation|docs?)\b\s+(?:for|de|sur)\s+(.+?)(?:[.?!]|$)/i,
    /\b(?:list|lister|liste|show|find|trouve|trouver|cherche|chercher)\b\s+(.+?)(?:[.?!]|$)/i,
    /\b(?:go to|aller sur|va sur|ouvre le site|open the site|open site)\b\s+(.+?)(?:\s+(?:and|puis|et)\s+(?:list|lister|liste|show|find|trouve|trouver|cherche|chercher)|[.?!]|$)/i
  ];
  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    const candidate = cleanText(match?.[1] ?? "", 220)
      .replace(/^(?:for|sur|de|the)\s+/i, "")
      .replace(/\s+(?:and|puis)\s+(?:take|capture|prends).*$/i, "")
      .replace(/,\s*(?:take|capture|prends).*$/i, "");
    if (candidate) return candidate;
  }
  return "";
}

function searchUrlFromQuery(query = "", targetHost = "") {
  const clean = cleanText(query, 220);
  const host = cleanText(targetHost, 120).replace(/^www\./i, "");
  const search = host && clean && !clean.toLowerCase().includes(`site:${host.toLowerCase()}`)
    ? `site:${host} ${clean}`
    : clean || (host ? `site:${host}` : "");
  return search ? `https://www.google.com/search?q=${encodeURIComponent(search)}` : "";
}

function directUrlFromHost(host = "") {
  const normalized = normalizeHostHint(host);
  return normalized && normalized.includes(".") ? `https://${normalized}/` : "";
}

function startUrlForBrowserAutonomy({ targetHost = "", launchUrl = "", explicitSearchUrl = "", generatedSearchUrl = "", text = "" } = {}) {
  if (launchUrl) return launchUrl;
  const normalizedHost = normalizeHostHint(targetHost);
  if (normalizedHost === "upwork.com" && /\b(profile|profil|description|compte|account)\b/i.test(text)) {
    return "https://www.upwork.com/freelancers/~me";
  }
  const direct = directUrlFromHost(normalizedHost);
  if (direct) return direct;
  return explicitSearchUrl || generatedSearchUrl;
}

function normalizeHostHint(value = "") {
  const text = cleanText(value, 140).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const known = {
    upwork: "upwork.com",
    ebay: "ebay.com",
    saastr: "saastr.com",
    amazon: "amazon.com",
    google: "google.com",
    linkedin: "linkedin.com",
    indeed: "indeed.com",
    github: "github.com",
    nodejs: "nodejs.org",
    "node.js": "nodejs.org"
  };
  return known[text] ?? text;
}

function hostFromUrl(value = "") {
  try {
    return normalizeHostHint(new URL(String(value ?? "")).hostname.toLowerCase());
  } catch {
    return "";
  }
}

function unique(values = []) {
  return Array.from(new Set(values.map((entry) => cleanText(entry, 120)).filter(Boolean)));
}

function expandHostAllowlist(values = []) {
  const expanded = [];
  for (const value of values) {
    const host = normalizeHostHint(value);
    if (!host) continue;
    expanded.push(host);
    if (!host.startsWith("www.") && host.includes(".") && host !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      expanded.push(`www.${host}`);
    }
    if (host.startsWith("www.")) {
      expanded.push(host.replace(/^www\./, ""));
    }
  }
  return unique(expanded);
}

function wantsBrowserAutonomy(text = "", parameters = {}) {
  if (parameters.computerAction?.boundedLaunchOnly === true || parameters.boundedLaunchOnly === true) {
    return false;
  }
  const explicit = lower(parameters.computerAction?.type ?? parameters.computerActionType ?? "");
  if (explicit === "browser_autonomy") return true;
  const normalized = lower(text);
  const siteNavigation = /\b(go to|aller sur|va sur|ouvre le site|open the site|open site|acc[eè]de|accéder|visite)\b/i.test(text)
    || Boolean(parameters.browserLaunch?.targetSite || parameters.browserLaunch?.url || parameters.browserLaunch?.searchUrl || websiteHintFromText(text));
  const multiStepWebTask = /\b(list|lister|liste|show|find|trouve|trouver|current|deals?|offres?|jobs?|postes?|missions?|articles?|products?|produits?|extract|extraire|copy|copie|copier|description|profile|profil|compare|comparer|summary|résumé|resume|screenshot|capture|preuve|proof|save|sauvegarde|sauvegarder|fichier|file|links?|liens?|click|clique|fill|remplir|type|saisis|search inside|rechercher sur)\b/i.test(text)
    || Boolean(parameters.browserLaunch?.resultCount || parameters.browserLaunch?.resultType || parameters.browserLaunch?.searchQuery);
  return Boolean(siteNavigation && multiStepWebTask && normalized);
}

function wantsBrowser(text = "", parameters = {}) {
  const websiteHint = websiteHintFromText(text);
  return Boolean(
    parameters.browserLaunch?.browserId
      || parameters.browserLaunch?.searchQuery
      || parameters.browserLaunch?.url
      || parameters.browserLaunch?.searchUrl
      || parameters.browserLaunch?.targetSite
      || websiteHint
      || parameters.computerAction?.type?.startsWith?.("launch_browser")
      || parameters.computerAction?.type === "browser_autonomy"
      || /\b(browser|navigateur|chrome|edge|firefox|brave|google|search|cherche|recherche|documentation|docs?|go to|aller sur|va sur|acc[eè]de|accéder|visite|site web|website)\b/i.test(text)
  );
}

function wantsDesktopActuation(text = "", parameters = {}) {
  return Boolean(
    parameters.applicationLaunch?.applicationId
      || parameters.computerAction?.type === "desktop_autonomy"
      || /\b(on the desktop|sur le bureau|desktop|bureau)\b[\s\S]{0,160}\b(click|clique|write|type|écris|ecris|tape|saisis|capture|screenshot)\b/i.test(text)
      || /\b(click|clique)\b[\s\S]{0,120}\b(button|bouton|menu|field|champ)\b/i.test(text)
  );
}

function wantsTerminal(text = "") {
  return /\b(terminal|console|powershell|cmd|codex|claude code|cli|shell)\b/i.test(text);
}

function wantsFileInspection(text = "") {
  return /\b(desktop|bureau|folder|folders|dossier|dossiers|liste|list|directory|répertoire|repertoire)\b/i.test(text)
    && !websiteHintFromText(text)
    && !/\b(open|launch|ouvrir|ouvre|lance|write|type|écris|ecris|click|clique|screenshot|capture|go to|aller sur|va sur|site web|website)\b/i.test(text);
}

function mergeParameters(base = {}, additions = {}) {
  return {
    ...base,
    ...additions,
    browserLaunch: additions.browserLaunch || base.browserLaunch
      ? { ...(base.browserLaunch ?? {}), ...(additions.browserLaunch ?? {}) }
      : undefined,
    computerAction: additions.computerAction || base.computerAction
      ? { ...(base.computerAction ?? {}), ...(additions.computerAction ?? {}) }
      : undefined,
    applicationLaunch: additions.applicationLaunch || base.applicationLaunch
      ? { ...(base.applicationLaunch ?? {}), ...(additions.applicationLaunch ?? {}) }
      : undefined,
    approvalPolicy: additions.approvalPolicy || base.approvalPolicy
      ? { ...(base.approvalPolicy ?? {}), ...(additions.approvalPolicy ?? {}) }
      : undefined,
    acceptanceHarness: additions.acceptanceHarness || base.acceptanceHarness
      ? { ...(base.acceptanceHarness ?? {}), ...(additions.acceptanceHarness ?? {}) }
      : undefined
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

export function routeMissionToSurface({
  missionSpec = {},
  objective = "",
  constraints = [],
  availableBrowsers = [],
  availableApplications = [],
  workspaceStateSnapshot = null,
  riskPolicy = null,
  userPreferences = null
} = {}) {
  const parameters = existingParameters(missionSpec);
  const text = [
    objective,
    missionSpec.objective,
    missionSpec.deliverable,
    ...asArray(constraints),
    ...asArray(missionSpec.constraints)
  ].map((entry) => cleanText(entry)).filter(Boolean).join(" ");

  const normalized = lower(text);
  const blockers = [];
  const expectedTools = [];
  let selectedSurface = SURFACES.ARTIFACT;
  let selectedProvider = "artifact.local";
  let selectedMode = missionSpec.mode && missionSpec.mode !== "auto" ? missionSpec.mode : "";
  let routingReason = "No actionable local surface was confidently required; defaulting to artifact/verifier handling.";
  let requiredApproval = null;
  let fallbackSurface = SURFACES.VERIFIER;
  let confidence = 0.45;
  let normalizedParameters = {};

  if (wantsTerminal(text)) {
    selectedSurface = SURFACES.TERMINAL;
    selectedProvider = "workspace.terminal";
    selectedMode = "computer";
    routingReason = "The mission mentions a terminal or CLI agent and needs terminal observation/orchestration.";
    expectedTools.push("terminal.read", "verifier.checkOutcome");
    fallbackSurface = SURFACES.APPROVAL;
    confidence = 0.78;
  } else if (wantsBrowser(text, parameters) && (!wantsDesktopActuation(text, parameters) || wantsBrowserAutonomy(text, parameters))) {
    const browserSelection = selectBrowser({ text, parameters, availableBrowsers, userPreferences });
    const browser = browserSelection.browser;
    const targetHost = normalizeHostHint(parameters.browserLaunch?.targetSite ?? websiteHintFromText(text));
    const searchQuery = cleanText(parameters.browserLaunch?.searchQuery ?? extractSearchQuery(text), 220);
    const launchUrl = cleanText(parameters.browserLaunch?.url, 300);
    const explicitSearchUrl = cleanText(parameters.browserLaunch?.searchUrl, 300);
    const generatedSearchUrl = (searchQuery || targetHost) ? searchUrlFromQuery(searchQuery, targetHost) : "";
    const browserAutonomy = wantsBrowserAutonomy(text, parameters);
    const searchUrl = browserAutonomy
      ? startUrlForBrowserAutonomy({ targetHost, launchUrl, explicitSearchUrl, generatedSearchUrl, text })
      : (explicitSearchUrl || launchUrl || generatedSearchUrl);
    const allowlistedHosts = expandHostAllowlist([
      "google.com",
      "www.google.com",
      targetHost,
      hostFromUrl(searchUrl),
      hostFromUrl(explicitSearchUrl),
      hostFromUrl(launchUrl)
    ]);
    selectedSurface = SURFACES.BROWSER;
    selectedProvider = browser?.id
      ? `browser.${browser.id}`
      : browserAutonomy
      ? "browser.bundled_chromium"
      : "browser.unresolved";
    selectedMode = "computer";
    routingReason = browserAutonomy
      ? "The mission asks JON to work through a live website step by step, so it needs the browser autonomy loop."
      : searchQuery
      ? "The mission asks for a visible browser search/navigation with screenshot proof."
      : "The mission asks to open or control a browser.";
    if (browserSelection.source && browserSelection.source !== "local_default_order") {
      routingReason = `${routingReason} Browser selected from ${browserSelection.source}.`;
    }
    requiredApproval = {
      category: APPROVAL_CATEGORY.LOCAL_APP_LAUNCH,
      reason: "System browser launch uses the local desktop and may expose a user profile."
    };
    expectedTools.push(
      "browser.open",
      searchQuery || launchUrl || explicitSearchUrl || targetHost ? "browser.navigate" : null,
      browserAutonomy ? "browser.extractDom" : null,
      /screenshot|capture|preuve|proof/i.test(normalized)
        ? browserAutonomy ? "browser.captureScreenshot" : "desktop.captureScreenshot"
        : null,
      "verifier.checkOutcome"
    );
    fallbackSurface = SURFACES.DESKTOP;
    confidence = browser || browserAutonomy ? 0.88 : 0.68;
    if (browserSelection.unavailablePreference?.id && browser) {
      routingReason = `${routingReason} Preferred browser ${browserSelection.unavailablePreference.label ?? browserSelection.unavailablePreference.id} was unavailable; routed to ${browser.label ?? browser.id}.`;
    }
    if (!browser && !browserAutonomy) blockers.push("No installed browser provider was available to route this mission.");
    normalizedParameters = compactObject({
      browserLaunch: compactObject({
        ...(browser?.id ? { browserId: browser.id } : {}),
        ...(browserSelection.source ? { selectionSource: browserSelection.source } : {}),
        ...(targetHost ? { targetSite: targetHost } : {}),
        ...(searchQuery ? { searchQuery } : {}),
        ...(searchUrl ? { searchUrl } : {})
      }),
      ...(browserAutonomy ? {
        browserAutonomy: compactObject({
          ...(searchUrl ? { startUrl: searchUrl } : {}),
          allowlistedHosts,
          visible: true,
          mode: "coworker_browser_loop"
        })
      } : {}),
      computerAction: {
        type: browserAutonomy ? "browser_autonomy" : searchQuery || launchUrl || explicitSearchUrl || targetHost ? "launch_browser_search" : "launch_browser"
      }
    });
  } else if (wantsFileInspection(text)) {
    selectedSurface = SURFACES.FILES;
    selectedProvider = /bureau|desktop/i.test(text) ? "files.desktop" : "files.local";
    selectedMode = "computer";
    routingReason = "The mission is a read-only local file/folder inspection.";
    expectedTools.push("desktop.inspectWindows", "file.read", "verifier.checkOutcome");
    fallbackSurface = SURFACES.DESKTOP;
    confidence = 0.72;
    normalizedParameters = {
      computerAction: { type: "desktop_autonomy" }
    };
  } else {
    const application = selectApplication({ text, parameters, availableApplications });
    if (application || wantsDesktopActuation(text, parameters) || /\b(open|launch|start|ouvrir|ouvre|lance|write|type|écris|ecris|screenshot|capture|notepad|bloc-?notes?)\b/i.test(text)) {
      selectedSurface = SURFACES.DESKTOP;
      selectedProvider = application?.id ? `desktop.${application.id}` : "desktop.unresolved";
      selectedMode = "computer";
      routingReason = application
        ? `The mission needs governed desktop actuation against ${application.label ?? application.id}.`
        : "The mission needs governed desktop actuation, but the target app is not fully resolved.";
      requiredApproval = {
        category: APPROVAL_CATEGORY.LOCAL_DESKTOP_ACTUATION,
        reason: "Desktop actuation can type or focus local windows."
      };
      expectedTools.push(
        "desktop.inspectWindows",
        application ? "desktop.launchApplication" : null,
        /\b(write|type|écris|ecris|tape|saisis)\b/i.test(text) ? "desktop.typeText" : null,
        /screenshot|capture|preuve|proof/i.test(normalized) ? "desktop.captureScreenshot" : null,
        "verifier.checkOutcome"
      );
      fallbackSurface = SURFACES.APPROVAL;
      confidence = application ? 0.86 : 0.58;
      if (!application) blockers.push("The target desktop application is ambiguous.");
      normalizedParameters = compactObject({
        computerAction: { type: "desktop_autonomy" },
        ...(application ? {
          applicationLaunch: compactObject({
            applicationId: application.id,
            applicationLabel: application.label
          })
        } : {})
      });
    }
  }

  expectedTools.push("verifier.checkOutcome");
  const dedupedTools = Array.from(new Set(expectedTools.filter(Boolean)));
  return {
    selectedSurface,
    selectedProvider,
    selectedMode: selectedMode || "research",
    routingReason,
    requiredApproval,
    expectedTools: dedupedTools,
    fallbackSurface,
    confidence,
    blockers,
    normalizedParameters,
    workspaceSignals: {
      activeWindow: workspaceStateSnapshot?.activeWindow?.title ?? workspaceStateSnapshot?.activeWindow ?? null,
      activeBrowser: workspaceStateSnapshot?.activeBrowser?.title ?? workspaceStateSnapshot?.browser?.title ?? null,
      activeTerminal: workspaceStateSnapshot?.activeTerminal?.label ?? workspaceStateSnapshot?.terminal?.label ?? null
    },
    riskPolicy: riskPolicy?.mode ?? riskPolicy ?? null
  };
}

export function applySurfaceRouteToMission(rawMission = {}, route = {}) {
  const parameters = mergeParameters(existingParameters(rawMission), route.normalizedParameters ?? {});
  return {
    ...rawMission,
    mode: rawMission.mode && rawMission.mode !== "auto" ? rawMission.mode : route.selectedMode,
    parameters,
    routing: {
      ...(rawMission.routing ?? {}),
      surfaceRouter: {
        selectedSurface: route.selectedSurface,
        selectedProvider: route.selectedProvider,
        routingReason: route.routingReason,
        requiredApproval: route.requiredApproval,
        expectedTools: route.expectedTools,
        fallbackSurface: route.fallbackSurface,
        confidence: route.confidence,
        blockers: route.blockers,
        parametersApplied: true
      }
    }
  };
}
