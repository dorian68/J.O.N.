import fs from "node:fs/promises";
import path from "node:path";
import { generateBrowserPlan } from "./browser-planner.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { createId, nowIso } from "../utils/ids.js";

function compactResult(value) {
  if (value == null) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= 1800) {
      return JSON.parse(serialized);
    }
    return {
      summary: serialized.slice(0, 1800)
    };
  } catch {
    return String(value).slice(0, 1800);
  }
}

function normalizeWaitExpectation(step) {
  return {
    state: step.target?.waitState || "domcontentloaded",
    selector: step.selector ?? null
  };
}

function evidenceRecordFromCapture(capture, step) {
  return {
    id: capture.evidenceId,
    type: capture.evidenceType,
    label: step.evidenceLabel ?? step.label,
    screenshotPath: capture.screenshotPath,
    summaryPath: capture.summaryPath,
    url: capture.browserState?.url ?? null,
    title: capture.browserState?.title ?? null
  };
}

export class BrowserOperator {
  constructor({
    browserController,
    llmGateway = null,
    projectId = "browser_operator",
    runId = createId("browser_run"),
    evidenceRoot
  } = {}) {
    if (!browserController) {
      throw new Error("BrowserOperator requires a BrowserController.");
    }
    this.browser = browserController;
    this.llmGateway = llmGateway;
    this.projectId = projectId;
    this.runId = runId;
    this.evidenceRoot = evidenceRoot;
  }

  async runMission(input = {}) {
    const evidenceDir = this.evidenceRoot ?? path.join(process.cwd(), ".runtime-data", "browser-operator", this.runId, "evidence");
    await ensureDir(evidenceDir);
    const planResult = await generateBrowserPlan({
      llmGateway: this.llmGateway,
      projectId: this.projectId,
      runId: this.runId,
      input
    });
    const plan = planResult.output;
    const execution = {
      id: this.runId,
      projectId: this.projectId,
      status: "running",
      startedAt: nowIso(),
      completedAt: null,
      generationMode: planResult.generationMode,
      fallbackReason: planResult.fallbackReason ?? null,
      llmCallId: planResult.callRecord?.id ?? null,
      plan,
      stepResults: [],
      extracted: {},
      evidence: [],
      blockers: [],
      errors: [],
      browserState: null
    };

    let targetId = null;
    try {
      for (const step of plan.steps) {
        const stepStartedAt = nowIso();
        try {
          const result = await this.#executeStep({ step, plan, targetId, evidenceDir });
          if (result?.targetId) {
            targetId = result.targetId;
          }
          if (result?.extracted) {
            execution.extracted = {
              ...execution.extracted,
              ...result.extracted
            };
          }
          if (result?.evidence) {
            execution.evidence.push(result.evidence);
          }
          if (result?.blocker?.blocked) {
            execution.blockers.push(result.blocker);
            if (step.stopOnFailure) {
              execution.status = "blocked";
            }
          }
          execution.stepResults.push({
            id: step.id,
            action: step.action,
            label: step.label,
            status: result?.status ?? "pass",
            startedAt: stepStartedAt,
            completedAt: nowIso(),
            result: compactResult(result)
          });
          if (execution.status === "blocked") {
            break;
          }
        } catch (error) {
          const failure = {
            id: step.id,
            action: step.action,
            label: step.label,
            status: "fail",
            startedAt: stepStartedAt,
            completedAt: nowIso(),
            error: error?.message ?? String(error)
          };
          execution.stepResults.push(failure);
          execution.errors.push(failure);
          if (step.stopOnFailure) {
            execution.status = "failed";
            break;
          }
        }
      }

      execution.browserState = await this.browser.getSessionState().catch(() => null);
      if (execution.status === "running") {
        execution.status = execution.errors.length > 0 ? "partial" : "completed";
      }
      execution.completedAt = nowIso();
      const summaryPath = path.join(evidenceDir, `browser-operator-run-${this.runId}.json`);
      await writeJson(summaryPath, execution);
      execution.summaryPath = summaryPath;
      return execution;
    } finally {
      if (input.closeBrowser !== false) {
        await this.browser.close().catch(() => {});
      }
    }
  }

  async #executeStep({ step, plan, targetId, evidenceDir }) {
    switch (step.action) {
      case "open_session": {
        const session = await this.browser.openBrowserSession({
          allowlistedHosts: plan.allowlistedHosts,
          headless: true
        });
        return {
          status: "pass",
          targetId: session.targetId,
          session
        };
      }
      case "navigate": {
        const activeTargetId = this.#requireTarget(targetId);
        const result = await this.browser.navigate(activeTargetId, step.target.url);
        return {
          status: "pass",
          targetId: activeTargetId,
          navigation: result
        };
      }
      case "wait_state": {
        const activeTargetId = this.#requireTarget(targetId);
        const result = await this.browser.waitForPageState(activeTargetId, normalizeWaitExpectation(step));
        return {
          status: "pass",
          targetId: activeTargetId,
          waitState: result
        };
      }
      case "read_state": {
        const activeTargetId = this.#requireTarget(targetId);
        const state = await this.browser.getTargetState(activeTargetId);
        return {
          status: "pass",
          targetId: activeTargetId,
          browserState: state
        };
      }
      case "read_dom": {
        const activeTargetId = this.#requireTarget(targetId);
        const snapshot = await this.browser.captureDomSnapshotForTarget(activeTargetId);
        return {
          status: "pass",
          targetId: activeTargetId,
          domSummary: {
            title: snapshot.title,
            url: snapshot.url,
            bodyTextLength: snapshot.bodyText?.length ?? 0,
            interactiveElementCount: snapshot.interactiveElements?.length ?? 0
          }
        };
      }
      case "query_interactive": {
        const activeTargetId = this.#requireTarget(targetId);
        const ranking = await this.browser.queryDom(activeTargetId, step.selector);
        return {
          status: ranking.ambiguous ? "ambiguous" : "pass",
          targetId: activeTargetId,
          ranking: {
            ambiguous: ranking.ambiguous,
            candidateCount: ranking.ranked?.length ?? 0,
            best: ranking.best ?? null
          }
        };
      }
      case "click": {
        const activeTargetId = this.#requireTarget(targetId);
        const ranking = await this.browser.queryDom(activeTargetId, step.selector);
        if (ranking.ambiguous) {
          return {
            status: "blocked",
            targetId: activeTargetId,
            blocker: {
              blocked: true,
              reason: "Ambiguous DOM target; manual clarification or stronger selector is required.",
              selector: step.selector
            }
          };
        }
        const click = await this.browser.clickElement(activeTargetId, step.selector);
        return {
          status: "pass",
          targetId: activeTargetId,
          click
        };
      }
      case "type": {
        const activeTargetId = this.#requireTarget(targetId);
        const typed = await this.browser.clearAndType(activeTargetId, step.selector, step.value);
        return {
          status: typed.validated ? "pass" : "partial",
          targetId: activeTargetId,
          typed
        };
      }
      case "select": {
        const activeTargetId = this.#requireTarget(targetId);
        const selected = await this.browser.selectOption(activeTargetId, step.selector, step.value);
        return {
          status: selected.validated ? "pass" : "partial",
          targetId: activeTargetId,
          selected
        };
      }
      case "extract_text": {
        const activeTargetId = this.#requireTarget(targetId);
        if (step.fieldMap) {
          const extracted = await this.browser.extractTextMap(activeTargetId, step.fieldMap);
          return {
            status: "pass",
            targetId: activeTargetId,
            extracted
          };
        }
        const text = await this.browser.extractTextContent(activeTargetId, step.selector);
        return {
          status: "pass",
          targetId: activeTargetId,
          extracted: {
            [step.id]: text
          }
        };
      }
      case "detect_blockers": {
        const activeTargetId = this.#requireTarget(targetId);
        const blocker = await this.browser.detectBlockers(activeTargetId);
        return {
          status: blocker.blocked ? "blocked" : "pass",
          targetId: activeTargetId,
          blocker
        };
      }
      case "verify_outcome": {
        const activeTargetId = this.#requireTarget(targetId);
        const verification = await this.browser.verifyOutcome(activeTargetId, step.expectation);
        return {
          status: verification.validated ? "pass" : "fail",
          targetId: activeTargetId,
          verification
        };
      }
      case "capture_evidence": {
        const activeTargetId = this.#requireTarget(targetId);
        await fs.mkdir(evidenceDir, { recursive: true });
        const capture = await this.browser.exportPageEvidence(activeTargetId, evidenceDir, step.evidenceLabel ?? "browser-operator-proof", {
          browserPlanStepId: step.id,
          browserPlanRunId: this.runId
        });
        return {
          status: "pass",
          targetId: activeTargetId,
          evidence: evidenceRecordFromCapture(capture, step)
        };
      }
      case "stop_manual_handoff":
        return {
          status: "blocked",
          blocker: {
            blocked: true,
            reason: step.label || "Manual handoff requested by browser plan."
          }
        };
      default:
        throw new Error(`Unsupported browser operator step: ${step.action}`);
    }
  }

  #requireTarget(targetId) {
    const resolved = targetId ?? this.browser.activeTargetId ?? this.browser.listTargets()?.[0]?.id ?? null;
    if (!resolved) {
      throw new Error("Browser operator has no active target. The plan must open a session before acting.");
    }
    return resolved;
  }
}
