const ACTIONABLE_CONTROL_TYPES = Object.freeze({
  "controltype.button": "button",
  "controltype.edit": "text_input",
  "controltype.document": "document",
  "controltype.hyperlink": "link",
  "controltype.menuitem": "menu_item",
  "controltype.checkbox": "checkbox",
  "controltype.radiobutton": "radio",
  "controltype.combobox": "combo_box",
  "controltype.listitem": "list_item",
  "controltype.tabitem": "tab",
  "controltype.treeitem": "tree_item",
  "controltype.window": "window",
  "controltype.pane": "pane"
});

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function centerOf(bounds) {
  const rect = safeBounds(bounds);
  if (!rect) {
    return null;
  }
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2)
  };
}

function controlRole(controlType) {
  const key = String(controlType ?? "").trim().toLowerCase();
  return ACTIONABLE_CONTROL_TYPES[key] ?? "unknown";
}

function nodeText(node) {
  return [
    node?.name,
    node?.automationId,
    node?.className,
    node?.controlType
  ]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function flattenAccessibilityTree(accessibility, options = {}) {
  const includeOffscreen = Boolean(options.includeOffscreen);
  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : 160;
  const root = accessibility?.tree ?? accessibility;
  const nodes = [];

  function visit(node, depth, pathParts) {
    if (!node || typeof node !== "object" || nodes.length >= maxNodes) {
      return;
    }
    if (node.isOffscreen && !includeOffscreen) {
      return;
    }
    const bounds = safeBounds(node.bounds);
    const name = String(node.name ?? "").trim();
    const automationId = String(node.automationId ?? "").trim();
    const role = controlRole(node.controlType);
    const path = [...pathParts, name || automationId || role].filter(Boolean).join(" > ");
    nodes.push({
      index: nodes.length,
      depth,
      path,
      name,
      automationId,
      className: String(node.className ?? "").trim(),
      controlType: String(node.controlType ?? "").trim(),
      role,
      isEnabled: node.isEnabled !== false,
      isOffscreen: Boolean(node.isOffscreen),
      bounds,
      center: centerOf(bounds),
      text: nodeText(node)
    });
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child, depth + 1, [...pathParts, name || automationId || role]);
    }
  }

  visit(root, 0, []);
  return nodes;
}

export function buildSemanticTargets(accessibility, options = {}) {
  return flattenAccessibilityTree(accessibility, options)
    .filter((node) => {
      if (!node.isEnabled || !node.center) {
        return false;
      }
      if (["button", "text_input", "link", "menu_item", "checkbox", "radio", "combo_box", "list_item", "tab", "tree_item"].includes(node.role)) {
        return true;
      }
      return Boolean(node.name || node.automationId) && node.role !== "unknown";
    })
    .map((node) => ({
      id: node.automationId || `node_${node.index}`,
      label: node.name || node.automationId || node.role,
      role: node.role,
      controlType: node.controlType,
      bounds: node.bounds,
      center: node.center,
      path: node.path,
      confidenceBasis: [
        node.name ? "name" : null,
        node.automationId ? "automation_id" : null,
        node.controlType ? "control_type" : null,
        node.bounds ? "bounds" : null
      ].filter(Boolean)
    }));
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(/\s+/).filter(Boolean));
}

function overlapScore(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function resolveSemanticTarget(accessibility, selector = {}, options = {}) {
  const query = String(selector.query ?? selector.label ?? selector.name ?? "").trim();
  const preferredRole = String(selector.role ?? "").trim();
  const automationId = String(selector.automationId ?? "").trim();
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.34;
  const targets = buildSemanticTargets(accessibility, {
    includeOffscreen: false,
    maxNodes: options.maxNodes ?? 180
  });

  if (automationId) {
    const exact = targets.find((target) => target.id === automationId);
    if (exact) {
      return {
        found: true,
        confidence: "high",
        score: 1,
        target: exact,
        candidates: targets.slice(0, 12),
        reason: "Matched by automation id."
      };
    }
  }

  const scored = targets
    .map((target) => {
      const text = [target.label, target.id, target.path, target.role].join(" ");
      const roleBoost = preferredRole && preferredRole === target.role ? 0.18 : 0;
      const exactBoost = query && normalizeText(target.label) === normalizeText(query) ? 0.32 : 0;
      return {
        target,
        score: overlapScore(query, text) + roleBoost + exactBoost
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored[0] ?? null;
  if (!best || best.score < minScore) {
    return {
      found: false,
      confidence: "none",
      score: best?.score ?? 0,
      target: null,
      candidates: scored.slice(0, 12).map((entry) => entry.target),
      reason: query
        ? `No visible semantic target matched "${query}" with enough confidence.`
        : "No semantic target query was provided."
    };
  }

  const secondScore = scored[1]?.score ?? 0;
  const confidence = best.score >= 0.78 || best.score - secondScore >= 0.2
    ? "high"
    : "medium";
  return {
    found: true,
    confidence,
    score: Number(best.score.toFixed(3)),
    target: best.target,
    candidates: scored.slice(0, 12).map((entry) => entry.target),
    reason: `Matched visible ${best.target.role} "${best.target.label}".`
  };
}

export function summarizeAccessibility(accessibility, options = {}) {
  const nodes = flattenAccessibilityTree(accessibility, {
    includeOffscreen: false,
    maxNodes: options.maxNodes ?? 120
  });
  const targets = buildSemanticTargets(accessibility, {
    maxNodes: options.maxNodes ?? 120
  });
  const roleCounts = {};
  for (const node of nodes) {
    roleCounts[node.role] = (roleCounts[node.role] ?? 0) + 1;
  }
  return {
    available: Boolean(accessibility?.available ?? accessibility?.tree),
    nodesReturned: nodes.length,
    roleCounts,
    visibleTextPreview: nodes
      .map((node) => node.name || node.automationId)
      .filter(Boolean)
      .slice(0, 24),
    semanticTargets: targets.slice(0, options.maxTargets ?? 24)
  };
}

export function compactAccessibilityForPrompt(accessibility, options = {}) {
  return summarizeAccessibility(accessibility, {
    maxNodes: options.maxNodes ?? 80,
    maxTargets: options.maxTargets ?? 20
  });
}

export function comparePerception(before, after) {
  const beforeSummary = before?.accessibilitySummary ?? summarizeAccessibility(before?.accessibility ?? before ?? null);
  const afterSummary = after?.accessibilitySummary ?? summarizeAccessibility(after?.accessibility ?? after ?? null);
  const beforeText = new Set((beforeSummary.visibleTextPreview ?? []).map(normalizeText));
  const afterText = new Set((afterSummary.visibleTextPreview ?? []).map(normalizeText));
  let newTextCount = 0;
  for (const entry of afterText) {
    if (entry && !beforeText.has(entry)) {
      newTextCount += 1;
    }
  }
  return {
    materialChangeDetected: newTextCount > 0 || beforeSummary.nodesReturned !== afterSummary.nodesReturned,
    beforeNodes: beforeSummary.nodesReturned,
    afterNodes: afterSummary.nodesReturned,
    newTextCount
  };
}
