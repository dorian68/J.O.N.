import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createDefaultOsSecretStore } from "../security/os-secret-store.js";
import { normalizeSecretValue } from "../security/secret-normalization.js";

const SECRET_ALIAS = "llm.openai_compatible.api_key";

function usage() {
  console.log([
    "Usage:",
    "  node src/scripts/manage-llm-secret.js status",
    "  node src/scripts/manage-llm-secret.js clear",
    "  node src/scripts/manage-llm-secret.js set [--value-env ENV_NAME]",
    "",
    "Notes:",
    "  - Without --value-env, the set action prompts for the secret on stdin.",
    "  - The secret value is never printed back."
  ].join("\n"));
}

function parseOptions(argv) {
  const action = argv[0] ?? "help";
  let valueEnv = null;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--value-env" && argv[index + 1]) {
      valueEnv = argv[index + 1];
      index += 1;
    }
  }
  return {
    action,
    valueEnv
  };
}

async function readSecretValue(valueEnv) {
  if (valueEnv) {
    const candidate = normalizeSecretValue(process.env[valueEnv]);
    if (!candidate) {
      throw new Error(`Environment variable ${valueEnv} is empty or not set.`);
    }
    return candidate;
  }

  const rl = readline.createInterface({
    input,
    output
  });
  try {
    const secretValue = normalizeSecretValue(await rl.question("Enter OpenAI-compatible API key: "));
    if (!secretValue) {
      throw new Error("No secret value entered.");
    }
    return secretValue;
  } finally {
    rl.close();
  }
}

const options = parseOptions(process.argv.slice(2));
const store = createDefaultOsSecretStore();

switch (options.action) {
  case "status": {
    const status = await store.getStatus(SECRET_ALIAS);
    console.log(JSON.stringify(status, null, 2));
    break;
  }
  case "clear": {
    const result = await store.clearSecret(SECRET_ALIAS);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "set": {
    const secretValue = await readSecretValue(options.valueEnv);
    const status = await store.setSecret(SECRET_ALIAS, secretValue);
    console.log(JSON.stringify({
      available: status.available,
      configured: status.configured,
      backend: status.backend,
      updatedAt: status.updatedAt ?? null
    }, null, 2));
    break;
  }
  default:
    usage();
    process.exitCode = options.action === "help" ? 0 : 1;
    break;
}
