import assert from "node:assert/strict";
import { APPROVAL_DECISION } from "../src/config.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function readFirstSseFrame(baseUrl) {
  const response = await fetch(`${baseUrl}/api/events`);
  if (!response.ok || !response.body) {
    throw new Error("Unable to open SSE stream.");
  }
  const reader = response.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

async function waitForPendingApproval(baseUrl, { timeoutMs = 4000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const dashboard = await fetchJson(baseUrl, "/api/dashboard");
    if (dashboard.pendingApprovals.length > 0) {
      return {
        dashboard,
        approval: dashboard.pendingApprovals[0]
      };
    }
    await sleep(100);
  }
  throw new Error("Timed out while waiting for pending approval on operator server.");
}

async function waitForRunTerminalState(baseUrl, runId, { timeoutMs = 15000 } = {}) {
  const startedAt = Date.now();
  let detail = null;
  while (Date.now() - startedAt < timeoutMs) {
    detail = await fetchJson(baseUrl, `/api/runs/${runId}`);
    if (["completed", "failed", "stopped"].includes(detail.run.status)) {
      return detail;
    }
    await sleep(100);
  }
  return detail;
}

async function waitForMissionChain(baseUrl, projectId, rootRunId, { timeoutMs = 15000 } = {}) {
  const startedAt = Date.now();
  const resolvedApprovalIds = new Set();
  while (Date.now() - startedAt < timeoutMs) {
    const dashboard = await fetchJson(baseUrl, "/api/dashboard");
    const project = dashboard.projects.find((entry) => entry.id === projectId);
    const chainRuns = (project?.runs ?? [])
      .filter((run) => (run.metadata?.orchestration?.rootRunId ?? run.id) === rootRunId)
      .sort((left, right) => Number(left.metadata?.orchestration?.runIndex ?? 0) - Number(right.metadata?.orchestration?.runIndex ?? 0));
    const pendingChainApprovals = dashboard.pendingApprovals.filter((approval) => chainRuns.some((run) => run.id === approval.runId));
    for (const approval of pendingChainApprovals) {
      if (resolvedApprovalIds.has(approval.id)) {
        continue;
      }
      resolvedApprovalIds.add(approval.id);
      await fetchJson(baseUrl, `/api/approvals/${approval.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision: APPROVAL_DECISION.APPROVED_ONCE,
          rationale: approval.category === "local_focus"
            ? "Allow chained focus shift for browser capture."
            : "Allow chained bounded continuation."
        })
      });
    }
    const activeChainRun = chainRuns.find((run) => dashboard.activeRunIds.includes(run.id));
    if (!activeChainRun && chainRuns.length >= 2) {
      return Promise.all(chainRuns.map((run) => fetchJson(baseUrl, `/api/runs/${run.id}`)));
    }
    await sleep(100);
  }
  throw new Error("Timed out while waiting for the mission chain on operator server.");
}

export async function run() {
  const server = await createOperatorServer({
    port: 0,
    operatorServiceOptions: {
      realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
      computerProvider: new FakeWindowProvider([
        {
          id: "win_hub",
          title: "Controlled Browser Fixture Window",
          active: false,
          allowlisted: true,
          content: "state=loading"
        },
        {
          id: "win_notes",
          title: "Operator Notes Window",
          active: true,
          allowlisted: false,
          content: "notes"
        }
      ], {
        browsers: [
          {
            id: "edge",
            label: "Microsoft Edge",
            processName: "msedge",
            executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
          },
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
    for (const project of server.operatorService.listProjects()) {
      await server.operatorService.deleteProject(project.id);
    }
    await server.operatorService.ensureDemoProject();

    const home = await fetch(`${server.baseUrl}/`);
    assert.equal(home.ok, true);
    const homeContent = await home.text();
    assert.equal(homeContent.includes("Cowork Desktop"), true);
    assert.equal(homeContent.includes("cowork-user-root"), true);
    assert.equal(homeContent.includes("/assets/react/cowork-user.js"), true);
    assert.equal(homeContent.includes("mission-onboarding"), false);
    assert.equal(homeContent.includes("Project context"), false);
    assert.equal(homeContent.includes("Diagnostics"), false);
    assert.equal(homeContent.includes("/assets/cowork-mark.svg"), true);

    const adminHome = await fetch(`${server.baseUrl}/admin`);
    assert.equal(adminHome.ok, true);
    const adminContent = await adminHome.text();
    assert.equal(adminContent.includes("Admin console"), true);
    assert.equal(adminContent.includes("Project context"), true);
    assert.equal(adminContent.includes("Diagnostics"), true);
    assert.equal(adminContent.includes("Token and cost dashboard"), true);

    const icon = await fetch(`${server.baseUrl}/assets/cowork-mark.svg`);
    assert.equal(icon.ok, true);
    assert.equal((icon.headers.get("content-type") ?? "").includes("image/svg+xml"), true);
    const sseFrame = await readFirstSseFrame(server.baseUrl);
    assert.equal(sseFrame.includes("stream.connected"), true);

    const dashboard = await fetchJson(server.baseUrl, "/api/dashboard");
    assert.equal(Array.isArray(dashboard.projects), true);
    assert.equal(dashboard.projects.length >= 1, true);
    assert.equal(Array.isArray(dashboard.scenarios), true);
    assert.equal(Array.isArray(dashboard.missionEntry?.modes), true);
    assert.equal(typeof dashboard.llmDashboard?.estimatedCost, "number");
    assert.equal(Array.isArray(dashboard.llmDashboard?.stageBreakdown), true);
    assert.equal(typeof dashboard.agentConfiguration?.conversationalSystemPrompt, "string");
    assert.equal(dashboard.agentConfiguration.conversationalSystemPrompt.includes("Before acting"), true);
    assert.equal(dashboard.capabilityGraph?.summary?.skills?.some((skill) => skill.id === "skill.explorer"), true);
    assert.equal(dashboard.capabilityGraph?.summary?.skills?.some((skill) => skill.id === "skill.notepad"), true);
    assert.equal(dashboard.capabilityGraph?.summary?.skills?.some((skill) => skill.id === "skill.browser"), true);
    assert.equal(Array.isArray(dashboard.desktopActionSupport?.availableBrowsers), true);
    assert.equal(dashboard.desktopActionSupport.availableBrowsers.length >= 2, true);
    assert.equal(Boolean(dashboard.workspace?.autonomyPolicy), true);

    const workspaceProjectId = dashboard.selectedProjectId ?? dashboard.projects[0].id;
    const workspaceBrief = await fetchJson(server.baseUrl, `/api/projects/${workspaceProjectId}/workspace/mission-brief`, {
      method: "POST",
      body: JSON.stringify({
        objective: "Supervise a Codex CLI worker for the current mission.",
        nextSteps: ["Watch terminal", "Escalate if blocked"]
      })
    });
    assert.equal(workspaceBrief.missionBrief.objective.includes("Codex CLI"), true);
    const terminalAttach = await fetchJson(server.baseUrl, `/api/projects/${workspaceProjectId}/workspace/terminals`, {
      method: "POST",
      body: JSON.stringify({
        label: "Codex CLI",
        command: "codex",
        recentOutput: "Approve this command? [y/n]",
        authorized: true,
        autonomyMode: "assisted"
      })
    });
    assert.equal(terminalAttach.terminal.status, "waiting_for_input");
    assert.equal(terminalAttach.decision.action, "request_human_approval");
    const terminalUpdate = await fetchJson(server.baseUrl, `/api/projects/${workspaceProjectId}/workspace/terminals/${terminalAttach.terminal.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        recentOutput: "All tests passed. Done.",
        processRunning: false,
        exitCode: 0
      })
    });
    assert.equal(terminalUpdate.terminal.status, "completed");
    const workspaceState = await fetchJson(server.baseUrl, `/api/projects/${workspaceProjectId}/workspace`);
    assert.equal(workspaceState.terminals.length, 1);
    assert.equal(workspaceState.decisions.length >= 2, true);

    const capabilityPayload = await fetchJson(server.baseUrl, "/api/capabilities");
    assert.equal(capabilityPayload.summary.nodeCount > 0, true);
    const refreshedCapabilityPayload = await fetchJson(server.baseUrl, "/api/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(refreshedCapabilityPayload.summary.nodeCount > 0, true);
    const firstCapability = refreshedCapabilityPayload.graph.nodes[0];
    const updatedCapability = await fetchJson(server.baseUrl, `/api/capabilities/${encodeURIComponent(firstCapability.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        label: `${firstCapability.label} edited`,
        description: "Operator-edited test capability description.",
        affordances: ["test affordance"],
        knownLimits: ["test limit"]
      })
    });
    assert.equal(updatedCapability.override.nodeId, firstCapability.id);
      const generatedCapability = await fetchJson(server.baseUrl, "/api/capabilities/descriptions/generate", {
        method: "POST",
        body: JSON.stringify({
          nodeIds: [firstCapability.id],
          limit: 1
        })
      });
      assert.equal(generatedCapability.updatedCount >= 1, true);
      const rankingPayload = await fetchJson(server.baseUrl, "/api/capabilities/rank", {
        method: "POST",
        body: JSON.stringify({
          mission: "ouvre mon navigateur et capture une preuve",
          limit: 5
        })
      });
      assert.equal(rankingPayload.policyId, "capability-ranking-v2");
      assert.equal(rankingPayload.results.length > 0, true);
      assert.equal(Boolean(rankingPayload.results[0].explanation?.components), true);
      const feedbackPayload = await fetchJson(server.baseUrl, "/api/capabilities/feedback", {
        method: "POST",
        body: JSON.stringify({
          nodeId: firstCapability.id,
          outcomeStatus: "operator_positive",
          mission: "operator server capability feedback test"
        })
      });
      assert.equal(feedbackPayload.feedback.nodeId, firstCapability.id);
      const skillRegistry = await fetchJson(server.baseUrl, "/api/skills");
      assert.equal(skillRegistry.builtin.some((skill) => skill.id === "skill.explorer"), true);
      assert.equal(skillRegistry.builtin.every((skill) => skill.implementationStatus === "operational_deep"), true);
      const deepSkillValidation = await fetchJson(server.baseUrl, "/api/skills/deep-validation");
      assert.equal(deepSkillValidation.status, "all_passed");
      assert.equal(deepSkillValidation.productionProof, "requires_real_scenario_evidence");
      const operationalDeep = await fetchJson(server.baseUrl, "/api/operational-deep");
      assert.equal(operationalDeep.classification.implementationStatus, "operational_deep_contract");
      assert.equal(operationalDeep.classification.isJonOperationalDeepImplemented, true);
      const userSkillRegistry = await fetchJson(server.baseUrl, "/api/skills/user-defined", {
        method: "POST",
        body: JSON.stringify({
          manifest: {
            id: "skill.test_user_skill",
            label: "Test user skill",
            primitives: ["launch_application"],
            policyHooks: ["local_app_launch"],
            evidenceHooks: ["visible_window_after_launch"],
            affordances: ["open test app"]
          }
        })
      });
      assert.equal(userSkillRegistry.userDefined.some((skill) => skill.id === "skill.test_user_skill"), true);

      const configPayload = await fetchJson(server.baseUrl, "/api/agent/config");
    assert.equal(configPayload.config.guardrails.showInternalPlansInChat, false);
    assert.equal(configPayload.config.guardrails.desktopAutonomy.level, "supervised");
    const updatedConfig = await fetchJson(server.baseUrl, "/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({
        config: {
          ...configPayload.config,
          conversationalSystemPrompt: `${configPayload.config.conversationalSystemPrompt}\n\nTest instruction: keep responses natural.`,
          guardrails: {
            ...configPayload.config.guardrails,
            assistantVerbosity: "balanced",
            showInternalPlansInChat: true,
            desktopAutonomy: {
              ...configPayload.config.guardrails.desktopAutonomy,
              level: "operator_trusted",
              autoApproveLowRisk: true,
              autoApproveMediumRisk: true
            }
          }
        }
      })
    });
    assert.equal(updatedConfig.config.guardrails.assistantVerbosity, "balanced");
    assert.equal(updatedConfig.config.guardrails.showInternalPlansInChat, true);
    assert.equal(updatedConfig.config.guardrails.desktopAutonomy.level, "operator_trusted");
    assert.equal(updatedConfig.config.guardrails.desktopAutonomy.autoApproveMediumRisk, true);
    const preview = await fetchJson(server.baseUrl, "/api/agent/config/preview", {
      method: "POST",
      body: JSON.stringify({
        message: "ouvre mon éditeur de note"
      })
    });
    assert.equal(preview.preview.includes("Confirme"), true);
    const resetConfig = await fetchJson(server.baseUrl, "/api/agent/config/reset", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(resetConfig.config.guardrails.showInternalPlansInChat, false);
    assert.equal(resetConfig.config.guardrails.desktopAutonomy.level, "supervised");

    const projectId = dashboard.projects[0].id;
    const launch = await fetchJson(server.baseUrl, `/api/projects/${projectId}/runs`, {
      method: "POST",
      body: JSON.stringify({ scenarioId: "computer" })
    });

    const pendingState = await waitForPendingApproval(server.baseUrl);
    assert.equal(pendingState.approval.category, "local_focus");

    await fetchJson(server.baseUrl, `/api/approvals/${pendingState.approval.id}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision: APPROVAL_DECISION.APPROVED_ONCE,
        rationale: "Controlled approval via HTTP test."
      })
    });

    const runDetail = await waitForRunTerminalState(server.baseUrl, launch.runId);

    assert.equal(runDetail.run.status, "completed");
    assert.equal(runDetail.evidence.length >= 1, true);
    assert.equal(runDetail.review.operatorState.code, "finished");
    const observationEvidence = runDetail.evidence.find((entry) => entry.label === "Computer control observation evidence");
    assert.equal(Boolean(observationEvidence), true);

    const manifest = await fetchJson(
      server.baseUrl,
      `/api/runs/${launch.runId}/evidence/${observationEvidence.id}/manifest`
    );
    assert.equal(manifest.content.payload.verification.validated, true);

    await fetchJson(
      server.baseUrl,
      `/api/runs/${launch.runId}/evidence/${observationEvidence.id}`,
      {
        method: "DELETE"
      }
    );

    await fetchJson(server.baseUrl, `/api/runs/${launch.runId}`, {
      method: "DELETE"
    });

    const removedRun = await fetch(`${server.baseUrl}/api/runs/${launch.runId}`);
    assert.equal(removedRun.status, 404);

    const missionPreflight = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions/preflight`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Compare the controlled pages and produce an operator-facing note.",
          constraints: [
            "Use only controlled pages"
          ],
          forbiddenActions: [
            "Do not submit anything"
          ]
        }
      })
    });

    assert.equal(missionPreflight.preflight.understanding.chosenExecutionFrame, "research");
    assert.equal(missionPreflight.preflight.understanding.coveredNow.length >= 1, true);
    assert.equal(missionPreflight.preflight.understanding.verificationGoals.length >= 1, true);
    assert.equal(missionPreflight.preflight.understanding.runNowPlan.length >= 1, true);
    assert.equal(missionPreflight.preflight.understanding.nextRunSuggestion.length > 0, true);
    assert.equal(
      missionPreflight.preflight.understanding.nextRunRecommendation == null
        || typeof missionPreflight.preflight.understanding.nextRunRecommendation.objective === "string",
      true
    );
    assert.equal(missionPreflight.preflight.understanding.requiresClarification, false);

    const hybridPreflight = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions/preflight`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Compare the controlled pages, then capture a screenshot of the visible result."
        }
      })
    });
    assert.equal(hybridPreflight.preflight.understanding.requiresClarification, true);
    assert.equal(hybridPreflight.preflight.understanding.clarificationQuestion.length > 0, true);

    const browserPreflight = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions/preflight`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Open my browser on this machine."
        }
      })
    });
    assert.equal(browserPreflight.preflight.understanding.chosenExecutionFrame, "computer_observation");
    assert.equal(browserPreflight.preflight.understanding.computerActionType, "launch_browser");
    assert.equal(browserPreflight.preflight.understanding.requiresClarification, true);
    assert.equal(browserPreflight.preflight.understanding.clarificationOptions.length, 2);

    const browserSelectedPreflight = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions/preflight`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Open my browser on this machine.",
          parameters: {
            browserLaunch: {
              browserId: "edge"
            }
          }
        }
      })
    });
    assert.equal(browserSelectedPreflight.preflight.understanding.requiresClarification, false);
    assert.equal(browserSelectedPreflight.preflight.understanding.selectedBrowser?.id, "edge");

    const browserMissionLaunch = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Open my browser on this machine.",
          parameters: {
            browserLaunch: {
              browserId: "edge"
            }
          }
        },
        preflight: browserSelectedPreflight.preflight
      })
    });
    const browserPending = await waitForPendingApproval(server.baseUrl);
    assert.equal(browserPending.approval.category, "local_app_launch");
    await fetchJson(server.baseUrl, `/api/approvals/${browserPending.approval.id}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision: APPROVAL_DECISION.APPROVED_ONCE,
        rationale: "Allow local browser launch via HTTP test."
      })
    });
    const browserDetail = await waitForRunTerminalState(server.baseUrl, browserMissionLaunch.runId);
    assert.equal(browserDetail.run.status, "completed");
    assert.equal(browserDetail.run.metadata?.computerActionType, "launch_browser");
    assert.equal(browserDetail.run.plan?.missionUnderstanding?.selectedBrowser?.id, "edge");
    assert.equal(browserDetail.review.outcomeSummary.selectedBrowser?.id, "edge");
    const browserEvidence = browserDetail.evidence.find((entry) => entry.label === "Desktop browser launch evidence");
    assert.equal(Boolean(browserEvidence), true);

    const browserSearchPreflight = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions/preflight`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Open Edge, search for release readiness, then capture a screenshot of the visible result.",
          parameters: {
            browserLaunch: {
              browserId: "edge"
            }
          }
        }
      })
    });
    assert.equal(browserSearchPreflight.preflight.understanding.computerActionType, "launch_browser_search");
    assert.equal(browserSearchPreflight.preflight.understanding.nextRunRecommendation?.parameters?.computerAction?.type, "capture_browser_window");
    assert.equal(browserSearchPreflight.preflight.understanding.requiresClarification, false);

    const browserSearchMissionLaunch = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Open Edge, search for release readiness, then capture a screenshot of the visible result.",
          parameters: {
            browserLaunch: {
              browserId: "edge"
            }
          }
        },
        preflight: browserSearchPreflight.preflight,
        orchestration: {
          autoContinue: true,
          maxAutoRuns: 2
        }
      })
    });
    const browserSearchPending = await waitForPendingApproval(server.baseUrl);
    assert.equal(browserSearchPending.approval.category, "local_app_launch");
    await fetchJson(server.baseUrl, `/api/approvals/${browserSearchPending.approval.id}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision: APPROVAL_DECISION.APPROVED_ONCE,
        rationale: "Allow chained browser launch via HTTP test."
      })
    });
    const browserChainDetails = await waitForMissionChain(server.baseUrl, projectId, browserSearchMissionLaunch.runId);
    assert.equal(browserChainDetails.length >= 2, true);
    assert.equal(browserChainDetails[0].review.outcomeSummary.handoffDecision?.decision, "continue_now");
    assert.equal(browserChainDetails[1].run.metadata?.entryPoint, "auto_chain");
    assert.equal(browserChainDetails[1].run.metadata?.computerActionType, "capture_browser_window");
    assert.equal(browserChainDetails[1].run.status, "completed");

    const missionConversation = await fetchJson(server.baseUrl, `/api/projects/${projectId}/conversations`, {
      method: "POST",
      body: JSON.stringify({
        title: "Compare controlled pages"
      })
    });

    const missionLaunch = await fetchJson(server.baseUrl, `/api/projects/${projectId}/missions`, {
      method: "POST",
      body: JSON.stringify({
        missionSpec: {
          objective: "Compare the controlled pages and produce an operator-facing note.",
          constraints: [
            "Use only controlled pages"
          ],
          forbiddenActions: [
            "Do not submit anything"
          ]
        },
        preflight: missionPreflight.preflight,
        conversationId: missionConversation.conversation.id
      })
    });

    const missionDetail = await waitForRunTerminalState(server.baseUrl, missionLaunch.runId);

    assert.equal(missionDetail.run.status, "completed");
    assert.equal(missionDetail.run.metadata?.entryPoint, "mission_entry_gui");
    assert.equal(missionDetail.run.metadata?.conversationId, missionConversation.conversation.id);
    assert.equal(missionDetail.run.metadata?.missionSpec?.mode, "research");
    assert.equal(missionDetail.run.metadata?.missionSpec?.routing?.modeSource, "agent_preflight_confirmed");
    assert.equal(missionDetail.run.plan?.missionUnderstanding?.chosenExecutionFrame, "research");
    assert.equal(missionDetail.run.plan?.missionUnderstanding?.generationMode, "confirmed_preflight");
    assert.equal(missionDetail.run.plan?.missionUnderstanding?.runNowPlan.length >= 1, true);
    assert.equal(typeof missionDetail.run.plan?.missionUnderstanding?.nextRunSuggestion, "string");
    assert.equal(missionDetail.review.outcomeSummary.recommendedNextStep.summary.length > 0, true);
    assert.equal(typeof missionDetail.review.llmUsage.totalTokens, "number");
    assert.equal(missionDetail.run.metadata?.verificationSummary?.overallStatus, "pass");

    const refreshedDashboard = await fetchJson(server.baseUrl, "/api/dashboard");
    assert.equal(refreshedDashboard.llmDashboard.callCount >= 1, true);
    assert.equal(refreshedDashboard.llmDashboard.recentRuns.some((entry) => entry.runId === missionLaunch.runId), true);
  } finally {
    await server.close();
  }
}
