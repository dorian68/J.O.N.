import assert from "node:assert/strict";
import { PromptRegistry } from "../src/llm/prompt-registry.js";

export async function run() {
  const registry = await new PromptRegistry().load();
  const prompts = registry.listPrompts();
  assert.ok(prompts.length >= 3, "Expected at least three prompts in registry.");

  const plan = registry.resolvePrompt("task.plan_generation", "1.0.0");
  assert.equal(plan.promptId, "task.plan_generation");
  assert.equal(plan.version, "1.0.0");
  assert.equal(plan.environment, "prototype");
  assert.ok(plan.messages.length > 0);

  const resolved = registry.resolvePromptRefs([
    { promptId: "task.plan_generation", version: "1.0.0", bindings: { mission: "Test mission", scenarioType: "research", allowlistedDomains: '["127.0.0.1"]' } }
  ]);
  assert.equal(resolved.length, 1);
  assert.ok(resolved[0].messages[0].content.includes("bounded plan"));
}
