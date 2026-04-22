import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DATA_ROOT } from "../config.js";
import { createId, nowIso } from "../utils/ids.js";
import { ensureDir, writeText } from "../utils/files.js";

const CONVERSATION_ARTIFACT_ROOT = path.join(DATA_ROOT, "conversation-artifacts");

function cleanText(value, maxLength = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function desktopPath() {
  return path.join(os.homedir(), "Desktop");
}

function safeDesktopPathLabel(fullPath) {
  const desktop = desktopPath();
  const relative = path.relative(desktop, fullPath);
  return relative && !relative.startsWith("..") ? `Desktop\\${relative}` : "Desktop";
}

async function inspectDesktopFolders() {
  const root = desktopPath();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const folders = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).slice(0, 80)) {
    const fullPath = path.join(root, entry.name);
    const stats = await fs.stat(fullPath).catch(() => null);
    folders.push({
      name: entry.name,
      pathLabel: safeDesktopPathLabel(fullPath),
      modifiedAt: stats?.mtime ? stats.mtime.toISOString() : "",
      itemCount: null
    });
  }
  folders.sort((left, right) => left.name.localeCompare(right.name, "fr"));
  return {
    text: folders.length === 0
      ? "Je n’ai trouvé aucun dossier de premier niveau sur le Bureau."
      : `J’ai trouvé ${folders.length} dossier(s) de premier niveau sur le Bureau.`,
    uiBlocks: [{
      type: "folderList",
      title: "Dossiers sur le Bureau",
      rootLabel: "Desktop",
      folders
    }],
    capabilityResult: {
      id: "inspect_desktop_folders",
      status: "completed",
      inspectedPathLabel: "Desktop",
      folderCount: folders.length
    }
  };
}

function installedAppRows(applications = []) {
  return applications.slice(0, 40).map((app) => ({
    Application: app.label ?? app.id ?? "Application",
    Type: app.kind ?? "application",
    Source: app.source ?? "local_provider"
  }));
}

async function runListInstalledApplicationsCapability({ listInstalledApplications, listInstalledBrowsers }) {
  const applications = await listInstalledApplications();
  const browsers = await listInstalledBrowsers();
  const appRows = installedAppRows(applications);
  return {
    text: `J’ai détecté ${applications.length} application(s) et ${browsers.length} navigateur(s) via le provider local.`,
    uiBlocks: [
      {
        type: "metricCards",
        title: "Capacités locales détectées",
        metrics: [
          { label: "Applications", value: String(applications.length), caption: "Catalogue local" },
          { label: "Navigateurs", value: String(browsers.length), caption: "Lançables après confirmation" }
        ]
      },
      {
        type: "table",
        title: "Applications détectées",
        columns: ["Application", "Type", "Source"],
        rows: appRows
      }
    ],
    capabilityResult: {
      id: "list_installed_applications",
      status: "completed",
      applicationCount: applications.length,
      browserCount: browsers.length
    }
  };
}

async function runListInstalledBrowsersCapability({ listInstalledBrowsers }) {
  const browsers = await listInstalledBrowsers();
  return {
    text: browsers.length === 0
      ? "Je n’ai trouvé aucun navigateur supporté via le provider local."
      : `J’ai trouvé ${browsers.length} navigateur(s) supporté(s).`,
    uiBlocks: [{
      type: "table",
      title: "Navigateurs disponibles",
      columns: ["Navigateur", "Process", "Source"],
      rows: browsers.map((browser) => ({
        Navigateur: browser.label ?? browser.id,
        Process: browser.processName ?? "",
        Source: browser.executablePath ? "détecté localement" : "catalogue provider"
      }))
    }],
    capabilityResult: {
      id: "list_installed_browsers",
      status: "completed",
      browserCount: browsers.length
    }
  };
}

async function generateReportPreview(request = {}) {
  const topic = cleanText(request.parameters?.topic ?? "Rapport demandé", 260);
  const createdAt = nowIso();
  const artifactId = createId("conv_art");
  await ensureDir(CONVERSATION_ARTIFACT_ROOT);
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; font-family: Aptos, Segoe UI, sans-serif; background: #fffdf8; color: #1f1c17; }
    main { padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -0.03em; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0; }
    .card { border: 1px solid #e3d8c8; border-radius: 16px; padding: 14px; background: #fff8ed; }
    .value { font-size: 28px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #eadfce; }
    small, p { color: #6f6659; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(topic)}</h1>
    <small>Prévisualisation contrôlée générée le ${escapeHtml(createdAt)}</small>
    <section class="grid">
      <div class="card"><span>Sources validées</span><div class="value">0</div><small>À collecter via action confirmée.</small></div>
      <div class="card"><span>Artefact</span><div class="value">1</div><small>HTML sandboxé + Markdown.</small></div>
      <div class="card"><span>Preuves</span><div class="value">0</div><small>Non collectées.</small></div>
    </section>
    <p>Ce rapport est un template contrôlé. Pour devenir probant, il doit être relié à des sources, captures ou runs vérifiés.</p>
    <table>
      <thead><tr><th>Section</th><th>Statut</th><th>Prochaine action</th></tr></thead>
      <tbody>
        <tr><td>Synthèse</td><td>Brouillon</td><td>Préciser les sources</td></tr>
        <tr><td>Métriques</td><td>À collecter</td><td>Lancer une action confirmée</td></tr>
        <tr><td>Preuves</td><td>Manquantes</td><td>Capturer ou attacher l'évidence</td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>`;
  const markdown = [
    `# ${topic}`,
    "",
    `Generated at: ${createdAt}`,
    "",
    "## Summary",
    "",
    "This is a controlled report preview generated by Cowork as structured UI blocks. It is not arbitrary inline HTML.",
    "",
    "## Next useful checks",
    "",
    "- Define the source data to inspect.",
    "- Run a bounded mission if desktop or browser evidence is needed.",
    "- Attach proof artifacts before treating the report as validated."
  ].join("\n");
  const storagePath = path.join(CONVERSATION_ARTIFACT_ROOT, `${artifactId}.md`);
  const htmlStoragePath = path.join(CONVERSATION_ARTIFACT_ROOT, `${artifactId}.html`);
  await writeText(storagePath, markdown);
  await writeText(htmlStoragePath, html);
  return {
    text: "J’ai préparé une prévisualisation de rapport contrôlée. Pour un rapport validé, il faudra ensuite connecter des sources ou preuves réelles.",
    uiBlocks: [
      {
        type: "reportPreview",
        title: topic,
        summary: "Prévisualisation structurée générée sans HTML arbitraire inline.",
        htmlPreview: html,
        sections: [
          "Synthèse",
          "Métriques disponibles",
          "Points à vérifier",
          "Prochain run recommandé si preuve nécessaire"
        ]
      },
      {
        type: "metricCards",
        title: "Statut du rapport",
        metrics: [
          { label: "Sources validées", value: "0", caption: "À collecter via action confirmée", tone: "warn" },
          { label: "Artefact", value: "1", caption: "Markdown local", tone: "ok" },
          { label: "Preuves", value: "0", caption: "Non collectées" }
        ]
      },
      {
        type: "artifactCard",
        title: "Rapport preview",
        description: "Artefact Markdown + HTML sandboxé, généré par template contrôlé.",
        artifactId,
        href: `/api/conversation/artifacts/${artifactId}/content`,
        format: "html+markdown"
      }
    ],
    capabilityResult: {
      id: "generate_report_preview",
      status: "completed",
      artifactId,
      storagePath,
      htmlStoragePath
    }
  };
}

export async function executeSafeConversationCapabilities({
  requests = [],
  listInstalledApplications = async () => [],
  listInstalledBrowsers = async () => []
} = {}) {
  const uiBlocks = [];
  const resultTexts = [];
  const capabilityResults = [];
  for (const request of requests) {
    let result = null;
    if (request.id === "inspect_desktop_folders") {
      result = await inspectDesktopFolders(request);
    } else if (request.id === "list_installed_applications") {
      result = await runListInstalledApplicationsCapability({ listInstalledApplications, listInstalledBrowsers });
    } else if (request.id === "list_installed_browsers") {
      result = await runListInstalledBrowsersCapability({ listInstalledBrowsers });
    } else if (request.id === "generate_report_preview") {
      result = await generateReportPreview(request);
    }
    if (!result) {
      continue;
    }
    resultTexts.push(result.text);
    uiBlocks.push(...(result.uiBlocks ?? []));
    capabilityResults.push(result.capabilityResult);
  }
  return {
    text: resultTexts.join(" "),
    uiBlocks,
    capabilityResults
  };
}

export async function readConversationArtifact(artifactId) {
  const normalizedId = cleanText(artifactId, 120);
  if (!/^conv_art_[a-z0-9]+/i.test(normalizedId)) {
    return null;
  }
  const storagePath = path.join(CONVERSATION_ARTIFACT_ROOT, `${normalizedId}.md`);
  const htmlPath = path.join(CONVERSATION_ARTIFACT_ROOT, `${normalizedId}.html`);
  const content = await fs.readFile(storagePath, "utf8").catch(() => null);
  const html = await fs.readFile(htmlPath, "utf8").catch(() => null);
  return content == null
    ? null
    : {
      artifact: {
        id: normalizedId,
        title: "Conversation report preview",
        format: html ? "html+markdown" : "markdown"
      },
      content,
      html
    };
}
