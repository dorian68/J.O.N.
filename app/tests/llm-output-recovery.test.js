import assert from "node:assert/strict";
import { parseJsonLoose, recoverStructuredOutput } from "../src/llm/output-recovery.js";

export async function run() {
  {
    const parsed = parseJsonLoose('{"ok":true}');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.ok, true);
    assert.equal(parsed.repaired, false);
  }

  {
    const parsed = parseJsonLoose('Here is JSON:\n{"steps":["one"],"assumptions":[]}\nDone.');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.repaired, true);
    assert.deepEqual(parsed.value.steps, ["one"]);
  }

  {
    const recovered = recoverStructuredOutput({
      output: 'prefix {"steps":["one"],"assumptions":[]} suffix',
      validateOutput: (output) => {
        assert(Array.isArray(output.steps));
        return output;
      }
    });
    assert.equal(recovered.status, "repaired");
    assert.deepEqual(recovered.output.steps, ["one"]);
  }

  {
    const recovered = recoverStructuredOutput({
      output: "not json",
      fallbackOutput: { status: "blocked" }
    });
    assert.equal(recovered.status, "fallback");
    assert.equal(recovered.output.status, "blocked");
  }
}
