import crypto from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}
