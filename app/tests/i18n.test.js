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
  for (const key of [
    "executionTools",
    "toolStatusPlanned",
    "toolStatusRunning",
    "toolStatusSucceeded",
    "toolStatusFailed",
    "toolStatusSkipped",
    "terminalAskBeforeSending",
    "terminalAskBeforeSendingSet"
  ]) {
    assert.equal(Boolean(fr[key]), true, `${key} should exist in French`);
    assert.equal(Boolean(en[key]), true, `${key} should exist in English`);
  }
  assert.equal(fr.executionTools, "Outils utilisés");
  assert.equal(en.executionTools, "Tools used");

  assert.equal(Boolean(formatTime("2026-04-22T12:34:56.000Z", "fr")), true);
  assert.equal(formatTime("not-a-date", "en"), "");
}
