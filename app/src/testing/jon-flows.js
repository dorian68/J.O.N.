// JON backend-first test flows.
//
// Each flow validates one of JON's backend flows independently of any UI, per
// docs/jon-backend-first-testing.md. A flow receives (ctx, log) and returns a
// normalized result: { success, summary, details? } or a structuredError().
//
// Flows are deliberately layered: cheap/offline checks first (config, db, llm,
// deliverables, self-check, policy, abort), then the full end-to-end mission
// engine (planning + browser + artifacts + deliverables), then platform-specific
// desktop actuation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPrototypeRuntime } from "../runtime/create-prototype-runtime.js";
import { createDefaultLlmGateway } from "../llm/create-default-llm-gateway.js";
import { createFixtureServer } from "../fixtures/fixture-server.js";
import { renderArtifactDeliverables } from "../artifacts/document-renderer.js";
import { runSelfCheck } from "../release/self-check.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { PrototypeAgent } from "../runtime/prototype-agent.js";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { PowerShellWindowProvider } from "../computer/powershell-window-provider.js";
import { buildDecisionNote, buildCollectionTable } from "../artifacts/builders.js";
import { APPROVAL_CATEGORY, APPROVAL_DECISION } from "../config.js";
import { structuredError, maskSecret } from "./structured-log.js";

let dbCounter = 0;
function freshDbPath() {
  dbCounter += 1;
  return path.join(os.tmpdir(), `jon-campaign-${process.pid}-${dbCounter}.sqlite`);
}

function fileMagic(filePath, bytes = 4) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return buf;
  } catch {
    return Buffer.alloc(0);
  }
}

// ─── Flow: environment & configuration ──────────────────────────────────────
async function flowEnvironment(ctx, log) {
  log.ok("inspect_env", { request: "process.env (sanitized)" });
  const interesting = [
    "COWORK_OPENAI_API_KEY",
    "COWORK_OPENAI_BASE_URL",
    "COWORK_LLM_PRODUCTION_STRICT",
    "COWORK_OPERATOR_PORT",
    "COWORK_DATA_ROOT",
    "COWORK_PS_DAEMON_TIMEOUT_MS"
  ];
  const presence = {};
  for (const key of interesting) {
    presence[key] = /KEY|SECRET|TOKEN/i.test(key) ? maskSecret(ctx.env[key]) : (ctx.env[key] ?? null);
  }
  log.ok("env_presence", { output: presence, next: "JON runs offline by default (mock provider); live keys are optional." });
  return { success: true, summary: "Environment inspected (no required var missing — offline-capable).", details: { presence } };
}

// ─── Flow: database CRUD ────────────────────────────────────────────────────
async function flowDatabase(ctx, log) {
  const dbPath = freshDbPath();
  log.ok("open_db", { request: "createPrototypeRuntime", input: { dbPath } });
  const handle = await createPrototypeRuntime({ dbPath, computerProvider: new FakeWindowProvider() });
  try {
    const project = handle.runtime.createProject({ name: "Campaign DB probe", description: "db flow", allowlistedDomains: ["127.0.0.1"] });
    log.ok("write_project", { output: { projectId: project.id } });

    const memId = `mem_campaign_${Date.now()}`;
    handle.database.insertMemoryRecord({
      id: memId, scope: "project", projectId: project.id, category: "fact",
      text: "Campaign canary memory record", sourceType: "test", createdAt: new Date().toISOString()
    });
    const found = handle.database.searchMemoryRecords({ query: "canary", projectId: project.id });
    const hit = found.some((r) => r.id === memId);
    log.log({ step: "read_back_memory", status: hit ? "success" : "fail", output: { matches: found.length } });
    if (!hit) {
      return structuredError({ step: "read_back_memory", code: "DB_READBACK_FAILED", message: "Inserted memory record not returned by search.", nextActions: ["Inspect searchMemoryRecords LIKE query", "Check memory_records schema"] });
    }
    return { success: true, summary: "DB open + project write + memory write/search verified.", details: { projectId: project.id } };
  } finally {
    await handle.close();
    try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  }
}

// ─── Flow: LLM gateway ──────────────────────────────────────────────────────
async function flowLlmGateway(ctx, log) {
  log.ok("create_gateway", { request: "createDefaultLlmGateway", input: { env: "default" } });
  const gateway = await createDefaultLlmGateway({ env: ctx.env });
  const status = typeof gateway.getStatus === "function" ? gateway.getStatus() : null;
  log.ok("gateway_status", { output: status ?? { note: "no getStatus()" } });
  const hasGenerate = typeof gateway.generateStructured === "function";
  log.log({ step: "capabilities", status: hasGenerate ? "success" : "fail", output: { generateStructured: hasGenerate, generateText: typeof gateway.generateText === "function" } });
  if (!hasGenerate) {
    return structuredError({ step: "capabilities", code: "GATEWAY_INCOMPLETE", message: "Gateway missing generateStructured.", nextActions: ["Inspect createDefaultLlmGateway"] });
  }
  return { success: true, summary: "LLM gateway constructed with structured + text generation; deep behaviour covered by mission flow.", details: { status } };
}

// ─── Flow: deliverable rendering ────────────────────────────────────────────
async function flowDeliverables(ctx, log) {
  const note = buildDecisionNote({
    mission: "Campaign deliverable probe", runId: "run_campaign",
    records: [{ sourceTitle: "Alpha", sourceId: "s1", sourceReference: "http://x", tagline: "fast", priceLevel: "Low", deliverySpeed: "Fast", riskNote: "none", evidenceId: "e1", evidenceReference: "ev" }],
    sourceReferences: [{ id: "s1", title: "Alpha", canonicalRef: "http://x" }], collectionArtifactId: "art_x"
  });
  const table = buildCollectionTable({ mission: "Campaign deliverable probe", runId: "run_campaign", records: [{ sourceTitle: "Alpha", sourceReference: "http://x", fact: "f", confidence: "High", note: "n", evidenceReference: "ev" }] });

  const checks = [];
  for (const [label, def, magicByFormat] of [
    ["note", note, { pdf: "%PDF", docx: "PK" }],
    ["table", table, { xlsx: "PK", pdf: "%PDF" }]
  ]) {
    const rendered = await renderArtifactDeliverables(def);
    for (const item of rendered) {
      const expectedMagic = magicByFormat[item.format];
      const magic = item.buffer ? item.buffer.slice(0, expectedMagic?.length ?? 2).toString("ascii") : "";
      const good = !item.errored && item.buffer && item.buffer.length > 0 && (!expectedMagic || magic === expectedMagic);
      log.log({ step: `render_${label}_${item.format}`, status: good ? "success" : "fail", output: { bytes: item.buffer?.length ?? 0, magic } });
      checks.push({ label, format: item.format, good });
    }
  }
  const failed = checks.filter((c) => !c.good);
  if (failed.length > 0) {
    return structuredError({ step: "render", code: "DELIVERABLE_RENDER_FAILED", message: `${failed.length} format(s) failed.`, nextActions: ["Run `npm install` (pdfkit/docx/exceljs)", "Inspect document-renderer.js"] });
  }
  return { success: true, summary: `All ${checks.length} deliverable formats produced valid binaries (PDF/DOCX/XLSX).`, details: { checks } };
}

// ─── Flow: system self-check ────────────────────────────────────────────────
async function flowSelfCheck(ctx, log) {
  const dbPath = freshDbPath();
  const handle = await createPrototypeRuntime({ dbPath, computerProvider: new FakeWindowProvider() });
  try {
    log.ok("run_self_check", { request: "runSelfCheck" });
    const report = await runSelfCheck({ runtime: handle.runtime });
    for (const c of report.checks) {
      log.log({ step: `subsystem_${c.id}`, status: c.ok ? "success" : "fail", output: c.detail, next: c.remediation ?? undefined });
    }
    if (!report.ok) {
      return structuredError({ step: "self_check", code: "SUBSYSTEM_DEGRADED", message: report.summary, nextActions: report.checks.filter((c) => !c.ok).map((c) => c.remediation).filter(Boolean) });
    }
    return { success: true, summary: report.summary, details: { checks: report.checks.map((c) => ({ id: c.id, ok: c.ok })) } };
  } finally {
    await handle.close();
    try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  }
}

// ─── Flow: approvals & policy ───────────────────────────────────────────────
async function flowApprovalsPolicy(ctx, log) {
  let resolverCalled = false;
  const policy = new PolicyEngine({
    approvalResolver: async () => { resolverCalled = true; return { decision: APPROVAL_DECISION.APPROVED_ONCE, rationale: "campaign" }; }
  });

  const readEval = policy.evaluate({ category: APPROVAL_CATEGORY.READ, actionLabel: "read page" });
  log.log({ step: "evaluate_read", status: readEval.decision === APPROVAL_DECISION.AUTO_APPROVED ? "success" : "fail", output: { decision: readEval.decision } });

  const editEval = policy.evaluate({ category: APPROVAL_CATEGORY.EDIT, actionLabel: "write file" });
  log.log({ step: "evaluate_write", status: editEval.requiresApproval ? "success" : "fail", output: { requiresApproval: editEval.requiresApproval } });

  const authorized = await policy.authorize({ runId: "run_campaign", category: APPROVAL_CATEGORY.EDIT, riskLevel: "medium", actionLabel: "write file", targetLabel: "report.md", reason: "campaign", expectedEffect: "write", consequenceOfRefusal: "none" });
  const decision = authorized?.decision ?? authorized?.record?.decision ?? null;
  log.log({ step: "authorize_with_resolver", status: resolverCalled ? "success" : "fail", output: { decision, resolverCalled } });

  const ok = readEval.decision === APPROVAL_DECISION.AUTO_APPROVED && editEval.requiresApproval && resolverCalled;
  if (!ok) {
    return structuredError({ step: "policy", code: "POLICY_FLOW_FAILED", message: "Policy evaluation/authorization did not behave as expected.", nextActions: ["Inspect policy-engine.js evaluate/authorize"] });
  }
  return { success: true, summary: "Policy: read auto-approved, write gated, resolver invoked on authorize.", details: { decision } };
}

// ─── Flow: emergency stop / cooperative abort ───────────────────────────────
async function flowEmergencyStop(ctx, log) {
  const agent = new PrototypeAgent({ database: null, browserController: null, computerControlService: null, policyEngine: null, llmGateway: null });
  log.ok("before_abort", { output: { aborted: agent.isRunAborted("run_x") } });
  const requested = agent.requestAbort("run_x");
  const aborted = agent.isRunAborted("run_x");
  log.log({ step: "request_abort", status: requested && aborted ? "success" : "fail", output: { requested, aborted } });
  const emptyNoop = agent.requestAbort("") === false;
  const scoped = agent.isRunAborted("run_y") === false;
  log.log({ step: "abort_scoping", status: emptyNoop && scoped ? "success" : "fail", output: { emptyNoop, scoped } });
  if (!(requested && aborted && emptyNoop && scoped)) {
    return structuredError({ step: "emergency_stop", code: "ABORT_REGISTRY_FAILED", message: "Cooperative abort registry misbehaved.", nextActions: ["Inspect requestAbort/isRunAborted in prototype-agent.js"] });
  }
  return { success: true, summary: "Cooperative abort registry validated (flag, scope, no-op).", details: {} };
}

// Shared end-to-end research mission engine driver. `mode` is "offline"
// (deterministic mock provider — default, reproducible) or "live" (the real
// configured provider — exercises the actual integration).
async function runMissionFlow(ctx, log, { mode }) {
  const live = mode === "live";

  // Build the LLM gateway for this mode and, for live, verify a provider is
  // actually configured before spending time (skip cleanly otherwise).
  let llmGateway;
  if (live) {
    log.ok("build_live_gateway", { request: "createDefaultLlmGateway(live)", input: { timeoutMs: ctx.env.COWORK_OPENAI_TIMEOUT_MS ?? "90000(override)" } });
    llmGateway = await createDefaultLlmGateway({
      env: { ...ctx.env, COWORK_OPENAI_TIMEOUT_MS: ctx.env.COWORK_OPENAI_TIMEOUT_MS ?? "90000" }
    });
    const status = typeof llmGateway.getStatus === "function" ? llmGateway.getStatus() : {};
    const available = Array.isArray(status.availableProviders) ? status.availableProviders : [];
    const liveConfigured = status?.providerDetails?.openaiCompatible?.configured === true
      || available.includes("openai_compatible");
    if (!liveConfigured) {
      log.skip("live_provider_check", { output: { availableProviders: available }, next: "No live provider configured — set COWORK_OPENAI_API_KEY (OS secret store) to enable." });
      return { success: true, skipped: true, summary: "Skipped: no live LLM provider configured." };
    }
    log.ok("live_provider_check", { output: { providers: available, productionStrict: status.productionStrict ?? null } });
  } else {
    // Backend-first: the default engine test must be reproducible and offline.
    log.ok("build_offline_gateway", { request: "createDefaultLlmGateway(mock_offline)", input: { providerMode: "mock_offline" } });
    llmGateway = await createDefaultLlmGateway({
      providerMode: "mock_offline",
      env: { ...ctx.env, COWORK_LLM_PRODUCTION_STRICT: "false", COWORK_LLM_ALLOW_DETERMINISTIC_FALLBACK: "true" }
    });
  }

  log.ok("start_fixture_server", { request: "createFixtureServer" });
  const fixtureServer = await createFixtureServer();
  const dbPath = freshDbPath();
  const handle = await createPrototypeRuntime({
    dbPath,
    browserOptions: { headless: true },
    computerProvider: new FakeWindowProvider(),
    llmGateway
  });
  try {
    const project = handle.runtime.createProject({ name: `Campaign mission (${mode})`, description: "e2e", allowlistedDomains: ["127.0.0.1"] });
    log.ok("create_project", { output: { projectId: project.id } });

    log.ok("run_research_mission", { request: "startResearchMission", input: { hub: fixtureServer.manifest.hub, links: 3, mode } });
    let launched;
    try {
      launched = await handle.runtime.startResearchMission({
        projectId: project.id,
        mission: "Compare the controlled candidate pages and produce a note de decision.",
        hubUrl: fixtureServer.manifest.hub,
        linkSpecs: [
          { testId: "link-alpha", title: "Alpha Analytics" },
          { testId: "link-beta", title: "Beta Commerce" },
          { testId: "link-gamma", title: "Gamma Ops" }
        ],
        fieldMap: {
          companyName: { testId: "company-name" },
          tagline: { testId: "company-tagline" },
          priceLevel: { testId: "price-level" },
          deliverySpeed: { testId: "delivery-speed" },
          riskNote: { testId: "risk-note" }
        }
      });
      await launched.completion;
    } catch (error) {
      // For the live flow, an LLM/network failure is an integration symptom, not
      // a code bug — surface the exact provider error and actionable next steps.
      log.fail("run_research_mission", { error: { code: live ? "LIVE_PROVIDER_ERROR" : "MISSION_ERROR", message: String(error?.message ?? error) } });
      return structuredError({
        step: "mission_research",
        code: live ? "LIVE_PROVIDER_ERROR" : "MISSION_ERROR",
        message: String(error?.message ?? error),
        raw: error?.stack,
        possibleCauses: live
          ? ["Live LLM endpoint unreachable / timed out", "Invalid or expired API key", "Rate limited", "Model name not served by endpoint"]
          : ["Browser/Playwright failed", "Planner produced no steps"],
        nextActions: live
          ? ["Verify network reachability to COWORK_OPENAI_BASE_URL", "Check the API key in the OS secret store", "Increase COWORK_OPENAI_TIMEOUT_MS", "Run `npm run debug:mission` (offline) to confirm the engine itself is healthy"]
          : ["Run flow `deliverables` and `self-check` in isolation", "Check Playwright chromium is installed"]
      });
    }

    const runId = launched.runId;
    const run = handle.database.getRun(runId);
    log.log({ step: "run_status", status: run && (run.status === "completed") ? "success" : "warn", output: { runId, status: run?.status } });

    const artifacts = handle.database.listArtifacts(runId);
    log.log({ step: "artifacts_created", status: artifacts.length > 0 ? "success" : "fail", output: { count: artifacts.length, types: artifacts.map((a) => a.artifactType) } });

    let deliverableFiles = 0;
    let validBinaries = 0;
    for (const artifact of artifacts) {
      for (const d of (artifact.metadata?.deliverables ?? [])) {
        if (!d.ok || !d.path) continue;
        deliverableFiles += 1;
        const magic = fileMagic(d.path, 4).toString("ascii");
        if ((magic.startsWith("%PDF") || magic.startsWith("PK")) && fs.existsSync(d.path)) validBinaries += 1;
      }
    }
    log.log({ step: "deliverables_on_disk", status: deliverableFiles > 0 && validBinaries === deliverableFiles ? "success" : "fail", output: { deliverableFiles, validBinaries } });

    const ok = run?.status === "completed" && artifacts.length > 0 && deliverableFiles > 0 && validBinaries === deliverableFiles;
    if (!ok) {
      return structuredError({
        step: "mission_research",
        code: "MISSION_FLOW_INCOMPLETE",
        message: `Mission did not reach a clean end-to-end state (status=${run?.status}, artifacts=${artifacts.length}, deliverables=${deliverableFiles}/${validBinaries}).`,
        possibleCauses: ["Browser/Playwright failed", "Planner produced no steps", "Deliverable rendering failed", "Completion guard blocked completion"],
        nextActions: ["Inspect run events in DB", "Run flow `deliverables` and `self-check` in isolation", "Check Playwright chromium is installed"]
      });
    }
    return { success: true, summary: `Mission completed end-to-end (${mode}): ${artifacts.length} artifact(s), ${validBinaries} valid binary deliverable(s).`, details: { runId, status: run.status, artifacts: artifacts.length, deliverableFiles, mode } };
  } finally {
    await handle.close();
    await fixtureServer.close();
    try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  }
}

// ─── Flow: end-to-end research mission (offline, deterministic) ──────────────
async function flowMissionResearch(ctx, log) {
  return runMissionFlow(ctx, log, { mode: "offline" });
}

// ─── Flow: end-to-end research mission (LIVE provider) ──────────────────────
async function flowMissionResearchLive(ctx, log) {
  return runMissionFlow(ctx, log, { mode: "live" });
}

// ─── Flow: desktop actuation (Windows real provider) ────────────────────────
async function flowDesktopProvider(ctx, log) {
  if (process.platform !== "win32") {
    log.skip("platform_check", { output: { platform: process.platform }, next: "Desktop control is Windows-only." });
    return { success: true, skipped: true, summary: "Skipped: not Windows." };
  }
  const provider = new PowerShellWindowProvider();
  log.ok("provider_self_test", { request: "PowerShellWindowProvider.selfTest" });
  const result = await provider.selfTest();
  log.log({ step: "actuation_mode", status: result.ok ? "success" : "fail", output: { actuationMode: result.actuationMode, checks: result.checks } });
  if (!result.ok) {
    return structuredError({
      step: "desktop_provider",
      code: "DESKTOP_ACTUATION_DOWN",
      message: "Neither persistent daemon nor single-shot actuation is available.",
      nextActions: ["Verify PowerShell on PATH", "Run windows-control.ps1 -Action ping manually"]
    });
  }
  return { success: true, summary: `Desktop actuation OK (mode: ${result.actuationMode}).`, details: { actuationMode: result.actuationMode } };
}

export const FLOWS = [
  { id: "environment", label: "Environment & config", category: "config", required: true, run: flowEnvironment },
  { id: "database", label: "Database CRUD", category: "storage", required: true, run: flowDatabase },
  { id: "llm-gateway", label: "LLM gateway", category: "llm", required: true, run: flowLlmGateway },
  { id: "deliverables", label: "Deliverable rendering", category: "artifacts", required: true, run: flowDeliverables },
  { id: "self-check", label: "System self-check", category: "health", required: true, run: flowSelfCheck },
  { id: "approvals-policy", label: "Approvals & policy", category: "policy", required: true, run: flowApprovalsPolicy },
  { id: "emergency-stop", label: "Emergency stop", category: "control", required: true, run: flowEmergencyStop },
  { id: "mission-research", label: "E2E research mission (offline)", category: "mission", required: true, run: flowMissionResearch },
  { id: "mission-research-live", label: "E2E research mission (LIVE provider)", category: "mission", required: false, run: flowMissionResearchLive },
  { id: "desktop-provider", label: "Desktop actuation", category: "desktop", required: false, run: flowDesktopProvider }
];

export function listFlows() {
  return FLOWS.map((f) => ({ id: f.id, label: f.label, category: f.category, required: f.required }));
}
