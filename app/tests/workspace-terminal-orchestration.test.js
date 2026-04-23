import assert from "node:assert/strict";
import { OperatorService } from "../src/service/operator-service.js";
import {
  TERMINAL_AGENT_KIND,
  TERMINAL_AUTONOMY_MODE,
  TERMINAL_STATUS,
  detectCliAgentKind,
  detectTerminalState,
  evaluateTerminalIntervention
} from "../src/workspace/terminal-orchestration.js";

export async function run() {
  assert.equal(
    detectCliAgentKind({ command: "codex", recentOutput: "OpenAI Codex waiting for input" }),
    TERMINAL_AGENT_KIND.CODEX_CLI
  );
  assert.equal(
    detectCliAgentKind({ command: "claude code", recentOutput: "Claude Code" }),
    TERMINAL_AGENT_KIND.CLAUDE_CODE_CLI
  );

  const waiting = detectTerminalState({
    recentOutput: "Approve this command? [y/n]",
    processRunning: true
  });
  assert.equal(waiting.status, TERMINAL_STATUS.WAITING_FOR_INPUT);
  assert.equal(waiting.confidence > 0.5, true);

  const error = detectTerminalState({
    recentOutput: "Traceback: fatal error",
    processRunning: false
  });
  assert.equal(error.status, TERMINAL_STATUS.ERROR);

  const assistedDecision = evaluateTerminalIntervention({
    terminal: {
      authorized: true,
      status: TERMINAL_STATUS.WAITING_FOR_INPUT,
      agentKind: TERMINAL_AGENT_KIND.CODEX_CLI,
      autonomyMode: TERMINAL_AUTONOMY_MODE.ASSISTED
    },
    missionBrief: {
      objective: "Implement a feature"
    },
    detection: waiting
  });
  assert.equal(assistedDecision.action, "request_human_approval");
  assert.equal(assistedDecision.requiresApproval, true);

  const autonomousDecision = evaluateTerminalIntervention({
    terminal: {
      authorized: true,
      status: TERMINAL_STATUS.WAITING_FOR_INPUT,
      agentKind: TERMINAL_AGENT_KIND.CODEX_CLI,
      autonomyMode: TERMINAL_AUTONOMY_MODE.SUPERVISED_AUTONOMY
    },
    missionBrief: {
      objective: "Implement a feature"
    },
    detection: waiting
  });
  assert.equal(autonomousDecision.action, "auto_inject_context");
  assert.equal(autonomousDecision.requiresApproval, false);

  const service = await OperatorService.create();
  try {
    await service.clearTemporaryRuntimeState();
    for (const project of service.listProjects()) {
      await service.deleteProject(project.id);
    }
    const project = await service.ensureDemoProject();
    const briefResult = service.upsertWorkspaceMissionBrief(project.id, {
      objective: "Ship the browser planner and verify tests.",
      nextSteps: ["Watch Codex CLI", "Escalate if tests fail"]
    });
    assert.equal(briefResult.missionBrief.objective.includes("browser planner"), true);

    const attachResult = service.attachWorkspaceTerminal(project.id, {
      label: "Codex worker",
      command: "codex",
      recentOutput: "Approve this command? [y/n]",
      authorized: true,
      autonomyMode: "assisted"
    });
    assert.equal(attachResult.terminal.agentKind, TERMINAL_AGENT_KIND.CODEX_CLI);
    assert.equal(attachResult.terminal.status, TERMINAL_STATUS.WAITING_FOR_INPUT);
    assert.equal(attachResult.decision.action, "request_human_approval");

    const updateResult = service.updateWorkspaceTerminal(project.id, attachResult.terminal.id, {
      recentOutput: "All tests passed. Done.",
      processRunning: false,
      exitCode: 0
    });
    assert.equal(updateResult.terminal.status, TERMINAL_STATUS.COMPLETED);
    assert.equal(updateResult.workspace.terminals.length, 1);
    assert.equal(updateResult.workspace.decisions.length >= 2, true);

    const dashboard = await service.getDashboard(project.id);
    assert.equal(dashboard.workspace.summary.terminalCount, 1);
    assert.equal(dashboard.workspace.browserStrategy.supportedModes.includes("system_browser_mode"), true);
  } finally {
    await service.close();
  }
}
