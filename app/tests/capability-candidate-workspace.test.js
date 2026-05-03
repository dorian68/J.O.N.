import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";
import { CAPABILITY_CANDIDATE_STATUS } from "../src/capabilities/capability-candidate-workspace.js";
import { createOperatorServer } from "../src/server/operator-server.js";
import { OperatorService } from "../src/service/operator-service.js";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture capability candidate mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture capability candidate window mission."
  }
});

async function tempDbPath(label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cowork-${label}-`));
  return path.join(dir, "test.sqlite");
}

function provider() {
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

function fourRowHtml() {
  return `<!doctype html>
<html>
  <body>
    <article data-capability-row><a data-field="title" href="/s1">Supplier 1</a><p data-field="summary">Alpha profile</p><span data-field="organization">Alpha</span></article>
    <article data-capability-row><a data-field="title" href="/s2">Supplier 2</a><p data-field="summary">Beta profile</p><span data-field="organization">Beta</span></article>
    <article data-capability-row><a data-field="title" href="/s3">Supplier 3</a><p data-field="summary">Gamma profile</p><span data-field="organization">Gamma</span></article>
    <article data-capability-row><a data-field="title" href="/s4">Supplier 4</a><p data-field="summary">Delta profile</p><span data-field="organization">Delta</span></article>
  </body>
</html>`;
}

async function createService(label) {
  return OperatorService.create({
    dbPath: await tempDbPath(label),
    realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
    computerProvider: provider()
  });
}

export async function run() {
  const service = await createService("capability-candidate");
  let artifactDirectory = null;
  try {
    const created = await service.createCapabilityCandidate({
      mission: "Collect 4 supplier profiles from a vendor portal into a CSV file.",
      desiredOutcome: "Verified CSV with 4 supplier profile rows.",
      failureContext: {
        status: "failed",
        summary: "The browser opened but no structured supplier rows were extracted."
      }
    });
    assert.equal(created.created, true);
    assert.equal(created.candidate.status, CAPABILITY_CANDIDATE_STATUS.CANDIDATE);
    assert.equal(created.candidate.artifactKind, "web_data_adapter.v1");
    assert.equal(created.artifact.generatedCode, false);
    artifactDirectory = created.candidate.artifactDirectory;
    await fs.access(created.candidate.artifactPaths.adapter);
    await fs.access(created.candidate.artifactPaths.positiveFixture);

    const listed = service.listCapabilityCandidates();
    assert.equal(listed.some((candidate) => candidate.id === created.candidate.id), true);

    const validated = await service.validateCapabilityCandidate(created.candidate.id);
    assert.equal(validated.candidate.status, CAPABILITY_CANDIDATE_STATUS.VALIDATED);
    assert.equal(validated.validation.status, "pass");
    assert.equal(validated.validation.checks.every((check) => check.pass), true);

    const enabled = await service.enableCapabilityCandidate(created.candidate.id, {
      approvedBy: "test",
      rationale: "Fixture harness passed."
    });
    assert.equal(enabled.candidate.status, CAPABILITY_CANDIDATE_STATUS.ENABLED);
    assert.equal(
      enabled.capabilityGraph.nodes.some((node) => node.sourceKind === "mcp_server" && node.payload?.serverId === "jon_generated_capabilities"),
      true
    );

    const execution = await service.executeCapabilityCandidateOnHtml(created.candidate.id, {
      html: fourRowHtml(),
      url: "https://portal.example.test/results"
    });
    assert.equal(execution.status, "pass");
    assert.equal(execution.rowCount, 4);
    assert.equal(execution.rows[0].title, "Supplier 1");
    assert.equal(execution.rows[0].url, "https://portal.example.test/s1");

    const disabled = await service.disableCapabilityCandidate(created.candidate.id, {
      rationale: "Test cleanup"
    });
    assert.equal(disabled.candidate.status, CAPABILITY_CANDIDATE_STATUS.DISABLED);
    await assert.rejects(
      () => service.executeCapabilityCandidateOnHtml(created.candidate.id, {
        html: fourRowHtml()
      }),
      /not enabled/
    );
  } finally {
    await service.close();
    if (artifactDirectory) {
      await fs.rm(artifactDirectory, { recursive: true, force: true });
    }
  }

  const server = await createOperatorServer({
    port: 0,
    operatorServiceOptions: {
      dbPath: await tempDbPath("capability-candidate-api"),
      realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES,
      computerProvider: provider()
    }
  });
  let apiArtifactDirectory = null;
  try {
    const createResponse = await fetch(`${server.baseUrl}/api/capabilities/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mission: "Collect 3 supplier profiles from a vendor portal into JSON.",
        desiredOutcome: "Verified JSON with 3 profile rows.",
        failureContext: {
          status: "partial",
          summary: "No structured rows were extracted."
        }
      })
    });
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json();
    const candidateId = createPayload.candidate.id;
    apiArtifactDirectory = createPayload.candidate.artifactDirectory;

    const validateResponse = await fetch(`${server.baseUrl}/api/capabilities/candidates/${encodeURIComponent(candidateId)}/validate`, {
      method: "POST"
    });
    assert.equal(validateResponse.ok, true);
    const validatePayload = await validateResponse.json();
    assert.equal(validatePayload.validation.status, "pass");

    const enableResponse = await fetch(`${server.baseUrl}/api/capabilities/candidates/${encodeURIComponent(candidateId)}/enable`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        approvedBy: "api-test",
        rationale: "Validated fixture harness."
      })
    });
    assert.equal(enableResponse.ok, true);
    const enablePayload = await enableResponse.json();
    assert.equal(enablePayload.candidate.status, CAPABILITY_CANDIDATE_STATUS.ENABLED);

    const runResponse = await fetch(`${server.baseUrl}/api/capabilities/candidates/${encodeURIComponent(candidateId)}/run-html`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        html: fourRowHtml(),
        url: "https://portal.example.test/results"
      })
    });
    assert.equal(runResponse.ok, true);
    const runPayload = await runResponse.json();
    assert.equal(runPayload.status, "pass");
    assert.equal(runPayload.rowCount >= 3, true);

    const listResponse = await fetch(`${server.baseUrl}/api/capabilities/candidates?status=enabled`);
    assert.equal(listResponse.ok, true);
    const listPayload = await listResponse.json();
    assert.equal(listPayload.candidates.some((candidate) => candidate.id === candidateId), true);
  } finally {
    await server.close();
    if (apiArtifactDirectory) {
      await fs.rm(apiArtifactDirectory, { recursive: true, force: true });
    }
  }
}
