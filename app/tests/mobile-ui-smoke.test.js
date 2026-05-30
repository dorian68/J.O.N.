import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createOperatorServer } from "../src/server/operator-server.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: { mode: "controlled_fixture" },
  computer: { mode: "controlled_fixture_window" }
});

const TEST_LLM_ENV = Object.freeze({
  ...process.env,
  COWORK_LLM_RUNTIME_PROFILE: "test",
  COWORK_LLM_PROVIDER_MODE: "mock_offline",
  COWORK_LLM_ALLOW_MOCK_FALLBACK: "1",
  COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK: "1",
  COWORK_LLM_REQUIRE_OS_SECRET_STORE: "0"
});

async function fetchJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

async function waitForMobileApproval(baseUrl, { timeoutMs = 6000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dashboard = await fetchJson(baseUrl, "/api/dashboard");
    const approval = dashboard.pendingApprovals?.[0] ?? null;
    if (approval) return approval;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for pending mobile approval fixture.");
}

export async function run() {
  const server = await createOperatorServer({
    port: 0,
    operatorServiceOptions: {
      env: TEST_LLM_ENV,
      realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
      computerProvider: new FakeWindowProvider([
        {
          id: "win_hub",
          title: "Controlled Browser Fixture Window",
          active: false,
          visible: true,
          allowlisted: true,
          content: "state=loading",
          processName: "chrome",
          bounds: { x: 0, y: 0, width: 1100, height: 760 }
        },
        {
          id: "win_notes",
          title: "Operator Notes",
          active: true,
          visible: true,
          allowlisted: true,
          content: "ready",
          processName: "notepad",
          bounds: { x: 0, y: 0, width: 900, height: 700 }
        }
      ])
    }
  });

  let browser = null;
  try {
    const projects = await fetchJson(server.baseUrl, "/api/projects");
    const projectId = projects.projects[0].id;
    await fetchJson(server.baseUrl, `/api/projects/${projectId}/runs`, {
      method: "POST",
      body: JSON.stringify({ scenarioId: "computer" })
    });
    const pendingApproval = await waitForMobileApproval(server.baseUrl);

    const pairing = await fetchJson(server.baseUrl, "/api/mobile/pairing/start", {
      method: "POST",
      body: JSON.stringify({})
    });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "fr-FR"
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${server.baseUrl}/mobile/?code=${encodeURIComponent(pairing.pairingCode)}`);
    await page.getByText("Mon Ordinateur").waitFor({ state: "visible", timeout: 10000 });

    await page.locator(".mobile-tab").filter({ hasText: "Tâches" }).click();
    await page.locator(".approval-card").waitFor({ state: "visible", timeout: 10000 });
    await assert.equal(await page.locator(".approval-card").filter({ hasText: pendingApproval.actionLabel }).count(), 1);

    await page.locator(".approval-card .mobile-btn.success").click();
    await page.locator(".mobile-tab").filter({ hasText: "Contrôle" }).click();
    await page.getByText("Écran contrôlé").waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".mobile-tab").filter({ hasText: "Onglets" }).click();
    const tabsPane = page.locator(".browser-tabs-tab");
    await tabsPane.getByText("Onglets JON").waitFor({ state: "visible", timeout: 10000 });
    await tabsPane.getByRole("button", { name: "+ Nouvel onglet" }).click();
    await tabsPane.getByText("Session active").waitFor({ state: "visible", timeout: 15000 });
    await tabsPane.locator(".browser-tab-card.active").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await tabsPane.locator(".browser-tab-card").filter({ hasText: "about:blank" }).count(), 1);
    await page.locator(".mobile-tab").filter({ hasText: "Terminal" }).click();
    await page.getByText("Shell interactif").waitFor({ state: "visible", timeout: 10000 });

    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await server.close({ timeoutMs: 1000 });
  }
}
