import fs from "node:fs/promises";
import path from "node:path";
import { REAL_SURFACE_VALIDATION_ROOT } from "../config.js";

export const DEFAULT_REAL_SURFACE_RUNTIME_CONFIG_PATH = path.join(
  REAL_SURFACE_VALIDATION_ROOT,
  "real-surface-runtime.local.json"
);

const DEFAULT_RESEARCH_MISSION = "Compare the controlled candidate pages and produce a note de decision.";
const DEFAULT_REAL_WEB_RESEARCH_MISSION = "Compare the allowlisted real web pages and produce a note de decision.";
const DEFAULT_FIXTURE_COMPUTER_MISSION = "Verify the controlled allowlisted local window reaches ready state.";
const DEFAULT_REAL_WINDOW_MISSION = "Verify the allowlisted local window is focused and visibly evidenced without generalized desktop actuation.";

const FIXTURE_LINK_SPECS = Object.freeze([
  { testId: "link-alpha", title: "Alpha Analytics" },
  { testId: "link-beta", title: "Beta Commerce" },
  { testId: "link-gamma", title: "Gamma Ops" }
]);

const FIXTURE_FIELD_MAP = Object.freeze({
  companyName: { testId: "company-name" },
  tagline: { testId: "company-tagline" },
  priceLevel: { testId: "price-level" },
  deliverySpeed: { testId: "delivery-speed" },
  riskNote: { testId: "risk-note" }
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHostname(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isLoopbackHost(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(normalizeHostname(hostname));
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function ensureSelectorSpec(value, label) {
  if (!isObject(value)) {
    throw new Error(`${label} must be an object selector spec.`);
  }
  return value;
}

function normalizeFieldMap(fieldMap = {}, labelPrefix = "fieldMap") {
  if (!isObject(fieldMap)) {
    throw new Error(`${labelPrefix} must be an object.`);
  }

  return Object.entries(fieldMap).reduce((accumulator, [key, value]) => {
    accumulator[key] = ensureSelectorSpec(value, `${labelPrefix}.${key}`);
    return accumulator;
  }, {});
}

function normalizeResearchTarget(target, index) {
  if (!isObject(target)) {
    throw new Error(`research.targets[${index}] must be an object.`);
  }

  const url = new URL(String(target.url ?? ""));
  if (url.protocol !== "https:") {
    throw new Error(`research.targets[${index}] must use https.`);
  }
  if (isLoopbackHost(url.hostname)) {
    throw new Error(`research.targets[${index}] must not point to a loopback host in allowlisted_real_web mode.`);
  }

  const title = String(target.title ?? "").trim();
  if (!title) {
    throw new Error(`research.targets[${index}] must define a title.`);
  }

  const fieldMap = normalizeFieldMap(target.fieldMap ?? {}, `research.targets[${index}].fieldMap`);
  const staticValues = isObject(target.staticValues) ? { ...target.staticValues } : {};
  staticValues.companyName = String(staticValues.companyName ?? title).trim() || title;
  staticValues.tagline = String(staticValues.tagline ?? `Observed on ${url.hostname}`).trim();
  staticValues.priceLevel = String(staticValues.priceLevel ?? "not_applicable").trim();
  staticValues.deliverySpeed = String(staticValues.deliverySpeed ?? "not_applicable").trim();
  staticValues.riskNote = String(staticValues.riskNote ?? `Read-only allowlisted real web page: ${url.hostname}`).trim();

  return {
    title,
    url: url.toString(),
    waitFor: target.waitFor ? ensureSelectorSpec(target.waitFor, `research.targets[${index}].waitFor`) : null,
    fieldMap,
    staticValues,
    trustClassification: "allowlisted_real_web",
    evidenceSensitivity: "allowlisted_real_web"
  };
}

function normalizeWindowMatch(windowMatch) {
  if (!isObject(windowMatch)) {
    throw new Error("computer.windowMatch must be an object.");
  }

  const normalized = {
    handleEquals: String(windowMatch.handleEquals ?? "").trim() || null,
    titleEquals: String(windowMatch.titleEquals ?? "").trim() || null,
    titleIncludes: String(windowMatch.titleIncludes ?? "").trim() || null,
    titlePattern: String(windowMatch.titlePattern ?? "").trim() || null,
    titlePatternFlags: String(windowMatch.titlePatternFlags ?? "").trim() || "i"
  };

  if (!normalized.handleEquals && !normalized.titleEquals && !normalized.titleIncludes && !normalized.titlePattern) {
    throw new Error("computer.windowMatch must define handleEquals, titleEquals, titleIncludes, or titlePattern.");
  }

  return normalized;
}

function normalizeRuntimeConfig(rawConfig = {}) {
  if (!isObject(rawConfig)) {
    throw new Error("Real-surface runtime config must be an object.");
  }

  const researchMode = rawConfig.research?.mode === "allowlisted_real_web"
    ? "allowlisted_real_web"
    : "controlled_fixture";
  const computerMode = rawConfig.computer?.mode === "real_local_window"
    ? "real_local_window"
    : "controlled_fixture_window";

  return {
    research: researchMode === "allowlisted_real_web"
      ? {
        mode: researchMode,
        mission: String(rawConfig.research?.mission ?? DEFAULT_REAL_WEB_RESEARCH_MISSION).trim() || DEFAULT_REAL_WEB_RESEARCH_MISSION,
        targets: (rawConfig.research?.targets ?? []).map((target, index) => normalizeResearchTarget(target, index))
      }
      : {
        mode: "controlled_fixture",
        mission: String(rawConfig.research?.mission ?? DEFAULT_RESEARCH_MISSION).trim() || DEFAULT_RESEARCH_MISSION
      },
    computer: computerMode === "real_local_window"
      ? {
        mode: computerMode,
        mission: String(rawConfig.computer?.mission ?? DEFAULT_REAL_WINDOW_MISSION).trim() || DEFAULT_REAL_WINDOW_MISSION,
        windowMatch: normalizeWindowMatch(rawConfig.computer?.windowMatch ?? {}),
        expectedTitle: String(rawConfig.computer?.expectedTitle ?? "").trim() || null
      }
      : {
        mode: "controlled_fixture_window",
        mission: String(rawConfig.computer?.mission ?? DEFAULT_FIXTURE_COMPUTER_MISSION).trim() || DEFAULT_FIXTURE_COMPUTER_MISSION
      }
  };
}

function hostnameFor(url) {
  return new URL(url).hostname;
}

export async function loadRealSurfaceRuntimeConfig({
  env = process.env,
  filePath = env.COWORK_REAL_SURFACE_CONFIG_PATH || DEFAULT_REAL_SURFACE_RUNTIME_CONFIG_PATH
} = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return {
      filePath,
      loadedFromFile: true,
      ...normalizeRuntimeConfig(JSON.parse(content))
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        filePath,
        loadedFromFile: false,
        ...normalizeRuntimeConfig({})
      };
    }
    throw error;
  }
}

export function buildResearchScenarioDefinition({ fixtureManifest, runtimeConfig }) {
  const research = runtimeConfig?.research ?? normalizeRuntimeConfig({}).research;
  if (research.mode === "allowlisted_real_web") {
    if (!Array.isArray(research.targets) || research.targets.length < 2) {
      throw new Error("allowlisted_real_web research mode requires at least two targets.");
    }
    return {
      mode: "allowlisted_real_web",
      mission: research.mission,
      allowlistedDomains: uniqueStrings(research.targets.map((target) => hostnameFor(target.url))),
      targets: research.targets,
      sourceTrustClassification: "allowlisted_real_web",
      evidenceSensitivity: "allowlisted_real_web"
    };
  }

  return {
    mode: "controlled_fixture",
    mission: research.mission,
    allowlistedDomains: uniqueStrings([hostnameFor(fixtureManifest.baseUrl)]),
    hubUrl: fixtureManifest.hub,
    linkSpecs: FIXTURE_LINK_SPECS,
    fieldMap: FIXTURE_FIELD_MAP,
    sourceTrustClassification: "controlled_fixture",
    evidenceSensitivity: "controlled_fixture"
  };
}

export function matchesWindowMatch(windowState, windowMatch) {
  if (!windowState) {
    return false;
  }

  const windowId = String(windowState.id ?? "").trim();
  const title = String(windowState.title ?? "").trim();

  if (windowMatch.handleEquals && windowId !== windowMatch.handleEquals) {
    return false;
  }
  if (windowMatch.titleEquals && title !== windowMatch.titleEquals) {
    return false;
  }
  if (windowMatch.titleIncludes && !title.toLowerCase().includes(windowMatch.titleIncludes.toLowerCase())) {
    return false;
  }
  if (windowMatch.titlePattern) {
    const expression = new RegExp(windowMatch.titlePattern, windowMatch.titlePatternFlags || "i");
    if (!expression.test(title)) {
      return false;
    }
  }
  return true;
}

export function selectAllowlistedWindow(visibleWindows = [], windowMatch) {
  return visibleWindows.find((windowState) => matchesWindowMatch(windowState, windowMatch)) ?? null;
}

export function describeWindowMatch(windowMatch) {
  if (windowMatch.handleEquals) {
    return `handle=${windowMatch.handleEquals}`;
  }
  if (windowMatch.titleEquals) {
    return `title="${windowMatch.titleEquals}"`;
  }
  if (windowMatch.titleIncludes) {
    return `title includes "${windowMatch.titleIncludes}"`;
  }
  if (windowMatch.titlePattern) {
    return `title pattern /${windowMatch.titlePattern}/${windowMatch.titlePatternFlags || "i"}`;
  }
  return "unspecified window rule";
}

export function buildComputerObservationScenarioDefinition({ runtimeConfig }) {
  const computer = runtimeConfig?.computer ?? normalizeRuntimeConfig({}).computer;
  if (computer.mode === "real_local_window") {
    return {
      mode: "real_local_window",
      mission: computer.mission,
      windowMatch: computer.windowMatch,
      surfaceClassification: "real_local_window",
      evidenceSensitivity: "real_local_window",
      expectedTitle: computer.expectedTitle
    };
  }

  return {
    mode: "controlled_fixture_window",
    mission: computer.mission,
    windowMatch: {
      titleEquals: "Controlled Browser Fixture Window"
    },
    fixtureWindows: {
      allowlistedWindowId: "win_hub",
      prerequisiteWindowId: "win_notes"
    },
    surfaceClassification: "controlled_fixture_window",
    evidenceSensitivity: "controlled_fixture_window",
    expectedTitle: "Controlled Browser Fixture Window"
  };
}

export function buildProjectAllowlistedDomains({ fixtureManifest, runtimeConfig }) {
  const research = buildResearchScenarioDefinition({
    fixtureManifest,
    runtimeConfig
  });
  return uniqueStrings([
    hostnameFor(fixtureManifest.baseUrl),
    ...research.allowlistedDomains
  ]);
}
