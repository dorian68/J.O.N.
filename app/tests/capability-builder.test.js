import assert from "node:assert/strict";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import {
  analyzeCapabilityGap,
  assessCapabilityGap,
  buildCapabilityBuildProposal,
  validateCapabilityBuildProposal
} from "../src/capabilities/capability-builder.js";
import {
  normalizeUserDefinedSkillManifest,
  validateSkillManifest
} from "../src/capabilities/skill-manifest.js";
import { createOperatorServer } from "../src/server/operator-server.js";
import { OperatorService } from "../src/service/operator-service.js";

const CAPABILITY_GRAPH = Object.freeze([
  {
    id: "skill.skill.browser",
    label: "Browser",
    skillId: "skill.browser",
    sourceKind: "skill",
    payload: {
      description: "Operate a controlled browser with DOM snapshots and extraction.",
      affordances: ["read web page", "extract text", "capture proof"],
      primitives: ["browser.read_dom", "browser.extract_text", "browser.verify_outcome"]
    }
  },
  {
    id: "skill.skill.notepad",
    label: "Notepad",
    skillId: "skill.notepad",
    sourceKind: "skill",
    payload: {
      description: "Open Notepad, type approved text, capture proof.",
      affordances: ["open editor", "type text"],
      primitives: ["launch_application", "type_text", "capture_window"]
    }
  }
]);

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture capability builder mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture capability builder window mission."
  }
});

function createCapabilityBuilderWindowProvider() {
  return new FakeWindowProvider([], {
    applications: [
      {
        id: "notepad",
        label: "Notepad",
        kind: "text_editor",
        processName: "notepad",
        executablePath: "C:\\Windows\\System32\\notepad.exe"
      }
    ],
    browsers: [
      {
        id: "edge",
        label: "Microsoft Edge",
        processName: "msedge",
        executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      }
    ]
  });
}

export async function run() {
  const extractionMission = "Open linkedin.com, collect 20 CFO profiles into a table, and prove the extracted fields.";
  const assessment = assessCapabilityGap({
    mission: extractionMission,
    desiredOutcome: "Verified table with 20 profile rows",
    capabilityGraph: CAPABILITY_GRAPH
  });
  assert.equal(assessment.needDetected, true);
  assert.equal(assessment.capabilityKind, "web_data_adapter");
  assert.equal(["specialized_adapter_missing", "weak_capability_coverage"].includes(assessment.gapType), true);
  assert.equal(assessment.existingMatches.some((entry) => entry.skillId === "skill.browser"), true);
  assert.deepEqual(analyzeCapabilityGap({
    mission: extractionMission,
    desiredOutcome: "Verified table with 20 profile rows",
    capabilityGraph: CAPABILITY_GRAPH
  }).signals, assessment.signals);

  const proposal = buildCapabilityBuildProposal({
    mission: extractionMission,
    desiredOutcome: "Verified table with 20 profile rows",
    capabilityGraph: CAPABILITY_GRAPH
  });
  assert.equal(proposal.status, "draft_proposed");
  assert.equal(proposal.decision, "propose_capability_build");
  assert.equal(proposal.safety.generatedCodeExecutableByDefault, false);
  assert.equal(proposal.safety.canModifyRuntimeCore, false);
  assert.equal(proposal.proposedSkillManifest.id.startsWith("skill.generated.web_data_adapter"), true);
  assert.equal(validateSkillManifest(proposal.proposedSkillManifest).valid, true);
  const normalizedDraftSkill = normalizeUserDefinedSkillManifest(proposal.proposedSkillManifest);
  assert.equal(normalizedDraftSkill.activationStatus, "draft");
  assert.equal(normalizedDraftSkill.implementationStatus, "declared_foundation");
  assert.equal(validateCapabilityBuildProposal(proposal).valid, true);
  assert.equal(proposal.testPlan.some((entry) => entry.id === "livrable_verification"), true);

  const failedRunProposal = buildCapabilityBuildProposal({
    mission: "Read a vendor portal and extract invoice PDF metadata.",
    desiredOutcome: "Invoice metadata JSON",
    capabilityGraph: CAPABILITY_GRAPH,
    failureContext: {
      status: "failed",
      failedChecks: ["The requested metadata was not extracted."],
      summary: "Browser opened but the deliverable was incomplete."
    }
  });
  assert.equal(failedRunProposal.assessment.gapType, "failed_or_incomplete_capability");
  assert.equal(failedRunProposal.assessment.confidence, "high");

  const coveredProposal = buildCapabilityBuildProposal({
    mission: "Open Notepad and type hello.",
    capabilityGraph: CAPABILITY_GRAPH
  });
  assert.equal(coveredProposal.status, "use_existing");
  assert.equal(coveredProposal.proposedSkillManifest, null);
  assert.equal(validateCapabilityBuildProposal(coveredProposal).valid, true);

  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
    computerProvider: createCapabilityBuilderWindowProvider()
  });
  try {
    await service.clearTemporaryRuntimeState();
    const serviceProposal = await service.proposeCapabilityBuild({
      mission: "Collect 12 supplier profiles from a vendor portal into a CSV file.",
      desiredOutcome: "Verified CSV with 12 supplier profile rows.",
      failureContext: {
        status: "failed",
        summary: "The browser opened but no structured rows were extracted.",
        failedChecks: ["No parser produced the requested supplier rows."]
      },
      registerDraftSkill: true
    });
    assert.equal(serviceProposal.validation.valid, true);
    assert.equal(serviceProposal.proposal.status, "draft_proposed");
    assert.equal(serviceProposal.proposal.capabilityKind, "web_data_adapter");
    assert.equal(serviceProposal.registeredDraftSkill, true);
    assert.equal(
      serviceProposal.skillRegistry.userDefined.some((skill) => skill.id === serviceProposal.proposal.proposedSkillManifest.id),
      true
    );
  } finally {
    await service.close();
  }

  const server = await createOperatorServer({
    port: 0,
    operatorServiceOptions: {
      realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
      computerProvider: createCapabilityBuilderWindowProvider()
    }
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/capabilities/build/propose`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mission: "Extract invoice metadata rows from a vendor portal into JSON.",
        desiredOutcome: "Invoice metadata JSON with all visible rows.",
        failureContext: {
          status: "partial",
          summary: "The run found the portal but no structured metadata rows were extracted."
        }
      })
    });
    assert.equal(response.ok, true);
    const payload = await response.json();
    assert.equal(payload.validation.valid, true);
    assert.equal(payload.proposal.status, "draft_proposed");
    assert.equal(payload.proposal.capabilityKind, "web_data_adapter");
  } finally {
    await server.close();
  }
}
