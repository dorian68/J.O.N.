import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { APPROVAL_DECISION } from "../config.js";

export function createConsoleApprovalResolver() {
  return async function consoleApprovalResolver(request) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log("");
      console.log("Approval required");
      console.log(`Action: ${request.actionLabel}`);
      console.log(`Category: ${request.category}`);
      console.log(`Target: ${request.targetLabel}`);
      console.log(`Risk: ${request.riskLevel}`);
      console.log(`Reason: ${request.reason}`);
      console.log(`Expected effect: ${request.expectedEffect}`);
      console.log(`If denied: ${request.consequenceOfRefusal}`);
      if (request.evidenceId) {
        console.log(`Evidence: ${request.evidenceId}`);
      }

      const answer = await rl.question("Approve once [a], deny [d], stop run [s]? ");
      const normalized = answer.trim().toLowerCase();
      if (normalized === "a") {
        return {
          decision: APPROVAL_DECISION.APPROVED_ONCE,
          rationale: "Approved through console resolver."
        };
      }
      if (normalized === "s") {
        return {
          decision: APPROVAL_DECISION.STOP_RUN,
          rationale: "Stopped through console resolver."
        };
      }
      return {
        decision: APPROVAL_DECISION.DENIED,
        rationale: "Denied through console resolver."
      };
    } finally {
      rl.close();
    }
  };
}
