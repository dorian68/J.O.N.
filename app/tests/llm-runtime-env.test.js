import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveLlmRuntimeEnvironment } from "../src/llm/resolve-runtime-env.js";
import { getDefaultLocalEnvFilePaths } from "../src/llm/local-env-files.js";

async function createTempEnvFile(content, fileName = ".env.local") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-env-"));
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

export async function run() {
  const envFile = await createTempEnvFile([
    "COWORK_LLM_PROVIDER_MODE=openai",
    "COWORK_OPENAI_PROVIDER_LABEL=OpenAI",
    "COWORK_OPENAI_BASE_URL=https://api.openai.com/v1",
    "COWORK_OPENAI_PRIMARY_MODEL=gpt-4.1-mini",
    "COWORK_OPENAI_API_KEY=file-secret"
  ].join("\n"));

  const localOnly = await resolveLlmRuntimeEnvironment({
    env: {},
    localEnvFilePaths: [envFile],
    secretStore: {
      getStatus: async () => ({
        available: true,
        configured: false,
        backend: "test"
      }),
      getSecret: async () => null
    }
  });
  assert.equal(localOnly.resolvedEnv.COWORK_LLM_PROVIDER_MODE, "openai");
  assert.equal(localOnly.secretResolution.providers.openaiCompatible.source, "local_env_file");

  const secretStoreFirst = await resolveLlmRuntimeEnvironment({
    env: {
      COWORK_OPENAI_API_KEY: "env-secret"
    },
    localEnvFilePaths: [envFile],
    secretStore: {
      getStatus: async () => ({
        available: true,
        configured: true,
        backend: "test"
      }),
      getSecret: async () => "secret-store-value"
    }
  });
  assert.equal(secretStoreFirst.resolvedEnv.COWORK_OPENAI_API_KEY, "secret-store-value");
  assert.equal(secretStoreFirst.secretResolution.providers.openaiCompatible.source, "os_secret_store");

  const baseEnv = await createTempEnvFile([
    "COWORK_OPENAI_PROVIDER_LABEL=Base provider",
    "COWORK_OPENAI_PRIMARY_MODEL=base-model"
  ].join("\n"), ".env");
  const localEnv = await createTempEnvFile([
    "COWORK_OPENAI_PROVIDER_LABEL=Local provider",
    "COWORK_OPENAI_PRIMARY_MODEL=local-model"
  ].join("\n"), ".env.local");

  const localOverridesBase = await resolveLlmRuntimeEnvironment({
    env: {},
    localEnvFilePaths: [baseEnv, localEnv],
    secretStore: {
      getStatus: async () => ({
        available: true,
        configured: false,
        backend: "test"
      }),
      getSecret: async () => null
    }
  });
  assert.equal(localOverridesBase.resolvedEnv.COWORK_OPENAI_PROVIDER_LABEL, "Local provider");
  assert.equal(localOverridesBase.resolvedEnv.COWORK_OPENAI_PRIMARY_MODEL, "local-model");

  const defaultPathOrder = getDefaultLocalEnvFilePaths().map((entry) => path.basename(entry));
  assert.deepEqual(defaultPathOrder, [".env", ".env", ".env.local", ".env.local"]);
}
