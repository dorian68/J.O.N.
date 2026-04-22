import assert from "node:assert/strict";
import { applySuiteHumanReview, buildBenchmarkReviewModel } from "../src/service/benchmark-review-model.js";

export async function run() {
  const review = buildBenchmarkReviewModel({
    browser: {
      assertions: {
        browserPass: true
      },
      assertionDetails: {
        browserPass: {
          label: "Browser suite assertion",
          reason: "Browser suite passed."
        }
      },
      cases: [
        {
          id: "browser-case",
          label: "Browser case",
          assertions: {
            browserPass: true
          },
          assertionDetails: {
            browserPass: {
              label: "Browser suite assertion",
              reason: "Browser suite passed."
            }
          }
        }
      ]
    },
    computer: {
      assertions: {
        computerPass: false
      },
      assertionDetails: {
        computerPass: {
          label: "Computer suite assertion",
          reason: "Computer suite failed."
        }
      },
      cases: []
    },
    reasoning: {
      assertions: {
        reasoningPass: true
      },
      assertionDetails: {
        reasoningPass: {
          label: "Reasoning suite assertion",
          reason: "Reasoning suite passed."
        }
      },
      cases: []
    },
    windowsProvider: {
      status: "skipped",
      assertions: {},
      assertionDetails: {},
      cases: []
    }
  });

  assert.equal(review.overallStatus, "gating_fail");
  assert.equal(review.suites.length, 4);
  assert.equal(review.suites[0].cases[0].assertionSummary.passed, 1);
  assert.equal(review.suites[1].failureReasons[0], "Computer suite failed.");
  assert.equal(review.suites[2].status, "pass");
  assert.equal(review.suites[3].status, "skipped");
  assert.equal(review.suites[0].humanReviewStatus, "pending");
  assert.equal(review.humanReviewSummary.gatingPending, 3);

  const updated = applySuiteHumanReview({
    browser: {
      assertions: {
        browserPass: true
      },
      assertionDetails: {
        browserPass: {
          label: "Browser suite assertion",
          reason: "Browser suite passed."
        }
      }
    },
    computer: {
      assertions: {
        computerPass: true
      },
      assertionDetails: {
        computerPass: {
          label: "Computer suite assertion",
          reason: "Computer suite passed."
        }
      }
    },
    reasoning: {
      assertions: {
        reasoningPass: true
      },
      assertionDetails: {
        reasoningPass: {
          label: "Reasoning suite assertion",
          reason: "Reasoning suite passed."
        }
      }
    },
    summary: {}
  }, {
    suiteId: "browser",
    classification: "real_success",
    notes: "Reviewed.",
    reviewer: "tester"
  });

  assert.equal(updated.review.suites[0].humanReviewStatus, "reviewed");
  assert.equal(updated.review.suites[0].humanReviewClassification, "real_success");
}
