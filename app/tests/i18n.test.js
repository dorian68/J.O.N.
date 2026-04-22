import assert from "node:assert/strict";
import {
  SUPPORTED_LOCALES,
  formatTime,
  normalizeLocale,
  stringsForLocale
} from "../ui/src/i18n.js";

export async function run() {
  assert.deepEqual(SUPPORTED_LOCALES, ["fr", "en"]);
  assert.equal(normalizeLocale("fr-FR"), "fr");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("de-DE"), "fr");

  const fr = stringsForLocale("fr");
  const en = stringsForLocale("en");
  assert.equal(fr.send, "Envoyer");
  assert.equal(en.send, "Send");
  assert.equal(fr.conversations, "Conversations");
  assert.equal(en.conversations, "Conversations");
  assert.equal(Boolean(fr.confirmationNeeded), true);
  assert.equal(Boolean(en.confirmationNeeded), true);

  assert.equal(Boolean(formatTime("2026-04-22T12:34:56.000Z", "fr")), true);
  assert.equal(formatTime("not-a-date", "en"), "");
}
