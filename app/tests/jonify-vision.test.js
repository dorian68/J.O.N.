import assert from "node:assert/strict";
import { ocrToSummary, jonifyFromOcr, executeWorkflow, VisionWorkflowAdapter, classifyApp } from "../src/jonify/index.js";

// OCR result for an Electron-like app (window-relative coords). Window is at (100,50).
const OCR = {
  available: true,
  lines: [
    { text: "Send", words: [{ text: "Send", bounds: { x: 10, y: 20, width: 40, height: 16 } }] },
    { text: "Delete message", words: [{ text: "Delete", bounds: { x: 60, y: 20, width: 50, height: 16 } }, { text: "message", bounds: { x: 112, y: 20, width: 60, height: 16 } }] },
    { text: "This is a long paragraph of body text that should not become a clickable control", words: [{ text: "This", bounds: { x: 0, y: 80, width: 30, height: 14 } }] },
    { text: "12:45", words: [{ text: "12:45", bounds: { x: 200, y: 5, width: 30, height: 12 } }] }
  ]
};

export async function run() {
  // ── Classifier routes a CLI-less Electron app → vision ──────────────────────
  const c = classifyApp({ window: { title: "Slack", processName: "slack", accessibility: { tree: null } } });
  assert.equal(c.method, "vision", "Electron without CLI → vision method");

  // ── ocrToSummary: button-like lines become coordinate targets; noise filtered ─
  const summary = ocrToSummary(OCR, { window: { x: 100, y: 50 }, title: "Slack" });
  const labels = summary.interactive.map((e) => e.label);
  assert.ok(labels.includes("Send"), "short label kept");
  assert.ok(labels.includes("Delete message"), "2-word label kept");
  assert.ok(!labels.some((l) => /paragraph/.test(l)), "long paragraph filtered out");
  assert.ok(!labels.includes("12:45"), "numeric/time filtered out");
  assert.equal(summary.environment, "vision");
  // Coordinates are window-offset: "Send" center = 100 + (10+50)/2 = 130, 50 + (20+36)/2 = 78
  const send = summary.interactive.find((e) => e.label === "Send");
  assert.equal(send.preferredSelector, "point=130,78", "OCR bbox → screen point with window offset");

  // ── jonifyFromOcr: valid manifest, vision actions ALWAYS need confirmation ──
  const { manifest, validation } = jonifyFromOcr(OCR, { window: { x: 100, y: 50 }, title: "Slack", appName: "Slack" });
  assert.equal(validation.valid, true, `vision manifest valid: ${validation.errors.join("; ")}`);
  assert.ok(manifest.actions.length >= 2, "vision actions detected");
  assert.ok(manifest.actions.every((a) => a.safety.requiresConfirmation === true), "every vision action requires confirmation");
  assert.ok(manifest.actions.every((a) => a.needsHumanReview === true), "every vision action needs human review");
  assert.ok(manifest.workflows.length >= 2, "each vision action has a runnable workflow");

  // ── Execution: blocked without confirmation, clicks correct coords with it ──
  const clicks = [];
  const fakeComputer = {
    clickPoint: async (id, pt) => { clicks.push([id, pt]); return { ok: true }; },
    typeText: async () => ({ ok: true }),
    captureWindow: async () => ({ outputPath: null })
  };
  const adapter = new VisionWorkflowAdapter({ computer: fakeComputer, windowId: "win_slack" });
  const sendAction = manifest.actions.find((a) => a.name.includes("Send"));
  const wfId = `${sendAction.id}-workflow`;

  const blocked = await executeWorkflow(manifest, wfId, { adapter });
  assert.equal(blocked.status, "needs_confirmation", "vision action blocked without confirmation");
  assert.equal(clicks.length, 0, "nothing clicked while blocked");

  const ok = await executeWorkflow(manifest, wfId, { adapter, confirm: async () => true });
  assert.equal(ok.status, "completed", "vision action runs once confirmed");
  assert.deepEqual(clicks.at(-1), ["win_slack", { x: 130, y: 78 }], "clicked the OCR-derived screen coordinate");

  // ── Adapter rejects a non-point selector (safety) ───────────────────────────
  await assert.rejects(() => adapter.click("[data-testid='x']"), /point=/, "vision adapter requires a point selector");
}
