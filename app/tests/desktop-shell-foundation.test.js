import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOperatorServer } from "../src/server/operator-server.js";
import {
  assertLocalOperatorBaseUrl,
  buildShellLaunchSpec,
  deriveOperatorPort,
  resolveBrowserPath,
  waitForOperatorHealth
} from "../../desktop/shell-foundation.mjs";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture research desktop shell test mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture computer desktop shell test mission."
  }
});

export async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-shell-test-"));
  const fakeBrowserPath = path.join(tempDir, "fake-browser.exe");
  await fs.writeFile(fakeBrowserPath, "shell", "utf8");

  try {
    const resolved = await resolveBrowserPath({
      env: {
        COWORK_DESKTOP_BROWSER_PATH: fakeBrowserPath
      }
    });
    assert.equal(resolved, fakeBrowserPath);

    const normalized = assertLocalOperatorBaseUrl("http://127.0.0.1:41732");
    assert.equal(normalized, "http://127.0.0.1:41732");
    assert.equal(deriveOperatorPort("http://127.0.0.1:41732"), 41732);

    assert.throws(
      () => assertLocalOperatorBaseUrl("https://example.com:444"),
      /loopback/
    );

    const launchSpec = buildShellLaunchSpec({
      baseUrl: "http://localhost:41732",
      browserPath: fakeBrowserPath
    });
    assert.equal(launchSpec.baseUrl, "http://localhost:41732");
    assert.ok(launchSpec.args.some((entry) => entry.startsWith("--app=http://localhost:41732/")));
    assert.ok(launchSpec.args.includes("--disable-background-networking"));

    const server = await createOperatorServer({
      port: 0,
      operatorServiceOptions: {
        realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES
      }
    });
    try {
      const healthy = await waitForOperatorHealth({
        baseUrl: server.baseUrl,
        timeoutMs: 1000,
        pollMs: 50
      });
      assert.equal(healthy, true);
    } finally {
      await server.close();
    }
  } finally {
    await fs.rm(tempDir, {
      force: true,
      recursive: true
    });
  }
}
