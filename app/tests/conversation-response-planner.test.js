import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { buildConversationResponsePlan } from "../src/conversation/conversation-response-planner.js";
import { normalizeUiBlocks, uiBlockTypes } from "../src/conversation/ui-blocks.js";
import { APP_ROOT } from "../src/config.js";

function runFixture(overrides = {}) {
  return {
    id: "run_ux",
    mission: "Ouvre Chrome, cherche Node.js documentation, prends une capture.",
    status: "completed",
    lifecycleStage: "completed",
    summary: "Chrome opened and screenshot captured.",
    metadata: {
      missionSpec: {
        objective: "Ouvre Chrome, cherche Node.js documentation, prends une capture.",
        deliverable: "Capture preuve"
      },
      semanticVerification: {
        objectiveSatisfied: true,
        verifiedByOutcomes: true,
        verificationVerdict: "satisfied",
        evidenceUsed: ["evidence_node"],
        missingEvidence: []
      }
    },
    ...overrides
  };
}

export async function run() {
  const completed = buildConversationResponsePlan({
    run: runFixture(),
    evidence: [{
      id: "evidence_node",
      kind: "screenshot",
      description: "Node.js documentation visible",
      hasScreenshot: true,
      metadata: {
        browserState: {
          title: "Node.js Documentation",
          url: "https://nodejs.org/docs"
        }
      }
    }],
    artifacts: [{ id: "artifact_summary", title: "Résumé", href: "#artifact" }],
    events: [
      { id: "evt_open", type: "tool.executed", createdAt: "2026-01-01T00:00:00.000Z", payload: { primitive: "browser.open", reason: "Open Chrome" } },
      { id: "evt_capture", type: "evidence.recorded", createdAt: "2026-01-01T00:00:01.000Z", payload: { evidenceId: "evidence_node", surface: "browser" } },
      { id: "evt_verify", type: "run.semantic_verification.completed", createdAt: "2026-01-01T00:00:02.000Z", payload: { status: "succeeded" } }
    ],
    locale: "fr"
  });
  assert.match(completed.naturalReply, /C’est fait/);
  assert.equal(completed.whereAreWe.objectiveSatisfied, true);
  assert.equal(completed.executionThread.toolCalls.some((call) => call.tool === "browser.open"), true);
  assert.equal(completed.executionThread.toolCalls.some((call) => call.tool === "browser.captureScreenshot"), true);
  assert.equal(completed.uiBlocks.some((block) => block.type === "proofCard"), true);
  assert.equal(completed.uiBlocks.some((block) => block.type === "artifactPreview"), true);

  const partial = buildConversationResponsePlan({
    run: runFixture({
      status: "completed",
      summary: "Page opened, but screenshot missing.",
      metadata: {
        missionSpec: { objective: "Prends une capture de la page LottieFiles." },
        semanticVerification: {
          objectiveSatisfied: false,
          verifiedByOutcomes: false,
          verificationVerdict: "partial",
          missingEvidence: ["screenshot"],
          failureReason: "La capture demandée n’est pas liée au run.",
          nextBestAction: "Relancer la capture sur la page cible."
        }
      }
    }),
    evidence: [],
    locale: "fr"
  });
  assert.match(partial.naturalReply, /J’ai avancé/);
  assert.doesNotMatch(partial.naturalReply, /C’est fait/);
  assert.equal(partial.executionThread.verification.objectiveSatisfied, false);
  assert.equal(partial.uiBlocks.some((block) => block.type === "errorRecoveryCard"), true);

  const blocked = buildConversationResponsePlan({
    run: runFixture({
      status: "failed",
      summary: "Le domaine demandé est hors périmètre.",
      metadata: {
        missionSpec: { objective: "Va sur un domaine non autorisé." },
        semanticVerification: {
          objectiveSatisfied: false,
          verificationVerdict: "blocked",
          failureReason: "Le domaine demandé est hors périmètre.",
          nextBestAction: "Demander une autorisation de domaine."
        }
      }
    }),
    locale: "fr"
  });
  assert.match(blocked.naturalReply, /Je n’ai pas pu terminer/);
  assert.match(blocked.naturalReply, /domaine/);
  assert.equal(blocked.whereAreWe.nextAction, "Demander une autorisation de domaine.");

  const manualBrowserHandoff = buildConversationResponsePlan({
    run: runFixture({
      status: "paused",
      lifecycleStage: "awaiting_manual_browser_handoff",
      summary: "JON attend ton intervention dans le navigateur.",
      metadata: {
        missionSpec: { objective: "Va sur Upwork et copie ma description." },
        manualBrowserHandoff: {
          awaitingUser: true,
          type: "captcha_or_automation_block",
          reason: "Le navigateur est bloqué par une vérification anti-robot.",
          userAction: "Termine la vérification manuellement, puis réponds \"c’est fait\"."
        },
        semanticVerification: {
          objectiveSatisfied: false,
          verificationVerdict: "blocked"
        }
      }
    }),
    locale: "fr"
  });
  assert.match(manualBrowserHandoff.naturalReply, /pause dans le navigateur/);
  assert.doesNotMatch(manualBrowserHandoff.naturalReply, /Je n’ai pas pu terminer/);
  assert.equal(manualBrowserHandoff.uiBlocks.some((block) => block.type === "nextStepCard"), true);

  const terminal = buildConversationResponsePlan({
    run: runFixture({ status: "running", lifecycleStage: "terminal_waiting" }),
    events: [{
      id: "evt_terminal",
      type: "workspace.terminal.waiting_for_input",
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: {
        terminalId: "term_codex",
        terminalStatus: "waiting_for_input",
        recentOutput: "Continue? [y/n]",
        suggestedReply: "y",
        requiresApproval: true
      }
    }],
    locale: "fr"
  });
  assert.equal(terminal.uiBlocks.some((block) => block.type === "terminalPromptCard"), true);
  assert.equal(terminal.executionThread.toolCalls.some((call) => call.tool === "terminal.read"), true);

  const transitions = buildConversationResponsePlan({
    run: runFixture({ status: "running" }),
    events: [
      { id: "tool_plan", type: "tool.planned", createdAt: "2026-01-01T00:00:00.000Z", payload: { primitive: "browser.navigate", inputSummary: "nodejs.org" } },
      { id: "tool_run", type: "tool.started", createdAt: "2026-01-01T00:00:01.000Z", payload: { primitive: "browser.navigate", inputSummary: "nodejs.org" } },
      { id: "tool_done", type: "tool.executed", createdAt: "2026-01-01T00:00:02.000Z", payload: { primitive: "browser.navigate", inputSummary: "nodejs.org" } },
      { id: "dup_done", type: "tool.executed", createdAt: "2026-01-01T00:00:02.000Z", payload: { primitive: "browser.navigate", inputSummary: "nodejs.org" } }
    ],
    locale: "en"
  });
  const statuses = transitions.executionThread.toolCalls.map((call) => call.status);
  assert.equal(statuses.includes("planned"), true);
  assert.equal(statuses.includes("running"), true);
  assert.equal(statuses.includes("succeeded"), true);
  assert.equal(
    transitions.executionThread.toolCalls.filter((call) => call.tool === "browser.navigate" && call.status === "succeeded").length,
    1
  );
  assert.match(transitions.naturalReply, /I’m working on it|Done|I made progress/);

  const blockTypes = uiBlockTypes();
  for (const type of [
    "text",
    "actionPlan",
    "approvalCard",
    "resultSummary",
    "proofCard",
    "table",
    "folderList",
    "browserResultList",
    "terminalPromptCard",
    "chart",
    "artifactPreview",
    "errorRecoveryCard",
    "nextStepCard"
  ]) {
    assert.equal(blockTypes.includes(type), true, `${type} should be registered`);
  }
  const normalized = normalizeUiBlocks([
    { type: "proofCard", label: "<script>alert(1)</script>", href: "/proof.png" },
    { type: "browserResultList", results: [{ title: "Node", url: "https://nodejs.org", snippet: "Docs" }] }
  ]);
  assert.equal(normalized[0].type, "proofCard");
  assert.equal(normalized[1].type, "browserResultList");

  const css = await fs.readFile(path.join(APP_ROOT, "ui", "styles.css"), "utf8");
  for (const state of ["idle", "thinking", "acting", "waiting_user", "blocked", "completed"]) {
    assert.equal(css.includes(`.jon-pulse.${state}`), true, `missing JON Pulse state ${state}`);
  }
}
