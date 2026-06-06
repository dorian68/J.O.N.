// V4 — Desktop adapter.
//
// Turns a Windows UI Automation accessibility tree (already produced by JON via
// windows-control.ps1 / ComputerControlService.inspectAccessibilityTree) into the
// SAME DOM-summary shape the web observer emits — so the identical JON-ify
// pipeline (surfaces → actions → workflows → manifest) works on a desktop window.
// The Linux/AT-SPI adapter would emit the same shape from roles+actions.

function controlType(node) {
  return String(node?.controlType ?? node?.ControlType ?? "").replace(/^ControlType\./, "");
}

const BUTTONISH = new Set(["Button", "SplitButton", "MenuItem", "ListItem"]);
const INPUTISH = new Set(["Edit", "Document", "ComboBox", "Spinner", "PasswordBox"]);
const NAVISH = new Set(["TabItem", "TreeItem"]);
const LINKISH = new Set(["Hyperlink"]);

function slug(s) { return String(s ?? "el").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "el"; }
function selectorFor(node) {
  if (node.automationId) return `automationId=${node.automationId}`;
  if (node.name) return `name=${node.name}`;
  return `controlType=${controlType(node)}`;
}

function walk(node, acc) {
  if (!node || typeof node !== "object") return;
  const type = controlType(node);
  const name = node.name ?? node.Name ?? null;
  const base = { label: name, name: node.automationId ?? null, testId: node.automationId ?? null, id: slug(name || node.automationId || type) };
  if (BUTTONISH.has(type)) acc.buttons.push({ ...base, kind: "button", tag: "button", type: "button", uiaPattern: "invoke", preferredSelector: selectorFor(node), selectorCandidates: [selectorFor(node)] });
  else if (LINKISH.has(type)) acc.links.push({ ...base, kind: "link", tag: "a", href: null, preferredSelector: selectorFor(node), selectorCandidates: [selectorFor(node)] });
  else if (INPUTISH.has(type)) acc.inputs.push({ ...base, kind: "input", tag: "input", type: type === "PasswordBox" ? "password" : "text", uiaPattern: "value", preferredSelector: selectorFor(node), selectorCandidates: [selectorFor(node)] });
  else if (NAVISH.has(type)) acc.navLinks.push({ label: name, href: null, testId: node.automationId ?? null });
  for (const child of node.children ?? node.Children ?? []) walk(child, acc);
}

// accessibility: the inspectAccessibilityTree result ({ tree } or a raw node).
export function accessibilityTreeToSummary(accessibility, { title = null, appName = null } = {}) {
  const root = accessibility?.tree ?? accessibility ?? {};
  const acc = { buttons: [], links: [], inputs: [], navLinks: [] };
  walk(root, acc);
  const interactive = [...acc.buttons, ...acc.links, ...acc.inputs];

  // Synthesize one implicit "form" from the edit controls so create/submit
  // workflows can infer inputs (UIA rarely exposes a real <form>).
  const forms = acc.inputs.length ? [{
    id: "form-1", action: null, method: "desktop", testId: null,
    inputs: acc.inputs.map((i) => ({ type: i.type, name: i.label ?? i.id, required: false })),
    requiredInputs: [],
    submitLabel: acc.buttons.find((b) => /save|ok|submit|enregistrer|valider/i.test(b.label ?? ""))?.label ?? null
  }] : [];

  return {
    url: null,
    title: title ?? appName ?? "Desktop app",
    headings: title ? [{ level: 1, text: title }] : [],
    interactive,
    buttons: acc.buttons, links: acc.links, inputs: acc.inputs,
    forms, banners: [], navLinks: acc.navLinks,
    counts: { interactive: interactive.length, forms: forms.length, banners: 0, navLinks: acc.navLinks.length },
    environment: "desktop"
  };
}

export function observeAccessibility(accessibility, { title = null, appName = null } = {}) {
  const summary = accessibilityTreeToSummary(accessibility, { title, appName });
  return { pages: [{ url: null, summary }], primaryUrl: null };
}
