import assert from "node:assert/strict";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import {
  buildDeterministicConversationTurn,
  validateConversationTurnOutput
} from "../src/conversation/conversation-turn.js";
import { normalizeUiBlocks } from "../src/conversation/ui-blocks.js";
import { createOperatorServer } from "../src/server/operator-server.js";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture research HTTP test mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture computer HTTP test mission."
  }
});

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

async function fetchSse(baseUrl, relativePath, options = {}) {
  const response = await fetch(`${baseUrl}${relativePath}`, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  function processFrame(frame) {
    const lines = frame.split(/\r?\n/);
    let event = "message";
    const data = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (data.length > 0) {
      events.push({ event, payload: JSON.parse(data.join("\n")) });
    }
  }
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.trim()) processFrame(frame);
    }
  }
  if (buffer.trim()) processFrame(buffer);
  return events;
}

export async function run() {
  const folderTurn = validateConversationTurnOutput(buildDeterministicConversationTurn({
    message: "Quels sont les dossiers presents sur mon bureau ?"
  }), {
    message: "Quels sont les dossiers presents sur mon bureau ?"
  });
  assert.equal(folderTurn.intentType, "safe_inspection");
  assert.equal(folderTurn.action, "inspect_then_answer");
  assert.equal(folderTurn.capabilityRequests[0].id, "inspect_desktop_folders");

  const actionTurn = validateConversationTurnOutput(buildDeterministicConversationTurn({
    message: "Ouvre mon navigateur web et cherche cowork desktop."
  }), {
    message: "Ouvre mon navigateur web et cherche cowork desktop."
  });
  assert.equal(actionTurn.action, "prepare_mission_preflight");
  assert.equal(Boolean(actionTurn.missionDraft?.objective), true);
  assert.equal(actionTurn.reply.includes("qualifier"), false);
  assert.equal(actionTurn.reply.includes("run born"), false);
  assert.equal(actionTurn.uiBlocks.some((block) => block.type === "actionPlan"), false);
  assert.equal(actionTurn.reply, "Oui. Je prépare l’action.");

  const catalogTurn = validateConversationTurnOutput(buildDeterministicConversationTurn({
    message: "Quels navigateurs et applications sont disponibles sur cette machine ?"
  }), {
    message: "Quels navigateurs et applications sont disponibles sur cette machine ?"
  });
  assert.equal(catalogTurn.action, "inspect_then_answer");
  assert.deepEqual(catalogTurn.capabilityRequests.map((request) => request.id), [
    "list_installed_applications",
    "list_installed_browsers"
  ]);
  const usageCatalogTurn = validateConversationTurnOutput(buildDeterministicConversationTurn({
    message: "quels navigateurs et applications peux-tu utiliser sur cette machine ?"
  }), {
    message: "quels navigateurs et applications peux-tu utiliser sur cette machine ?"
  });
  assert.deepEqual(usageCatalogTurn.capabilityRequests.map((request) => request.id), [
    "list_installed_applications",
    "list_installed_browsers"
  ]);

  const sanitizedTurn = validateConversationTurnOutput({
    intentType: "desktop_action",
    action: "prepare_mission_preflight",
    reply: "Before acting, I will qualify this request. What I will do: prepare a run.",
    requiresClarification: false,
    clarificationQuestion: "",
    capabilityRequests: [],
    missionDraft: {
      objective: "Ouvre le navigateur",
      deliverable: "",
      constraints: [],
      forbiddenActions: [],
      mode: "",
      parameters: {}
    },
    uiBlocks: [{
      type: "actionPlan",
      title: "Before acting",
      steps: ["Internal plan"],
      checks: [],
      limitations: ["Limitations"]
    }],
    safetyNotes: [],
    confidence: "medium"
  }, {
    message: "Ouvre le navigateur"
  });
  assert.equal(sanitizedTurn.reply, "Oui. Je prépare l’ouverture.");

  const polishedApprovalTurn = validateConversationTurnOutput({
    intentType: "desktop_action",
    action: "prepare_mission_preflight",
    reply: "Oui. J’ai besoin de ton accord pour lancer Microsoft Edge.",
    requiresClarification: false,
    clarificationQuestion: "",
    capabilityRequests: [],
    missionDraft: {
      objective: "Ouvre Microsoft Edge",
      deliverable: "",
      constraints: [],
      forbiddenActions: [],
      mode: "",
      parameters: {}
    },
    uiBlocks: [],
    safetyNotes: []
  }, {
    message: "Ouvre Microsoft Edge"
  });
  assert.equal(polishedApprovalTurn.reply, "Confirme et je lance Microsoft Edge.");

  const polishedChoiceTurn = validateConversationTurnOutput({
    intentType: "desktop_action",
    action: "prepare_mission_preflight",
    reply: "Oui. J'ai besoin de ton accord pour ouvrir ton navigateur web. Tu préfères Microsoft Edge ou Google Chrome ?",
    requiresClarification: true,
    clarificationQuestion: "Tu préfères Microsoft Edge ou Google Chrome ?",
    capabilityRequests: [],
    missionDraft: {
      objective: "Ouvre mon navigateur web",
      deliverable: "",
      constraints: [],
      forbiddenActions: [],
      mode: "",
      parameters: {}
    },
    uiBlocks: [],
    safetyNotes: []
  }, {
    message: "Ouvre mon navigateur web"
  });
  assert.equal(polishedChoiceTurn.reply, "Tu préfères Microsoft Edge ou Google Chrome ?");

  const repairedMissionDraftTurn = validateConversationTurnOutput({
    intentType: "desktop_action",
    action: "prepare_mission_preflight",
    reply: "Oui. Je prépare l’ouverture.",
    requiresClarification: false,
    clarificationQuestion: "",
    capabilityRequests: [],
    uiBlocks: [],
    safetyNotes: []
  }, {
    message: "ouvre mon navigateur web"
  });
  assert.equal(repairedMissionDraftTurn.missionDraft.objective, "ouvre mon navigateur web");

  const sanitizedModeTurn = validateConversationTurnOutput({
    intentType: "desktop_action",
    action: "prepare_mission_preflight",
    reply: "Oui. Je prépare l’ouverture.",
    requiresClarification: false,
    clarificationQuestion: "",
    capabilityRequests: [],
    missionDraft: {
      objective: "ouvre Edge",
      deliverable: "",
      constraints: [],
      forbiddenActions: [],
      mode: "supervised",
      parameters: {}
    },
    uiBlocks: [],
    safetyNotes: []
  }, {
    message: "ouvre Edge"
  });
  assert.equal(sanitizedModeTurn.missionDraft.mode, "");

  const blocks = normalizeUiBlocks([
    {
      type: "table",
      title: "Test",
      columns: ["A", "B"],
      rows: [{ A: "<script>x</script>", B: "safe" }]
    },
    {
      type: "folderList",
      folders: [{ name: "Project", pathLabel: "Desktop\\Project" }]
    }
  ]);
  assert.equal(blocks[0].type, "table");
  assert.equal(blocks[1].type, "folderList");
  assert.equal(blocks[1].folders[0].name, "Project");

  const server = await createOperatorServer({
    port: 0,
    operatorServiceOptions: {
      realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
      computerProvider: new FakeWindowProvider([], {
        browsers: [
          {
            id: "chrome",
            label: "Google Chrome",
            processName: "chrome",
            executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          }
        ]
      })
    }
  });

  try {
    await server.operatorService.clearTemporaryRuntimeState();
    const dashboard = await fetchJson(server.baseUrl, "/api/dashboard");
    const projectId = dashboard.projects[0].id;

    const localQuestion = await fetchJson(server.baseUrl, `/api/projects/${projectId}/conversation/turn`, {
      method: "POST",
      body: JSON.stringify({
        message: "Quels sont les dossiers presents sur mon bureau ?"
      })
    });
    assert.equal(localQuestion.turn.action, "inspect_then_answer");
    assert.equal(Boolean(localQuestion.conversation?.id), true);
    assert.equal(localQuestion.turn.conversationId, localQuestion.conversation.id);
    assert.equal(localQuestion.turn.uiBlocks.some((block) => block.type === "folderList"), true);
    assert.equal(localQuestion.preflight, null);
    const conversationsAfterLocalQuestion = await fetchJson(server.baseUrl, `/api/projects/${projectId}/conversations?limit=4`);
    assert.equal(conversationsAfterLocalQuestion.conversations.length >= 1, true);
    assert.equal(conversationsAfterLocalQuestion.conversations[0].id, localQuestion.conversation.id);
    const historyAfterLocalQuestion = await fetchJson(server.baseUrl, `/api/projects/${projectId}/conversation?limit=4&conversationId=${encodeURIComponent(localQuestion.conversation.id)}`);
    assert.equal(historyAfterLocalQuestion.turns.length >= 2, true);
    assert.equal(historyAfterLocalQuestion.turns.at(-2).role, "user");
    assert.equal(historyAfterLocalQuestion.turns.at(-1).role, "assistant");

    const browserAction = await fetchJson(server.baseUrl, `/api/projects/${projectId}/conversation/turn`, {
      method: "POST",
      body: JSON.stringify({
        message: "Ouvre Chrome et cherche release readiness.",
        conversationId: localQuestion.conversation.id
      })
    });
    assert.equal(browserAction.conversation.id, localQuestion.conversation.id);
    assert.equal(browserAction.turn.action, "prepare_mission_preflight");
    assert.equal(browserAction.turn.reply.includes("qualifier"), false);
    assert.equal(browserAction.turn.uiBlocks.some((block) => block.type === "actionPlan"), false);
    assert.equal(Boolean(browserAction.preflight), true);
    assert.equal(browserAction.preflight.understanding.chosenExecutionFrame, "computer_observation");

    const report = await fetchJson(server.baseUrl, `/api/projects/${projectId}/conversation/turn`, {
      method: "POST",
      body: JSON.stringify({
        message: "Genere un rapport de performance avec un tableau."
      })
    });
    const artifact = report.turn.uiBlocks.find((block) => block.type === "artifactCard");
    assert.equal(Boolean(artifact?.href), true);
    const content = await fetchJson(server.baseUrl, artifact.href);
    assert.equal(content.content.includes("Generated at:"), true);
    assert.equal(content.html.includes("<table>"), true);

    const streamed = await fetchSse(server.baseUrl, `/api/projects/${projectId}/conversation/stream`, {
      method: "POST",
      body: JSON.stringify({
        message: "hello ?"
      })
    });
    assert.equal(streamed.some((entry) => entry.event === "reply.delta"), true);
    const completed = streamed.find((entry) => entry.event === "turn.completed");
    assert.equal(Boolean(completed?.payload?.turn?.reply), true);
  } finally {
    await server.close();
  }
}
