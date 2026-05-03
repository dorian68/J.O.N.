import assert from "node:assert/strict";
import {
  USER_MEMORY_SETTING_KEY,
  defaultUserMemory,
  extractUserMemoryRecordsFromConversationTurn,
  extractUserMemoryRecordsFromRun,
  normalizeUserMemory,
  summarizeUserMemory,
  updateUserMemoryFromConversationTurn,
  updateUserMemoryFromRun
} from "../src/memory/user-memory.js";

export async function run() {
  let memory = defaultUserMemory();
  memory = updateUserMemoryFromConversationTurn(memory, {
    projectId: "prj_user",
    conversationId: "conv_user",
    userMessage: "Je suis consultant data. Je prefere utiliser Codex et PowerShell pour les tests, mais Claude etait indisponible avant.",
    assistantReply: "Je note le contexte.",
    intentType: "simple_conversation",
    action: "answer_directly"
  });
  memory = updateUserMemoryFromConversationTurn(memory, {
    projectId: "prj_user",
    conversationId: "conv_user",
    userMessage: "Quand un workflow Excel bloque, evite de relancer sans verifier le rapport.",
    assistantReply: "Compris.",
    intentType: "local_question",
    action: "answer_directly"
  });
  memory = updateUserMemoryFromRun(memory, {
    id: "run_user_1",
    projectId: "prj_user",
    mission: "Open Edge and research benchmark data",
    status: "completed",
    summary: "Browser research completed.",
    metadata: {
      type: "research",
      selectedBrowser: { id: "edge", label: "Microsoft Edge" },
      missionUnderstanding: {
        chosenExecutionFrame: "research"
      }
    }
  });

  const normalized = normalizeUserMemory(memory);
  assert.equal(USER_MEMORY_SETTING_KEY, "user.memory.v1");
  assert.equal(normalized.profileFacts.some((fact) => fact.includes("consultant data")), true);
  assert.equal(normalized.tools.codex.count >= 1, true);
  assert.equal(normalized.tools.powershell.count >= 1, true);
  assert.equal(normalized.tools.edge.count >= 1, true);
  assert.equal(Object.values(normalized.blockers).some((entry) => entry.label.includes("bloque")), true);

  const summary = summarizeUserMemory(normalized);
  assert.equal(summary.preferredTools.some((entry) => entry.key === "codex"), true);
  assert.equal(summary.commonWorkflows.some((entry) => entry.key === "research"), true);
  assert.equal(summary.statedPreferences.length >= 1, true);
  assert.equal(summary.recentConversationSummaries.length >= 1, true);
  assert.equal(summary.recentMissionSummaries.some((entry) => entry.runId === "run_user_1"), true);

  const conversationRecords = extractUserMemoryRecordsFromConversationTurn({
    projectId: "prj_user",
    conversationId: "conv_user",
    userMessage: "Je suis consultant data. Je prefere Codex pour les tests PowerShell.",
    assistantReply: "Note.",
    intentType: "simple_conversation",
    action: "answer_directly"
  });
  assert.equal(conversationRecords.some((record) => record.category === "profile_fact"), true);
  assert.equal(conversationRecords.some((record) => record.category === "preference"), true);
  assert.equal(conversationRecords.some((record) => record.category === "tool" && record.metadata.toolId === "codex"), true);

  const runRecords = extractUserMemoryRecordsFromRun({
    id: "run_user_2",
    projectId: "prj_user",
    mission: "Prepare a browser research summary",
    status: "failed",
    summary: "Network timeout",
    metadata: {
      type: "research",
      selectedBrowser: { id: "edge", label: "Microsoft Edge" }
    }
  });
  assert.equal(runRecords.some((record) => record.category === "mission_summary"), true);
  assert.equal(runRecords.some((record) => record.category === "blocker"), true);
}
