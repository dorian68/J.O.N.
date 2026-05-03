import assert from "node:assert/strict";
import { ComputerControlService } from "../src/computer/computer-control-service.js";
import { DesktopRunWatcher } from "../src/computer/desktop-run-watcher.js";
import { FakeWindowProvider } from "../src/computer/fake-window-provider.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run() {
  const provider = new FakeWindowProvider([
    {
      id: "win_notes",
      title: "Notes",
      active: true,
      content: "draft",
      controls: [
        {
          id: "continue_button",
          name: "Continue",
          controlType: "ControlType.Button"
        }
      ]
    },
    {
      id: "win_browser",
      title: "Browser",
      active: false,
      content: "search results"
    }
  ]);
  const computer = new ComputerControlService(provider);
  const watcher = new DesktopRunWatcher({
    computer,
    intervalMs: 25
  });

  try {
    await watcher.start();
    assert.equal(watcher.getLatestSnapshot()?.activeWindow?.id, "win_notes");

    provider.focusWindow("win_browser");
    await sleep(80);
    await watcher.observeNow();

    const changes = watcher.consumeChanges();
    assert.equal(changes.length >= 1, true);
    assert.equal(changes.at(-1).reasons.includes("active_window_changed"), true);
    assert.equal(changes.at(-1).after.activeWindow.id, "win_browser");

    await watcher.markBaseline();
    provider.mutateWindow("win_browser", { content: "search results updated" });
    await watcher.observeNow();
    const contentChanges = watcher.consumeChanges();
    assert.equal(contentChanges.length, 1);
    assert.equal(contentChanges[0].reasons.includes("active_content_changed"), true);
  } finally {
    await watcher.stop();
  }
}
