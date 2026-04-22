import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeWindowProvider } from "../computer/fake-window-provider.js";
import { createPrototypeRuntime } from "../runtime/create-prototype-runtime.js";
import { APPROVAL_DECISION } from "../config.js";

async function tempDbPath(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, "prototype.sqlite");
}

export async function runComputerBenchmarks() {
  const provider = new FakeWindowProvider([
    {
      id: "win_hub",
      title: "Fixture Hub Browser",
      active: false,
      allowlisted: true,
      content: "state=loading"
    },
    {
      id: "win_research",
      title: "Controlled Research Window",
      active: true,
      allowlisted: true,
      content: "state=loading"
    },
    {
      id: "win_noise",
      title: "Noise Window",
      active: false,
      allowlisted: false,
      content: "unexpected"
    }
  ]);

  const dbPath = await tempDbPath("cowork-computer");
  const runtimeHandle = await createPrototypeRuntime({
    dbPath,
    computerProvider: provider,
    approvalResolver: async (request) => ({
      decision: APPROVAL_DECISION.APPROVED_ONCE,
      rationale: `Controlled computer benchmark approval for ${request.actionLabel}.`
    })
  });

  try {
    const project = runtimeHandle.runtime.createProject({
      name: "Controlled computer benchmarks",
      description: "Controlled desktop benchmark project",
      allowlistedDomains: ["127.0.0.1"]
    });

    setTimeout(() => {
      provider.mutateWindow("win_hub", {
        content: "state=ready"
      });
    }, 200);

    const observationResult = await runtimeHandle.runtime.runComputerObservationScenario({
      projectId: project.id,
      mission: "Verify the controlled local surface becomes ready.",
      allowlistedWindowId: "win_hub",
      expectedMatcher: (inspection) => inspection.content?.includes("ready")
    });

    const assertions = {
      runCompleted: observationResult.run.status === "completed",
      verificationValidated: observationResult.verification.validated === true,
      approvalsPresent: observationResult.approvals.length >= 1,
      evidencePresent: observationResult.evidence.length >= 1
    };

    const assertionDetails = {
      runCompleted: {
        label: "Computer observation run completed",
        expected: "run status completed",
        observed: observationResult.run.status,
        reason: observationResult.run.status === "completed"
          ? "Computer observation run completed."
          : `Computer observation run ended with status ${observationResult.run.status}.`,
        refs: { runId: observationResult.run.id }
      },
      verificationValidated: {
        label: "Visible outcome verified",
        expected: "verification.validated = true",
        observed: observationResult.verification.validated,
        reason: observationResult.verification.validated === true
          ? "Visible outcome verification succeeded."
          : "Visible outcome verification did not succeed."
      },
      approvalsPresent: {
        label: "Local focus approval recorded",
        expected: "at least 1 approval",
        observed: observationResult.approvals.length,
        reason: observationResult.approvals.length >= 1
          ? "The bounded local focus approval path was exercised."
          : "No bounded local focus approval was recorded.",
        refs: {
          runId: observationResult.run.id,
          approvalIds: observationResult.approvals.map((approval) => approval.id)
        }
      },
      evidencePresent: {
        label: "Computer evidence captured",
        expected: "at least 1 evidence record",
        observed: observationResult.evidence.length,
        reason: observationResult.evidence.length >= 1
          ? "Computer observation evidence was persisted."
          : "No computer observation evidence was persisted.",
        refs: {
          runId: observationResult.run.id,
          evidenceIds: observationResult.evidence.map((entry) => entry.id)
        }
      }
    };

    return {
      runId: observationResult.run.id,
      evidence: observationResult.evidence,
      approvals: observationResult.approvals,
      verification: observationResult.verification,
      assertions,
      assertionDetails,
      cases: [
        {
          id: "computer-observation",
          label: "Computer observation flow",
          summary: "Bounded observation/focus/proof flow on a controlled local surface.",
          relatedRunId: observationResult.run.id,
          relatedEvidenceIds: observationResult.evidence.map((entry) => entry.id),
          assertions,
          assertionDetails
        }
      ]
    };
  } finally {
    await runtimeHandle.close();
  }
}
