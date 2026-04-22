import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nowIso } from "../utils/ids.js";
import { ensureDir, isPathInside, sanitizeFilename, writeJson } from "../utils/files.js";

export const FILE_PRIMITIVES = Object.freeze([
  "list_directory",
  "read_text_file",
  "create_text_file",
  "write_text_file",
  "copy_path",
  "rename_path",
  "move_path",
  "delete_path"
]);

const USER_HOME = os.homedir();
const SYSTEM_BLOCKED_ROOTS = Object.freeze([
  process.env.WINDIR,
  process.env.ProgramFiles,
  process.env["ProgramFiles(x86)"],
  path.parse(USER_HOME).root
].filter(Boolean).map((entry) => path.resolve(entry)));

function normalizeText(value, maxLength = 120_000) {
  return String(value ?? "").replace(/\r\n/g, "\n").slice(0, maxLength);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function expandKnownPath(value = "") {
  let candidate = String(value ?? "").trim();
  if (!candidate) {
    return "";
  }
  candidate = candidate
    .replace(/^~(?=\\|\/|$)/, USER_HOME)
    .replace(/^%USERPROFILE%/i, USER_HOME);
  if (/^(desktop|bureau)$/i.test(candidate)) {
    return path.join(USER_HOME, "Desktop");
  }
  if (/^(documents)$/i.test(candidate)) {
    return path.join(USER_HOME, "Documents");
  }
  if (/^(downloads|telechargements|téléchargements)$/i.test(candidate)) {
    return path.join(USER_HOME, "Downloads");
  }
  return candidate;
}

export function resolveFileTarget(rawPath, { baseDir = USER_HOME } = {}) {
  const expanded = expandKnownPath(rawPath);
  if (!expanded) {
    throw new Error("File primitive target.path is required.");
  }
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded));
}

function criticalPathReason(targetPath) {
  const resolved = path.resolve(targetPath);
  for (const root of SYSTEM_BLOCKED_ROOTS) {
    if (resolved === root) {
      return `Refusing to operate on protected root: ${root}`;
    }
    if (root !== path.parse(root).root && isPathInside(root, resolved)) {
      return `Refusing to operate inside protected system path: ${root}`;
    }
  }
  if (resolved === USER_HOME) {
    return "Refusing to operate on the user profile root directly.";
  }
  return null;
}

async function copyRecursive(source, destination) {
  const stats = await fs.stat(source);
  if (stats.isDirectory()) {
    await ensureDir(destination);
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  await ensureDir(path.dirname(destination));
  await fs.copyFile(source, destination);
}

async function snapshotPath(targetPath, rollbackRoot, reason) {
  const exists = await pathExists(targetPath);
  const snapshot = {
    reason,
    targetPath,
    existedBefore: exists,
    backupPath: null,
    createdAt: nowIso()
  };
  if (!exists) {
    return snapshot;
  }
  const safeName = sanitizeFilename(path.basename(targetPath) || "root") || "path";
  const backupPath = path.join(rollbackRoot, `${Date.now()}-${safeName}`);
  await copyRecursive(targetPath, backupPath);
  snapshot.backupPath = backupPath;
  return snapshot;
}

async function rollbackInstructionFile(rollbackRoot, primitive, snapshots = [], extra = {}) {
  await ensureDir(rollbackRoot);
  const rollbackId = `${Date.now()}-${primitive}`;
  const manifestPath = path.join(rollbackRoot, `${rollbackId}.json`);
  const manifest = {
    primitive,
    createdAt: nowIso(),
    snapshots,
    instructions: "Rollback is manual-reviewable: restore backupPath over targetPath, or remove targetPath when existedBefore=false.",
    ...extra
  };
  await writeJson(manifestPath, manifest);
  return { manifestPath, manifest };
}

async function listDirectory(targetPath, { maxEntries = 80 } = {}) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  return entries.slice(0, maxEntries).map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
  }));
}

function assertSafePath(targetPath, { allowDestructive = false } = {}) {
  const reason = criticalPathReason(targetPath);
  if (reason) {
    throw new Error(reason);
  }
  if (!allowDestructive && targetPath === path.parse(targetPath).root) {
    throw new Error("Refusing to operate on a drive root.");
  }
}

export async function executeFilePrimitive(step, { runDir, baseDir = USER_HOME } = {}) {
  const primitive = String(step?.primitive ?? "").trim();
  if (!FILE_PRIMITIVES.includes(primitive)) {
    throw new Error(`Unsupported file primitive: ${primitive}`);
  }
  const rollbackRoot = path.join(runDir, "rollback");
  const targetPath = resolveFileTarget(step?.target?.path ?? step?.input?.path, { baseDir });
  assertSafePath(targetPath, { allowDestructive: primitive !== "delete_path" });

  if (primitive === "list_directory") {
    const entries = await listDirectory(targetPath, {
      maxEntries: Number(step?.input?.maxEntries ?? 80)
    });
    return {
      ok: true,
      primitive,
      targetPath,
      entryCount: entries.length,
      entries
    };
  }

  if (primitive === "read_text_file") {
    const text = await fs.readFile(targetPath, "utf8");
    return {
      ok: true,
      primitive,
      targetPath,
      byteLength: Buffer.byteLength(text, "utf8"),
      preview: normalizeText(text, 4000)
    };
  }

  if (primitive === "create_text_file") {
    const overwrite = step?.input?.overwrite === true;
    const exists = await pathExists(targetPath);
    if (exists && !overwrite) {
      throw new Error(`Target file already exists: ${targetPath}`);
    }
    const snapshots = [await snapshotPath(targetPath, rollbackRoot, "before_create_text_file")];
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, normalizeText(step?.input?.content ?? ""), "utf8");
    const rollback = await rollbackInstructionFile(rollbackRoot, primitive, snapshots, {
      targetPath
    });
    return {
      ok: true,
      primitive,
      targetPath,
      rollback,
      created: !exists,
      overwritten: exists
    };
  }

  if (primitive === "write_text_file") {
    const snapshots = [await snapshotPath(targetPath, rollbackRoot, "before_write_text_file")];
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, normalizeText(step?.input?.content ?? ""), "utf8");
    const rollback = await rollbackInstructionFile(rollbackRoot, primitive, snapshots, {
      targetPath
    });
    return {
      ok: true,
      primitive,
      targetPath,
      rollback
    };
  }

  if (primitive === "copy_path") {
    const destinationPath = resolveFileTarget(step?.target?.destinationPath ?? step?.input?.destinationPath, { baseDir });
    assertSafePath(destinationPath);
    const exists = await pathExists(destinationPath);
    if (exists && step?.input?.overwrite !== true) {
      throw new Error(`Destination already exists: ${destinationPath}`);
    }
    const snapshots = [await snapshotPath(destinationPath, rollbackRoot, "before_copy_path_destination")];
    await copyRecursive(targetPath, destinationPath);
    const rollback = await rollbackInstructionFile(rollbackRoot, primitive, snapshots, {
      sourcePath: targetPath,
      destinationPath
    });
    return {
      ok: true,
      primitive,
      sourcePath: targetPath,
      destinationPath,
      rollback
    };
  }

  if (primitive === "rename_path" || primitive === "move_path") {
    const destinationPath = resolveFileTarget(
      step?.target?.destinationPath ?? step?.target?.newPath ?? step?.input?.destinationPath ?? step?.input?.newPath,
      { baseDir: primitive === "rename_path" ? path.dirname(targetPath) : baseDir }
    );
    assertSafePath(destinationPath);
    if (await pathExists(destinationPath)) {
      throw new Error(`Destination already exists: ${destinationPath}`);
    }
    const snapshots = [await snapshotPath(targetPath, rollbackRoot, `before_${primitive}`)];
    await ensureDir(path.dirname(destinationPath));
    await fs.rename(targetPath, destinationPath);
    const rollback = await rollbackInstructionFile(rollbackRoot, primitive, snapshots, {
      sourcePath: targetPath,
      destinationPath
    });
    return {
      ok: true,
      primitive,
      sourcePath: targetPath,
      destinationPath,
      rollback
    };
  }

  if (primitive === "delete_path") {
    assertSafePath(targetPath, { allowDestructive: true });
    const snapshots = [await snapshotPath(targetPath, rollbackRoot, "before_delete_path")];
    await fs.rm(targetPath, {
      recursive: true,
      force: false
    });
    const rollback = await rollbackInstructionFile(rollbackRoot, primitive, snapshots, {
      targetPath
    });
    return {
      ok: true,
      primitive,
      targetPath,
      rollback
    };
  }

  throw new Error(`Unhandled file primitive: ${primitive}`);
}
