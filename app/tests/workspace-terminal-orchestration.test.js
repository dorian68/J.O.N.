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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTerminalStatus(service, projectId, terminalId, status, { timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const terminal = service.runtimeHandle.database.getWorkspaceTerminalSession(terminalId);
    if (terminal?.status === status) {
      return terminal;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for terminal ${terminalId} to reach ${status}.`);
}

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

  const service = await OperatorService.create({
    cliAllowedCommands: [process.execPath]
  });
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

    const processResult = service.startWorkspaceTerminalProcess(project.id, {
      label: "Node test worker",
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log('worker ready')",
          "console.log('Approve this command? [y/n]')",
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (chunk) => { console.log('received:' + chunk.trim()); process.exit(0) })",
          "setTimeout(() => process.exit(2), 8000)"
        ].join(";")
      ],
      authorized: true,
      autonomyMode: "assisted"
    });
    assert.equal(processResult.terminal.status, TERMINAL_STATUS.RUNNING);
    const waitingTerminal = await waitForTerminalStatus(service, project.id, processResult.terminal.id, TERMINAL_STATUS.WAITING_FOR_INPUT);
    assert.equal(waitingTerminal.recentOutput.includes("Approve this command?"), true);
    assert.throws(
      () => service.writeWorkspaceTerminalInput(project.id, processResult.terminal.id, { input: "y" }),
      /requires explicit approval/
    );
    service.writeWorkspaceTerminalInput(project.id, processResult.terminal.id, {
      input: "y",
      approved: true
    });
    const completedTerminal = await waitForTerminalStatus(service, project.id, processResult.terminal.id, TERMINAL_STATUS.COMPLETED);
    assert.equal(completedTerminal.recentOutput.includes("received:y"), true);
    const terminalEvents = service.runtimeHandle.database.listWorkspaceTerminalEvents(project.id, {
      terminalId: processResult.terminal.id
    });
    assert.equal(terminalEvents.some((event) => event.eventType === "process.input"), true);
  } finally {
    await service.close();
  }
}
