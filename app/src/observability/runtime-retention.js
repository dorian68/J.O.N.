import fs from "node:fs/promises";
import path from "node:path";
import { LOGS_ROOT, REAL_SURFACE_VALIDATION_ROOT, DATA_ROOT, DEFAULT_RUNTIME_RETENTION_DAYS } from "../config.js";

const DEFAULT_TARGET_ROOTS = [
  LOGS_ROOT,
  path.join(DATA_ROOT, "smoke"),
  REAL_SURFACE_VALIDATION_ROOT
];

async function listFiles(rootPath) {
  const collected = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootPath, {
      withFileTypes: true
    });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await listFiles(fullPath)));
    } else {
      collected.push(fullPath);
    }
  }
  return collected;
}

export async function pruneRuntimeData({
  roots = DEFAULT_TARGET_ROOTS,
  olderThanDays = DEFAULT_RUNTIME_RETENTION_DAYS,
  now = Date.now()
} = {}) {
  const threshold = now - (olderThanDays * 24 * 60 * 60 * 1000);
  const deleted = [];
  const kept = [];

  for (const root of roots) {
    for (const filePath of await listFiles(root)) {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < threshold) {
        await fs.rm(filePath, {
          force: true,
          recursive: false
        });
        deleted.push(filePath);
      } else {
        kept.push(filePath);
      }
    }
  }

  return {
    olderThanDays,
    deletedCount: deleted.length,
    keptCount: kept.length,
    deleted,
    kept
  };
}

