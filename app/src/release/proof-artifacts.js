import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_ROOT,
  DIST_ROOT,
  LOGS_ROOT,
  REAL_SURFACE_VALIDATION_ROOT,
  RELEASE_ROOT
} from "../config.js";

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findMatchingLogEntry({ logPath, requestId, eventType }) {
  if (!requestId || !(await fileExists(logPath))) {
    return null;
  }
  const raw = await fs.readFile(logPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.requestId === requestId && (!eventType || parsed.type === eventType)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function evaluateSimpleSmoke(smoke) {
  if (!smoke) {
    return {
      status: "missing",
      proven: false
    };
  }

  return {
    status: smoke.status === "pass" ? "pass" : "fail",
    proven: smoke.status === "pass"
  };
}

async function evaluateLiveSuccess({ smokeRoot, logPath }) {
  const payload = await readJsonIfExists(path.join(smokeRoot, "live-success.json"));
  if (!payload) {
    return {
      status: "missing",
      proven: false,
      payload: null,
      logEntry: null
    };
  }

  const logEntry = await findMatchingLogEntry({
    logPath,
    requestId: payload.requestId,
    eventType: "llm.gateway.request.succeeded"
  });

  const proven = payload.status === "pass"
    && payload.providerAlias === "openai_compatible"
    && Array.isArray(payload.fallbackChain)
    && payload.fallbackChain.length === 0
    && Boolean(payload.requestId)
    && Number.isFinite(payload.latencyMs)
    && Boolean(logEntry);

  return {
    status: proven ? "pass" : "fail",
    proven,
    payload,
    logEntry
  };
}

function evaluateDesktopArtifact(payload, {
  expectedStatus = "pass",
  requiredField = null
} = {}) {
  if (!payload) {
    return {
      status: "missing",
      proven: false
    };
  }

  const proven = payload.status === expectedStatus && (!requiredField || payload[requiredField]);
  return {
    status: proven ? "pass" : "fail",
    proven: Boolean(proven),
    payload
  };
}

export async function collectProofArtifacts({
  releaseRoot = RELEASE_ROOT,
  smokeRoot = path.join(DATA_ROOT, "smoke"),
  logPath = path.join(LOGS_ROOT, "llm-runtime.jsonl"),
  distRoot = DIST_ROOT,
  validationRoot = REAL_SURFACE_VALIDATION_ROOT
} = {}) {
  const [
    testReport,
    secretStoreSmoke,
    desktopBundleReport,
    desktopSmokeReport,
    desktopDryRunReport,
    validationSummary
  ] = await Promise.all([
    readJsonIfExists(path.join(releaseRoot, "test-report-latest.json")),
    readJsonIfExists(path.join(releaseRoot, "secret-store-smoke-latest.json")),
    readJsonIfExists(path.join(releaseRoot, "desktop-shell-bundle-latest.json")),
    readJsonIfExists(path.join(releaseRoot, "desktop-shell-smoke-latest.json")),
    readJsonIfExists(path.join(releaseRoot, "desktop-shell-dry-run-latest.json")),
    readJsonIfExists(path.join(validationRoot, "validation-summary-latest.json"))
  ]);

  const [
    providerUnavailable,
    runtimeDegraded,
    liveSuccess
  ] = await Promise.all([
    readJsonIfExists(path.join(smokeRoot, "provider-unavailable.json")),
    readJsonIfExists(path.join(smokeRoot, "runtime-degraded.json")),
    evaluateLiveSuccess({
      smokeRoot,
      logPath
    })
  ]);

  return {
    paths: {
      releaseRoot,
      smokeRoot,
      logPath,
      distRoot,
      validationRoot
    },
    tests: {
      status: testReport?.status ?? "missing",
      proven: testReport?.status === "pass",
      payload: testReport
    },
    secretStoreSmoke: evaluateSimpleSmoke(secretStoreSmoke),
    llmSmoke: {
      liveSuccess,
      providerUnavailable: {
        ...evaluateSimpleSmoke(providerUnavailable),
        payload: providerUnavailable
      },
      runtimeDegraded: {
        ...evaluateSimpleSmoke(runtimeDegraded),
        payload: runtimeDegraded
      }
    },
    desktop: {
      bundle: evaluateDesktopArtifact(desktopBundleReport, {
        expectedStatus: "ready",
        requiredField: "manifestPath"
      }),
      smoke: evaluateDesktopArtifact(desktopSmokeReport, {
        expectedStatus: "pass",
        requiredField: "manifestPath"
      }),
      dryRun: evaluateDesktopArtifact(desktopDryRunReport, {
        expectedStatus: "ready",
        requiredField: "operatorBaseUrl"
      })
    },
    validationSummary: validationSummary
      ? {
        status: "present",
        payload: validationSummary
      }
      : {
        status: "missing",
        payload: null
      }
  };
}
