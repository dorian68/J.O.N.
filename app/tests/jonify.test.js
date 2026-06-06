import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jonifyFromHtml, simulateWorkflow, planJonifyMission, jonifyFromObservations, jonifyFromAccessibility, executeWorkflow, BrowserWorkflowAdapter } from "../src/jonify/index.js";
import { resolveJonifiedAppForMission } from "../src/jonify/mission-resolver.js";
import { createDesktopWorkflowAdapter } from "../src/jonify/index.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { ComputerControlService } from "../src/computer/computer-control-service.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "fixtures", "jonify", "sample-crm.html");

export async function run() {
  const html = fs.readFileSync(FIXTURE, "utf8");
  const { observation, manifest, validation } = jonifyFromHtml(html, { url: "https://acme.example.com/dashboard" });

  // 1. Observation
  assert.equal(observation.pages.length, 1, "observed one page");
  const interactive = observation.pages[0].summary.interactive;
  assert.ok(interactive.length >= 10, `interactive elements detected (${interactive.length})`);

  // 3. Surfaces (dashboard + leads + settings)
  assert.ok(manifest.surfaces.length >= 3, `surfaces detected (${manifest.surfaces.length})`);

  // 4. Actions
  assert.ok(manifest.actions.length >= 7, `actions detected (${manifest.actions.length})`);

  // 6. Manifest generated
  assert.equal(manifest.schemaVersion, "0.1.0");
  assert.equal(manifest.generatedBy, "JON");
  assert.equal(manifest.generationMode, "auto-assisted");
  assert.ok(manifest.app.id, "app id inferred");

  // 7. Manifest validates
  assert.equal(validation.valid, true, `manifest valid: ${validation.errors.join("; ")}`);

  // 8. Delete action is critical
  const del = manifest.actions.find((a) => a.type === "delete");
  assert.ok(del, "delete action detected");
  assert.equal(del.safety.riskLevel, "critical", "delete is critical");
  assert.equal(del.safety.requiresConfirmation, true, "delete requires confirmation");

  // 9. Send/submit requires confirmation (high)
  const sensitive = manifest.actions.filter((a) => ["send", "submit", "export", "payment", "publish"].includes(a.type));
  assert.ok(sensitive.length >= 1 && sensitive.every((a) => a.safety.requiresConfirmation === true), "send/submit/export require confirmation");

  // 5. Workflows
  assert.ok(manifest.workflows.length >= 2, `workflows inferred (${manifest.workflows.length})`);

  // 10. Simulate a workflow (no execution)
  const wf = manifest.workflows.find((w) => w.id === "create-object-workflow") ?? manifest.workflows[0];
  const sim = simulateWorkflow(manifest, wf.id);
  assert.equal(sim.ok, true, "simulation ok");
  assert.ok(sim.plannedSteps.length >= 1, "simulation has steps");
  if (wf.id === "create-object-workflow") {
    assert.ok(sim.missingInputs.includes("name") && sim.missingInputs.includes("email"), "create workflow needs name+email");
    assert.ok(sim.confirmationsRequired.length >= 1, "create workflow requires a confirmation (submit)");
    assert.equal(sim.executionMode, "confirmation_required");
  }

  // 11. Human-review questions are targeted (not a form)
  assert.ok(manifest.humanReview.questions.length >= 1, "targeted human-review questions produced");

  // 12. Safety contract present
  assert.ok((manifest.safety.globalRules ?? []).length >= 3, "global safety rules present");

  // 13. Mission resolver: a NL mission maps to this app + the right workflow.
  const match = resolveJonifiedAppForMission("va dans mon CRM et crée un lead", [manifest]);
  assert.ok(match, "mission resolved to a jonified app");
  assert.equal(match.appId, manifest.app.id, "resolved to the CRM app");
  assert.ok(match.workflow, "a workflow was selected");
  assert.equal(match.workflow.id, "create-object-workflow", "create intent → create workflow");

  // 14. planJonifyMission dry-runs the matched workflow (no execution in V1).
  const plan = planJonifyMission("supprime un lead dans le CRM", { loadManifests: () => [manifest] });
  assert.equal(plan.matched, true);
  assert.equal(plan.workflow.id, "delete-workflow", "delete intent → delete workflow");
  assert.equal(plan.executionMode, "simulate_only_v1");
  assert.equal(plan.simulation.maxRisk, "critical", "delete workflow is critical (confirmation required)");

  // No match for an unrelated mission.
  assert.equal(resolveJonifiedAppForMission("règle la luminosité de l'écran", [manifest]), null, "unrelated mission → no match");

  // ── V2: multi-page merge yields a richer manifest ───────────────────────────
  const settingsHtml = fs.readFileSync(path.join(HERE, "..", "fixtures", "jonify", "sample-crm-settings.html"), "utf8");
  const merged = jonifyFromObservations([
    { html, url: "https://acme.example.com/dashboard" },
    { html: settingsHtml, url: "https://acme.example.com/settings" }
  ]);
  assert.equal(merged.validation.valid, true, `merged manifest valid: ${merged.validation.errors.join("; ")}`);
  assert.ok(merged.manifest.actions.length > manifest.actions.length, "merge adds actions from the settings page");
  assert.ok(merged.manifest.actions.some((a) => a.type === "connect_account"), "settings page contributes connect_account");

  // ── V3: safe executor (fake adapter) ────────────────────────────────────────
  const calls = [];
  const adapter = {
    navigate: async (t) => { calls.push(["navigate", t]); return { ok: true }; },
    click: async (s) => { calls.push(["click", s]); return { ok: true }; },
    type: async (s, v) => { calls.push(["type", s, v]); return { ok: true }; },
    capture: async () => ({ path: "/tmp/shot.jpg" })
  };
  // low-risk search executes
  const searchRun = await executeWorkflow(manifest, "search-workflow", { adapter, inputs: { query: "acme" } });
  assert.equal(searchRun.status, "completed", "low-risk workflow executes");
  assert.ok(searchRun.executedCount >= 1);

  // critical delete is BLOCKED without confirmation, EXECUTES with confirmation
  const delBlocked = await executeWorkflow(manifest, "delete-workflow", { adapter });
  assert.equal(delBlocked.status, "needs_confirmation", "critical action blocked without confirmation");
  assert.equal(delBlocked.steps.at(-1).executed, undefined, "blocked delete did not execute");
  const delOk = await executeWorkflow(manifest, "delete-workflow", { adapter, confirm: async () => true });
  assert.equal(delOk.status, "completed", "critical action runs once confirmed");

  // create workflow blocks on missing required inputs, then runs with them + confirm
  const createMissing = await executeWorkflow(manifest, "create-object-workflow", { adapter, confirm: async () => true });
  assert.equal(createMissing.status, "needs_input", "create blocks on missing name/email");
  const createOk = await executeWorkflow(manifest, "create-object-workflow", { adapter, inputs: { name: "A", email: "a@b.c" }, confirm: async () => true });
  assert.equal(createOk.status, "completed", "create runs with inputs + confirmation");

  // abort hook stops execution
  const aborted = await executeWorkflow(manifest, "search-workflow", { adapter, inputs: { query: "x" }, shouldAbort: () => true });
  assert.equal(aborted.status, "aborted", "abort hook stops the workflow");

  // ── V3-live bridge: executeWorkflow drives the BrowserController contract ───
  const browserCalls = [];
  const fakeBrowser = {
    allowlistedHosts: [],
    isOpen: () => true,
    async getTargetState(targetId) {
      browserCalls.push(["getTargetState", targetId]);
      return { url: "about:blank", title: "Blank" };
    },
    async navigate(targetId, url) {
      browserCalls.push(["navigate", targetId, url]);
      return { targetId, url, status: 200 };
    },
    async clearAndType(targetId, selector, value) {
      browserCalls.push(["clearAndType", targetId, selector, value]);
      return { validated: true, selector, value };
    },
    async waitForPageStable(targetId) {
      browserCalls.push(["waitForPageStable", targetId]);
      return { targetId, stable: true };
    },
    async exportPageEvidence(targetId, evidenceDir, label) {
      browserCalls.push(["exportPageEvidence", targetId, evidenceDir, label]);
      return { evidenceId: "ev_fake", screenshotPath: "/tmp/jonify-live.png", summaryPath: "/tmp/jonify-live.json" };
    }
  };
  const browserAdapter = new BrowserWorkflowAdapter({
    browserController: fakeBrowser,
    targetId: "target_live",
    manifest,
    startUrl: "https://acme.example.com/dashboard",
    allowlistedHosts: ["acme.example.com"],
    closeOnFinish: false
  });
  const liveSearch = await executeWorkflow(manifest, "search-workflow", {
    adapter: browserAdapter,
    inputs: { query: "beta" }
  });
  assert.equal(liveSearch.status, "completed", "browser adapter workflow completes");
  assert.deepEqual(
    browserCalls.find((call) => call[0] === "clearAndType")?.slice(2),
    [{ testId: "search" }, "beta"],
    "manifest selector is translated to BrowserController selector spec"
  );
  assert.equal(liveSearch.steps[0].evidence, "/tmp/jonify-live.png", "browser adapter captures evidence");

  // ── V4: desktop adapter (UI Automation tree → manifest) ─────────────────────
  const tree = { tree: { controlType: "ControlType.Window", name: "Notepad", children: [
    { controlType: "ControlType.MenuItem", name: "Save", automationId: "Item 2" },
    { controlType: "ControlType.MenuItem", name: "Delete", automationId: "Item 9" },
    { controlType: "ControlType.Edit", name: "Text Editor", automationId: "15" },
    { controlType: "ControlType.TabItem", name: "Settings" }
  ] } };
  const desk = jonifyFromAccessibility(tree, { title: "Notepad", appName: "Notepad" });
  assert.equal(desk.validation.valid, true, `desktop manifest valid: ${desk.validation.errors.join("; ")}`);
  assert.equal(desk.observation.pages[0].summary.environment, "desktop");
  assert.ok(desk.manifest.actions.some((a) => a.type === "delete" && a.safety.riskLevel === "critical"), "desktop delete is critical");
  assert.ok(desk.manifest.actions.length >= 2, "desktop actions detected from UIA tree");

  // ── V4-execution: DesktopWorkflowAdapter drives UIA invoke via ComputerControlService ──
  const deskProvider = new FakeWindowProvider([{
    id: "win_app", title: "Notepad", active: true, visible: true, content: "ready",
    controls: [
      { automationId: "Item 9", name: "Delete", controlType: "Button" },
      { automationId: "15", name: "Text Editor", controlType: "Edit" }
    ]
  }]);
  const ccs = new ComputerControlService(deskProvider); // exercises the new UIA forwards
  const deskAdapter = createDesktopWorkflowAdapter({ provider: ccs, windowId: "win_app", manifest: desk.manifest });
  const deleteWf = desk.manifest.workflows.find((w) => w.id === "delete-workflow");
  assert.ok(deleteWf, "desktop delete workflow exists");
  // critical → blocked without confirmation
  const deskBlocked = await executeWorkflow(desk.manifest, deleteWf.id, { adapter: deskAdapter });
  assert.equal(deskBlocked.status, "needs_confirmation", "desktop critical action blocked without confirmation");
  // with confirmation → executes via UIA Invoke (provider records it)
  const deskRun = await executeWorkflow(desk.manifest, deleteWf.id, { adapter: deskAdapter, confirm: async () => true });
  assert.equal(deskRun.status, "completed", "desktop workflow executes once confirmed");
  // "executed" proves the adapter→ComputerControlService→UIA invoke path ran (the
  // fake provider throws if the control selector isn't resolved).
  assert.equal(deskRun.steps.at(-1).status, "executed", "UIA Invoke fired on the desktop control via CCS");

  return {
    interactive: interactive.length,
    surfaces: manifest.surfaces.length,
    actions: manifest.actions.length,
    workflows: manifest.workflows.length,
    sensitive: manifest.actions.filter((a) => ["high", "critical"].includes(a.safety.riskLevel)).length,
    humanReview: manifest.humanReview.questions.length,
    confidence: manifest.confidence
  };
}
