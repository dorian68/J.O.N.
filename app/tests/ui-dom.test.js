import assert from "node:assert/strict";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { APP_ROOT } from "../src/config.js";

const UI_ROOT = path.join(APP_ROOT, "ui");
const execAsync = promisify(exec);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function sendJson(response, payload) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function writeSse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const assetPath = path.normalize(path.join(UI_ROOT, requested));
  if (!assetPath.startsWith(UI_ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await fs.readFile(assetPath);
    response.writeHead(200, {
      "content-type": MIME_TYPES.get(path.extname(assetPath)) ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

function buildFixture() {
  const projectId = "project_ui_dom";
  const activeConversationId = "conv_aaaaaaaaaaaaaaaaaaaaaaaa";
  const otherConversationId = "conv_bbbbbbbbbbbbbbbbbbbbbbbb";
  const activeRun = {
    id: "run_active_conversation",
    projectId,
    mission: "Ouvre le navigateur et cherche cinestar",
    status: "paused",
    lifecycleStage: "approval_pending",
    summary: "Awaiting approval: open browser",
    createdAt: nowIso(-30000),
    updatedAt: nowIso(-1000),
    metadata: {
      conversationId: activeConversationId,
      missionSpec: {
        objective: "Ouvre le navigateur et cherche cinestar",
        mode: "computer",
        routing: {
          capabilityId: "browser.launch_search",
          skillId: "browser"
        }
      }
    }
  };
  const otherRun = {
    id: "run_other_conversation",
    projectId,
    mission: "Autre mission hors conversation",
    status: "completed",
    lifecycleStage: "completed",
    summary: "Other run completed",
    createdAt: nowIso(-60000),
    updatedAt: nowIso(-50000),
    metadata: {
      conversationId: otherConversationId,
      missionSpec: {
        objective: "Autre mission hors conversation",
        mode: "research"
      }
    }
  };
  return {
    projectId,
    activeConversationId,
    activeRun,
    otherRun,
    dashboard: {
      selectedProjectId: projectId,
      activeRunIds: [activeRun.id],
      desktopActionSupport: {
        availableBrowsers: [{ id: "edge", label: "Microsoft Edge" }, { id: "chrome", label: "Google Chrome" }],
        availableCliAgents: [
          { id: "codex", command: "codex", label: "Codex CLI", agentKind: "codex_cli", availability: "local_path" }
        ]
      },
      missionEntry: {
        modes: []
      },
      agentConfiguration: {
        guardrails: {
          terminalWorkspaceView: "surface"
        }
      },
      conversation: {
        conversations: [
          {
            id: activeConversationId,
            projectId,
            title: "Navigateur cinestar",
            createdAt: nowIso(-40000),
            updatedAt: nowIso(-500),
            metadata: {
              linkedRunIds: [activeRun.id],
              latestRunId: activeRun.id
            }
          },
          {
            id: otherConversationId,
            projectId,
            title: "Autre conversation",
            createdAt: nowIso(-70000),
            updatedAt: nowIso(-60000),
            metadata: {
              linkedRunIds: [otherRun.id],
              latestRunId: otherRun.id
            }
          }
        ],
        recentTurns: []
      },
      workspace: {
        missionBrief: {
          id: "wmb_ui",
          projectId,
          objective: "Superviser une mission navigateur avec terminal Codex",
          status: "active",
          nextSteps: ["Valider l'ouverture du navigateur"]
        },
        terminals: [{
          id: "term_codex",
          projectId,
          label: "Codex CLI",
          agentKind: "codex_cli",
          status: "waiting_for_input",
          autonomyMode: "assisted",
          authorized: true,
          lastPrompt: "Approve browser launch?",
          updatedAt: nowIso(-700)
        }],
        decisions: [{
          id: "wtd_ui",
          terminalId: "term_codex",
          projectId,
          action: "request_human_approval",
          reason: "Codex CLI attend une confirmation.",
          requiresApproval: true,
          createdAt: nowIso(-700)
        }],
        alerts: [{
          id: "wtd_ui",
          terminalId: "term_codex",
          projectId,
          action: "request_human_approval",
          reason: "Codex CLI attend une confirmation.",
          requiresApproval: true,
          createdAt: nowIso(-700)
        }],
        terminalEvents: [
          {
            id: "evt_term_start",
            terminalId: "term_codex",
            projectId,
            eventType: "process.started",
            stream: null,
            content: "",
            metadata: {
              snapshot: {
                pid: 5421
              }
            },
            createdAt: nowIso(-950)
          },
          {
            id: "evt_term_output",
            terminalId: "term_codex",
            projectId,
            eventType: "process.output",
            stream: "stdout",
            content: "Approve this command? [y/n]",
            metadata: {},
            createdAt: nowIso(-720)
          },
          {
            id: "evt_term_output_2",
            terminalId: "term_codex",
            projectId,
            eventType: "process.output",
            stream: "stdout",
            content: "Waiting for input",
            metadata: {},
            createdAt: nowIso(-710)
          }
        ],
        liveProcesses: [
          {
            terminalId: "term_codex",
            pid: 5421,
            command: "codex",
            args: [],
            cwd: "C:\\\\workspace",
            startedAt: nowIso(-950)
          }
        ],
        browserStrategy: {
          preferredMode: "workspace_browser_mode",
          supportedModes: ["workspace_browser_mode", "system_browser_mode"]
        },
        availableCliAgents: [
          { id: "codex", command: "codex", label: "Codex CLI", agentKind: "codex_cli", availability: "local_path" }
        ],
        summary: {
          terminalCount: 1,
          waitingTerminalCount: 1
        }
      },
      projects: [{
        id: projectId,
        name: "UI DOM project",
        runs: [activeRun, otherRun]
      }]
    },
    runDetail: {
      run: activeRun,
      pendingApprovals: [{
        id: "approval_browser",
        runId: activeRun.id,
        actionLabel: "Lancer Microsoft Edge ?",
        reason: "JON doit ouvrir le navigateur pour continuer.",
        expectedEffect: "Ouverture du navigateur",
        consequenceOfRefusal: "Le run restera en attente.",
        riskLevel: "medium",
        targetLabel: "Microsoft Edge",
        createdAt: nowIso(-800)
      }],
      events: [
        {
          id: "evt_approval",
          runId: activeRun.id,
          type: "approval.requested",
          createdAt: nowIso(-800),
          payload: { approvalId: "approval_browser" }
        },
        {
          id: "evt_plan",
          runId: activeRun.id,
          type: "desktop.plan.created",
          createdAt: nowIso(-1600),
          payload: { skillId: "browser", capabilityId: "browser.launch_search" }
        }
      ],
      artifacts: [{
        id: "artifact_active",
        title: "Artefact actif",
        description: "Artefact lié à la conversation active.",
        href: "#active-artifact"
      }],
      evidence: [{
        id: "evidence_active",
        kind: "screenshot",
        description: "Preuve active",
        hasScreenshot: true
      }],
      review: {
        artifacts: []
      },
      llmCalls: [{
        id: "llm_active",
        callType: "desktop_plan",
        resultStatus: "success",
        tokenUsage: { totalTokens: 120 },
        createdAt: nowIso(-1200)
      }]
    },
    turns: [
      {
        id: "turn_user",
        projectId,
        conversationId: activeConversationId,
        role: "user",
        kind: "message",
        content: "Ouvre mon navigateur",
        payload: {},
        metadata: {},
        createdAt: nowIso(-20000)
      },
      {
        id: "turn_assistant",
        projectId,
        conversationId: activeConversationId,
        role: "assistant",
        kind: "turn",
        content: "Tu veux utiliser quel navigateur ?",
        payload: {
          action: "prepare_mission_preflight",
          requiresClarification: true,
          clarificationQuestion: "Quel navigateur veux-tu utiliser ?",
          uiBlocks: [],
          preflight: {
            understanding: {
              missionSummary: "Ouvrir un navigateur",
              requiresClarification: true,
              clarificationQuestion: "Quel navigateur veux-tu utiliser ?",
              clarificationOptions: [{ id: "edge", label: "Microsoft Edge" }, { id: "chrome", label: "Google Chrome" }],
              choiceRequest: {
                id: "choice_browser_launch",
                kind: "browser",
                title: "Choisis le navigateur",
                question: "Quel navigateur veux-tu utiliser ?",
                resolutionTarget: {
                  parameterPath: "parameters.browserLaunch.browserId",
                  labelPath: "parameters.browserLaunch.browserLabel"
                },
                options: [
                  { id: "edge", label: "Microsoft Edge", value: "edge", description: "Navigateur détecté" },
                  { id: "chrome", label: "Google Chrome", value: "chrome", description: "Navigateur détecté" }
                ]
              }
            }
          }
        },
        metadata: { generationMode: "mock_offline" },
        createdAt: nowIso(-19000)
      }
    ]
  };
}

async function startMockUiServer(fixture) {
  const eventResponses = new Set();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/dashboard") {
      sendJson(response, fixture.dashboard);
      return;
    }
    if (url.pathname === `/api/projects/${fixture.projectId}/conversation`) {
      sendJson(response, {
        turns: url.searchParams.get("conversationId") === fixture.activeConversationId ? fixture.turns : []
      });
      return;
    }
    if (url.pathname === `/api/projects/${fixture.projectId}/conversation/stream`) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      writeSse(response, "reply.delta", { text: "D'accord. J'utiliserai Microsoft Edge." });
      writeSse(response, "turn.completed", {
        conversation: {
          id: fixture.activeConversationId,
          title: "Navigateur cinestar",
          updatedAt: nowIso()
        },
        turn: {
          id: "turn_resolved",
          intentType: "desktop_action",
          action: "prepare_mission_preflight",
          reply: "D'accord. J'utiliserai Microsoft Edge.",
          requiresClarification: false,
          clarificationQuestion: "",
          uiBlocks: [],
          generationMode: "clarification_resolution"
        },
        preflight: {
          understanding: {
            missionSummary: "Ouvrir Microsoft Edge",
            requiresClarification: false
          }
        },
        missionDraft: {
          objective: "Ouvre le navigateur et cherche cinestar",
          parameters: {
            browserLaunch: {
              browserId: "edge"
            }
          }
        }
      });
      response.end();
      return;
    }
    if (url.pathname === `/api/runs/${fixture.activeRun.id}`) {
      sendJson(response, fixture.runDetail);
      return;
    }
    if (url.pathname === `/api/runs/${fixture.activeRun.id}/evidence/evidence_active/screenshot`) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end("");
      return;
    }
    if (url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      response.write(`data: ${JSON.stringify({ type: "stream.connected", payload: {} })}\n\n`);
      eventResponses.add(response);
      request.on("close", () => eventResponses.delete(response));
      return;
    }
    await serveStatic(response, url.pathname);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    pushEvent(type, payload) {
      const frame = `data: ${JSON.stringify({ type, payload: payload ?? {} })}\n\n`;
      for (const response of eventResponses) {
        try {
          response.write(frame);
        } catch {
          eventResponses.delete(response);
        }
      }
    },
    async close() {
      for (const response of eventResponses) {
        response.end();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function ensureBuiltUserUi() {
  await execAsync("npm run ui:build", {
    cwd: APP_ROOT,
    timeout: 120000
  });
}

export async function run() {
  await ensureBuiltUserUi();
  const fixture = buildFixture();
  const server = await startMockUiServer(fixture);
  const browser = await chromium.launch({
    headless: true
  });
  try {
    const page = await browser.newPage({ locale: "fr-FR" });
    await page.addInitScript(() => {
      localStorage.setItem("jon.locale", "fr");
    });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });

    await assert.doesNotReject(async () => {
      await page.locator('[data-testid="conversation-sidebar"].collapsed').waitFor({ state: "visible" });
      await page.locator('[data-testid="workspace-rail"]').waitFor({ state: "visible" });
    });
    await assert.equal(await page.getByText("Tu veux utiliser quel navigateur ?").count(), 0);
    const railWritingModes = await page.locator(".side-rail-button small").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).writingMode));
    await assert.equal(railWritingModes.every((mode) => !String(mode).includes("vertical")), true);

    await page.getByLabel("Ouvrir les conversations").click();
    await page.locator('[data-testid="conversation-sidebar"].open').waitFor({ state: "visible" });
    await assert.equal(await page.getByText("Navigateur cinestar").count() >= 1, true);
    await page.getByText("Navigateur cinestar").click();

    await page.locator('[data-testid="choice-card"]').waitFor({ state: "visible" });
    await assert.equal(await page.getByText("Quel navigateur veux-tu utiliser ?").count() >= 1, true);
    await page.getByRole("button", { name: "Microsoft Edge" }).click();
    await page.locator(".react-message.assistant p", { hasText: "D'accord. J'utiliserai Microsoft Edge." }).last().waitFor({ state: "visible" });
    await assert.equal(await page.locator(".react-composer-row textarea").inputValue(), "");
    await assert.equal(await page.getByText("Ouvrir Microsoft Edge").count() >= 1, true);
    await assert.equal(await page.getByRole("button", { name: "Confirmer" }).count() >= 1, true);

    // WorkspaceTerminalMessage is now in JON (workspace pilot conversation) only
    await page.locator('[data-testid="jon-conversation-item"]').click();
    await page.locator('[data-testid="workspace-terminal-bubble"]').waitFor({ state: "visible" });
    await assert.equal(await page.getByText("Surface terminal").count() >= 1, true);
    await assert.equal(await page.getByText("Codex CLI").count() >= 1, true);

    // Navigate back to scoped conversation so ActivityPanel has conversationId scope
    await page.getByText("Navigateur cinestar").click();
    await page.locator('[data-testid="choice-card"]').waitFor({ state: "visible" });

    // Open trace inspector from the single right workspace rail
    await page.getByLabel("Ouvrir l'inspecteur").click();
    await page.locator('[data-testid="run-inspector"].open').waitFor({ state: "visible" });
    await assert.equal(await page.locator(".run-trace-list").count() >= 1, true);
    await assert.equal(await page.getByText("Ouvre le navigateur et cherche cinestar").count() >= 1, true);
    await assert.equal(await page.getByText("Autre mission hors conversation").count(), 0);
    await assert.equal(await page.getByText("Codex CLI attend une confirmation.").count() >= 1, true);
    await page.getByRole("button", { name: "Réduire l'inspecteur" }).click();
    await page.locator('[data-testid="workspace-rail"]').waitFor({ state: "visible" });

    // Open terminal sidebar from the same right workspace rail
    await page.getByLabel("Ouvrir les terminaux").click();
    await page.locator('[data-testid="terminal-sidebar"].open').waitFor({ state: "visible" });
    // New UX: sidebar shows compact rows — click first row to open the overlay
    await page.locator('.terminal-row-item').first().click();
    await page.locator('[data-testid="terminal-overlay"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="terminal-surface-view"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="terminal-surface-current-state"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="terminal-transcript-grouped"]').waitFor({ state: "visible" });
    await assert.equal(await page.getByText("Superviser une mission navigateur avec terminal Codex").count() >= 1, true);
    await assert.equal(await page.getByText("Codex CLI").count() >= 1, true);
    await assert.equal(await page.getByText("JON attend ton accord avant de répondre au terminal.").count() >= 1, true);
    await assert.equal(await page.getByText("Sortie terminal · stdout · x2").count() >= 1, true);
    await assert.equal(await page.getByText("Approve this command? [y/n]").count() >= 1, true);
    await page.getByRole("button", { name: "Réduire les terminaux" }).click();
    await page.locator('[data-testid="workspace-rail"]').waitFor({ state: "visible" });
    // Navigate to JON — WorkspaceTerminalMessage (with "Créer un terminal") only renders there
    await page.locator('[data-testid="jon-conversation-item"]').click();
    await page.locator('[data-testid="workspace-terminal-bubble"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Créer un terminal" }).click();
    await page.locator('[data-testid="terminal-sidebar"].open').waitFor({ state: "visible" });
    await assert.equal(await page.getByText("CLI détectés").count() >= 1, true);

    // Test terminal alert injection via SSE
    server.pushEvent("workspace.terminal.conversation_alert", {
      projectId: fixture.projectId,
      conversationId: fixture.activeConversationId,
      terminalId: "term_codex",
      terminalLabel: "Codex CLI",
      terminalStatus: "waiting_for_input",
      agentKind: "codex_cli",
      decisionAction: "request_human_approval",
      requiresApproval: true,
      reason: "Codex CLI is waiting for your confirmation before proceeding.",
      recentOutput: "Approve this command? [y/n]",
      alertText: "Le terminal **Codex CLI** (codex_cli) attend une entrée utilisateur.\n\nDernière sortie : `Approve this command? [y/n]`\n\nVotre accord est requis avant que JON n'agisse."
    });
    await page.locator(".terminal-alert-bubble").waitFor({ state: "visible", timeout: 5000 });
    await assert.equal(await page.locator(".terminal-output-snippet").count() >= 1, true);
    await assert.equal(await page.locator(".terminal-reply-input").count() >= 1, true);
  } finally {
    await browser.close();
    await server.close();
  }
}
