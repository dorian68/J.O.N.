// npm run jonify:simulate -- ./manifest.json workflow-id
import { parseArgs, loadManifest } from "./jonify-cli.js";
import { simulateWorkflow } from "../jonify/workflow-simulator.js";

const args = parseArgs(process.argv.slice(2));
const m = loadManifest(args._[0]);
const sim = simulateWorkflow(m, args._[1]);
if (!sim.ok) { console.error(`Workflow introuvable. Disponibles: ${sim.available?.join(", ")}`); process.exit(1); }
console.log(`Simulation: ${sim.name} (${sim.workflowId})  —  risque max=${sim.maxRisk}, mode=${sim.executionMode}`);
console.log("Étapes (aucune exécution réelle) :");
for (const s of sim.plannedSteps) {
  console.log(`  ${s.index}. ${s.action} [${s.type}] via ${s.selector ?? "?"} · risque=${s.risk}${s.requiresConfirmation ? " (confirmation)" : ""}`);
  console.log(`     succès attendu: ${s.expectedSuccess}`);
}
if (sim.missingInputs.length) console.log(`Données manquantes: ${sim.missingInputs.join(", ")}`);
if (sim.confirmationsRequired.length) console.log(`Confirmations requises: ${sim.confirmationsRequired.map((c) => c.name).join(", ")}`);
if (sim.lowConfidence) console.log("⚠ Confiance faible — validation humaine recommandée.");
