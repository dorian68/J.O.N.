// App observer — turns a page into a structured DOM summary JON can reason on.
//
// V1 is deterministic and dependency-free: it parses an HTML string (from a
// fixture, or from the live page captured via the browser controller / extension)
// into interactive elements, forms, navigation and state signals. No heavy LLM.
//
// The real-browser path (observeUrl) reuses JON's existing browser automation to
// fetch the page HTML, then calls the same extractDomSummary().

function decodeEntities(s = "") {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function stripTags(s = "") { return decodeEntities(String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()); }
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? decodeEntities(m[1]) : null;
}
function hasAttr(tag, name) { return new RegExp(`(^|\\s)${name}(\\s|=|>|$)`, "i").test(tag); }
function preferredSelector(el) {
  if (el.testId) return `[data-testid='${el.testId}']`;
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name='${el.name}']`;
  if (el.label) return `${el.tag}:has-text('${el.label}')`;
  return el.tag;
}
function selectorCandidates(el) {
  const c = [];
  if (el.testId) c.push(`[data-testid='${el.testId}']`);
  if (el.id) c.push(`#${el.id}`);
  if (el.name) c.push(`[name='${el.name}']`);
  if (el.label) c.push(`${el.tag}:has-text('${el.label}')`);
  return c.length ? c : [el.tag];
}

// Parse raw HTML into a normalized DOM summary.
export function extractDomSummary(html, { url = null } = {}) {
  const src = String(html ?? "");
  const title = stripTags((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ?? "");

  const headings = [...src.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: stripTags(m[2]) }));

  let idCounter = 0;
  const nextId = (base) => `${base}-${++idCounter}`;

  const buttons = [...src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map((m) => {
    const tagAttrs = m[1]; const label = stripTags(m[2]);
    return {
      kind: "button", tag: "button", label,
      testId: attr(tagAttrs, "data-testid"), id: attr(tagAttrs, "id"),
      name: attr(tagAttrs, "name"), type: attr(tagAttrs, "type") ?? "button"
    };
  });

  const links = [...src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => {
    const tagAttrs = m[1];
    return {
      kind: "link", tag: "a", label: stripTags(m[2]),
      href: attr(tagAttrs, "href"), testId: attr(tagAttrs, "data-testid"), id: attr(tagAttrs, "id")
    };
  }).filter((l) => l.href || l.label);

  const inputs = [...src.matchAll(/<(input|textarea|select)\b([^>]*?)\/?>/gi)].map((m) => {
    const tag = m[1].toLowerCase(); const tagAttrs = m[2];
    return {
      kind: "input", tag,
      type: attr(tagAttrs, "type") ?? (tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text"),
      name: attr(tagAttrs, "name"), id: attr(tagAttrs, "id"),
      testId: attr(tagAttrs, "data-testid"), placeholder: attr(tagAttrs, "placeholder"),
      required: hasAttr(tagAttrs, "required")
    };
  });

  const forms = [...src.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((m) => {
    const tagAttrs = m[1]; const body = m[2];
    const fInputs = [...body.matchAll(/<(input|textarea|select)\b([^>]*?)\/?>/gi)].map((im) => ({
      type: attr(im[2], "type") ?? im[1].toLowerCase(), name: attr(im[2], "name"),
      required: hasAttr(im[2], "required"), placeholder: attr(im[2], "placeholder")
    })).filter((i) => i.type !== "hidden");
    const submit = (body.match(/<button\b([^>]*type\s*=\s*["']submit["'][^>]*)>([\s\S]*?)<\/button>/i));
    return {
      id: nextId("form"), action: attr(tagAttrs, "action"), method: (attr(tagAttrs, "method") ?? "get").toLowerCase(),
      testId: attr(tagAttrs, "data-testid"),
      inputs: fInputs, requiredInputs: fInputs.filter((i) => i.required).map((i) => i.name).filter(Boolean),
      submitLabel: submit ? stripTags(submit[2]) : null,
      submitTestId: submit ? attr(submit[1], "data-testid") : null
    };
  });

  // State signals: success / error / alert banners.
  const banners = [...src.matchAll(/<(div|span|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map((m) => ({ attrs: m[2], text: stripTags(m[3]) }))
    .filter((b) => /banner|alert|toast|notice|role\s*=\s*["'](alert|status)["']|class\s*=\s*["'][^"']*(success|error|warning)/i.test(b.attrs))
    .map((b) => ({
      kind: /error|alert|danger/i.test(b.attrs) ? "error" : /success|status/i.test(b.attrs) ? "success" : "info",
      text: b.text
    }))
    .filter((b) => b.text);

  // Navigation = links that look like primary nav (inside <nav> or with nav testid).
  const navBlock = (src.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i) || [])[1] ?? "";
  const navLinks = [...navBlock.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    label: stripTags(m[2]), href: attr(m[1], "href"), testId: attr(m[1], "data-testid")
  })).filter((l) => l.label);

  // Assign stable ids + selectors to interactive elements.
  const interactive = [...buttons, ...links, ...inputs].map((el) => {
    const slug = (el.testId || el.id || el.name || el.label || el.kind || "el").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "el";
    return { ...el, id: slug, preferredSelector: preferredSelector(el), selectorCandidates: selectorCandidates(el) };
  });

  return {
    url, title, headings,
    interactive,
    buttons: interactive.filter((e) => e.kind === "button"),
    links: interactive.filter((e) => e.kind === "link"),
    inputs: interactive.filter((e) => e.kind === "input"),
    forms, banners, navLinks,
    counts: { interactive: interactive.length, forms: forms.length, banners: banners.length, navLinks: navLinks.length }
  };
}

export function extractInteractiveElements(summary) { return summary.interactive ?? []; }
export function extractForms(summary) { return summary.forms ?? []; }
export function extractNavigationElements(summary) { return summary.navLinks ?? []; }
export function extractStateSignals(summary) { return summary.banners ?? []; }

// Observe a single page's HTML into a one-page observation set.
export function observeHtml(html, { url = null } = {}) {
  const summary = extractDomSummary(html, { url });
  return { pages: [{ url, summary }], primaryUrl: url };
}

// Real-browser path (V1 best-effort): fetch the page HTML via the provided
// browser controller, then reuse the deterministic extractor.
export async function observeUrl(url, { browserController = null } = {}) {
  if (!browserController) {
    throw Object.assign(new Error("observeUrl requires a browserController (or use observeHtml on captured HTML)."), { code: "NO_BROWSER" });
  }
  const session = await browserController.openBrowserSession({ url });
  try {
    const targetId = session.targetId ?? session.id;
    const html = await browserController.getPageHtml?.(targetId) ?? await browserController.extractHtml?.(targetId) ?? "";
    return observeHtml(html, { url });
  } finally {
    await browserController.close?.().catch(() => {});
  }
}
