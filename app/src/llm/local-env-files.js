import fs from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, REPO_ROOT } from "../config.js";

const DEFAULT_ENV_FILE_CANDIDATES = Object.freeze([
  path.join(REPO_ROOT, ".env"),
  path.join(APP_ROOT, ".env"),
  path.join(REPO_ROOT, ".env.local"),
  path.join(APP_ROOT, ".env.local")
]);

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvText(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1);
    result[key] = stripWrappingQuotes(rawValue);
  }
  return result;
}

export async function loadLocalEnvFiles({
  filePaths = DEFAULT_ENV_FILE_CANDIDATES
} = {}) {
  const values = {};
  const loadedFiles = [];

  for (const filePath of filePaths) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      Object.assign(values, parseEnvText(content));
      loadedFiles.push(filePath);
    } catch {
      continue;
    }
  }

  return {
    values,
    loadedFiles
  };
}

export function getDefaultLocalEnvFilePaths() {
  return [...DEFAULT_ENV_FILE_CANDIDATES];
}
