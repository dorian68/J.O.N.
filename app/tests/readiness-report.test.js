import assert from "node:assert/strict";
import { buildReadinessReport, classifyReadiness } from "../src/release/readiness-report.js";

function baseDoctorReport(overrides = {}) {
  return {
    status: "warn",
    blocks: [],
    checks: {
      llmRuntime: {
        liveProviderConfigured: false,
        secretSource: "env"
      },
      promptRegistry: {
        status: "pass"
      },
      realSurfaceHarness: {
        latestPackExists: true
      }
    },
    ...overrides
  };
}

function baseValidationSummary(overrides = {}) {
  return {
    overallStatus: "incomplete",
    counts: {
      pass: 0,
      partial: 0,
      fail: 0,
      blocked: 0,
      missing: 4
    },
    ...overrides
  };
}

function baseProofArtifacts(overrides = {}) {
  return {
    tests: {
      status: "pass",
      proven: true
    },
    secretStoreSmoke: {
      status: "pass",
      proven: true
    },
    llmSmoke: {
      liveSuccess: {
        status: "missing",
        proven: false
      },
      providerUnavailable: {
        status: "pass",
        proven: true
      },
      runtimeDegraded: {
        status: "pass",
        proven: true
      }
    },
    desktop: {
      bundle: {
        status: "pass",
        proven: true
      },
      smoke: {
        status: "pass",
        proven: true
      },
      dryRun: {
        status: "pass",
        proven: true
      }
    },
    validationSummary: {
      status: "present"
    },
    ...overrides
  };
}

export async function run() {
  const stronger = classifyReadiness({
    doctorReport: baseDoctorReport(),
    validationSummary: baseValidationSummary(),
    proofArtifacts: baseProofArtifacts()
  });
  assert.equal(stronger.currentLevel, "stronger-local-build");
  assert.equal(stronger.tiers.strongerLocalBuild, true);
  assert.equal(stronger.tiers.pilotCredibleLocalBuild, false);

  const pilotCredible = classifyReadiness({
    doctorReport: baseDoctorReport({
      status: "pass",
      checks: {
        llmRuntime: {
          liveProviderConfigured: true,
          secretSource: "os_secret_store"
        },
        promptRegistry: {
          status: "pass"
        },
        realSurfaceHarness: {
          latestPackExists: true
        }
      }
    }),
    validationSummary: baseValidationSummary({
      overallStatus: "all_passed"
    }),
    proofArtifacts: baseProofArtifacts({
      llmSmoke: {
        liveSuccess: {
          status: "pass",
          proven: true
        },
        providerUnavailable: {
          status: "pass",
          proven: true
        },
        runtimeDegraded: {
          status: "pass",
          proven: true
        }
      }
    })
  });
  assert.equal(pilotCredible.currentLevel, "pilot-credible-local-build");
  assert.equal(pilotCredible.tiers.productionCandidate, false);

  const report = await buildReadinessReport({
    proofArtifacts: baseProofArtifacts(),
    operationalDeep: {
      classification: {
        implementationStatus: "operational_deep_contract",
        fieldProofStatus: "partial"
      }
    },
    promptRegistryLoader: async () => ({
      environment: "prototype",
      prompts: new Map([["system.primary_reasoning@1.0.0", {}]])
    }),
    secretStore: {
      getStatus: async () => ({
        available: false,
        configured: false,
        backend: "unsupported"
      }),
      getSecret: async () => null
    },
    env: {
      COWORK_LLM_PROVIDER_MODE: "openai_compatible",
      COWORK_OPENAI_API_KEY: "env-secret",
      COWORK_OPERATOR_BASE_URL: "http://127.0.0.1:41732",
      COWORK_DESKTOP_BROWSER_PATH: "C:\\fake\\browser.exe"
    }
  });
  assert.equal(report.classification.currentLevel, "stronger-local-build");
  assert.equal(report.operationalDeep.classification.implementationStatus, "operational_deep_contract");
  assert.equal(report.tiers.productionReady, false);
}
