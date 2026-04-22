import assert from "node:assert/strict";
import {
  buildSemanticTargets,
  flattenAccessibilityTree,
  resolveSemanticTarget,
  summarizeAccessibility
} from "../src/computer/desktop-perception.js";
import { assessDesktopStep } from "../src/computer/desktop-safety.js";
import { buildDesktopSkillCatalog, selectDesktopSkillForApplication } from "../src/computer/desktop-skills.js";

const accessibility = {
  available: true,
  tree: {
    name: "Browser",
    automationId: "root",
    controlType: "ControlType.Window",
    isEnabled: true,
    isOffscreen: false,
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
    children: [
      {
        name: "Search",
        automationId: "search_button",
        controlType: "ControlType.Button",
        isEnabled: true,
        isOffscreen: false,
        bounds: { x: 900, y: 20, width: 80, height: 32 },
        children: []
      },
      {
        name: "Query",
        automationId: "query",
        controlType: "ControlType.Edit",
        isEnabled: true,
        isOffscreen: false,
        bounds: { x: 20, y: 20, width: 850, height: 32 },
        children: []
      }
    ]
  }
};

export async function run() {
  const nodes = flattenAccessibilityTree(accessibility);
  assert.equal(nodes.length, 3);
  assert.equal(nodes.some((node) => node.role === "button"), true);

  const targets = buildSemanticTargets(accessibility);
  assert.equal(targets.length >= 2, true);
  assert.equal(targets.some((target) => target.label === "Search"), true);

  const resolved = resolveSemanticTarget(accessibility, {
    query: "Search",
    role: "button"
  });
  assert.equal(resolved.found, true);
  assert.equal(resolved.target.center.x, 940);
  assert.equal(resolved.target.center.y, 36);

  const summary = summarizeAccessibility(accessibility);
  assert.equal(summary.available, true);
  assert.equal(summary.roleCounts.button, 1);

  const browserSkill = selectDesktopSkillForApplication({
    id: "browser_edge",
    label: "Microsoft Edge",
    kind: "browser"
  });
  assert.equal(browserSkill.id, "browser_basic");
  const catalog = buildDesktopSkillCatalog([{ id: "notepad", label: "Notepad", kind: "text_editor" }]);
  assert.equal(catalog.some((skill) => skill.id === "text_editor_basic"), true);
  assert.equal(catalog.some((skill) => skill.id === "skill.app_launch"), true);
  assert.equal(catalog.some((skill) => skill.id === "skill.review_capture"), true);
  assert.equal(catalog.some((skill) => skill.id === "skill.clipboard_transfer"), true);
  assert.equal(catalog.some((skill) => skill.id === "skill.terminal_guarded"), true);
  assert.equal(catalog.some((skill) => skill.id === "skill.forms_basic"), true);

  const blocked = assessDesktopStep({
    primitive: "type_text",
    label: "Type password",
    input: { text: "password=abc" }
  });
  assert.equal(blocked.blocked, true);

  const semanticClick = assessDesktopStep({
    primitive: "click_point",
    label: "Click Search",
    target: { semanticTarget: "Search", role: "button" },
    riskLevel: "medium"
  });
  assert.equal(semanticClick.allowed, true);
  assert.equal(semanticClick.requiresApproval, true);

  const defaultDelete = assessDesktopStep({
    primitive: "click_point",
    label: "Click delete",
    target: { semanticTarget: "Delete", role: "button" },
    riskLevel: "high"
  });
  assert.equal(defaultDelete.blocked, true);

  const governedDelete = assessDesktopStep({
    primitive: "delete_path",
    label: "Delete file",
    target: { path: "Desktop/test.txt" },
    riskLevel: "high"
  }, {
    desktopAutonomy: {
      level: "maximum_governed",
      destructiveActionMode: "confirm"
    }
  });
  assert.equal(governedDelete.allowed, true);
  assert.equal(governedDelete.requiresApproval, true);

  const blockedFileWrite = assessDesktopStep({
    primitive: "write_text_file",
    label: "Write file",
    target: { path: "Desktop/test.txt" },
    input: { content: "hello" },
    riskLevel: "medium"
  });
  assert.equal(blockedFileWrite.blocked, true);

  const trustedMediumClick = assessDesktopStep({
    primitive: "click_point",
    label: "Click Search",
    target: { semanticTarget: "Search", role: "button" },
    riskLevel: "medium"
  }, {
    desktopAutonomy: {
      level: "operator_trusted",
      autoApproveMediumRisk: true
    },
    agentConfiguration: {
      guardrails: {
        approvalModeByAction: {
          local_desktop_actuation: "quiet_when_auto_allowed"
        }
      }
    }
  });
  assert.equal(trustedMediumClick.allowed, true);
  assert.equal(trustedMediumClick.requiresApproval, false);

  const terminalCredential = assessDesktopStep({
    primitive: "type_text",
    label: "Type login password into terminal",
    input: { text: "password=abc" },
    riskLevel: "medium"
  }, {
    skill: {
      id: "skill.terminal_guarded",
      primitiveAllowed: true,
      blockedIntents: ["credential_entry"]
    }
  });
  assert.equal(terminalCredential.blocked, true);
}
