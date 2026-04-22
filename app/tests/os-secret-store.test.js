import assert from "node:assert/strict";
import { OsSecretStore } from "../src/security/os-secret-store.js";

export async function run() {
  const commands = [];
  const store = new OsSecretStore({
    platform: "win32",
    runner: async (_command, args, options = {}) => {
      commands.push({
        args,
        stdinValue: options.stdinValue ?? null
      });
      const action = args[args.indexOf("-Action") + 1];
      if (action === "status") {
        return {
          stdout: JSON.stringify({
            status: "present",
            backend: "windows_dpapi_current_user",
            updatedAt: "2026-04-16T00:00:00.000Z"
          })
        };
      }
      if (action === "retrieve") {
        return {
          stdout: "secret-from-store"
        };
      }
      return {
        stdout: JSON.stringify({
          status: "ok"
        })
      };
    }
  });

  const status = await store.getStatus("llm.openai_compatible.api_key");
  assert.equal(status.available, true);
  assert.equal(status.configured, true);

  const value = await store.getSecret("llm.openai_compatible.api_key");
  assert.equal(value, "secret-from-store");

  await store.setSecret("llm.openai_compatible.api_key", "secret-input");
  assert.equal(commands.some((entry) => entry.stdinValue === "secret-input"), true);

  const unsupported = new OsSecretStore({
    platform: "linux"
  });
  assert.equal(unsupported.isSupported(), false);
}

