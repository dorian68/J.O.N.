import assert from "node:assert/strict";
import { APPROVAL_CATEGORY, APPROVAL_DECISION } from "../src/config.js";
import { resolveApprovalByPolicy, shouldUseInteractiveApproval } from "../src/policy/approval-resolution-policy.js";

function runForBenchmark(id) {
  return {
    metadata: {
      missionSpec: {
        parameters: {
          approvalPolicy: {
            mode: "harness_mode",
            benchmarkId: id,
            allowedCategories: ["local_app_launch", "local_desktop_actuation"],
            allowedPrimitives: ["launch_application", "type_text", "launch_browser_search"]
          }
        }
      }
    }
  };
}

export async function run() {
  {
    const result = resolveApprovalByPolicy({
      request: {
        category: APPROVAL_CATEGORY.LOCAL_APP_LAUNCH,
        actionLabel: "Open Notepad",
        targetLabel: "Notepad",
        metadata: { primitive: "launch_application" }
      },
      run: runForBenchmark(1)
    });
    assert.equal(result.decision, APPROVAL_DECISION.APPROVED_ONCE);
    assert.equal(result.metadata.approvalPolicy.decision, "auto_resolved");
  }

  {
    const result = resolveApprovalByPolicy({
      request: {
        category: APPROVAL_CATEGORY.LOCAL_APP_LAUNCH,
        actionLabel: "Open Chrome",
        targetLabel: "Google Chrome",
        metadata: { primitive: "launch_browser_search", browserId: "chrome" }
      },
      run: runForBenchmark(2)
    });
    assert.equal(result.decision, APPROVAL_DECISION.APPROVED_ONCE);
  }

  {
    const result = resolveApprovalByPolicy({
      request: {
        category: APPROVAL_CATEGORY.LOCAL_DESKTOP_ACTUATION,
        actionLabel: "Delete a file",
        targetLabel: "Desktop",
        metadata: { primitive: "delete_path" }
      },
      run: runForBenchmark(1)
    });
    assert.equal(result.decision, "user_required");
    assert.equal(result.metadata.approvalPolicy.decision, "user_required");
    assert.equal(shouldUseInteractiveApproval(result), true);
  }

  {
    const result = resolveApprovalByPolicy({
      request: {
        category: APPROVAL_CATEGORY.LOCAL_APP_LAUNCH,
        actionLabel: "Open Calculator",
        targetLabel: "Calculator",
        metadata: { primitive: "launch_application" }
      },
      run: runForBenchmark(1)
    });
    assert.equal(result.decision, APPROVAL_DECISION.BLOCKED);
    assert.equal(result.metadata.approvalPolicy.decision, "policy_blocked");
  }

  {
    const result = resolveApprovalByPolicy({
      request: {
        category: APPROVAL_CATEGORY.LOCAL_APP_LAUNCH,
        actionLabel: "Open Notepad",
        targetLabel: "Notepad",
        metadata: { primitive: "launch_application" }
      },
      run: { metadata: { missionSpec: { parameters: {} } } },
      env: {}
    });
    assert.equal(result.decision, "user_required");
    assert.equal(shouldUseInteractiveApproval(result), true);
  }
}
