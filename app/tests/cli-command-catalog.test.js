import assert from "node:assert/strict";
import {
  listAllowlistedCliCommandsFromCatalog,
  listAvailableCliAgents,
  resolveCliCommandPath
} from "../src/workspace/cli-command-catalog.js";

export async function run() {
  const resolvedNode = resolveCliCommandPath(process.execPath);
  assert.equal(Boolean(resolvedNode), true);

  const catalog = listAvailableCliAgents({
    candidates: [
      {
        id: "node",
        command: process.execPath,
        label: "Node",
        agentKind: "generic_cli"
      },
      {
        id: "missing",
        command: "jon-command-that-does-not-exist",
        label: "Missing",
        agentKind: "generic_cli"
      }
    ]
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, "node");
  assert.equal(listAllowlistedCliCommandsFromCatalog(catalog)[0], process.execPath);
}
