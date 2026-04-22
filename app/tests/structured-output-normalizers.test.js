import assert from "node:assert/strict";
import { normalizePlanOutput } from "../src/llm/structured-output-normalizers.js";

export async function run() {
  const normalized = normalizePlanOutput({
    plan: [
      {
        step: "Open browser",
        description: "Start a controlled browser session.",
        assumptions: ["Browser is installed."]
      },
      {
        step: "Collect sources",
        description: "Gather bounded evidence."
      }
    ],
    assumptions: ["Operator approvals remain unchanged."]
  });

  assert.deepEqual(normalized.steps, [
    "Open browser: Start a controlled browser session.",
    "Collect sources: Gather bounded evidence."
  ]);
  assert.deepEqual(normalized.assumptions, [
    "Browser is installed.",
    "Operator approvals remain unchanged."
  ]);
}
