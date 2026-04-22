import assert from "node:assert/strict";
import {
  buildMissionEntryContract,
  buildMissionStatement,
  normalizeMissionDraft,
  normalizeMissionSpec
} from "../src/service/mission-entry.js";

export async function run() {
  const contract = buildMissionEntryContract({
    scenarios: [
      {
        id: "research",
        label: "Recherche multi-pages",
        description: "Bounded research.",
        writeBoundary: "read_only",
        evidenceFocus: "controlled_fixture"
      },
      {
        id: "form",
        label: "Preparation de formulaire",
        description: "Bounded edit without submit.",
        writeBoundary: "bounded_edit_without_submit",
        evidenceFocus: "form_preparation_evidence"
      },
      {
        id: "computer",
        label: "Desktop step",
        description: "Bounded local desktop step.",
        writeBoundary: "bounded_local_desktop_step",
        evidenceFocus: "controlled_fixture_window"
      }
    ]
  });

  assert.equal(contract.defaultModeId, "research");
  assert.equal(contract.modes.length, 3);
  assert.equal(contract.formRoleOptions.some((option) => option.value === "operator"), true);
  assert.equal(contract.starterMissions.some((mission) => mission.mode === "research"), true);
  assert.equal(contract.starterMissions.some((mission) => mission.mode === "form"), true);

  const missionDraft = normalizeMissionDraft({
    objective: "Compare the allowlisted pages and prepare a decision note."
  }, contract);

  assert.equal(missionDraft.mode, "");
  assert.deepEqual(missionDraft.constraints, []);
  assert.deepEqual(missionDraft.forbiddenActions, []);

  const browserDraft = normalizeMissionDraft({
    objective: "Open my browser on this machine.",
    parameters: {
      browserLaunch: {
        browserId: "edge"
      }
    }
  }, contract);
  assert.equal(browserDraft.parameters.browserLaunch.browserId, "edge");

  const researchSpec = normalizeMissionSpec({
    objective: "Compare the allowlisted pages and prepare a decision note.",
    deliverable: "Operator note",
    constraints: "Use only allowlisted pages\nKeep uncertainty explicit",
    forbiddenActions: ["Do not submit anything"]
  }, contract);

  assert.equal(researchSpec.mode, "research");
  assert.equal(researchSpec.routing.modeSource, "inferred");
  assert.deepEqual(researchSpec.constraints, [
    "Use only allowlisted pages",
    "Keep uncertainty explicit"
  ]);
  assert.deepEqual(researchSpec.forbiddenActions, ["Do not submit anything"]);

  const browserSpec = normalizeMissionSpec({
    objective: "Open my browser on this machine.",
    parameters: {
      browserLaunch: {
        browserId: "chrome"
      }
    }
  }, contract);
  assert.equal(browserSpec.parameters.browserLaunch.browserId, "chrome");

  const formSpec = normalizeMissionSpec({
    mode: "form",
    objective: "Prepare the controlled form for review.",
    parameters: {
      formValues: {
        name: "Jordan Labry",
        role: "lead",
        subscribe: true
      }
    }
  }, contract);

  assert.equal(formSpec.parameters.formValues.role, "lead");
  assert.equal(formSpec.parameters.formValues.subscribe, true);

  const missionStatement = buildMissionStatement(formSpec, contract.modes.find((mode) => mode.id === "form"));
  assert.equal(missionStatement.includes("Controlled form values:"), true);
  assert.equal(missionStatement.includes("Boundary:"), false);

  const explicitStatement = buildMissionStatement(
    formSpec,
    contract.modes.find((mode) => mode.id === "form"),
    { includeExecutionFrame: true }
  );
  assert.equal(explicitStatement.includes("Boundary:"), true);

  assert.throws(() => normalizeMissionSpec({
    mode: "form",
    objective: "Prepare the controlled form for review.",
    parameters: {
      formValues: {
        name: "Jordan Labry",
        role: "admin"
      }
    }
  }, contract), /Unsupported form role/);
}
