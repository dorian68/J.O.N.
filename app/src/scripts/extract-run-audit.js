/**
 * Extract full structured audit for a given runId.
 * Usage:
 *   node app/src/scripts/extract-run-audit.js <runId>
 *   node app/src/scripts/extract-run-audit.js <runId> --format=summary
 *   node app/src/scripts/extract-run-audit.js --list   (list recent runs)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DB_PATH, LOGS_ROOT } from "../config.js";
import { PrototypeDatabase } from "../storage/database.js";
// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const listMode = args.includes("--list");
const format = (args.find((a) => a.startsWith("--format=")) ?? "--format=json").split("=")[1];
const runId = args.find((a) => !a.startsWith("--"));

if (!listMode && !runId) {
  console.error("Usage: node extract-run-audit.js <runId> [--format=json|summary]");
  console.error("       node extract-run-audit.js --list");
  process.exit(1);
}

// ── DB ────────────────────────────────────────────────────────────────────────

const db = new PrototypeDatabase(DB_PATH);
await db.open();

// ── List mode ─────────────────────────────────────────────────────────────────

if (listMode) {
  const runs = db.db.prepare(`
    SELECT id, project_id, mission, status, lifecycle_stage, created_at, updated_at
    FROM runs ORDER BY created_at DESC LIMIT 30
  `).all();
  console.log("\nRecent runs (last 30):\n");
  for (const r of runs) {
    const duration = r.updated_at && r.created_at
      ? Math.round((new Date(r.updated_at) - new Date(r.created_at)) / 1000)
      : null;
    console.log(`  ${r.id}  [${r.status}]  ${duration != null ? duration + "s" : "?"}  ${r.created_at}`);
    console.log(`    ${String(r.mission ?? "").slice(0, 100)}`);
    console.log();
  }
  process.exit(0);
}

// ── JSONL reader — filter by runId ────────────────────────────────────────────

async function readAuditEntriesForRun(targetRunId) {
  const filePath = path.join(LOGS_ROOT, "jon-audit.jsonl");
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((entry) => entry && entry.runId === targetRunId);
}

// ── Main extract ──────────────────────────────────────────────────────────────

const run = db.getRun(runId);
if (!run) {
  console.error(`Run not found: ${runId}`);
  console.error("Use --list to see available runs.");
  process.exit(1);
}

const [events, llmCalls, approvals, artifacts, evidence, sources, reasoningSnapshots, auditEntries] =
  await Promise.all([
    Promise.resolve(db.listEvents(runId)),
    Promise.resolve(db.listLlmCalls(runId)),
    Promise.resolve(db.listApprovals(runId)),
    Promise.resolve(db.listArtifacts(runId)),
    Promise.resolve(db.listEvidence(runId)),
    Promise.resolve(db.listSources(runId)),
    Promise.resolve(db.listReasoningContextSnapshots(runId)),
    readAuditEntriesForRun(runId)
  ]);

// ── Build audit document ──────────────────────────────────────────────────────

const auditByType = {};
for (const entry of auditEntries) {
  const t = entry.type ?? "unknown";
  if (!auditByType[t]) auditByType[t] = [];
  auditByType[t].push(entry);
}

const tokenTotal = llmCalls.reduce((acc, c) => acc + (c.tokenUsage?.totalTokens ?? 0), 0);
const costTotal = llmCalls.reduce((acc, c) => acc + (c.estimatedCost ?? 0), 0);
const durationMs = run.updatedAt && run.createdAt
  ? new Date(run.updatedAt) - new Date(run.createdAt)
  : null;

const auditDoc = {
  _meta: {
    extractedAt: new Date().toISOString(),
    runId,
    format
  },

  // ── Run header ──────────────────────────────────────────────────────────────
  run: {
    id: run.id,
    projectId: run.projectId,
    mission: run.mission,
    status: run.status,
    lifecycleStage: run.lifecycleStage,
    summary: run.summary,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    durationSeconds: durationMs != null ? Math.round(durationMs / 1000) : null,
    metadata: run.metadata
  },

  // ── JSONL audit entries grouped by type ────────────────────────────────────
  auditTrail: {
    missionPlan: auditByType["jon.mission.plan"]?.[0] ?? null,
    missionExecution: auditByType["jon.mission.execution"] ?? [],
    browserMission: auditByType["jon.browser.mission"] ?? [],
    stepFailures: auditByType["jon.step.failure"] ?? [],
    approvalDecisions: auditByType["jon.approval.decision"] ?? [],
    runStatusChanges: auditByType["jon.run.status_change"] ?? [],
    llmOutputs: auditByType["jon.llm.output"] ?? [],
    conversationTurns: auditByType["jon.conversation.turn"] ?? [],
    terminalReasoning: auditByType["jon.terminal.reasoning"] ?? []
  },

  // ── Database records ───────────────────────────────────────────────────────
  events: events.map((e) => ({
    type: e.type,
    actor: e.actor,
    summary: e.summary,
    createdAt: e.createdAt,
    payload: e.payload
  })),

  llmCalls: llmCalls.map((c) => ({
    id: c.id,
    callType: c.callType,
    providerAlias: c.providerAlias,
    modelAlias: c.modelAlias,
    latencyMs: c.latencyMs,
    tokenUsage: c.tokenUsage,
    estimatedCost: c.estimatedCost,
    resultStatus: c.resultStatus,
    errorCategory: c.errorCategory,
    fallbackUsed: c.metadata?.fallbackUsed ?? false,
    degradedModeUsed: c.metadata?.degradedModeUsed ?? false,
    schemaRepairAttempted: c.metadata?.schemaRepairAttempted ?? false,
    reasoningStage: c.metadata?.reasoningStage ?? null,
    createdAt: c.createdAt
  })),

  approvals: approvals.map((a) => ({
    id: a.id,
    category: a.category,
    decision: a.decision,
    riskLevel: a.riskLevel,
    actionLabel: a.actionLabel,
    reason: a.reason,
    createdAt: a.createdAt,
    metadata: a.metadata
  })),

  artifacts: artifacts.map((a) => ({
    id: a.id,
    artifactType: a.artifactType,
    title: a.title,
    status: a.status,
    storagePath: a.storagePath,
    createdAt: a.createdAt
  })),

  evidence: evidence.map((e) => ({
    id: e.id,
    evidenceType: e.evidenceType,
    label: e.label,
    storagePath: e.storagePath,
    linkedSurface: e.linkedSurface,
    sensitivity: e.sensitivity,
    createdAt: e.createdAt
  })),

  sources: sources.map((s) => ({
    id: s.id,
    title: s.title,
    canonicalRef: s.canonicalRef,
    trustClassification: s.trustClassification,
    createdAt: s.createdAt
  })),

  reasoningSnapshots: reasoningSnapshots.map((s) => ({
    stage: s.stage,
    createdAt: s.createdAt,
    summary: s
  })),

  // ── Semantic outcome verification ─────────────────────────────────────────
  semanticVerification: run.metadata?.semanticVerification ?? null,

  // ── Mission progress tracker snapshot ─────────────────────────────────────
  missionProgress: run.metadata?.missionProgress ?? null,

  // ── Computed summary ───────────────────────────────────────────────────────
  summary: {
    totalLlmCalls: llmCalls.length,
    totalTokens: tokenTotal,
    estimatedCostUsd: Math.round(costTotal * 1_000_000) / 1_000_000,
    failedLlmCalls: llmCalls.filter((c) => c.resultStatus === "failed").length,
    fallbackCalls: llmCalls.filter((c) => c.metadata?.fallbackUsed).length,
    totalEvents: events.length,
    totalApprovals: approvals.length,
    approvedCount: approvals.filter((a) => a.decision === "approved_once").length,
    deniedCount: approvals.filter((a) => a.decision !== "approved_once").length,
    stepFailures: (auditByType["jon.step.failure"] ?? []).length,
    stepFailuresByStatus: {
      failed: (auditByType["jon.step.failure"] ?? []).filter((e) => e.status === "failed").length,
      blocked: (auditByType["jon.step.failure"] ?? []).filter((e) => e.status === "blocked").length,
      skipped: (auditByType["jon.step.failure"] ?? []).filter((e) => e.status === "skipped").length
    },
    artifactsCreated: artifacts.length,
    evidenceRecorded: evidence.length,
    sourcesUsed: sources.length,
    durationSeconds: durationMs != null ? Math.round(durationMs / 1000) : null
  }
};

// ── Output ────────────────────────────────────────────────────────────────────

if (format === "summary") {
  const r = auditDoc.run;
  const s = auditDoc.summary;
  const plan = auditDoc.auditTrail.missionPlan;
  const executions = auditDoc.auditTrail.missionExecution;
  const stepFails = auditDoc.auditTrail.stepFailures;
  const approvalDecs = auditDoc.auditTrail.approvalDecisions;
  const statusChanges = auditDoc.auditTrail.runStatusChanges;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`RUN AUDIT — ${r.id}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Status   : ${r.status} / ${r.lifecycleStage}`);
  console.log(`Duration : ${s.durationSeconds != null ? s.durationSeconds + "s" : "unknown"}`);
  console.log(`Created  : ${r.createdAt}`);
  console.log(`Mission  : ${r.mission}`);
  if (r.summary) console.log(`Result   : ${r.summary}`);

  const sv = auditDoc.semanticVerification;
  if (sv) {
    const svIcon = sv.verifiedByOutcomes ? "✓" : "✗";
    console.log(`Semantic : ${svIcon} verdict=${sv.verificationVerdict} confidence=${sv.confidence} objectiveMet=${sv.objectiveSatisfied}`);
    if (sv.failureReason) console.log(`         Reason: ${sv.failureReason}`);
    if (sv.nextBestAction) console.log(`         Next: ${sv.nextBestAction}`);
  }
  console.log();

  if (plan) {
    console.log("── PLAN ──────────────────────────────────────────────────");
    console.log(`Steps planned : ${plan.stepCount}`);
    if (plan.requiresClarification) console.log(`⚠ Clarification needed: ${plan.clarificationQuestion}`);
    if (plan.unsupportedRequests?.length) console.log(`✗ Unsupported: ${plan.unsupportedRequests.join(", ")}`);
    (plan.steps ?? []).forEach((step, i) => {
      console.log(`  ${i + 1}. [${step.primitive}] ${step.label} (risk: ${step.riskLevel})`);
    });
    console.log();
  }

  if (executions.length) {
    const exec = executions.at(-1);
    console.log("── EXECUTION ─────────────────────────────────────────────");
    console.log(`Final status      : ${exec.finalStatus}`);
    console.log(`Steps: ${exec.completedSteps} completed, ${exec.failedSteps} failed, ${exec.blockedSteps} blocked, ${exec.skippedSteps} skipped`);
    if (exec.stoppedReason) console.log(`Stopped reason    : ${exec.stoppedReason}`);
    if (exec.consecutiveFailures > 0) console.log(`Consecutive fails : ${exec.consecutiveFailures}`);
    console.log();
  }

  if (stepFails.length) {
    console.log("── STEP FAILURES ─────────────────────────────────────────");
    for (const f of stepFails) {
      const tag = f.status === "failed" ? "✗ FAIL" : f.status === "blocked" ? "⊘ BLOCKED" : "↷ SKIPPED";
      console.log(`  ${tag} step ${(f.stepIndex ?? 0) + 1}/${f.totalSteps ?? "?"} [${f.primitive}] ${f.label ?? ""}`);
      if (f.errorMessage) console.log(`    Error: ${f.errorMessage}`);
      if (f.safetyReason) console.log(`    Safety: ${f.safetyReason}`);
      if (f.approvalRationale) console.log(`    Approval rationale: ${f.approvalRationale}`);
      if (f.screenshotPath) console.log(`    Screenshot: ${f.screenshotPath}`);
    }
    console.log();
  }

  if (approvalDecs.length) {
    console.log("── APPROVALS ─────────────────────────────────────────────");
    for (const a of approvalDecs) {
      const icon = a.approved ? "✓" : "✗";
      console.log(`  ${icon} [${a.decision}] ${a.actionLabel} (risk: ${a.riskLevel ?? "?"})`);
      if (a.rationale) console.log(`    Rationale: ${a.rationale}`);
    }
    console.log();
  }

  if (statusChanges.length) {
    console.log("── RUN STATUS CHANGES ────────────────────────────────────");
    for (const sc of statusChanges) {
      console.log(`  → ${sc.toStatus} (${sc.lifecycleStage ?? ""}) — ${sc.reason ?? ""}`);
    }
    console.log();
  }

  console.log("── LLM USAGE ─────────────────────────────────────────────");
  console.log(`Calls    : ${s.totalLlmCalls} total, ${s.failedLlmCalls} failed, ${s.fallbackCalls} fallback`);
  console.log(`Tokens   : ${s.totalTokens.toLocaleString()}`);
  console.log(`Cost     : $${s.estimatedCostUsd}`);
  const callsByStage = {};
  for (const c of auditDoc.llmCalls) {
    const stage = c.reasoningStage ?? c.callType ?? "unknown";
    callsByStage[stage] = (callsByStage[stage] ?? 0) + 1;
  }
  for (const [stage, count] of Object.entries(callsByStage)) {
    console.log(`  ${stage}: ${count} call(s)`);
  }
  console.log();

  if (auditDoc.auditTrail.llmOutputs.length) {
    console.log("── LLM OUTPUTS (last 3) ──────────────────────────────────");
    for (const o of auditDoc.auditTrail.llmOutputs.slice(-3)) {
      console.log(`  [${o.callType}] ${o.providerAlias} ${o.latencyMs}ms`);
      if (o.outputText) console.log(`  → ${String(o.outputText).slice(0, 300)}`);
      console.log();
    }
  }

  console.log("═══════════════════════════════════════════════════════════");
} else {
  console.log(JSON.stringify(auditDoc, null, 2));
}
