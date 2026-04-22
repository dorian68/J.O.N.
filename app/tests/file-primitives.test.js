import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeFilePrimitive } from "../src/computer/file-primitives.js";

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-file-primitives-"));
  const runDir = path.join(root, "run");
  const filePath = path.join(root, "notes.txt");
  const renamedPath = path.join(root, "notes-renamed.txt");

  const created = await executeFilePrimitive({
    primitive: "create_text_file",
    target: { path: filePath },
    input: { content: "hello cowork" }
  }, { runDir, baseDir: root });
  assert.equal(created.ok, true);
  assert.equal(await fs.readFile(filePath, "utf8"), "hello cowork");
  assert.equal(Boolean(created.rollback?.manifestPath), true);

  const listed = await executeFilePrimitive({
    primitive: "list_directory",
    target: { path: root },
    input: { maxEntries: 10 }
  }, { runDir, baseDir: root });
  assert.equal(listed.entries.some((entry) => entry.name === "notes.txt"), true);

  const written = await executeFilePrimitive({
    primitive: "write_text_file",
    target: { path: filePath },
    input: { content: "updated" }
  }, { runDir, baseDir: root });
  assert.equal(written.ok, true);
  assert.equal(await fs.readFile(filePath, "utf8"), "updated");
  assert.equal(written.rollback.manifest.snapshots[0].existedBefore, true);

  const renamed = await executeFilePrimitive({
    primitive: "rename_path",
    target: { path: filePath, destinationPath: renamedPath }
  }, { runDir, baseDir: root });
  assert.equal(renamed.ok, true);
  assert.equal(await fs.readFile(renamedPath, "utf8"), "updated");

  const deleted = await executeFilePrimitive({
    primitive: "delete_path",
    target: { path: renamedPath }
  }, { runDir, baseDir: root });
  assert.equal(deleted.ok, true);
  await assert.rejects(() => fs.access(renamedPath));
  assert.equal(deleted.rollback.manifest.snapshots[0].existedBefore, true);

  await assert.rejects(() => executeFilePrimitive({
    primitive: "delete_path",
    target: { path: os.homedir() }
  }, { runDir, baseDir: root }), /user profile root|protected root/i);

  await fs.rm(root, { recursive: true, force: true });
}
