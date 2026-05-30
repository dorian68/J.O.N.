const UI_BLOCK_TYPES = Object.freeze([
  "text",
  "folderList",
  "table",
  "metricCards",
  "chart",
  "reportPreview",
  "artifactCard",
  "artifactPreview",
  "approvalCard",
  "actionPlan",
  "evidenceGallery",
  "resultSummary",
  "proofCard",
  "browserResultList",
  "terminalPromptCard",
  "errorRecoveryCard",
  "nextStepCard"
]);

function cleanText(value, maxLength = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 12, maxLength = 260) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => cleanText(entry, maxLength)).filter(Boolean).slice(0, maxItems);
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeBlockId(block, index) {
  return cleanText(block.id, 80) || `block_${index + 1}`;
}

function normalizeTextBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "text",
    tone: cleanText(block.tone, 24) || "neutral",
    title: cleanText(block.title, 120),
    text: cleanText(block.text ?? block.body, 1800)
  };
}

function normalizeFolderListBlock(block, index) {
  const folders = Array.isArray(block.folders) ? block.folders : [];
  return {
    id: normalizeBlockId(block, index),
    type: "folderList",
    title: cleanText(block.title, 120) || "Dossiers",
    rootLabel: cleanText(block.rootLabel, 180),
    folders: folders.slice(0, 80).map((folder) => {
      const entry = cleanObject(folder);
      return {
        name: cleanText(entry.name, 180),
        pathLabel: cleanText(entry.pathLabel, 260),
        modifiedAt: cleanText(entry.modifiedAt, 80),
        itemCount: Number.isFinite(Number(entry.itemCount)) ? Number(entry.itemCount) : null
      };
    }).filter((folder) => folder.name)
  };
}

function normalizeTableBlock(block, index) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  return {
    id: normalizeBlockId(block, index),
    type: "table",
    title: cleanText(block.title, 120),
    columns: columns.slice(0, 8).map((column) => cleanText(column, 80)).filter(Boolean),
    rows: rows.slice(0, 40).map((row) => {
      if (Array.isArray(row)) {
        return row.slice(0, 8).map((cell) => cleanText(cell, 220));
      }
      const objectRow = cleanObject(row);
      return columns.slice(0, 8).map((column) => cleanText(objectRow[column], 220));
    })
  };
}

function normalizeMetricCardsBlock(block, index) {
  const metrics = Array.isArray(block.metrics) ? block.metrics : [];
  return {
    id: normalizeBlockId(block, index),
    type: "metricCards",
    title: cleanText(block.title, 120),
    metrics: metrics.slice(0, 8).map((metric) => {
      const entry = cleanObject(metric);
      return {
        label: cleanText(entry.label, 80),
        value: cleanText(entry.value, 80),
        caption: cleanText(entry.caption, 180),
        tone: cleanText(entry.tone, 24) || "neutral"
      };
    }).filter((metric) => metric.label || metric.value)
  };
}

function normalizeChartBlock(block, index) {
  const points = Array.isArray(block.points) ? block.points : [];
  return {
    id: normalizeBlockId(block, index),
    type: "chart",
    title: cleanText(block.title, 120),
    chartType: cleanText(block.chartType, 40) || "bar",
    points: points.slice(0, 12).map((point) => {
      const entry = cleanObject(point);
      return {
        label: cleanText(entry.label, 80),
        value: Number.isFinite(Number(entry.value)) ? Number(entry.value) : 0
      };
    }).filter((point) => point.label)
  };
}

function normalizeReportPreviewBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "reportPreview",
    title: cleanText(block.title, 120) || "Rapport",
    summary: cleanText(block.summary, 1200),
    sections: cleanList(block.sections, 8, 260)
  };
}

function normalizeArtifactCardBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "artifactCard",
    title: cleanText(block.title, 120) || "Artefact",
    description: cleanText(block.description, 360),
    artifactId: cleanText(block.artifactId, 120),
    href: cleanText(block.href, 300),
    format: cleanText(block.format, 40) || "markdown"
  };
}

function normalizeApprovalCardBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "approvalCard",
    title: cleanText(block.title, 120) || "Approval",
    actionLabel: cleanText(block.actionLabel, 220),
    reason: cleanText(block.reason, 360),
    riskLevel: cleanText(block.riskLevel, 40)
  };
}

function normalizeActionPlanBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "actionPlan",
    title: cleanText(block.title, 120) || "Plan d’action",
    steps: cleanList(block.steps, 8, 260),
    checks: cleanList(block.checks, 8, 260),
    limitations: cleanList(block.limitations, 8, 260)
  };
}

function normalizeEvidenceGalleryBlock(block, index) {
  const items = Array.isArray(block.items) ? block.items : [];
  return {
    id: normalizeBlockId(block, index),
    type: "evidenceGallery",
    title: cleanText(block.title, 120) || "Preuves",
    items: items.slice(0, 12).map((item) => {
      const entry = cleanObject(item);
      return {
        label: cleanText(entry.label, 120),
        href: cleanText(entry.href, 300),
        kind: cleanText(entry.kind, 60)
      };
    }).filter((item) => item.label || item.href)
  };
}

function normalizeResultSummaryBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "resultSummary",
    title: cleanText(block.title, 120) || "Résumé du résultat",
    status: cleanText(block.status, 60),
    verdict: cleanText(block.verdict, 60),
    objectiveSatisfied: block.objectiveSatisfied === true,
    summary: cleanText(block.summary, 1200),
    bullets: cleanList(block.bullets, 8, 260)
  };
}

function normalizeProofCardBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "proofCard",
    title: cleanText(block.title, 120) || "Preuve",
    label: cleanText(block.label, 160),
    description: cleanText(block.description, 500),
    href: cleanText(block.href, 300),
    evidenceId: cleanText(block.evidenceId, 120),
    kind: cleanText(block.kind, 60)
  };
}

function normalizeBrowserResultListBlock(block, index) {
  const results = Array.isArray(block.results) ? block.results : [];
  return {
    id: normalizeBlockId(block, index),
    type: "browserResultList",
    title: cleanText(block.title, 120) || "Résultats web",
    results: results.slice(0, 12).map((result) => {
      const entry = cleanObject(result);
      return {
        title: cleanText(entry.title, 180),
        url: cleanText(entry.url ?? entry.href, 300),
        snippet: cleanText(entry.snippet ?? entry.description, 500),
        source: cleanText(entry.source ?? entry.domain, 120)
      };
    }).filter((result) => result.title || result.url || result.snippet)
  };
}

function normalizeTerminalPromptCardBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "terminalPromptCard",
    title: cleanText(block.title, 120) || "Terminal en attente",
    terminalId: cleanText(block.terminalId, 120),
    prompt: cleanText(block.prompt, 800),
    suggestedReply: cleanText(block.suggestedReply, 500),
    requiresApproval: block.requiresApproval !== false
  };
}

function normalizeArtifactPreviewBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "artifactPreview",
    title: cleanText(block.title, 120) || "Artefact",
    description: cleanText(block.description, 500),
    artifactId: cleanText(block.artifactId, 120),
    href: cleanText(block.href, 300),
    format: cleanText(block.format, 60)
  };
}

function normalizeErrorRecoveryCardBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "errorRecoveryCard",
    title: cleanText(block.title, 120) || "Récupération",
    blocker: cleanText(block.blocker, 700),
    recovery: cleanText(block.recovery, 700),
    retryable: Boolean(block.retryable)
  };
}

function normalizeNextStepCardBlock(block, index) {
  return {
    id: normalizeBlockId(block, index),
    type: "nextStepCard",
    title: cleanText(block.title, 120) || "Prochaine action",
    action: cleanText(block.action, 700),
    reason: cleanText(block.reason, 500)
  };
}

export function normalizeUiBlock(block, index = 0) {
  const candidate = cleanObject(block);
  const type = cleanText(candidate.type, 60);
  switch (type) {
    case "folderList":
      return normalizeFolderListBlock(candidate, index);
    case "table":
      return normalizeTableBlock(candidate, index);
    case "metricCards":
      return normalizeMetricCardsBlock(candidate, index);
    case "chart":
      return normalizeChartBlock(candidate, index);
    case "reportPreview":
      return normalizeReportPreviewBlock(candidate, index);
    case "artifactCard":
      return normalizeArtifactCardBlock(candidate, index);
    case "artifactPreview":
      return normalizeArtifactPreviewBlock(candidate, index);
    case "approvalCard":
      return normalizeApprovalCardBlock(candidate, index);
    case "actionPlan":
      return normalizeActionPlanBlock(candidate, index);
    case "evidenceGallery":
      return normalizeEvidenceGalleryBlock(candidate, index);
    case "resultSummary":
      return normalizeResultSummaryBlock(candidate, index);
    case "proofCard":
      return normalizeProofCardBlock(candidate, index);
    case "browserResultList":
      return normalizeBrowserResultListBlock(candidate, index);
    case "terminalPromptCard":
      return normalizeTerminalPromptCardBlock(candidate, index);
    case "errorRecoveryCard":
      return normalizeErrorRecoveryCardBlock(candidate, index);
    case "nextStepCard":
      return normalizeNextStepCardBlock(candidate, index);
    case "text":
    default:
      return normalizeTextBlock({ ...candidate, type: "text" }, index);
  }
}

export function normalizeUiBlocks(value, { fallbackText = "" } = {}) {
  const normalized = Array.isArray(value)
    ? value.map((block, index) => normalizeUiBlock(block, index))
    : [];
  const meaningful = normalized.filter((block) => {
    if (!UI_BLOCK_TYPES.includes(block.type)) {
      return false;
    }
    if (block.type === "text") {
      return Boolean(block.title || block.text);
    }
    return true;
  });
  if (meaningful.length > 0) {
    return meaningful.slice(0, 12);
  }
  const text = cleanText(fallbackText, 1800);
  return text
    ? [{ id: "fallback_text", type: "text", tone: "neutral", title: "", text }]
    : [];
}

export function uiBlockTypes() {
  return [...UI_BLOCK_TYPES];
}
