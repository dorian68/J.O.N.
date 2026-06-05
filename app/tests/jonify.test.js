import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jonifyFromHtml, simulateWorkflow, planJonifyMission } from "../src/jonify/index.js";
import { resolveJonifiedAppForMission } from "../src/jonify/mission-resolver.js";

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
