import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { PrototypeDatabase } from "../src/storage/database.js";
import {
  USER_PREFERENCES_SETTING_KEY,
  defaultUserPreferences,
  inferUserPreferencePatchFromMessage,
  normalizeUserPreferences,
  selectPreferredBrowser,
  summarizeUserPreferences,
  updateUserPreferences
} from "../src/preferences/user-preferences.js";

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-preferences-"));
  return path.join(dir, "prototype.sqlite");
}

export async function run() {
  const browsers = [
    { id: "edge", label: "Microsoft Edge" },
    { id: "chrome", label: "Google Chrome" }
  ];

  const inferred = inferUserPreferencePatchFromMessage("J'utilise Edge comme navigateur par défaut.", {
    availableBrowsers: browsers
  });
  assert.equal(inferred.preferredBrowser.id, "edge");
  assert.equal(inferred.preferredBrowser.confidence > 0.9, true);

  const preferences = updateUserPreferences(defaultUserPreferences(), inferred);
  assert.equal(preferences.preferredBrowser.id, "edge");
  assert.equal(summarizeUserPreferences(preferences).preferredBrowser.label, "Microsoft Edge");

  const selected = selectPreferredBrowser(browsers, preferences);
  assert.equal(selected.browser.id, "edge");
  assert.equal(selected.preference.id, "edge");

  const unavailable = selectPreferredBrowser([{ id: "chrome", label: "Google Chrome" }], preferences);
  assert.equal(unavailable.browser, null);
  assert.equal(unavailable.unavailablePreference.id, "edge");

  const dbPath = await tempDbPath();
  const first = new PrototypeDatabase(dbPath);
  await first.open();
  first.upsertAppSetting(USER_PREFERENCES_SETTING_KEY, preferences);
  first.close();

  const second = new PrototypeDatabase(dbPath);
  await second.open();
  const restored = normalizeUserPreferences(
    second.getAppSetting(USER_PREFERENCES_SETTING_KEY, defaultUserPreferences()).value
  );
  assert.equal(restored.preferredBrowser.id, "edge");
  assert.equal(restored.preferredBrowser.label, "Microsoft Edge");
  second.close();
}
