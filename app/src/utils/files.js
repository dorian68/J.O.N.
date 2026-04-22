import fs from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT, RUNS_ROOT } from "../config.js";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureDataDirs() {
  await ensureDir(DATA_ROOT);
  await ensureDir(RUNS_ROOT);
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, "utf8");
}

export function resolvePath(filePath) {
  return path.resolve(filePath);
}

export function isPathInside(rootPath, targetPath) {
  const root = resolvePath(rootPath);
  const target = resolvePath(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function removePathIfExists(targetPath, { recursive = false } = {}) {
  try {
    await fs.rm(targetPath, {
      force: true,
      recursive
    });
    return true;
  } catch {
    return false;
  }
}

export function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
