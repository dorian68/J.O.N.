import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jonifyFromHtml, simulateWorkflow } from "../src/jonify/index.js";

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
