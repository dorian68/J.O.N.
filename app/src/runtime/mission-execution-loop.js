export const MISSION_LOOP_STATUS = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED: "failed"
});

function defaultDecision() {
  return {
    status: MISSION_LOOP_STATUS.BLOCKED,
    reason: "No decision callback was configured.",
    action: null
  };
}

function resultStatus(result = null) {
  if (result?.objectiveSatisfied || result?.verifiedByOutcomes) {
    return MISSION_LOOP_STATUS.COMPLETED;
  }
  if (result?.blocked || result?.requiresUserInput) {
    return MISSION_LOOP_STATUS.BLOCKED;
  }
  if (result?.failed) {
    return MISSION_LOOP_STATUS.FAILED;
  }
  return MISSION_LOOP_STATUS.RUNNING;
}

export class MissionExecutionLoop {
  constructor({
    observe,
    decide,
    act,
    verify,
    recover,
    progressTracker = null,
    maxIterations = 12
  } = {}) {
    this.observe = observe;
    this.decide = decide;
    this.act = act;
    this.verify = verify;
    this.recover = recover;
    this.progressTracker = progressTracker;
    this.maxIterations = maxIterations;
  }

  async run({ mission, runId = null, initialState = null } = {}) {
    const timeline = [];
    let state = initialState;
    let lastVerification = null;
    let finalStatus = MISSION_LOOP_STATUS.RUNNING;
    let blockedReason = null;

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const observation = this.observe
        ? await this.observe({ mission, runId, state, iteration })
        : state;
      state = observation ?? state;
      timeline.push({ phase: "observe", iteration, observation });

      const decision = this.decide
        ? await this.decide({ mission, runId, observation: state, lastVerification, iteration })
        : defaultDecision();
      timeline.push({ phase: "decide", iteration, decision });

      if (decision?.status === MISSION_LOOP_STATUS.BLOCKED || decision?.requiresUserInput) {
        finalStatus = MISSION_LOOP_STATUS.BLOCKED;
        blockedReason = decision.reason ?? "Decision requires user input.";
        break;
      }
      if (decision?.status === MISSION_LOOP_STATUS.COMPLETED) {
        lastVerification = this.verify
          ? await this.verify({ mission, runId, observation: state, actionResult: null, iteration })
          : decision.verification;
        timeline.push({ phase: "verify", iteration, verification: lastVerification });
        finalStatus = resultStatus(lastVerification);
        if (finalStatus === MISSION_LOOP_STATUS.COMPLETED) break;
        blockedReason = lastVerification?.failureReason ?? "Objective was not verified.";
        finalStatus = MISSION_LOOP_STATUS.BLOCKED;
        break;
      }

      const action = decision?.action ?? decision;
      const actionResult = this.act
        ? await this.act({ mission, runId, action, observation: state, iteration })
        : { status: "skipped", reason: "No act callback configured." };
      timeline.push({ phase: "act", iteration, action, actionResult });
      this.progressTracker?.recordStepResult?.({
        stepId: action?.id ?? `loop_${iteration}`,
        primitive: action?.primitive ?? action?.type ?? "loop_action",
        label: action?.label ?? action?.summary ?? null,
        status: actionResult?.status === "completed" || actionResult?.status === "pass" ? "completed" : actionResult?.status ?? "failed",
        errorMessage: actionResult?.error ?? actionResult?.reason ?? null
      });

      lastVerification = this.verify
        ? await this.verify({ mission, runId, observation: state, action, actionResult, iteration })
        : actionResult?.verification;
      timeline.push({ phase: "verify", iteration, verification: lastVerification });

      const status = resultStatus(lastVerification);
      if (status === MISSION_LOOP_STATUS.COMPLETED) {
        finalStatus = MISSION_LOOP_STATUS.COMPLETED;
        break;
      }
      if (status === MISSION_LOOP_STATUS.BLOCKED || status === MISSION_LOOP_STATUS.FAILED) {
        const recovery = this.recover
          ? await this.recover({ mission, runId, observation: state, action, actionResult, verification: lastVerification, iteration })
          : { strategy: "stop", autoExecutable: false, reason: "No recovery callback configured." };
        timeline.push({ phase: "recover", iteration, recovery });
        if (!recovery?.autoExecutable) {
          finalStatus = MISSION_LOOP_STATUS.BLOCKED;
          blockedReason = recovery?.reason ?? recovery?.nextAction ?? lastVerification?.failureReason ?? "Recovery requires user input.";
          break;
        }
      }
    }

    if (finalStatus === MISSION_LOOP_STATUS.RUNNING) {
      finalStatus = MISSION_LOOP_STATUS.FAILED;
      blockedReason = `Mission loop exhausted ${this.maxIterations} iterations without verified completion.`;
    }

    return {
      runId,
      mission,
      status: finalStatus,
      objectiveSatisfied: finalStatus === MISSION_LOOP_STATUS.COMPLETED,
      blockedReason,
      verification: lastVerification,
      timeline
    };
  }
}
