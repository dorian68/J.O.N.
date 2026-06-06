import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { createOperatorServer } from "../src/server/operator-server.js";
import { jonifyFromAccessibility, jonifyFromHtml } from "../src/jonify/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "fixtures", "jonify", "sample-crm.html");

async function fetchJson(baseUrl, relativePath, options = {}) {
  const response = await fetch(`${baseUrl}${relativePath}`, {
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

export async function run() {
  const computerProvider = new FakeWindowProvider([
    {
      id: "win_notes",
      title: "Operator Notes Window",
      active: true,
      allowlisted: true,
      content: "ready",
      controls: [
        {
          name: "Search query",
          automationId: "searchInput",
          controlType: "ControlType.Edit",
          patterns: ["value"]
        },
        {
          name: "Save",
          automationId: "saveButton",
          controlType: "ControlType.Button",
          patterns: ["invoke"]
        }
      ]
    }
  ]);
  const server = await createOperatorServer({
    port: 0,
    operatorServiceOptions: {
      realSurfaceRuntimeConfig: {
        research: { mode: "controlled_fixture" },
        computer: { mode: "controlled_fixture_window" }
      },
      computerProvider
    }
  });

  try {
    const html = await fs.readFile(FIXTURE, "utf8");
    const { manifest, validation } = jonifyFromHtml(html, {
      url: "https://acme.example.com/dashboard"
    });
    assert.equal(validation.valid, true, `manifest valid: ${validation.errors.join("; ")}`);
    await fetchJson(server.baseUrl, "/api/jonify/register", {
      method: "POST",
      body: JSON.stringify({ manifest })
    });

    const browserCalls = [];
    server.operatorService.browserProvider.getOrCreateJonSession = async ({ projectId, runId, allowlistedHosts }) => {
      browserCalls.push(["getOrCreateJonSession", projectId, runId, allowlistedHosts]);
      return { id: "jonify_browser_session_fake", projectId, runId, status: "active" };
    };
    server.operatorService.browserProvider.getAutomationHandle = () => ({
      session: { id: "jonify_browser_session_fake", status: "active" },
      targetId: "target_j",
      controller: {
        allowlistedHosts: [],
        isOpen: () => true,
        async getTargetState(targetId) {
          browserCalls.push(["getTargetState", targetId]);
          return { url: "about:blank", title: "Blank" };
        },
        async navigate(targetId, url) {
          browserCalls.push(["navigate", targetId, url]);
          return { targetId, url, status: 200 };
        },
        async clickElement(targetId, selector) {
          browserCalls.push(["clickElement", targetId, selector]);
          return { found: true, selector };
        },
        async clearAndType(targetId, selector, value) {
          browserCalls.push(["clearAndType", targetId, selector, value]);
          return { validated: true, selector, value };
        },
        async waitForPageStable(targetId) {
          browserCalls.push(["waitForPageStable", targetId]);
          return { targetId, stable: true };
        },
        async exportPageEvidence(targetId, evidenceDir, label) {
          browserCalls.push(["exportPageEvidence", targetId, evidenceDir, label]);
          return { evidenceId: "ev_operator_jonify", screenshotPath: "/tmp/operator-jonify.png", summaryPath: "/tmp/operator-jonify.json" };
        }
      },
      persistent: true
    });

    const liveSearch = await fetchJson(server.baseUrl, `/api/jonify/apps/${encodeURIComponent(manifest.app.id)}/execute-workflow`, {
      method: "POST",
      body: JSON.stringify({
        mode: "live",
        workflowId: "search-workflow",
        projectId: "default",
        url: "https://acme.example.com/dashboard",
        inputs: { query: "operator live" }
      })
    });
    assert.equal(liveSearch.result.status, "completed");
    assert.deepEqual(
      browserCalls.find((call) => call[0] === "clearAndType")?.slice(2),
      [{ testId: "search" }, "operator live"]
    );
    assert.equal(liveSearch.result.steps[0].evidence, "/tmp/operator-jonify.png");
    assert.deepEqual(
      browserCalls.find((call) => call[0] === "getOrCreateJonSession")?.[3],
      ["acme.example.com"],
      "route constrains live browser execution to manifest/start URL host"
    );

    browserCalls.length = 0;
    const blockedDelete = await fetchJson(server.baseUrl, `/api/jonify/apps/${encodeURIComponent(manifest.app.id)}/execute-workflow`, {
      method: "POST",
      body: JSON.stringify({
        mode: "live",
        workflowId: "delete-workflow",
        projectId: "default",
        url: "https://acme.example.com/dashboard"
      })
    });
    assert.equal(blockedDelete.result.status, "needs_confirmation");
    assert.equal(browserCalls.length, 0, "critical delete does not even start the browser without confirmation");
    assert.equal(browserCalls.some((call) => call[0] === "clickElement"), false, "critical delete is not actuated without confirmation");

    const accessibility = computerProvider.inspectAccessibilityTree("win_notes");
    const desktop = jonifyFromAccessibility(accessibility, {
      title: "Operator Notes Window",
      appName: "Operator Notes"
    });
    desktop.manifest.app.id = "operator-notes-desktop";
    assert.equal(desktop.manifest.app.environment, "desktop");
    assert.ok(desktop.manifest.workflows.some((workflow) => workflow.id === "submit-form-workflow"));
    await fetchJson(server.baseUrl, "/api/jonify/register", {
      method: "POST",
      body: JSON.stringify({ manifest: desktop.manifest })
    });

    const desktopResult = await fetchJson(
      server.baseUrl,
      `/api/jonify/apps/${desktop.manifest.app.id}/execute-workflow`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "live",
          surface: "desktop",
          workflowId: "submit-form-workflow",
          projectId: "default",
          windowId: "win_notes",
          confirm: true,
          inputs: { "Search query": "desktop live" }
        })
      }
    );
    assert.equal(desktopResult.surface, "desktop");
    assert.equal(desktopResult.result.status, "completed");
    assert.equal(computerProvider.windows[0].controls[0].value, "desktop live", "ValuePattern adapter fills the input");
    assert.equal(computerProvider.windows[0].controls[1].invokeCount, 1, "InvokePattern adapter invokes the button");
    assert.ok(desktopResult.result.steps[0].evidenceSummaryUrl, "desktop execution exposes a confined proof URL");
  } finally {
    await server.close();
  }
}
