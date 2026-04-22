import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildComputerObservationScenarioDefinition,
  buildProjectAllowlistedDomains,
  buildResearchScenarioDefinition,
  loadRealSurfaceRuntimeConfig,
  matchesWindowMatch,
  selectAllowlistedWindow
} from "../src/validation/real-surface-runtime-config.js";

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

const FIXTURE_MANIFEST = Object.freeze({
  baseUrl: "http://127.0.0.1:41731",
  hub: "http://127.0.0.1:41731/hub"
});

export async function run() {
  const tempDir = await makeTempDir("real-surface-config");
  const missingPath = path.join(tempDir, "missing-runtime-config.json");
  const defaultConfig = await loadRealSurfaceRuntimeConfig({ filePath: missingPath });

  assert.equal(defaultConfig.loadedFromFile, false);
  assert.equal(defaultConfig.research.mode, "controlled_fixture");
  assert.equal(defaultConfig.computer.mode, "controlled_fixture_window");

  const configPath = path.join(tempDir, "real-surface-runtime.local.json");
  await fs.writeFile(configPath, JSON.stringify({
    research: {
      mode: "allowlisted_real_web",
      mission: "Review the allowlisted public pages only.",
      targets: [
        {
          title: "Example Dot Com",
          url: "https://example.com/",
          fieldMap: {
            companyName: { css: "h1" }
          },
          staticValues: {
            tagline: "Example Domain",
            riskNote: "Static public documentation page."
          }
        },
        {
          title: "Example Dot Org",
          url: "https://example.org/",
          fieldMap: {
            companyName: { css: "h1" }
          },
          staticValues: {
            tagline: "Example Domain"
          }
        }
      ]
    },
    computer: {
      mode: "real_local_window",
      mission: "Observe the allowlisted local PowerShell window only.",
      windowMatch: {
        titleIncludes: "Allowlisted Observation Window"
      }
    }
  }, null, 2), "utf8");

  const runtimeConfig = await loadRealSurfaceRuntimeConfig({ filePath: configPath });
  const researchDefinition = buildResearchScenarioDefinition({
    fixtureManifest: FIXTURE_MANIFEST,
    runtimeConfig
  });
  const computerDefinition = buildComputerObservationScenarioDefinition({ runtimeConfig });
  const allowlistedDomains = buildProjectAllowlistedDomains({
    fixtureManifest: FIXTURE_MANIFEST,
    runtimeConfig
  });

  assert.equal(runtimeConfig.loadedFromFile, true);
  assert.equal(researchDefinition.mode, "allowlisted_real_web");
  assert.equal(researchDefinition.targets.length, 2);
  assert.equal(researchDefinition.targets[0].trustClassification, "allowlisted_real_web");
  assert.equal(researchDefinition.targets[0].evidenceSensitivity, "allowlisted_real_web");
  assert.deepEqual(researchDefinition.allowlistedDomains.sort(), ["example.com", "example.org"]);
  assert.deepEqual(allowlistedDomains.sort(), ["127.0.0.1", "example.com", "example.org"]);

  assert.equal(computerDefinition.mode, "real_local_window");
  assert.equal(computerDefinition.surfaceClassification, "real_local_window");
  assert.equal(matchesWindowMatch({
    id: "hwnd-1234",
    title: "PowerShell - Allowlisted Observation Window"
  }, runtimeConfig.computer.windowMatch), true);
  assert.equal(selectAllowlistedWindow([
    { id: "hwnd-other", title: "Unrelated Window" },
    { id: "hwnd-1234", title: "PowerShell - Allowlisted Observation Window" }
  ], runtimeConfig.computer.windowMatch)?.id, "hwnd-1234");

  const invalidPath = path.join(tempDir, "invalid-loopback.json");
  await fs.writeFile(invalidPath, JSON.stringify({
    research: {
      mode: "allowlisted_real_web",
      targets: [
        {
          title: "Loopback",
          url: "https://127.0.0.1/",
          fieldMap: {
            companyName: { css: "h1" }
          }
        },
        {
          title: "Example Dot Net",
          url: "https://example.net/",
          fieldMap: {
            companyName: { css: "h1" }
          }
        }
      ]
    }
  }, null, 2), "utf8");

  await assert.rejects(
    loadRealSurfaceRuntimeConfig({ filePath: invalidPath }),
    /must not point to a loopback host/
  );
}
