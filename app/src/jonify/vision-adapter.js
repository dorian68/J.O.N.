// Vision adapter — JON-ify by SIGHT, for apps that expose no accessibility tree
// and no CLI (e.g. some Electron apps). Capture a screenshot → OCR (word/line
// bounding boxes) → coordinate-targeted candidate actions. Vision is inherently
// uncertain, so EVERY vision action requires confirmation and human review; JON
// never auto-clicks a blindly-detected control.

function slug(s) { return String(s ?? "el").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "el"; }

// Pure: turn an OCR result + the window's screen rect into a DOM-like summary.
// ocr = { available, words?:[{text,bounds:{x,y,width,height}}], lines?:[{text,words:[...]}] }
// window = { x, y } screen offset of the captured window (OCR coords are window-relative).
export function ocrToSummary(ocr, { window = {}, title = null, appName = null } = {}) {
  const offX = Number(window.x ?? 0);
  const offY = Number(window.y ?? 0);
  const lines = ocr?.lines ?? [];
  const seen = new Set();
  const interactive = [];

  for (const line of lines) {
    const text = String(line.text ?? "").trim();
    const wordCount = (line.words ?? []).length || text.split(/\s+/).length;
    // Button-like: short, few words, not an empty/numeric blob.
    if (!text || text.length > 30 || wordCount > 4 || /^[\d\s.,:%/-]+$/.test(text)) continue;
    const bounds = (line.words ?? []).reduce((acc, w) => {
      const b = w.bounds ?? {}; if (b.x == null) return acc;
      const x1 = b.x, y1 = b.y, x2 = b.x + (b.width ?? 0), y2 = b.y + (b.height ?? 0);
      return { x1: Math.min(acc.x1, x1), y1: Math.min(acc.y1, y1), x2: Math.max(acc.x2, x2), y2: Math.max(acc.y2, y2) };
    }, { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
    if (!Number.isFinite(bounds.x1)) continue;
    const cx = Math.round(offX + (bounds.x1 + bounds.x2) / 2);
    const cy = Math.round(offY + (bounds.y1 + bounds.y2) / 2);
    const id = slug(text);
    if (seen.has(id)) continue; seen.add(id);
    interactive.push({
      kind: "button", tag: "button", label: text, source: "vision",
      point: { x: cx, y: cy },
      preferredSelector: `point=${cx},${cy}`,
      selectorCandidates: [`point=${cx},${cy}`, `text=${text}`]
    });
  }

  return {
    url: null,
    title: title ?? appName ?? "App (vision)",
    headings: title ? [{ level: 1, text: title }] : [],
    interactive,
    buttons: interactive, links: [], inputs: [],
    forms: [], banners: [], navLinks: [],
    counts: { interactive: interactive.length, forms: 0, banners: 0, navLinks: 0 },
    environment: "vision"
  };
}

// Observe a real window by sight: screenshot → OCR → summary.
export async function observeVisionWindow(computer, windowId, { title = null, appName = null } = {}) {
  const windows = await computer.listVisibleWindows().catch(() => []);
  const win = windows.find((w) => String(w.id) === String(windowId)) ?? {};
  const capture = await computer.captureWindow(windowId);
  const ocr = await computer.extractTextFromImage(capture?.outputPath).catch(() => ({ available: false }));
  if (ocr?.available === false) {
    return { pages: [{ url: null, summary: { ...ocrToSummary({ lines: [] }, { window: win, title: title ?? win.title, appName }), ocrUnavailable: true } }], primaryUrl: null };
  }
  const summary = ocrToSummary(ocr, { window: win, title: title ?? win.title, appName });
  return { pages: [{ url: null, summary }], primaryUrl: null, screenshotPath: capture?.outputPath ?? null };
}

// Execute vision actions by coordinate (click / type-after-click).
export class VisionWorkflowAdapter {
  constructor({ computer, windowId } = {}) {
    if (!computer) throw new Error("VisionWorkflowAdapter requires a computer (ComputerControlService).");
    if (!windowId) throw new Error("VisionWorkflowAdapter requires a windowId.");
    this.computer = computer;
    this.windowId = String(windowId);
  }
  #point(selector) {
    const m = String(selector ?? "").match(/^point=(-?\d+),(-?\d+)$/);
    if (!m) throw new Error(`Vision adapter needs a point= selector, got: ${selector}`);
    return { x: Number(m[1]), y: Number(m[2]) };
  }
  async navigate(selector) { return this.click(selector); }
  async click(selector) { const r = await this.computer.clickPoint(this.windowId, this.#point(selector)); return { ok: r?.ok !== false, click: r }; }
  async type(selector, value) {
    await this.computer.clickPoint(this.windowId, this.#point(selector)).catch(() => {});
    const r = await this.computer.typeText(this.windowId, String(value ?? ""));
    return { ok: r?.ok !== false, typed: r };
  }
  async capture() { const c = await this.computer.captureWindow(this.windowId).catch(() => null); return c?.outputPath ? { ok: true, path: c.outputPath } : null; }
  async close() {}
}

export function createVisionWorkflowAdapter(options = {}) { return new VisionWorkflowAdapter(options); }
