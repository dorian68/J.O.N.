import assert from "node:assert/strict";
import { once } from "node:events";
import { CliTerminalSupervisor, hasSensitiveTerminalInput } from "../src/workspace/cli-terminal-supervisor.js";

function waitFor(predicate, { timeoutMs = 4000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for CLI supervisor condition."));
      }
    }, 25);
  });
}

export async function run() {
  assert.equal(hasSensitiveTerminalInput("use token abc"), true);
  assert.equal(hasSensitiveTerminalInput("continue"), false);

  const supervisor = new CliTerminalSupervisor({
    allowedCommands: [process.execPath]
  });
  const output = [];
  supervisor.on("output", (event) => output.push(event.text));
  try {
    const snapshot = supervisor.start("term_test_cli", {
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log('worker ready')",
          "console.log('Approve this command? [y/n]')",
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (chunk) => { console.log('received:' + chunk.trim()); process.exit(0) })",
          "setTimeout(() => process.exit(2), 8000)"
        ].join(";")
      ],
      cwd: process.cwd()
    });
    assert.equal(snapshot.terminalId, "term_test_cli");
    assert.equal(Number.isInteger(snapshot.pid), true);
    await waitFor(() => output.join("").includes("Approve this command?"));
    supervisor.write("term_test_cli", "y");
    const [exitEvent] = await once(supervisor, "exit");
    assert.equal(exitEvent.exitCode, 0);
    assert.equal(output.join("").includes("received:y"), true);
  } finally {
    supervisor.close();
  }
}
