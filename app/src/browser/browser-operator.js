import fs from "node:fs/promises";
import path from "node:path";
import {
  generateBrowserPlan,
  generateBrowserReplan,
  selectReplanTriggerChange
} from "./browser-planner.js";
import { BrowserRunWatcher } from "./browser-run-watcher.js";
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

function stripScreenshotPayload(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) =>
    key === "screenshotBase64" ? undefined : entry
  ));
}

export class BrowserOperator {
  constructor({
    browserController,
    llmGateway = null,
    projectId = "browser_operator",
    runId = createId("browser_run"),
    evidenceRoot,
    onEvent = null,
    describeVisualFrame = null
  } = {}) {
    if (!browserController) {
      throw new Error("BrowserOperator requires a BrowserController.");
    }
    this.browser = browserController;
    this.llmGateway = llmGateway;
    this.projectId = projectId;
    this.runId = runId;
    this.evidenceRoot = evidenceRoot;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.describeVisualFrame = typeof describeVisualFrame === "function" ? describeVisualFrame : null;
    this.visualFrameDescriptionCount = 0;
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
      browserWatchChanges: [],
      multimodalFrames: [],
      adaptations: [],
      browserState: null
    };

    // Mutable step queue — replanning splices new steps in place of remaining ones.
    const executionSteps = [...plan.steps];
    const maxReplans = Number.isFinite(Number(input.maxBrowserReplans)) ? Number(input.maxBrowserReplans) : 2;
    let replanCount = 0;

    let targetId = null;
    let browserWatcher = null;
    let stepIdx = 0;
    try {
      while (stepIdx < executionSteps.length) {
        const step = executionSteps[stepIdx];
        const stepStartedAt = nowIso();
        try {
          if (targetId) {
            browserWatcher = await this.#ensureBrowserWatcher({
              browserWatcher,
              targetId,
              input
            });
            const preStepChanges = await this.#consumeBrowserWatcherChanges({
              browserWatcher,
              execution,
              targetId,
              phase: "before_step",
              step,
              input
            });
            const preStepBlocker = this.#blockingWatcherChange(preStepChanges);
            if (preStepBlocker && this.#shouldStopForWatcherBlocker(step)) {
              execution.blockers.push(preStepBlocker);
              execution.status = "blocked";
              execution.stepResults.push({
                id: `browser_watch_blocker_before_${step.id}`,
                action: "browser_watch",
                label: `Browser watcher stopped before ${step.label ?? step.action}`,
                status: "blocked",
                startedAt: stepStartedAt,
                completedAt: nowIso(),
                result: compactResult({
                  reason: "blocking_browser_state_changed",
                  blocker: preStepBlocker
                })
              });
              break;
            }
          }

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
          if (targetId) {
            browserWatcher = await this.#ensureBrowserWatcher({
              browserWatcher,
              targetId,
              input
            });
            const postStepChanges = await this.#consumeBrowserWatcherChanges({
              browserWatcher,
              execution,
              targetId,
              phase: "after_step",
              step,
              input
            });

            // Check for replan trigger before checking for stop-on-blocker.
            if (replanCount < maxReplans) {
              const replanned = await this.#maybeReplanFromChanges({
                changes: postStepChanges,
                execution,
                executionSteps,
                stepIdx,
                targetId,
                input,
                replanCount
              });
              if (replanned) {
                replanCount++;
                // executionSteps was mutated — new steps spliced in after stepIdx.
                // Step idx advances normally on next iteration to pick up first replan step.
                stepIdx++;
                continue;
              }
            }

            const postStepBlocker = this.#blockingWatcherChange(postStepChanges);
            if (postStepBlocker && this.#shouldStopAfterWatcherBlocker(step)) {
              execution.blockers.push(postStepBlocker);
              execution.status = "blocked";
              execution.adaptations.push({
                id: createId("browser_adapt"),
                type: "watcher_blocker_stop",
                stepId: step.id,
                detectedAt: nowIso(),
                blocker: postStepBlocker
              });
              break;
            }
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
        stepIdx++;
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
      await browserWatcher?.stop?.();
      if (input.closeBrowser !== false) {
        await this.browser.close().catch(() => {});
      }
    }
  }

  // Evaluates whether post-step watcher changes warrant a mid-run replan.
  // Only triggers after interactive actions (click, type, select) — planned navigate and
  // structural read steps produce expected URL/DOM changes that should not trigger replanning.
  // If conditions are met, generates a new continuation plan, splices the remaining steps in
  // executionSteps, records the adaptation, and returns true. Returns false otherwise.
  async #maybeReplanFromChanges({ changes, execution, executionSteps, stepIdx, targetId, input, replanCount }) {
    const currentStep = executionSteps[stepIdx];
    if (!["click", "type", "select"].includes(currentStep?.action)) return false;
    const triggerChange = selectReplanTriggerChange(changes);
    if (!triggerChange) return false;

    const reasons = triggerChange.reasons ?? [];
    const triggerReason = reasons.join(", ");

    // Capture current DOM and browser state for the replanner.
    let currentDomSnapshot = null;
    let currentBrowserState = null;
    try {
      currentDomSnapshot = await this.browser.captureDomSnapshotForTarget(targetId).catch(() => null);
      currentBrowserState = await this.browser.getSessionState().catch(() => null);
    } catch {
      // Non-fatal — replanner will work with partial context.
    }

    // Retrieve the last visual description for this change if available.
    const visualDescription = execution.multimodalFrames.length > 0
      ? execution.multimodalFrames[execution.multimodalFrames.length - 1]
      : null;

    // Summarize completed steps concisely for the LLM prompt.
    const completedStepsSummary = execution.stepResults
      .map((sr) => `[${sr.status}] ${sr.action}: ${sr.label}`)
      .join("\n");

    const replanInput = {
      mission: input.mission ?? execution.plan?.missionSummary ?? "",
      completedStepsSummary,
      triggerReason,
      currentBrowserState,
      currentDomSnapshot,
      visualDescription,
      extractedData: Object.keys(execution.extracted).length > 0 ? execution.extracted : null,
      allowlistedHosts: execution.plan?.allowlistedHosts ?? input.allowlistedHosts ?? [],
      allowlistedDomains: input.allowlistedDomains ?? [],
      projectMemory: input.projectMemory ?? null
    };

    const replanId = createId("browser_replan");
    let replanResult;
    try {
      replanResult = await generateBrowserReplan({
        llmGateway: this.llmGateway,
        projectId: this.projectId,
        runId: replanId,
        input: replanInput
      });
    } catch (err) {
      // Replan generation itself failed — record and continue without replanning.
      execution.adaptations.push({
        id: replanId,
        type: "replan_generation_failed",
        replanCount: replanCount + 1,
        triggerReason,
        detectedAt: nowIso(),
        error: err?.message ?? String(err)
      });
      return false;
    }

    // Filter out open_session — the browser session is already active during a replan.
    const newSteps = (replanResult.output?.steps ?? []).filter((s) => s.action !== "open_session");
    if (newSteps.length === 0) return false;

    // Splice: remove all steps after current index, append new replan steps.
    executionSteps.splice(stepIdx + 1);
    executionSteps.push(...newSteps);

    execution.adaptations.push({
      id: replanId,
      type: "browser_replan",
      replanCount: replanCount + 1,
      triggerReason,
      triggerChangeId: triggerChange.id ?? null,
      triggerReasons: reasons,
      generationMode: replanResult.generationMode,
      fallbackReason: replanResult.fallbackReason ?? null,
      llmCallId: replanResult.callRecord?.id ?? null,
      newStepCount: newSteps.length,
      currentUrl: currentBrowserState?.targets?.find((t) => t.active)?.url
        ?? currentDomSnapshot?.url
        ?? null,
      detectedAt: nowIso()
    });

    await this.#emitEvent("browser.replan_triggered", {
      runId: this.runId,
      replanId,
      replanCount: replanCount + 1,
      triggerReason,
      triggerReasons: reasons,
      generationMode: replanResult.generationMode,
      newStepCount: newSteps.length
    });

    return true;
  }

  async #ensureBrowserWatcher({ browserWatcher, targetId, input = {} }) {
    if (browserWatcher) {
      return browserWatcher;
    }
    const watcher = new BrowserRunWatcher({
      browser: this.browser,
      intervalMs: input.browserWatchIntervalMs ?? 500,
      maxChanges: input.maxBrowserWatchChanges ?? 32,
      includeDom: input.browserWatchIncludeDom !== false,
      detectBlockers: input.browserWatchDetectBlockers !== false,
      includeScreenshot: input.browserWatchIncludeScreenshot !== false,
      retainScreenshotBase64: Boolean(this.describeVisualFrame),
      screenshotWidth: input.browserWatchScreenshotWidth ?? 480
    });
    const baseline = await watcher.start({ targetId });
    await this.#emitEvent("browser.watch_started", {
      runId: this.runId,
      targetId,
      baseline: stripScreenshotPayload(baseline)
    });
    return watcher;
  }

  async #consumeBrowserWatcherChanges({ browserWatcher, execution, targetId, phase, step, input = {} }) {
    if (!browserWatcher) {
      return [];
    }
    await browserWatcher.checkNow({ targetId }).catch(() => []);
    const rawChanges = browserWatcher.consumeChanges().map((change) => ({
      ...change,
      phase,
      stepId: step?.id ?? null,
      stepAction: step?.action ?? null
    }));
    const changes = [];
    for (const rawChange of rawChanges) {
      const visualDescription = await this.#maybeDescribeVisualFrame({
        change: rawChange,
        execution,
        phase,
        step,
        input
      });
      const change = stripScreenshotPayload({
        ...rawChange,
        visualDescription
      });
      execution.browserWatchChanges.push(change);
      if (visualDescription) {
        execution.multimodalFrames.push(visualDescription);
      }
      await this.#emitEvent("browser.watch_changed", {
        runId: this.runId,
        phase,
        stepId: change.stepId,
        stepAction: change.stepAction,
        reasons: change.reasons,
        after: change.after,
        visualDescription
      });
      changes.push(change);
    }
    return changes;
  }

  async #maybeDescribeVisualFrame({ change, phase, step, input = {} }) {
    if (!this.describeVisualFrame) {
      return null;
    }
    const maxFrames = Number.isFinite(Number(input.maxMultimodalVisionFrames))
      ? Number(input.maxMultimodalVisionFrames)
      : 4;
    if (this.visualFrameDescriptionCount >= maxFrames) {
      return null;
    }
    const screenshotBase64 = change.after?.activeTarget?.visual?.screenshotBase64 ?? null;
    if (!screenshotBase64) {
      return null;
    }
    const significant = (change.reasons ?? []).some((reason) => [
      "url_changed",
      "title_changed",
      "visual_changed",
      "blocker_changed",
      "active_target_changed"
    ].includes(reason));
    if (!significant) {
      return null;
    }
    this.visualFrameDescriptionCount += 1;
    const visionDetail = this.#selectVisionDetail({ change, step, input });
    try {
      return await this.describeVisualFrame({
        frame: stripScreenshotPayload(change.after?.activeTarget ?? {}),
        screenshotBase64,
        change: stripScreenshotPayload(change),
        phase,
        step,
        visionDetail
      });
    } catch (error) {
      return {
        id: createId("browser_vision"),
        status: "failed",
        phase,
        stepId: step?.id ?? null,
        error: error?.message ?? String(error),
        createdAt: nowIso()
      };
    }
  }

  #blockingWatcherChange(changes = []) {
    const change = changes.find((item) => item.after?.activeTarget?.blocker?.blocked);
    return change?.after?.activeTarget?.blocker ?? null;
  }

  #shouldStopForWatcherBlocker(step = {}) {
    return ["click", "type", "select", "extract_text", "extract_structured_rows", "verify_outcome"].includes(step.action);
  }

  #shouldStopAfterWatcherBlocker(step = {}) {
    return ["click", "type", "select"].includes(step.action);
  }

  #selectVisionDetail({ change, step, input = {} }) {
    const policy = input.browserVisionPolicy ?? {};
    if ((change.reasons ?? []).includes("blocker_changed") || change.after?.activeTarget?.blocker?.blocked) {
      return policy.blockerDetail ?? "high";
    }
    if (["click", "type", "select"].includes(step?.action)) {
      return policy.interactionDetail ?? "high";
    }
    return policy.defaultDetail ?? "low";
  }

  async #emitEvent(type, payload = {}) {
    if (!this.onEvent) {
      return;
    }
    await this.onEvent({
      type,
      payload,
      emittedAt: nowIso()
    });
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
          const recoveredClick = await this.#retryClickWithResolvedCandidate({
            targetId: activeTargetId,
            selector: step.selector,
            ranking,
            reason: "ambiguous_dom_target"
          });
          if (recoveredClick.resolved) {
            return {
              status: "pass",
              targetId: activeTargetId,
              click: recoveredClick.click,
              pageStable: recoveredClick.pageStable,
              recovery: recoveredClick.recovery
            };
          }
          return {
            status: "blocked",
            targetId: activeTargetId,
            blocker: {
              blocked: true,
              reason: recoveredClick.reason ?? "Ambiguous DOM target; manual clarification or stronger selector is required.",
              selector: step.selector,
              candidates: recoveredClick.candidates
            }
          };
        }
        let click;
        try {
          click = await this.browser.clickElement(activeTargetId, step.selector);
        } catch (error) {
          const recoveredClick = await this.#retryClickWithResolvedCandidate({
            targetId: activeTargetId,
            selector: step.selector,
            ranking,
            reason: error.message
          });
          if (!recoveredClick.resolved) {
            throw error;
          }
          return {
            status: "pass",
            targetId: activeTargetId,
            click: recoveredClick.click,
            pageStable: recoveredClick.pageStable,
            recovery: recoveredClick.recovery
          };
        }
        const pageStable = await this.browser.waitForPageStable(activeTargetId);
        return {
          status: "pass",
          targetId: activeTargetId,
          click,
          pageStable
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
      case "extract_structured_rows": {
        const activeTargetId = this.#requireTarget(targetId);
        const structuredExtraction = await this.browser.extractStructuredRows(activeTargetId, step.artifact ?? step.adapter);
        return {
          status: structuredExtraction.status,
          targetId: activeTargetId,
          structuredExtraction,
          extracted: {
            [step.outputKey ?? step.id]: structuredExtraction.rows
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

  async #retryClickWithResolvedCandidate({ targetId, selector, ranking = null, reason = "" }) {
    const freshRanking = ranking?.ranked?.length
      ? ranking
      : await this.browser.queryDom(targetId, selector).catch(() => null);
    const candidate = this.#selectStrongInteractiveCandidate(freshRanking);
    if (!candidate) {
      const refreshed = await this.browser.captureDomSnapshotForTarget(targetId).then(() => this.browser.queryDom(targetId, selector)).catch(() => null);
      const refreshedCandidate = this.#selectStrongInteractiveCandidate(refreshed);
      if (!refreshedCandidate) {
        return {
          resolved: false,
          reason: "No unambiguous visible DOM candidate was strong enough after re-reading the page.",
          candidates: (refreshed?.ranked ?? freshRanking?.ranked ?? []).slice(0, 5)
        };
      }
      const click = await this.browser.clickInteractiveCandidate(targetId, refreshedCandidate);
      const pageStable = await this.browser.waitForPageStable(targetId);
      return {
        resolved: true,
        click,
        pageStable,
        recovery: {
          strategy: "fresh_dom_candidate_click",
          reason,
          selectedCandidate: refreshedCandidate
        }
      };
    }
    const click = await this.browser.clickInteractiveCandidate(targetId, candidate);
    const pageStable = await this.browser.waitForPageStable(targetId);
    return {
      resolved: true,
      click,
      pageStable,
      recovery: {
        strategy: "ranked_dom_candidate_click",
        reason,
        selectedCandidate: candidate
      }
    };
  }

  #selectStrongInteractiveCandidate(ranking) {
    const best = ranking?.best ?? null;
    if (!best || best.disabled || !best.visible || best.outsideViewport) {
      return null;
    }
    const secondScore = ranking?.ranked?.[1]?.score ?? 0;
    const scoreGap = best.score - secondScore;
    const hasDirectMatch = (best.reasons ?? []).some((reason) => ["testId", "exact_name", "exact_text", "label"].includes(reason));
    if (best.score >= 85 || (hasDirectMatch && best.score >= 65) || scoreGap >= 25) {
      return best;
    }
    return null;
  }
}
