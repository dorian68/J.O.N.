import os from "node:os";
import path from "node:path";
import { RELEASE_ROOT } from "../config.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { createDefaultOsSecretStore } from "./os-secret-store.js";

export async function runSecretStoreSmoke({
  store = createDefaultOsSecretStore()
} = {}) {
  const alias = `smoke.llm.secret.${process.pid}.${Date.now()}`;

  if (!store.isSupported()) {
    return {
      status: "blocked",
      backend: store.backend,
      reason: "unsupported_platform"
    };
  }

  const secretValue = `smoke-secret-${os.hostname()}-${process.pid}`;
  await store.setSecret(alias, secretValue);
  const status = await store.getStatus(alias);
  const roundTrip = await store.getSecret(alias);
  await store.clearSecret(alias);

  return {
    status: roundTrip === secretValue && status.configured ? "pass" : "fail",
    backend: status.backend,
    configured: status.configured,
    roundTripOk: roundTrip === secretValue
  };
}

export async function persistSecretStoreSmokeResult(result) {
  await ensureDir(RELEASE_ROOT);
  const stamped = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(RELEASE_ROOT, `secret-store-smoke-${stamped}.json`);
  const latestPath = path.join(RELEASE_ROOT, "secret-store-smoke-latest.json");
  await writeJson(outputPath, result);
  await writeJson(latestPath, result);
  return {
    outputPath,
    latestPath
  };
}
