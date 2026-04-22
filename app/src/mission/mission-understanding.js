const MODE_TO_SCENARIO_TYPE = Object.freeze({
  research: "research",
  form: "form_preparation",
  computer: "computer_observation"
});

const SCENARIO_TYPE_TO_MODE = Object.freeze({
  research: "research",
  form_preparation: "form",
  computer_observation: "computer"
});

const MODE_KEYWORDS = Object.freeze({
  research: [
    "research",
    "search",
    "compare",
    "page",
    "pages",
    "site",
    "web",
    "browser",
    "browse",
    "read",
    "review",
    "find",
    "chercher",
    "recherche",
    "compare",
    "page",
    "pages",
    "site",
    "navigateur",
    "web"
  ],
  form: [
    "form",
    "formulaire",
    "field",
    "fields",
    "input",
    "checkbox",
    "newsletter",
    "candidate",
    "role",
    "review-ready",
    "rempl",
    "champ",
    "case a cocher",
    "case",
    "select"
  ],
  computer: [
    "window",
    "local window",
    "screen",
    "desktop",
    "local app",
    "application locale",
    "focus",
    "front",
    "foreground",
    "capture",
    "screenshot",
    "fenetre",
    "fenêtre",
    "ecran",
    "écran",
    "bureau"
  ]
});

const UNSUPPORTED_PATTERNS = Object.freeze([
  {
    id: "submit",
    pattern: /\b(submit|soumettre|envoyer le formulaire|envoyer)\b/i,
    message: "Submit/send flows remain outside the bounded prototype."
  },
  {
    id: "login",
    pattern: /\b(log ?in|login|sign ?in|connexion|connecte-toi|authentif)/i,
    message: "Login/authentication flows remain outside the bounded prototype."
  },
  {
    id: "publish",
    pattern: /\b(publish|publier|post|poster|mettre en ligne)\b/i,
    message: "Publish/post flows remain outside the bounded prototype."
  },
  {
    id: "delete",
    pattern: /\b(delete|remove|erase|supprimer|effacer)\b/i,
    message: "Delete/remove flows remain outside the bounded prototype."
  },
  {
    id: "upload",
    pattern: /\b(upload|televers|télévers|importer un fichier)\b/i,
    message: "Upload flows remain outside the bounded prototype."
  }
]);

const BROWSER_LAUNCH_PATTERNS = Object.freeze([
  /\b(open|launch|start|ouvrir|ouvre|lance)\b[\s\S]{0,80}\b(browser|web browser|navigateur|chrome|edge|firefox|brave)\b/i,
  /\b(browser|web browser|navigateur)\b[\s\S]{0,40}\b(open|launch|start|ouvrir|ouvre|lance)\b/i
]);

const BROWSER_SEARCH_PATTERNS = Object.freeze([
  /\b(search|look up|find|browse to|cherche|chercher|recherche)\b/i,
  /\bgoogle\b/i,
  /\bbing\b/i,
  /\bduckduckgo\b/i
]);

const SCREENSHOT_PATTERNS = Object.freeze([
  /\b(screenshot|screen ?shot|capture|capture d'?ecran|capture d'?écran|take a capture|take a screenshot|prends une capture|prends une capture d'?ecran|prends une capture d'?écran)\b/i
]);

const GENERAL_DESKTOP_ACTION_PATTERNS = Object.freeze([
  /\b(open|launch|start|ouvrir|ouvre|lance|démarre|demarre)\b[\s\S]{0,120}\b(app|application|notepad|bloc-?notes?|calculator|calculatrice|paint|explorer|file explorer|word|excel|powerpoint|terminal|powershell)\b/i,
  /\b(type|write|enter|saisis|tape|écris|ecris)\b[\s\S]{0,120}\b(in|dans|into|sur)\b[\s\S]{0,80}\b(app|application|notepad|bloc-?notes?|window|fen[eê]tre)\b/i,
  /\b(click|clique|scroll|defile|défile|hotkey|raccourci|copie|copy|paste|coller)\b/i
]);

const BROWSER_ALIASES = Object.freeze({
  edge: ["edge", "microsoft edge", "msedge"],
  chrome: ["chrome", "google chrome"],
  firefox: ["firefox", "mozilla firefox"],
  brave: ["brave", "brave browser"]
});

function normalizeBrowserCatalog(browsers = []) {
  if (!Array.isArray(browsers)) {
    return [];
  }
  return browsers
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const id = String(entry.id ?? "").trim().toLowerCase();
      const label = String(entry.label ?? entry.id ?? "").trim();
      if (!id || !label) {
        return null;
      }
      return {
        id,
        label,
        processName: String(entry.processName ?? "").trim().toLowerCase() || null,
        executablePath: String(entry.executablePath ?? "").trim() || null
      };
    })
    .filter(Boolean);
}

function browserAliasesFor(browser) {
  return Array.from(new Set([
    browser.id,
    browser.label,
    ...(BROWSER_ALIASES[browser.id] ?? [])
  ].map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean)));
}

function detectBrowserLaunchIntent(text) {
  return BROWSER_LAUNCH_PATTERNS.some((pattern) => pattern.test(text));
}

function detectBrowserSearchIntent(text) {
  return BROWSER_SEARCH_PATTERNS.some((pattern) => pattern.test(text));
}

function detectScreenshotIntent(text) {
  return SCREENSHOT_PATTERNS.some((pattern) => pattern.test(text));
}

function detectGeneralDesktopActionIntent(text) {
  return GENERAL_DESKTOP_ACTION_PATTERNS.some((pattern) => pattern.test(text));
}

function findExplicitBrowserChoice(text, browserCatalog = [], preferredBrowserId = "") {
  const preferred = String(preferredBrowserId ?? "").trim().toLowerCase();
  if (preferred) {
    return browserCatalog.find((browser) => browser.id === preferred) ?? null;
  }
  return browserCatalog.find((browser) => {
    return browserAliasesFor(browser).some((alias) => text.includes(alias));
  }) ?? null;
}

function browserChoiceSummary(browser) {
  if (!browser) {
    return null;
  }
  return {
    id: browser.id,
    label: browser.label
  };
}

function normalizeSearchText(input = {}) {
  return [
    input.objective,
    input.deliverable,
    ...(Array.isArray(input.constraints) ? input.constraints : typeof input.constraints === "string" ? input.constraints.split(/\r?\n/) : []),
    ...(Array.isArray(input.forbiddenActions) ? input.forbiddenActions : typeof input.forbiddenActions === "string" ? input.forbiddenActions.split(/\r?\n/) : [])
  ]
    .map((entry) => String(entry ?? "").toLowerCase())
    .join("\n");
}

function normalizeMissionText(input = {}) {
  return [
    input.objective,
    input.deliverable,
    ...(Array.isArray(input.constraints) ? input.constraints : typeof input.constraints === "string" ? input.constraints.split(/\r?\n/) : []),
    ...(Array.isArray(input.forbiddenActions) ? input.forbiddenActions : typeof input.forbiddenActions === "string" ? input.forbiddenActions.split(/\r?\n/) : [])
  ]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function extractSearchQuery(text, preferredQuery = "") {
  const explicit = String(preferredQuery ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const patterns = [
    /\b(?:search(?: for)?|look up|find|browse to|cherche(?:r)?|recherche)\b[\s:"]+(.+?)(?:\s+(?:then|and then|puis|et puis|and|et)\b|[.?!]|$)/i,
    /\b(?:google|bing|duckduckgo)\b[\s:"]+(.+?)(?:\s+(?:then|and then|puis|et puis|and|et)\b|[.?!]|$)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const candidate = String(match[1]).replace(/^for\s+/i, "").replace(/^sur\s+/i, "").trim();
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function buildSearchUrl(query, text) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    return null;
  }
  const encoded = encodeURIComponent(normalizedQuery);
  if (/\bbing\b/i.test(text)) {
    return `https://www.bing.com/search?q=${encoded}`;
  }
  if (/\bduckduckgo\b/i.test(text)) {
    return `https://duckduckgo.com/?q=${encoded}`;
  }
  return `https://www.google.com/search?q=${encoded}`;
}

function scoreKeywords(text, keywords = []) {
  return keywords.reduce((score, keyword) => {
    return score + (text.includes(keyword.toLowerCase()) ? 1 : 0);
  }, 0);
}

function rankModes(scores = {}) {
  return Object.entries(scores).sort((left, right) => right[1] - left[1]);
}

function modePlanLabel(mode) {
  switch (mode) {
    case "form":
      return "controlled form preparation";
    case "computer":
      return "local window observation";
    case "research":
    default:
      return "bounded web research";
  }
}

function buildRoutingReason(mode, scores, text) {
  if (mode === "computer" && detectBrowserLaunchIntent(text)) {
    return "The mission explicitly asks for a visible local browser action, so the bounded computer lane is the safest first step.";
  }
  if (mode === "form") {
    if (text.includes("submit") || text.includes("soumettre")) {
      return "The mission talks about form fields or submission-sensitive form work, so the bounded form-preparation lane is the safest match.";
    }
    return "The mission refers to form fields or explicit form values, so the bounded form-preparation lane is the closest fit.";
  }
  if (mode === "computer") {
    return "The mission refers to a local window, screen visibility, focus, or screenshot-style observation, so the bounded computer-observation lane is the closest fit.";
  }
  if ((scores.research ?? 0) > 0) {
    return "The mission is primarily about reading, comparing, or searching bounded web content, so the research lane is the closest fit.";
  }
  return "The request does not point to a stronger local action target, so the safest first step is to gather information.";
}

function detectCrossFrameNotice(scores) {
  const activeModes = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .map(([mode]) => mode);
  if (activeModes.length < 2) {
    return null;
  }
  return "The mission mixes signals from multiple bounded lanes; the runtime will keep a single execution frame per run and surface the limitation.";
}

function buildBrowserLaunchState(input = {}, inferred = {}) {
  const searchText = normalizeSearchText({
    objective: input.mission ?? input.objective ?? "",
    deliverable: input.deliverable ?? "",
    constraints: input.constraints ?? input.missionSpec?.constraints ?? [],
    forbiddenActions: input.forbiddenActions ?? input.missionSpec?.forbiddenActions ?? [],
    parameters: input.missionSpec?.parameters ?? input.parameters ?? {}
  });
  const missionText = normalizeMissionText({
    objective: input.mission ?? input.objective ?? "",
    deliverable: input.deliverable ?? "",
    constraints: input.constraints ?? input.missionSpec?.constraints ?? [],
    forbiddenActions: input.forbiddenActions ?? input.missionSpec?.forbiddenActions ?? [],
    parameters: input.missionSpec?.parameters ?? input.parameters ?? {}
  });
  const browserCatalog = normalizeBrowserCatalog(input.availableBrowsers ?? []);
  const preferredBrowserId = input.missionSpec?.parameters?.browserLaunch?.browserId
    ?? input.parameters?.browserLaunch?.browserId
    ?? "";
  const preferredSearchQuery = input.missionSpec?.parameters?.browserLaunch?.searchQuery
    ?? input.parameters?.browserLaunch?.searchQuery
    ?? "";
  const preferredLaunchUrl = input.missionSpec?.parameters?.browserLaunch?.url
    ?? input.parameters?.browserLaunch?.url
    ?? "";
  const forcedActionType = input.missionSpec?.parameters?.computerAction?.type
    ?? input.parameters?.computerAction?.type
    ?? "";
  const normalizedForcedActionType = String(forcedActionType).trim();
  const desktopAutonomyRequested = Boolean(
    normalizedForcedActionType === "desktop_autonomy"
    || detectGeneralDesktopActionIntent(missionText)
  );
  const launchRequested = Boolean(
    inferred.browserLaunchIntent
    || detectBrowserLaunchIntent(searchText)
    || ["launch_browser", "launch_browser_search"].includes(normalizedForcedActionType)
  );
  const browserScopedActionRequested = Boolean(
    launchRequested
    || normalizedForcedActionType === "capture_browser_window"
    || preferredBrowserId
    || preferredSearchQuery
    || preferredLaunchUrl
  );
  const explicitBrowser = browserScopedActionRequested
    ? findExplicitBrowserChoice(searchText, browserCatalog, preferredBrowserId)
    : null;
  const selectedBrowser = browserScopedActionRequested
    ? (explicitBrowser ?? (browserCatalog.length === 1 ? browserCatalog[0] : null))
    : null;
  const searchRequested = Boolean(
    (launchRequested || normalizedForcedActionType === "launch_browser_search")
    && (detectBrowserSearchIntent(searchText) || preferredSearchQuery || preferredLaunchUrl)
  );
  const searchQuery = searchRequested
    ? extractSearchQuery(missionText, preferredSearchQuery)
    : "";
  const launchUrl = preferredLaunchUrl || (searchRequested ? buildSearchUrl(searchQuery, missionText) : null);
  const captureRequested = detectScreenshotIntent(searchText)
    || ["capture_browser_window", "capture_active_window"].includes(normalizedForcedActionType);
  const clarificationOptions = browserScopedActionRequested && !selectedBrowser && browserCatalog.length > 1
    ? browserCatalog.map(browserChoiceSummary).filter(Boolean)
    : [];
  return {
    launchRequested,
    searchRequested,
    searchQuery,
    launchUrl,
    captureRequested,
    desktopAutonomyRequested,
    forcedActionType: normalizedForcedActionType || null,
    browserCatalog,
    selectedBrowser,
    clarificationOptions,
    noSupportedBrowser: browserScopedActionRequested && browserCatalog.length === 0
  };
}

function determineComputerActionType(browserLaunchState = null) {
  const forced = String(browserLaunchState?.forcedActionType ?? "").trim();
  if (["observe_window", "launch_browser", "launch_browser_search", "capture_browser_window", "capture_active_window", "desktop_autonomy"].includes(forced)) {
    return forced;
  }
  if (browserLaunchState?.desktopAutonomyRequested && !browserLaunchState?.launchRequested) {
    return "desktop_autonomy";
  }
  if (browserLaunchState?.launchRequested && browserLaunchState?.searchRequested) {
    return "launch_browser_search";
  }
  if (browserLaunchState?.launchRequested) {
    return "launch_browser";
  }
  if (browserLaunchState?.captureRequested && browserLaunchState?.selectedBrowser) {
    return "capture_browser_window";
  }
  if (browserLaunchState?.captureRequested) {
    return "capture_active_window";
  }
  return "observe_window";
}

function verificationGoalsForMode(mode, browserLaunchState = null) {
  if (mode === "computer") {
    const actionType = determineComputerActionType(browserLaunchState);
    if (actionType === "launch_browser_search") {
      return [
        "Verify that the approved browser launch and search step was executed on this machine.",
        "Verify that a visible browser window appears for the selected browser after launch.",
        "Persist visible proof for operator review."
      ];
    }
    if (actionType === "launch_browser") {
      return [
        "Verify that the approved browser launch request was executed on this machine.",
        "Verify that a visible window for the selected browser appears after launch.",
        "Persist visible proof for operator review."
      ];
    }
    if (actionType === "capture_browser_window" || actionType === "capture_active_window") {
      return [
        "Verify that the intended visible window is targeted for capture.",
        "Verify that a screenshot was persisted for operator review.",
        "Persist visible proof for operator review."
      ];
    }
    if (actionType === "desktop_autonomy") {
      return [
        "Verify that the selected desktop primitives match the user's mission.",
        "Verify each approved desktop action against the observed window state.",
        "Persist before/after proof and an action log for operator review."
      ];
    }
  }
  switch (mode) {
    case "form":
      return [
        "Verify that every approved field change is visibly applied.",
        "Verify that the form reaches a review-ready state without submission.",
        "Persist visible proof for operator review."
      ];
    case "computer":
      return [
        "Verify that the focused window matches the allowlisted local target.",
        "Verify the visible state before and after observation.",
        "Persist visible proof for operator review."
      ];
    case "research":
    default:
      return [
        "Verify that collected pages stay inside the bounded browser scope.",
        "Verify that each retained source has traceable proof.",
        "Verify that the final result remains tied to collected sources and evidence."
      ];
  }
}

function requestedOutcomesForMode(mode, input = {}, browserLaunchState = null) {
  const deliverable = String(input.deliverable ?? "").trim();
  if (mode === "computer") {
    const actionType = determineComputerActionType(browserLaunchState);
    const browserLabel = browserLaunchState.selectedBrowser?.label ?? "the selected browser";
    if (actionType === "launch_browser_search") {
      const query = browserLaunchState.searchQuery || "the requested query";
      return [
        `Open ${browserLabel} on this machine after approval.`,
        `Search for ${query} inside the browser launch step.`,
        deliverable || "Return visible proof that the browser search step ran."
      ];
    }
    if (actionType === "launch_browser") {
      return [
        `Launch ${browserLabel} on this machine after approval.`,
        "Verify that the browser window becomes visibly available.",
        deliverable || "Return visible proof that the browser was opened."
      ];
    }
    if (actionType === "capture_browser_window") {
      return [
        `Capture a visible screenshot of ${browserLabel}.`,
        "Persist the screenshot as run evidence.",
        deliverable || "Return visible proof that the screenshot was captured."
      ];
    }
    if (actionType === "capture_active_window") {
      return [
        "Capture a visible screenshot of the active window.",
        "Persist the screenshot as run evidence.",
        deliverable || "Return visible proof that the screenshot was captured."
      ];
    }
    if (actionType === "desktop_autonomy") {
      return [
        "Let the agent select a bounded desktop application/action plan from discovered local capabilities.",
        "Execute only approved desktop primitives and verify each visible outcome.",
        deliverable || "Return a short desktop action outcome summary with proof."
      ];
    }
  }
  switch (mode) {
    case "form":
      return [
        "Apply approved controlled form changes.",
        "Leave the form in a review-ready visible state without submission.",
        deliverable || "Return visible proof of the prepared form state."
      ];
    case "computer":
      return [
        "Bring the allowlisted local window into focus only when approval allows it.",
        "Capture visible proof of the observed local state.",
        deliverable || "Return an observation summary tied to visible proof."
      ];
    case "research":
    default:
      return [
        "Collect traceable findings from bounded browser surfaces.",
        "Capture proof for the consulted pages.",
        deliverable || "Return a qualified decision-oriented result."
      ];
  }
}

function runNowPlanForMode(mode, input = {}, browserLaunchState = null) {
  const deliverable = String(input.deliverable ?? "").trim();
  if (mode === "computer") {
    const actionType = determineComputerActionType(browserLaunchState);
    const browserLabel = browserLaunchState.selectedBrowser?.label ?? "the selected browser";
    if (actionType === "launch_browser_search") {
      return [
        "List the supported browsers available on this machine and keep the browser step inside that bounded set.",
        `Request approval before opening ${browserLabel}.`,
        `Launch ${browserLabel} on the requested search page, then verify that a visible browser window appears.`,
        deliverable ? `Return ${deliverable}.` : "Return visible proof that the browser search step was executed."
      ];
    }
    if (actionType === "launch_browser") {
      return [
        "List the supported browsers available on this machine and keep the launch inside that bounded set.",
        `Request approval before opening ${browserLabel}.`,
        `Launch ${browserLabel}, then verify that a visible browser window appears.`,
        deliverable ? `Return ${deliverable}.` : "Return visible proof that the browser was opened."
      ];
    }
    if (actionType === "capture_browser_window") {
      return [
        `Locate a visible ${browserLabel} window on this machine.`,
        "Request approval before changing focus when needed, then capture the visible browser window.",
        "Persist the screenshot as run evidence and verify that the capture was written.",
        deliverable ? `Return ${deliverable}.` : "Return visible proof that the screenshot was captured."
      ];
    }
    if (actionType === "capture_active_window") {
      return [
        "Detect the active local window for this machine.",
        "Capture the active visible window without widening to generalized desktop actuation.",
        "Persist the screenshot as run evidence and verify that the capture was written.",
        deliverable ? `Return ${deliverable}.` : "Return visible proof that the screenshot was captured."
      ];
    }
    if (actionType === "desktop_autonomy") {
      return [
        "Discover visible windows and installed local applications before choosing an action path.",
        "Use the desktop planner to select a small sequence of governed primitives.",
        "Request approval before launching apps or performing desktop actuation.",
        "Verify each primitive with visible state or persisted proof before continuing."
      ];
    }
  }
  switch (mode) {
    case "form":
      return [
        "Open the controlled form surface for this project.",
        "Apply only the bounded form changes needed for this request, with approvals if required.",
        "Verify the visible review-ready state and stop before submission.",
        deliverable ? `Return ${deliverable}.` : "Return visible proof of the prepared form state."
      ];
    case "computer":
      return [
        "Inspect the allowlisted local window target for this project.",
        "Request approval before changing focus when needed, then observe the visible state.",
        "Capture visible proof tied to the observed local outcome.",
        deliverable ? `Return ${deliverable}.` : "Return a short observation summary tied to the proof."
      ];
    case "research":
    default:
      return [
        "Open the bounded web surfaces already allowlisted for this project.",
        "Collect the relevant findings and keep source-linked proof for each retained page.",
        "Assemble a qualified result tied to those sources and checks.",
        deliverable ? `Return ${deliverable}.` : "Return a short evidence-backed result."
      ];
  }
}

function buildCoverageStatus({ confidence, unsupportedRequests, crossFrameNotice, browserLaunchState }) {
  if (browserLaunchState?.clarificationOptions?.length > 0) {
    return "clarification_needed";
  }
  if (browserLaunchState?.captureRequested && ["launch_browser", "launch_browser_search"].includes(determineComputerActionType(browserLaunchState))) {
    return "partial";
  }
  if (unsupportedRequests.length > 0 || crossFrameNotice) {
    return "partial";
  }
  if (browserLaunchState?.noSupportedBrowser) {
    return "clarification_needed";
  }
  if (confidence === "low") {
    return "clarification_needed";
  }
  return "full";
}

function buildNotCoveredNow({ unsupportedRequests, crossFrameNotice, selectedMode, browserLaunchState }) {
  const items = [...unsupportedRequests];
  const computerActionType = determineComputerActionType(browserLaunchState);
  if (crossFrameNotice) {
    items.push("This run will stay inside one bounded lane and will not silently switch into a second execution mode.");
  }
  if (selectedMode === "computer" && computerActionType === "launch_browser") {
    items.push("This run will only open the chosen browser. It will not silently continue into broader browsing or multi-step desktop automation.");
  }
  if (selectedMode === "computer" && computerActionType === "launch_browser_search") {
    items.push("This run will stop after the bounded browser-search step. It will not silently continue into additional desktop actions.");
  }
  if (selectedMode === "computer" && browserLaunchState?.captureRequested && ["launch_browser", "launch_browser_search"].includes(computerActionType)) {
    items.push("This run will not capture the screenshot yet. The screenshot needs its own bounded follow-up run.");
  }
  if (selectedMode === "research") {
    items.push("This run will not perform general desktop actions outside the bounded browser slice.");
  }
  if (selectedMode === "computer") {
    items.push("This run will not browse arbitrary external web pages as part of the same run.");
  }
  if (selectedMode === "form") {
    items.push("This run will not submit the form or move beyond the bounded preparation step.");
  }
  return Array.from(new Set(items));
}

function buildAmbiguityNote({ confidence, crossFrameNotice, unsupportedRequests }) {
  if (crossFrameNotice) {
    return crossFrameNotice;
  }
  if (unsupportedRequests.length > 0) {
    return "Part of the mission sits outside the currently authorized bounded slice, so the runtime will only cover the safe subset now.";
  }
  if (confidence === "low") {
    return "The request is still broad or underspecified, so the runtime is choosing the safest bounded interpretation.";
  }
  return "";
}

function secondActiveMode(inferred = {}) {
  return inferred.rankedModes?.find(([mode, score]) => mode !== inferred.mode && score > 0)?.[0] ?? null;
}

function thirdActiveMode(inferred = {}, selectedMode) {
  return inferred.rankedModes?.find(([mode, score]) => mode !== selectedMode && mode !== secondActiveMode(inferred) && score > 0)?.[0] ?? null;
}

function recommendationDeliverableForMode(mode) {
  switch (mode) {
    case "form":
      return "Confirmed controlled form state ready for review";
    case "computer":
      return "Visible local proof and short observation summary";
    case "research":
    default:
      return "Evidence-backed findings for the next step";
  }
}

function recommendationObjectiveForMode(mode, input = {}) {
  const baseObjective = String(input.mission ?? input.objective ?? "").trim();
  if (mode === "computer") {
    return baseObjective
      ? "Capture visible local proof for the browser or desktop state that still needs confirmation."
      : "Observe the allowlisted local window and capture visible proof.";
  }
  if (mode === "form") {
    return baseObjective
      ? "Prepare the controlled form with the information already gathered, then stop before submission."
      : "Prepare the controlled form and stop before submission.";
  }
  return baseObjective
    ? "Gather the bounded web information needed before the next step."
    : "Collect the bounded web findings needed for the next step.";
}

function buildRunRecommendation(mode, input = {}, rationale = "", parameters = null) {
  if (!mode) {
    return null;
  }
  return {
    objective: recommendationObjectiveForMode(mode, input),
    deliverable: recommendationDeliverableForMode(mode),
    preferredMode: mode,
    rationale: String(rationale ?? "").trim() || `The next bounded step is ${modePlanLabel(mode)}.`,
    parameters
  };
}

function buildActionLevelRecommendation({ selectedMode, input, browserLaunchState }) {
  if (selectedMode !== "computer") {
    return null;
  }
  const actionType = determineComputerActionType(browserLaunchState);
  if (!browserLaunchState?.captureRequested || !["launch_browser", "launch_browser_search"].includes(actionType)) {
    return null;
  }
  const browserLabel = browserLaunchState.selectedBrowser?.label ?? "the active browser";
  return {
    summary: "After this run, capture visible proof in a second bounded desktop run.",
    recommendation: {
      objective: `Capture a visible screenshot from ${browserLabel} after the browser step completes.`,
      deliverable: "Visible screenshot evidence saved in the run folder",
      preferredMode: "computer",
      rationale: "The browser step and the screenshot step should stay in separate bounded runs so the desktop action remains explicit and verifiable.",
      parameters: {
        browserLaunch: {
          ...(browserLaunchState.selectedBrowser?.id ? { browserId: browserLaunchState.selectedBrowser.id } : {}),
          ...(browserLaunchState.searchQuery ? { searchQuery: browserLaunchState.searchQuery } : {}),
          ...(browserLaunchState.launchUrl ? { url: browserLaunchState.launchUrl } : {})
        },
        computerAction: {
          type: browserLaunchState.selectedBrowser ? "capture_browser_window" : "capture_active_window"
        }
      }
    }
  };
}

function buildNextRunSuggestion({ selectedMode, inferred, requiresClarification, actionLevelRecommendation = null }) {
  if (requiresClarification) {
    return "After you answer the clarification, the cowork will recommend the best next bounded run.";
  }
  if (actionLevelRecommendation?.summary) {
    return actionLevelRecommendation.summary;
  }
  const followUpMode = secondActiveMode(inferred);
  if (!followUpMode) {
    return "No follow-up run is recommended if this run completes as planned.";
  }
  if (followUpMode === "computer") {
    return "After this run, start a local window observation run if you still need visible proof captured from the desktop side.";
  }
  if (followUpMode === "form") {
    return "After this run, start a controlled form-preparation run if you still need the form state prepared.";
  }
  return "After this run, start a bounded web research run if you still need additional information gathered before the next step.";
}

function buildMaybeLaterSuggestion({ inferred, selectedMode, unsupportedRequests, actionLevelRecommendation = null }) {
  const followUpMode = secondActiveMode(inferred);
  const laterMode = inferred.rankedModes?.find(([mode, score]) => mode !== selectedMode && mode !== followUpMode && score > 0)?.[0] ?? null;
  if (actionLevelRecommendation && followUpMode) {
    return `If the mission still needs it after the screenshot step, plan a later ${modePlanLabel(followUpMode)} run rather than widening the current run.`;
  }
  if (laterMode) {
    return `If the mission still needs it after the next step, plan a later ${modePlanLabel(laterMode)} run rather than widening the current run.`;
  }
  if (unsupportedRequests.length > 0) {
    return "Requests outside the bounded product slice would need a separate authorized workflow rather than another run in the current slice.";
  }
  return "No later run is suggested right now.";
}

function buildClarificationQuestion({ selectedMode, inferred, unsupportedRequests, browserLaunchState }) {
  if (browserLaunchState?.launchRequested && browserLaunchState.clarificationOptions?.length > 0) {
    const labels = browserLaunchState.clarificationOptions.map((option) => option.label);
    return `Which browser should I open on this machine? I found ${labels.join(", ")}.`;
  }
  if (browserLaunchState?.launchRequested && browserLaunchState.noSupportedBrowser) {
    return "I could not find a supported browser on this machine. Open one manually or install one before retrying this run.";
  }
  const followUpMode = secondActiveMode(inferred);
  if (unsupportedRequests.length > 0) {
    return "Which safe part of the request should this run focus on first?";
  }
  if (followUpMode === "computer" && selectedMode === "research") {
    return "Should this run focus on finding the information first, or do you want the visible screenshot step to be the priority now?";
  }
  if (followUpMode === "research" && selectedMode === "computer") {
    return "Should this run focus on observing the local window now, or should the cowork start with web research first?";
  }
  if (followUpMode === "form" && selectedMode === "research") {
    return "Should this run focus on gathering the information first, or do you want the controlled form prepared now?";
  }
  if (followUpMode === "research" && selectedMode === "form") {
    return "Should this run prepare the controlled form now, or should the cowork gather the missing information first?";
  }
  if (selectedMode === "computer") {
    return "Do you want this run to observe the local window only, or is there another step you want treated first?";
  }
  if (selectedMode === "form") {
    return "Do you want this run to prepare the controlled form now, or should the cowork handle a different bounded step first?";
  }
  return "Should this run focus on finding the information only, or do you also expect another bounded step to happen first?";
}

function buildClarificationState({ inferred, unsupportedRequests, browserLaunchState }) {
  const requiresClarification = inferred.confidence === "low"
    || Boolean(inferred.crossFrameNotice && inferred.scoreGap <= 1)
    || Boolean(unsupportedRequests.length > 0 && inferred.confidence !== "high")
    || Boolean(browserLaunchState?.clarificationOptions?.length > 0)
    || Boolean(browserLaunchState?.noSupportedBrowser);
  return {
    requiresClarification,
    clarificationQuestion: requiresClarification
      ? buildClarificationQuestion({
        selectedMode: inferred.mode,
        inferred,
        unsupportedRequests,
        browserLaunchState
      })
      : ""
  };
}

export function missionModeToScenarioType(mode) {
  return MODE_TO_SCENARIO_TYPE[mode] ?? null;
}

export function scenarioTypeToMissionMode(scenarioType) {
  return SCENARIO_TYPE_TO_MODE[scenarioType] ?? null;
}

export function detectUnsupportedMissionRequests(input = {}) {
  const text = normalizeSearchText(input);
  return UNSUPPORTED_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.message);
}

export function inferMissionMode(input = {}) {
  const text = normalizeSearchText(input);
  const browserLaunchIntent = detectBrowserLaunchIntent(text);
  const screenshotIntent = detectScreenshotIntent(text);
  const browserSearchIntent = detectBrowserSearchIntent(text);
  const scores = {
    research: scoreKeywords(text, MODE_KEYWORDS.research),
    form: scoreKeywords(text, MODE_KEYWORDS.form),
    computer: scoreKeywords(text, MODE_KEYWORDS.computer)
  };

  if (input.parameters?.formValues) {
    scores.form += 4;
  }
  if (browserLaunchIntent) {
    scores.computer += 5;
  }
  if (screenshotIntent) {
    scores.computer += 3;
  }
  if (detectGeneralDesktopActionIntent(text)) {
    scores.computer += 5;
  }
  if (browserLaunchIntent && browserSearchIntent) {
    scores.computer += 2;
  }

  const ranked = rankModes(scores);
  const [selectedMode, selectedScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const confidence = selectedScore === 0
    ? "low"
    : selectedScore - secondScore >= 2
      ? "high"
      : "medium";

  return {
    mode: selectedMode ?? "research",
    confidence,
    reason: buildRoutingReason(selectedMode ?? "research", scores, text),
    scores,
    rankedModes: ranked,
    scoreGap: selectedScore - secondScore,
    crossFrameNotice: detectCrossFrameNotice(scores),
    browserLaunchIntent
  };
}

export function buildDeterministicMissionUnderstanding(input = {}) {
  const inferred = inferMissionMode({
    objective: input.mission ?? input.objective ?? "",
    deliverable: input.deliverable ?? "",
    constraints: input.constraints ?? input.missionSpec?.constraints ?? [],
    forbiddenActions: input.forbiddenActions ?? input.missionSpec?.forbiddenActions ?? [],
    parameters: input.missionSpec?.parameters ?? input.parameters ?? {}
  });
  const explicitScenarioType = String(input.scenarioType ?? "").trim();
  const selectedMode = scenarioTypeToMissionMode(explicitScenarioType) ?? inferred.mode;
  const browserLaunchState = buildBrowserLaunchState(input, inferred);
  const chosenExecutionFrame = explicitScenarioType || missionModeToScenarioType(selectedMode) || "research";
  const unsupportedRequests = [
    ...detectUnsupportedMissionRequests({
      objective: input.mission ?? input.objective ?? "",
      deliverable: input.deliverable ?? "",
      constraints: input.constraints ?? input.missionSpec?.constraints ?? [],
      forbiddenActions: input.forbiddenActions ?? input.missionSpec?.forbiddenActions ?? []
    }),
    ...(browserLaunchState.noSupportedBrowser ? ["No supported browser is currently available on this machine for a bounded browser-launch step."] : []),
    ...(inferred.crossFrameNotice ? [inferred.crossFrameNotice] : [])
  ];
  const coverageStatus = buildCoverageStatus({
    confidence: inferred.confidence,
    unsupportedRequests,
    crossFrameNotice: inferred.crossFrameNotice,
    browserLaunchState
  });
  const coveredNow = requestedOutcomesForMode(selectedMode, input, browserLaunchState);
  const notCoveredNow = buildNotCoveredNow({
    unsupportedRequests,
    crossFrameNotice: inferred.crossFrameNotice,
    selectedMode,
    browserLaunchState
  });
  const clarificationState = buildClarificationState({
    inferred,
    unsupportedRequests,
    browserLaunchState
  });
  const ambiguityNote = buildAmbiguityNote({
    confidence: inferred.confidence,
    crossFrameNotice: inferred.crossFrameNotice,
    unsupportedRequests
  });
  const runNowPlan = runNowPlanForMode(selectedMode, input, browserLaunchState);
  const computerActionType = selectedMode === "computer"
    ? determineComputerActionType(browserLaunchState)
    : null;
  const followUpMode = secondActiveMode(inferred);
  const laterMode = thirdActiveMode(inferred, selectedMode);
  const actionLevelRecommendation = buildActionLevelRecommendation({
    selectedMode,
    input,
    browserLaunchState
  });
  const nextRunSuggestion = buildNextRunSuggestion({
    selectedMode,
    inferred,
    requiresClarification: clarificationState.requiresClarification,
    actionLevelRecommendation
  });
  const maybeLaterSuggestion = buildMaybeLaterSuggestion({
    inferred,
    selectedMode,
    unsupportedRequests,
    actionLevelRecommendation
  });

  return {
    missionSummary: String(input.mission ?? input.objective ?? "Unknown mission").trim() || "Unknown mission",
    clarifiedObjective: String(input.mission ?? input.objective ?? "Unknown mission").trim() || "Unknown mission",
    chosenExecutionFrame,
    routingConfidence: explicitScenarioType ? inferred.confidence : inferred.confidence,
    whyThisFrame: explicitScenarioType
      ? `The runtime selected ${explicitScenarioType}; mission-understanding keeps that bounded lane and qualifies the mission inside it.`
      : inferred.reason,
    coverageStatus,
    coveredNow,
    notCoveredNow,
    requestedOutcomes: coveredNow,
    verificationGoals: verificationGoalsForMode(selectedMode, browserLaunchState),
    runNowPlan,
    nextRunSuggestion,
    nextRunRecommendation: clarificationState.requiresClarification
      ? null
      : (actionLevelRecommendation?.recommendation ?? buildRunRecommendation(followUpMode, input, nextRunSuggestion)),
    maybeLaterSuggestion,
    maybeLaterRecommendation: actionLevelRecommendation
      ? buildRunRecommendation(followUpMode, input, maybeLaterSuggestion)
      : buildRunRecommendation(laterMode, input, maybeLaterSuggestion),
    unsupportedRequests,
    operatorBoundary: "The operator remains the approval authority and the runtime must stay inside one bounded execution frame.",
    ambiguityNote,
    computerActionType,
    selectedBrowser: browserChoiceSummary(browserLaunchState.selectedBrowser),
    browserSearchQuery: browserLaunchState.searchQuery || "",
    browserLaunchUrl: browserLaunchState.launchUrl ?? null,
    clarificationOptions: browserLaunchState.clarificationOptions,
    requiresClarification: clarificationState.requiresClarification,
    clarificationQuestion: clarificationState.clarificationQuestion
  };
}

function structuredStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function validateRecommendationObject(value, label) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object or null.`), {
      category: "malformed_output"
    });
  }
  const objective = String(value.objective ?? "").trim();
  const deliverable = String(value.deliverable ?? "").trim();
  const preferredMode = String(value.preferredMode ?? "").trim();
  const rationale = String(value.rationale ?? "").trim();
  const parameters = value.parameters && typeof value.parameters === "object" && !Array.isArray(value.parameters)
    ? {
      ...(value.parameters.browserLaunch && typeof value.parameters.browserLaunch === "object" && !Array.isArray(value.parameters.browserLaunch)
        ? {
          browserLaunch: {
            ...(value.parameters.browserLaunch.browserId ? { browserId: String(value.parameters.browserLaunch.browserId).trim().toLowerCase() } : {}),
            ...(value.parameters.browserLaunch.searchQuery ? { searchQuery: String(value.parameters.browserLaunch.searchQuery).trim() } : {}),
            ...(value.parameters.browserLaunch.url ? { url: String(value.parameters.browserLaunch.url).trim() } : {})
          }
        }
        : {}),
      ...(value.parameters.computerAction && typeof value.parameters.computerAction === "object" && !Array.isArray(value.parameters.computerAction)
        ? {
          computerAction: {
            ...(value.parameters.computerAction.type ? { type: String(value.parameters.computerAction.type).trim() } : {})
          }
        }
        : {})
    }
    : null;
  if (!objective || !deliverable || !preferredMode || !rationale) {
    return null;
  }
  if (!["research", "form", "computer"].includes(preferredMode)) {
    return null;
  }
  return {
    objective,
    deliverable,
    preferredMode,
    rationale,
    parameters
  };
}

function validateBrowserChoice(value, label) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object or null.`), {
      category: "malformed_output"
    });
  }
  const id = String(value.id ?? "").trim().toLowerCase();
  const labelText = String(value.label ?? "").trim();
  if (!id || !labelText) {
    throw Object.assign(new Error(`${label} is missing required fields.`), {
      category: "malformed_output"
    });
  }
  return {
    id,
    label: labelText
  };
}

function validateBrowserChoiceArray(value, label) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an array.`), {
      category: "malformed_output"
    });
  }
  return value.map((entry, index) => validateBrowserChoice(entry, `${label}[${index}]`)).filter(Boolean);
}

function reconcileBrowserLaunchOutput(validated, context = {}) {
  const browserCatalog = normalizeBrowserCatalog(context.availableBrowsers ?? []);
  if (!["launch_browser", "launch_browser_search", "capture_browser_window"].includes(validated.computerActionType)) {
    return {
      ...validated,
      selectedBrowser: null,
      clarificationOptions: []
    };
  }

  let selectedBrowser = validated.selectedBrowser
    ? browserChoiceSummary(browserCatalog.find((browser) => browser.id === validated.selectedBrowser.id) ?? null)
    : null;
  let clarificationOptions = validated.clarificationOptions
    .map((option) => browserChoiceSummary(browserCatalog.find((browser) => browser.id === option.id) ?? null))
    .filter(Boolean);
  let requiresClarification = validated.requiresClarification;
  let clarificationQuestion = validated.clarificationQuestion;

  if (browserCatalog.length === 1 && !selectedBrowser) {
    selectedBrowser = browserChoiceSummary(browserCatalog[0]);
    clarificationOptions = [];
    requiresClarification = false;
    clarificationQuestion = "";
  }

  if (browserCatalog.length > 1 && !selectedBrowser) {
    if (clarificationOptions.length === 0) {
      clarificationOptions = browserCatalog.map(browserChoiceSummary).filter(Boolean);
    }
    requiresClarification = true;
    clarificationQuestion = clarificationQuestion || `Which browser should I open on this machine? I found ${clarificationOptions.map((option) => option.label).join(", ")}.`;
  }

  if (browserCatalog.length === 0) {
    selectedBrowser = null;
    clarificationOptions = [];
    requiresClarification = true;
    clarificationQuestion = clarificationQuestion || "I could not find a supported browser on this machine. Open one manually or install one before retrying this run.";
  }

  return {
    ...validated,
    selectedBrowser,
    clarificationOptions,
    requiresClarification,
    clarificationQuestion
  };
}

export function validateMissionUnderstandingOutput(output, context = {}) {
  if (!output || typeof output !== "object") {
    throw Object.assign(new Error("Mission understanding output must be an object."), {
      category: "malformed_output"
    });
  }
  const missionSummary = String(output.missionSummary ?? "").trim();
  const clarifiedObjective = String(output.clarifiedObjective ?? "").trim();
  const chosenExecutionFrame = String(output.chosenExecutionFrame ?? "").trim();
  const routingConfidence = String(output.routingConfidence ?? "").trim().toLowerCase();
  const whyThisFrame = String(output.whyThisFrame ?? "").trim();
  const operatorBoundary = String(output.operatorBoundary ?? "").trim();
  const coverageStatus = String(output.coverageStatus ?? "").trim().toLowerCase();
  const ambiguityNote = String(output.ambiguityNote ?? "").trim();
  const nextRunSuggestion = String(output.nextRunSuggestion ?? "").trim();
  const maybeLaterSuggestion = String(output.maybeLaterSuggestion ?? "").trim();
  const nextRunRecommendation = validateRecommendationObject(output.nextRunRecommendation ?? null, "nextRunRecommendation");
  const maybeLaterRecommendation = validateRecommendationObject(output.maybeLaterRecommendation ?? null, "maybeLaterRecommendation");
  const computerActionType = output.computerActionType == null ? null : String(output.computerActionType).trim();
  const browserSearchQuery = String(output.browserSearchQuery ?? "").trim();
  const browserLaunchUrl = output.browserLaunchUrl == null ? null : String(output.browserLaunchUrl).trim();
  const selectedBrowser = validateBrowserChoice(output.selectedBrowser ?? null, "selectedBrowser");
  const clarificationOptions = validateBrowserChoiceArray(output.clarificationOptions ?? [], "clarificationOptions");
  const requiresClarification = Boolean(output.requiresClarification);
  const clarificationQuestion = String(output.clarificationQuestion ?? "").trim();

  if (!missionSummary || !clarifiedObjective || !whyThisFrame || !operatorBoundary) {
    throw Object.assign(new Error("Mission understanding output is missing required narrative fields."), {
      category: "malformed_output"
    });
  }
  if (!["research", "form_preparation", "computer_observation"].includes(chosenExecutionFrame)) {
    throw Object.assign(new Error("Mission understanding output must select a valid execution frame."), {
      category: "malformed_output"
    });
  }
  if (!["low", "medium", "high"].includes(routingConfidence)) {
    throw Object.assign(new Error("Mission understanding output must contain a valid routing confidence."), {
      category: "malformed_output"
    });
  }
  if (!["full", "partial", "clarification_needed"].includes(coverageStatus)) {
    throw Object.assign(new Error("Mission understanding output must contain a valid coverage status."), {
      category: "malformed_output"
    });
  }
  if (computerActionType != null && !["observe_window", "launch_browser", "launch_browser_search", "capture_browser_window", "capture_active_window", "desktop_autonomy"].includes(computerActionType)) {
    throw Object.assign(new Error("Mission understanding output must contain a valid computerActionType."), {
      category: "malformed_output"
    });
  }
  if (browserLaunchUrl && !/^https?:\/\//i.test(browserLaunchUrl)) {
    throw Object.assign(new Error("Mission understanding output must contain a valid browserLaunchUrl when provided."), {
      category: "malformed_output"
    });
  }

  const coveredNow = structuredStringArray(output.coveredNow ?? output.requestedOutcomes ?? [], "coveredNow");
  const notCoveredNow = structuredStringArray(output.notCoveredNow ?? [], "notCoveredNow");
  const requestedOutcomes = structuredStringArray(output.requestedOutcomes ?? output.coveredNow ?? [], "requestedOutcomes");
  const verificationGoals = structuredStringArray(output.verificationGoals ?? [], "verificationGoals");
  const runNowPlan = structuredStringArray(output.runNowPlan ?? output.coveredNow ?? output.requestedOutcomes ?? [], "runNowPlan");
  const unsupportedRequests = structuredStringArray(output.unsupportedRequests ?? [], "unsupportedRequests");
  if (runNowPlan.length === 0) {
    throw Object.assign(new Error("Mission understanding output must contain a non-empty runNowPlan."), {
      category: "malformed_output"
    });
  }

  const validated = {
    missionSummary,
    clarifiedObjective,
    chosenExecutionFrame,
    routingConfidence,
    coverageStatus,
    whyThisFrame,
    coveredNow,
    notCoveredNow,
    requestedOutcomes,
    verificationGoals,
    runNowPlan,
    nextRunSuggestion: nextRunSuggestion || "No follow-up run is recommended if this run completes as planned.",
    nextRunRecommendation,
    maybeLaterSuggestion: maybeLaterSuggestion || "No later run is suggested right now.",
    maybeLaterRecommendation,
    unsupportedRequests,
    operatorBoundary,
    ambiguityNote,
    computerActionType,
    browserSearchQuery,
    browserLaunchUrl,
    selectedBrowser,
    clarificationOptions,
    requiresClarification,
    clarificationQuestion: requiresClarification
      ? (clarificationQuestion || "What should this run prioritize first?")
      : ""
  };
  return reconcileBrowserLaunchOutput(validated, context);
}
