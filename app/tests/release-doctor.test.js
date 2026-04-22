import assert from "node:assert/strict";
import { buildReleaseDoctorReport } from "../src/release/release-doctor.js";

export async function run() {
  const report = await buildReleaseDoctorReport({
    env: {
      COWORK_LLM_PROVIDER_MODE: "mock_offline",
      COWORK_OPERATOR_BASE_URL: "http://127.0.0.1:41732",
      COWORK_DESKTOP_BROWSER_PATH: "C:\\fake\\browser.exe"
    },
    secretStore: {
      getStatus: async () => ({
        available: false,
        configured: false,
        backend: "unsupported"
      }),
      getSecret: async () => null
    },
    promptRegistryLoader: async () => ({
      environment: "prototype",
      prompts: new Map([
        ["system.primary_reasoning@1.0.0", {}]
      ])
    }),
    proofArtifacts: {
      tests: {
        status: "pass",
        proven: true
      },
      secretStoreSmoke: {
        status: "missing",
        proven: false
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
        status: "present",
        payload: {
          overallStatus: "incomplete"
        }
      }
    }
  });

  assert.ok(["warn", "pass"].includes(report.status));
  assert.equal(report.checks.promptRegistry.status, "pass");
  assert.equal(report.checks.desktopShellFoundation.operatorBaseUrl, "http://127.0.0.1:41732");
  assert.equal(report.checks.realSurfaceHarness.scenarioCount >= 4, true);
  assert.equal(report.checks.proofArtifacts.tests.proven, true);
}
