export function normalizeSecretValue(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim().replace(/[\r\n\t]+/g, "");
}
