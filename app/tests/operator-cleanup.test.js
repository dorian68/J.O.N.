import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { TEMP_RUNTIME_ROOT } from "../src/config.js";
import { OperatorService } from "../src/service/operator-service.js";

const FIXTURE_ONLY_REAL_SURFACES = Object.freeze({
  research: {
    mode: "controlled_fixture",
    mission: "Controlled fixture research cleanup test mission."
  },
  computer: {
    mode: "controlled_fixture_window",
    mission: "Controlled fixture computer cleanup test mission."
  }
});

function isSpawnEperm(error) {
  return error?.message?.includes("spawn EPERM");
}

export async function run() {
  const service = await OperatorService.create({
    realSurfaceRuntimeConfig: FIXTURE_ONLY_REAL_SURFACES
  });

  try {
    const project = await service.ensureDemoProject();
    const launch = await service.startScenario(project.id, "research");
    const detail = await service.waitForRun(launch.runId);

    assert.equal(detail.run.status, "completed");
    assert.equal(detail.artifacts.length >= 2, true);
    assert.equal(detail.evidence.length >= 1, true);

    const artifact = detail.artifacts[0];
    const evidence = detail.evidence[0];
    const artifactPath = artifact.storagePath;
    const evidencePath = evidence.storagePath;

    await service.deleteArtifact(detail.run.id, artifact.id);
    await fs.access(artifactPath).then(() => {
      throw new Error("Artifact file still exists after deletion.");
    }).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });

    await service.deleteEvidence(detail.run.id, evidence.id);
    await fs.access(evidencePath).then(() => {
      throw new Error("Evidence file still exists after deletion.");
    }).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });

    await service.deleteRun(detail.run.id);
    const deletedRun = await service.getRunDetail(detail.run.id);
    assert.equal(deletedRun, null);

    await fs.mkdir(TEMP_RUNTIME_ROOT, { recursive: true });
    const tempFile = path.join(TEMP_RUNTIME_ROOT, "cleanup-test.txt");
    await fs.writeFile(tempFile, "temp", "utf8");
    const cleanup = await service.clearTemporaryRuntimeState();
    assert.equal(cleanup.cleared, true);
    assert.equal(cleanup.deletedEntryCount >= 1, true);
    await fs.access(tempFile).then(() => {
      throw new Error("Temporary runtime file still exists after cleanup.");
    }).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });

    await service.deleteProject(project.id);
    assert.equal(service.listProjects().some((entry) => entry.id === project.id), false);
    assert.equal(service.runtimeHandle.database.listDeletedRecords({ limit: 20 }).length >= 4, true);
  } catch (error) {
    if (isSpawnEperm(error)) {
      console.warn("operator-cleanup test skipped: browser launch blocked (EPERM).");
      return;
    }
    throw error;
  } finally {
    await service.close();
  }
}
