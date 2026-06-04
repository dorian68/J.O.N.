import assert from "node:assert/strict";
import { translateRequest, DEFAULT_CAPABILITIES } from "../src/mission/mission-translator.js";

export async function run() {
  // Cross-surface web→desktop, ordered (gather before act) with tool calls.
  const plan = translateRequest("ouvre moi le site cinestar et ecris moi sur un notepad les seances de demain");
  assert.equal(plan.multiSurface, true);
  assert.deepEqual(plan.surfaces, ["browser", "desktop"]);
  assert.equal(plan.phases[0].surface, "browser");
  assert.equal(plan.phases[0].actionType, "browser_autonomy");
  assert.ok(plan.phases[0].expectedTools.includes("browser.extractText"));
  assert.equal(plan.phases[0].producesData, true);
  assert.equal(plan.phases[1].surface, "desktop");
  assert.equal(plan.phases[1].actionType, "desktop_autonomy");
  assert.equal(plan.phases[1].consumesPrevious, true);
  assert.ok(plan.phases[1].expectedTools.includes("desktop.typeText"));

  // Ordering: even if desktop is mentioned first, gather (web) runs first.
  const reversed = translateRequest("écris dans notepad ce que tu trouves sur amazon.com");
  assert.equal(reversed.phases[0].surface, "browser", "producer ordered before consumer");

  // Single surface stays single.
  assert.equal(translateRequest("ouvre notepad et écris bonjour").multiSurface, false);
  assert.equal(translateRequest("compare les pages et produis une note").multiSurface, false);

  // Scalability: register a NEW surface capability without touching core code.
  const emailCap = {
    id: "email",
    actionType: "email_draft",
    role: "act",
    producesData: false,
    consumesData: true,
    detect: (t) => /\b(email|e-mail|courriel|mail|gmail)\b/i.test(t),
    matchClause: (c) => /\b(email|e-mail|courriel|mail|gmail)\b/i.test(c),
    expectedTools: ["email.draft"],
    objective: (c) => c.slice(0, 300),
    constraints: () => ["Draft only — never send without approval."]
  };
  const withEmail = translateRequest(
    "va sur amazon.com, trouve le meilleur prix et prépare un email avec le résultat",
    { capabilities: [...DEFAULT_CAPABILITIES, emailCap] }
  );
  assert.ok(withEmail.surfaces.includes("email"), "custom capability detected");
  // gather (browser) before act (email)
  assert.equal(withEmail.phases[0].surface, "browser");
  assert.equal(withEmail.phases[withEmail.phases.length - 1].surface, "email");
}
