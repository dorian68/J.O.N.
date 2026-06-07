// App classifier — the "intelligence" of JON-ify. Given a target (URL, CLI binary,
// or a desktop window + its UIA tree), decide WHAT kind of app it is and WHICH
// jonification method applies:
//   web      → DOM      (jonifyFromHtml / browser)
//   native   → UIA      (jonifyFromAccessibility + UIA execution)
//   electron → CLI or vision (Chromium renderer exposes nothing to UIA by default
//              — it only builds the a11y tree when a screen reader/AT client asks;
//              so prefer the app's CLI when it has one, else fall back to vision)
//   cli      → CLI      (jonifyCli from --help)

const ELECTRON_HINT = /docker desktop|visual studio code|\bvscode\b|\bcode\b|slack|discord|microsoft teams|\bteams\b|spotify|notion|figma|postman|obsidian|whatsapp|signal|1password|github desktop|electron/i;

// Electron/desktop apps that expose a real CLI — the robust way to operate them.
const KNOWN_CLI = [
  [/docker/i, "docker"],
  [/github desktop|\bgit\b/i, "git"],
  [/visual studio code|\bvscode\b|\bcode\b/i, "code"],
  [/\bnpm\b/i, "npm"],
  [/kubernetes|kubectl/i, "kubectl"]
];

function countUiaControls(accessibility) {
  const root = accessibility?.tree ?? null;
  if (!root) return 0;
  let n = 0;
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.controlType || node.ControlType) n += 1;
    for (const c of node.children ?? node.Children ?? []) walk(c);
  })(root);
  return n;
}

function knownCliFor(text) {
  for (const [re, bin] of KNOWN_CLI) if (re.test(text)) return bin;
  return null;
}

export function classifyApp({ url = null, command = null, window = null } = {}) {
  if (command) {
    return { kind: "cli", method: "cli", cliBinary: String(command).split(/\s+/)[0], confidence: 0.95, reason: "Cible explicite : outil en ligne de commande." };
  }
  if (url) {
    return { kind: "web", method: "web-dom", confidence: 0.9, reason: "Cible URL → cartographie DOM via le navigateur." };
  }
  if (window) {
    const text = `${window.title ?? ""} ${window.processName ?? ""} ${window.exePath ?? ""}`;
    const uiaControls = countUiaControls(window.accessibility);
    const isElectron = ELECTRON_HINT.test(text);
    const cli = knownCliFor(text);

    if (isElectron) {
      if (cli) {
        return { kind: "electron", method: "cli", cliBinary: cli, confidence: 0.85,
          reason: `App Electron (« ${window.title ?? window.processName} ») : l'UI n'est pas exposée à UI Automation → utiliser sa CLI « ${cli} ».`,
          accessibilityHint: "Le renderer Chromium n'active l'accessibilité que si un lecteur d'écran est attaché." };
      }
      if (uiaControls > 0) {
        return { kind: "electron", method: "uia", confidence: 0.6, reason: "App Electron exposant partiellement UIA → tentative UIA." };
      }
      return { kind: "electron", method: "vision", confidence: 0.5,
        reason: "App Electron sans arbre d'accessibilité → repli sur la vision (capture + OCR).",
        accessibilityHint: "Aucun contrôle UIA exposé ; activer un client AT ou utiliser la vision." };
    }
    if (uiaControls > 0) {
      return { kind: "native-uia", method: "uia", confidence: 0.85, reason: `App native (${uiaControls} contrôles UIA) → UI Automation.` };
    }
    return { kind: "unknown", method: "vision", confidence: 0.4, reason: "Fenêtre sans contrôles UIA exploitables → repli vision (ou CLI si l'outil en a une)." };
  }
  return { kind: "unknown", method: "none", confidence: 0, reason: "Aucune cible fournie (url, command ou window)." };
}
