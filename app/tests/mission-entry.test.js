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

  const upworkDraft = normalizeMissionDraft({
    objective: "Ouvrir Upwork et lister 5 postes autour de Excel.",
    parameters: {
      website: "Upwork",
      searchQuery: "Excel",
      resultCount: 5,
      application: "Google Chrome"
    }
  }, contract);
  assert.equal(upworkDraft.parameters.browserLaunch.browserId, "chrome");
  assert.equal(upworkDraft.parameters.browserLaunch.searchQuery, "Excel");
  assert.equal(upworkDraft.parameters.browserLaunch.resultCount, 5);
  assert.equal(upworkDraft.parameters.browserLaunch.targetSite, "Upwork");
  assert.equal(upworkDraft.parameters.browserLaunch.resultType, "jobs");
  assert.equal(upworkDraft.parameters.browserLaunch.searchUrl.includes("google.com/search"), true);
  assert.equal(upworkDraft.parameters.browserLaunch.searchUrl.includes("Upwork"), true);
  assert.equal(upworkDraft.parameters.browserLaunch.searchUrl.includes("Excel"), true);
  assert.equal(upworkDraft.parameters.computerAction.type, "launch_browser_search");

  const linkedInDraft = normalizeMissionDraft({
    objective: "Open LinkedIn and list 3 data analyst jobs.",
    parameters: {
      website: "linkedin.com",
      searchQuery: "data analyst",
      resultCount: 3,
      browser: "Chrome"
    }
  }, contract);
  assert.equal(linkedInDraft.parameters.browserLaunch.browserId, "chrome");
  assert.equal(linkedInDraft.parameters.browserLaunch.targetSite, "linkedin.com");
  assert.equal(linkedInDraft.parameters.browserLaunch.resultType, "jobs");
  assert.equal(linkedInDraft.parameters.browserLaunch.searchUrl.includes("site%3Alinkedin.com"), true);
  assert.equal(linkedInDraft.parameters.computerAction.type, "launch_browser_search");

  const applicationDraft = normalizeMissionDraft({
    objective: "Open my note editor.",
    parameters: {
      applicationLaunch: {
        applicationId: "obsidian",
        applicationLabel: "Obsidian"
      }
    }
  }, contract);
  assert.equal(applicationDraft.parameters.applicationLaunch.applicationId, "obsidian");
  assert.equal(applicationDraft.parameters.applicationLaunch.applicationLabel, "Obsidian");

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

  const upworkSpec = normalizeMissionSpec({
    objective: "Ouvrir Upwork et lister 5 postes autour de Excel.",
    deliverable: "Liste de 5 postes Excel sur Upwork",
    parameters: {
      website: "Upwork",
      searchQuery: "Excel",
      resultCount: 5,
      application: "Google Chrome"
    }
  }, contract);
  assert.equal(upworkSpec.mode, "computer");
  assert.equal(upworkSpec.parameters.browserLaunch.browserId, "chrome");
  assert.equal(upworkSpec.parameters.computerAction.type, "launch_browser_search");
  assert.equal(buildMissionStatement(upworkSpec).includes("Browser target site if needed: Upwork"), true);
  assert.equal(buildMissionStatement(upworkSpec).includes("Requested browser result type if needed: jobs"), true);
  assert.equal(buildMissionStatement(upworkSpec).includes("Requested browser result count if needed: 5"), true);

  const appStatement = buildMissionStatement(applicationDraft, contract.modes.find((mode) => mode.id === "computer"));
  assert.equal(appStatement.includes("Preferred application if needed: obsidian"), true);

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
