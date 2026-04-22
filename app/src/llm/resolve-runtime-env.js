import { createDefaultOsSecretStore } from "../security/os-secret-store.js";
import { LLM_PROVIDER_ALIAS } from "../config.js";
import { loadLocalEnvFiles } from "./local-env-files.js";
import { normalizeSecretValue } from "../security/secret-normalization.js";

const PROVIDER_SECRET_ALIASES = Object.freeze({
  [LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE]: "llm.openai_compatible.api_key"
});

export async function resolveLlmRuntimeEnvironment({
  env = process.env,
  secretStore = createDefaultOsSecretStore(),
  localEnvFilePaths
} = {}) {
  const shouldLoadLocalEnvFiles = Array.isArray(localEnvFilePaths) || env === process.env;
  const { values: localEnvValues, loadedFiles } = shouldLoadLocalEnvFiles
    ? await loadLocalEnvFiles({
      filePaths: localEnvFilePaths
    })
    : {
      values: {},
      loadedFiles: []
    };
  const resolvedEnv = {
    ...localEnvValues,
    ...env
  };

  const openAiAlias = PROVIDER_SECRET_ALIASES[LLM_PROVIDER_ALIAS.OPENAI_COMPATIBLE];
  const openAiSecretStatus = await secretStore.getStatus(openAiAlias);
  let openAiSecretSource = "missing";
  const processEnvOpenAiKey = normalizeSecretValue(env.COWORK_OPENAI_API_KEY || "");
  const localEnvOpenAiKey = normalizeSecretValue(localEnvValues.COWORK_OPENAI_API_KEY || "");

  if (openAiSecretStatus.available && openAiSecretStatus.configured) {
    const secretValue = normalizeSecretValue(await secretStore.getSecret(openAiAlias));
    if (secretValue) {
      resolvedEnv.COWORK_OPENAI_API_KEY = secretValue;
      openAiSecretSource = "os_secret_store";
    }
  }

  if (openAiSecretSource === "missing" && processEnvOpenAiKey) {
    resolvedEnv.COWORK_OPENAI_API_KEY = processEnvOpenAiKey;
    openAiSecretSource = "env";
  }

  if (openAiSecretSource === "missing" && localEnvOpenAiKey) {
    resolvedEnv.COWORK_OPENAI_API_KEY = localEnvOpenAiKey;
    openAiSecretSource = "local_env_file";
  }

  return {
    resolvedEnv,
    secretResolution: {
      requireOsSecretStore: !["0", "false", "no"].includes(String(env.COWORK_LLM_REQUIRE_OS_SECRET_STORE ?? "0").toLowerCase()),
      localEnvFiles: loadedFiles,
      providers: {
        openaiCompatible: {
          alias: openAiAlias,
          source: openAiSecretSource,
          status: openAiSecretStatus,
          localEnvFileConfigured: Boolean(localEnvOpenAiKey)
        }
      }
    }
  };
}
