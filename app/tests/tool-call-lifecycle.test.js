import assert from "node:assert/strict";
import {
  browserToolNameForAction,
  createToolCall,
  createToolCallLifecycleEvent,
  desktopToolNameForPrimitive,
  TOOL_CALL_STATUS
} from "../src/runtime/tool-call-lifecycle.js";

export async function run() {
  const call = createToolCall({
    runId: "run_1",
    stepId: "type_text",
    toolName: desktopToolNameForPrimitive("type_text"),
    surface: "desktop",
    reason: "Type requested text",
    inputSummary: "hello cowork"
  });
  assert.equal(call.status, "planned");
  assert.equal(call.toolName, "desktop.typeText");

  const running = createToolCallLifecycleEvent(call, TOOL_CALL_STATUS.RUNNING, {
    primitive: "type_text"
  });
  assert.equal(running.toolCall.status, "running");
  assert.ok(running.toolCall.startedAt);
  assert.equal(running.event.type, "tool.running");
  assert.equal(running.event.payload.toolCallId, call.id);
  assert.equal(running.event.payload.primitive, "type_text");

  const succeeded = createToolCallLifecycleEvent(running.toolCall, TOOL_CALL_STATUS.SUCCEEDED, {
    primitive: "type_text",
    payload: {
      outputSummary: "Text typed."
    }
  });
  assert.equal(succeeded.toolCall.status, "succeeded");
  assert.ok(succeeded.toolCall.completedAt);
  assert.equal(succeeded.event.type, "tool.succeeded");
  assert.equal(succeeded.event.payload.outputSummary, "Text typed.");

  assert.equal(browserToolNameForAction("open_session"), "browser.open");
  assert.equal(browserToolNameForAction("read_dom"), "browser.extractDom");
  assert.equal(browserToolNameForAction("click"), "browser.click");
  assert.equal(browserToolNameForAction("capture_evidence"), "browser.captureScreenshot");
  assert.equal(browserToolNameForAction("verify_outcome"), "verifier.checkOutcome");
}
