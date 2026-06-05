// npm run jonify:summarize -- ./manifest.json
import { parseArgs, loadManifest } from "./jonify-cli.js";

const m = loadManifest(parseArgs(process.argv.slice(2))._[0]);
console.log(`# ${m.app.name} (${m.app.id})  —  confidence ${m.confidence}`);
console.log(`But métier (inféré): ${m.app.businessPurpose}`);
console.log(`\nSurfaces (${m.surfaces.length}):`);
for (const s of m.surfaces) console.log(`  - ${s.name} [${s.type}] ${s.urlPattern ?? ""}`);
console.log(`\nActions (${m.actions.length}):`);
for (const a of m.actions) console.log(`  - ${a.name} · ${a.type} · risque=${a.safety.riskLevel}${a.safety.requiresConfirmation ? " (confirmation)" : ""}`);
console.log(`\nWorkflows (${m.workflows.length}):`);
for (const w of m.workflows) console.log(`  - ${w.name} (confiance ${w.confidence}${w.needsHumanReview ? ", à valider" : ""})`);
console.log(`\nQuestions de validation (${m.humanReview.questions.length}):`);
for (const q of m.humanReview.questions) console.log(`  ? ${q.question} [${q.suggestedAnswer}]`);
