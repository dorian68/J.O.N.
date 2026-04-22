import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pruneRuntimeData } from "../src/observability/runtime-retention.js";

export async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-retention-"));
  const oldFile = path.join(tempRoot, "old.json");
  const freshFile = path.join(tempRoot, "fresh.json");

  try {
    await fs.writeFile(oldFile, "old", "utf8");
    await fs.writeFile(freshFile, "fresh", "utf8");

    const twoDaysAgo = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
    await fs.utimes(oldFile, twoDaysAgo, twoDaysAgo);

    const result = await pruneRuntimeData({
      roots: [tempRoot],
      olderThanDays: 1,
      now: Date.now()
    });

    assert.equal(result.deletedCount, 1);
    assert.equal(result.keptCount, 1);
    await assert.rejects(() => fs.access(oldFile));
    await fs.access(freshFile);
  } finally {
    await fs.rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
}

