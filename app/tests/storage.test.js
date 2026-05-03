import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { PrototypeDatabase } from "../src/storage/database.js";

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-db-"));
  return path.join(dir, "prototype.sqlite");
}

export async function run() {
  const database = new PrototypeDatabase(await tempDbPath());
  await database.open();

  database.insertProject({
    id: "prj_test",
    name: "Test project",
    description: "desc",
    allowlistedDomains: ["127.0.0.1"],
    createdAt: new Date().toISOString()
  });

  database.insertRun({
    id: "run_test",
    projectId: "prj_test",
    mission: "Mission",
    status: "created",
    lifecycleStage: "created",
    plan: { steps: ["a"] },
    summary: "created",
    metadata: { type: "research" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const project = database.getProject("prj_test");
  const run = database.getRun("run_test");

  assert.equal(project.name, "Test project");
  assert.equal(run.mission, "Mission");
  assert.deepEqual(run.plan.steps, ["a"]);

  database.insertConversation({
    id: "conv_test",
    projectId: "prj_test",
    title: "List desktop folders",
    summary: "",
    status: "active",
    metadata: { source: "test" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  database.insertConversationTurn({
    id: "cturn_user",
    projectId: "prj_test",
    conversationId: "conv_test",
    role: "user",
    kind: "message",
    content: "Quels dossiers sont sur mon Bureau ?",
    payload: { source: "test" },
    metadata: {},
    createdAt: new Date().toISOString()
  });
  database.insertConversationTurn({
    id: "cturn_assistant",
    projectId: "prj_test",
    conversationId: "conv_test",
    role: "assistant",
    kind: "turn",
    content: "Je regarde ça.",
    payload: { action: "inspect_then_answer" },
    metadata: { generationMode: "deterministic_fallback" },
    createdAt: new Date().toISOString()
  });

  const conversations = database.listConversations("prj_test");
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, "conv_test");
  const turns = database.listConversationTurns("prj_test", { conversationId: "conv_test" });
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, "user");
  assert.equal(turns[1].conversationId, "conv_test");

  const observedAt = new Date().toISOString();
  database.insertMemoryRecord({
    id: "mem_test_preference",
    scope: "user",
    projectId: "prj_test",
    category: "preference",
    text: "Prefers PowerShell for local validation",
    confidence: 0.82,
    sourceType: "conversation",
    sourceId: "conv_test",
    metadata: { conversationId: "conv_test" },
    createdAt: observedAt,
    updatedAt: observedAt
  });
  database.insertMemoryRecord({
    id: "mem_test_workflow",
    scope: "user",
    projectId: "prj_test",
    category: "workflow",
    text: "Desktop inspection workflow",
    confidence: 0.66,
    sourceType: "run",
    sourceId: "run_test",
    metadata: { runId: "run_test" },
    createdAt: observedAt,
    updatedAt: observedAt
  });

  const preferenceRecords = database.listMemoryRecords({
    scope: "user",
    projectId: "prj_test",
    category: "preference"
  });
  assert.equal(preferenceRecords.length, 1);
  assert.equal(preferenceRecords[0].metadata.conversationId, "conv_test");

  const searchResults = database.searchMemoryRecords({
    query: "PowerShell",
    scope: "user",
    projectId: "prj_test"
  });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, "mem_test_preference");

  database.close();
}
