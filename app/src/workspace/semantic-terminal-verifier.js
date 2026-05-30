import { createId, nowIso } from "../utils/ids.js";
import { LLM_CALL_TYPE, LLM_MODEL_ALIAS } from "../config.js";

export const VERDICT = Object.freeze({
  SUCCESS: "success",
  PARTIAL_SUCCESS: "partial_success",
  BLOCKED: "blocked",
  FAILED: "failed",
  UNCLEAR: "unclear"
});

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function safeString(v, max = 500) {
  return String(v ?? "").slice(0, max);
}

function parseVerdict(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

export async function verifyTerminalOutcome({
  projectId,
  terminal,
  stage,
  llmGateway
}) {
  const verificationId = createId("wverif");
  const transcript = String(terminal?.recentOutput ?? "").slice(-6000);
  const successCriteria = safeArray(stage?.successCriteria);
  const expectedArtifacts = safeArray(stage?.expectedArtifacts);

  const emptyResult = {
    id: verificationId,
    terminalId: terminal?.id ?? null,
    stageId: stage?.id ?? null,
    planId: stage?.planId ?? null,
    projectId,
    verdict: VERDICT.UNCLEAR,
    confidence: 0.4,
    summary: "Semantic verification could not be completed — no LLM gateway available.",
    criteriaResults: [],
    observedEvidence: [],
    modifiedFiles: [],
    testsRun: [],
    testsPassed: [],
    testsFailed: [],
    risks: [],
    recommendedNextAction: "Review terminal output manually.",
    createdAt: nowIso()
  };

  if (!llmGateway) return emptyResult;

  try {
    const llmResult = await llmGateway.generateStructured({
      runId: verificationId,
      projectId,
      callType: LLM_CALL_TYPE.WORKSPACE_STAGE_VERIFICATION,
      modelAlias: LLM_MODEL_ALIAS.PRIMARY_REASONING,
      promptRefs: [
        {
          promptId: "workspace.semantic_terminal_verifier",
          version: "1.0.0",
          bindings: {
            stageLabel: stage?.label ?? "Unknown stage",
            successCriteria: successCriteria.length
              ? successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
              : "(aucun critère défini)",
            expectedArtifacts: expectedArtifacts.length
              ? expectedArtifacts.map(a => `- ${a}`).join("\n")
              : "(aucun artefact attendu)",
            transcript: transcript || "(transcript vide)"
          }
        }
      ],
      input: { terminalId: terminal?.id, stageId: stage?.id }
    });

    const parsed = parseVerdict(llmResult?.output ?? llmResult?.rawOutput);
    if (!parsed) {
      return { ...emptyResult, summary: "LLM returned unparseable output.", risks: ["unparseable_llm_output"] };
    }

    const verdict = Object.values(VERDICT).includes(parsed.verdict) ? parsed.verdict : VERDICT.UNCLEAR;
    const confidence = typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

    return {
      id: verificationId,
      terminalId: terminal?.id ?? null,
      stageId: stage?.id ?? null,
      planId: stage?.planId ?? null,
      projectId,
      verdict,
      confidence,
      summary: safeString(parsed.summary, 1000),
      criteriaResults: safeArray(parsed.criteriaResults).slice(0, 20),
      observedEvidence: safeArray(parsed.observedEvidence).map(e => safeString(e)).slice(0, 20),
      modifiedFiles: safeArray(parsed.modifiedFiles).map(f => safeString(f, 300)).slice(0, 30),
      testsRun: safeArray(parsed.testsRun).map(t => safeString(t)).slice(0, 20),
      testsPassed: safeArray(parsed.testsPassed).map(t => safeString(t)).slice(0, 20),
      testsFailed: safeArray(parsed.testsFailed).map(t => safeString(t)).slice(0, 20),
      risks: safeArray(parsed.risks).map(r => safeString(r)).slice(0, 10),
      recommendedNextAction: safeString(parsed.recommendedNextAction, 500),
      createdAt: nowIso()
    };
  } catch (err) {
    return {
      ...emptyResult,
      verdict: VERDICT.UNCLEAR,
      summary: `Semantic verification error: ${safeString(err?.message ?? String(err), 300)}`,
      risks: [`verification_error: ${safeString(err?.message ?? String(err), 200)}`]
    };
  }
}

// Deterministic fallback: analyse sans LLM à partir de l'exit code et du transcript
export function deriveHeuristicVerdict(terminal, stage) {
  const exitCode = terminal?.metadata?.exitCode ?? null;
  const output = String(terminal?.recentOutput ?? "").toLowerCase();

  if (exitCode != null && exitCode !== 0) {
    return {
      verdict: VERDICT.FAILED,
      confidence: 0.85,
      summary: `Process exited with code ${exitCode}.`,
      recommendedNextAction: "Review error output and decide whether to retry or escalate."
    };
  }

  const hasTestFailure = /\b(test failed|tests? failed|failing|assertion error|assert.*error)\b/.test(output);
  const hasSuccess = /\b(done|completed|success|all tests passed|finished|✓|✔)\b/.test(output);
  const hasError = /\b(error|fatal|uncaught|unhandled|panic|traceback)\b/.test(output);
  const hasCredential = /\b(password|api.?key|token|secret|bearer)\b/.test(output);

  if (hasCredential) {
    return { verdict: VERDICT.BLOCKED, confidence: 0.9, summary: "Credentials were requested.", recommendedNextAction: "Provide required credentials through the secure channel." };
  }
  if (hasTestFailure) {
    return { verdict: VERDICT.PARTIAL_SUCCESS, confidence: 0.75, summary: "Tests failed.", recommendedNextAction: "Review test output and fix failures." };
  }
  if (hasError && !hasSuccess) {
    return { verdict: VERDICT.FAILED, confidence: 0.7, summary: "Error patterns detected in output.", recommendedNextAction: "Review errors and retry or escalate." };
  }
  if (exitCode === 0 && hasSuccess) {
    return { verdict: VERDICT.SUCCESS, confidence: 0.7, summary: "Exit 0 with success markers detected.", recommendedNextAction: "Proceed to next stage." };
  }
  if (exitCode === 0) {
    return { verdict: VERDICT.UNCLEAR, confidence: 0.45, summary: "Exit 0 but no clear success evidence in transcript.", recommendedNextAction: "Run semantic verification or review manually." };
  }

  return { verdict: VERDICT.UNCLEAR, confidence: 0.35, summary: "Insufficient transcript to determine outcome.", recommendedNextAction: "Review terminal output manually." };
}
