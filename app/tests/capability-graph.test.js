import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrototypeDatabase } from "../src/storage/database.js";
import {
  applyCapabilityOverrides,
  buildCapabilityGraph,
  buildCapabilityFeedbackStats,
  compactCapabilityGraphForPrompt,
  explainCapabilityRankingForMission,
  refreshCapabilityGraph,
  scoreCapabilityNodesForMission,
  summarizeCapabilityGraph
} from "../src/capabilities/capability-graph.js";
import {
  BUILTIN_SKILL_MANIFESTS,
  validateSkillManifest
} from "../src/capabilities/skill-manifest.js";
import { validateOperationalDeepSkills } from "../src/capabilities/skill-validation-harness.js";

export async function run() {
  const dbPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "cowork-capability-graph-")), "test.sqlite");
  const database = new PrototypeDatabase(dbPath);
  await database.open();
  try {
    const graph = buildCapabilityGraph({
      applications: [
        { id: "file_explorer", label: "File Explorer", kind: "file_manager", processName: "explorer" },
        { id: "notepad", label: "Notepad", kind: "text_editor", processName: "notepad" }
      ],
      browsers: [
        { id: "edge", label: "Microsoft Edge", processName: "msedge" }
      ],
      externalToolProviders: [
        {
          id: "local_docs_mcp",
          label: "Local docs MCP",
          trustLevel: "operator_configured",
          enabled: false,
          tools: [
            {
              name: "search_docs",
              description: "Search local documentation by query.",
              inputSchema: { type: "object" }
            }
          ]
        }
      ],
      agentConfiguration: {
        guardrails: {
          desktopAutonomy: { level: "maximum_governed" }
        }
      }
    });
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.explorer"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.notepad"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.browser"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.app_launch"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.review_capture"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.clipboard_transfer"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.terminal_guarded"), true);
    assert.equal(graph.nodes.some((node) => node.id === "skill.skill.forms_basic"), true);
    assert.equal(graph.nodes.some((node) => node.sourceKind === "file_primitive_provider" && node.rollbackPossible), true);
    const mcpNode = graph.nodes.find((node) => node.sourceKind === "mcp_server");
    assert.equal(Boolean(mcpNode), true);
    assert.equal(mcpNode.approvalRequired, true);
    assert.equal(mcpNode.payload.trustLevel, "operator_configured");
    assert.equal(BUILTIN_SKILL_MANIFESTS.length >= 7, true);
    assert.equal(BUILTIN_SKILL_MANIFESTS.every((manifest) => validateSkillManifest(manifest).valid), true);
    const deepValidation = validateOperationalDeepSkills();
    assert.equal(deepValidation.status, "all_passed");
    assert.equal(deepValidation.results.every((result) => result.proofLevel === "repo_contract_validated"), true);

    const refreshed = refreshCapabilityGraph(database, {
      applications: [
        { id: "file_explorer", label: "File Explorer", kind: "file_manager", processName: "explorer" },
        { id: "notepad", label: "Notepad", kind: "text_editor", processName: "notepad" }
      ],
      browsers: [
        { id: "edge", label: "Microsoft Edge", processName: "msedge" }
      ]
    });
    assert.equal(refreshed.nodes.length, database.listCapabilityGraphNodes().length);

    const rankedFile = scoreCapabilityNodesForMission(refreshed.nodes, "liste les dossiers présents sur mon bureau", { limit: 5 });
    assert.equal(rankedFile.some((node) => node.skillId === "skill.explorer" || node.id === "skill.skill.explorer"), true);

    const explorerSkill = refreshed.nodes.find((node) => node.id === "skill.skill.explorer");
    const override = database.upsertCapabilityGraphOverride(explorerSkill.id, {
      label: "Explorer governed skill",
      description: "Inspect and manage local files through governed primitives.",
      affordances: ["inspect folders", "copy files"],
      knownLimits: ["Policy decides before mutation."],
      metadata: { source: "test" }
    });
    const overriddenNodes = applyCapabilityOverrides(refreshed.nodes, database.listCapabilityGraphOverrides());
    const overriddenExplorer = overriddenNodes.find((node) => node.id === explorerSkill.id);
    assert.equal(override.nodeId, explorerSkill.id);
    assert.equal(overriddenExplorer.label, "Explorer governed skill");
    assert.equal(overriddenExplorer.payload.description.includes("Inspect and manage"), true);

    database.insertCapabilityFeedback({
      id: "capfb_test_1",
      nodeId: explorerSkill.id,
      skillId: "skill.explorer",
      mission: "liste le bureau",
      projectId: null,
      runId: null,
      conversationTurnId: null,
      selectedScore: 0.8,
      outcomeStatus: "success",
      approvalCount: 0,
      evidenceCount: 1,
      rollbackCount: 0,
      notes: "test feedback",
      metadata: {},
      createdAt: new Date().toISOString()
    });
    database.insertCapabilityFeedback({
      id: "capfb_test_2",
      nodeId: explorerSkill.id,
      skillId: "skill.explorer",
      mission: "liste le bureau",
      projectId: null,
      runId: null,
      conversationTurnId: null,
      selectedScore: 0.8,
      outcomeStatus: "operator_positive",
      approvalCount: 0,
      evidenceCount: 0,
      rollbackCount: 0,
      notes: "operator confirmed this was useful",
      metadata: { source: "test" },
      createdAt: new Date().toISOString()
    });
    const feedbackRecords = database.listCapabilityFeedback();
    const feedbackStats = buildCapabilityFeedbackStats(feedbackRecords);
    assert.equal(feedbackStats.get(explorerSkill.id).successes, 1);
    assert.equal(feedbackStats.get(explorerSkill.id).operatorPositive, 1);

    const rankedBrowser = scoreCapabilityNodesForMission(refreshed.nodes, "ouvre mon navigateur et cherche cowork", { limit: 5 });
    assert.equal(rankedBrowser.some((node) => node.skillId === "skill.browser" || node.id === "skill.skill.browser"), true);

    const compact = compactCapabilityGraphForPrompt(refreshed.nodes, {
      mission: "crée un fichier texte sur mon bureau",
      limit: 8,
      feedbackRecords
    });
    assert.equal(compact.nodeCount, refreshed.nodes.length);
    assert.equal(compact.topCapabilities.length > 0, true);
    assert.equal(Object.hasOwn(compact.topCapabilities[0], "knownLimits"), true);
    assert.equal(Boolean(compact.topCapabilities[0].rankingExplanation), true);
    const ranking = explainCapabilityRankingForMission(refreshed.nodes, "ouvre mon navigateur et prends une capture", {
      limit: 5,
      feedbackRecords
    });
    assert.equal(ranking.policyId, "capability-ranking-v2");
    assert.equal(ranking.results.length > 0, true);
    assert.equal(Boolean(ranking.results[0].explanation?.components), true);
    const summary = summarizeCapabilityGraph(refreshed.nodes, feedbackRecords);
    assert.equal(database.summarizeCapabilityFeedback().some((entry) => entry.nodeId === explorerSkill.id), true);
    assert.equal(summary.skillManifests.some((skill) => skill.id === "skill.forms_basic" && skill.implementationStatus === "operational_deep"), true);
    assert.equal(summary.deepValidation.status, "all_passed");
  } finally {
    database.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  }
}
