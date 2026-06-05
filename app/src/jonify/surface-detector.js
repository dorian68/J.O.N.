// Surface detector — infers the app's main surfaces (pages/views) and groups the
// interactive elements under them. V1 sources surfaces from the primary nav +
// the observed page itself.

function inferSurfaceType(label, href, title) {
  const s = `${label ?? ""} ${href ?? ""} ${title ?? ""}`.toLowerCase();
  if (/login|sign in|signin|connexion/.test(s)) return "login";
  if (/setting|paramètre|parametre|config|account/.test(s)) return "settings";
  if (/dashboard|overview|accueil|home/.test(s)) return "dashboard";
  if (/detail|view|show/.test(s)) return "detail";
  if (/new|create|form|edit|créer|creer/.test(s)) return "form";
  if (/list|leads|items|orders|contacts|users|table/.test(s)) return "list";
  return "page";
}

function slug(s) { return String(s ?? "surface").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "surface"; }

export function generateSurfaceId(surface) { return slug(surface.name ?? surface.urlPattern ?? "surface"); }

export function inferSurfacePurpose(type, name) {
  return {
    login: "Authentification de l'utilisateur.",
    settings: "Configuration / paramètres.",
    dashboard: "Vue d'ensemble et points d'entrée principaux.",
    list: `Liste/collection (${name}).`,
    form: "Saisie / création / édition de données.",
    detail: "Détail d'un objet.",
    page: `Page « ${name} ».`
  }[type] ?? `Page « ${name} ».`;
}

export function detectSurfaces(observation) {
  const summary = observation.pages?.[0]?.summary ?? observation.summary ?? observation;
  const url = summary.url ?? null;
  const title = summary.title ?? "";
  const surfaces = [];

  // 1) The observed (current) page is a surface.
  const currentType = inferSurfaceType(title, url, title);
  const currentName = (summary.headings?.[0]?.text) || title || "Page";
  const current = {
    id: generateSurfaceId({ name: currentName }),
    name: currentName,
    urlPattern: url ? new URL(url, "http://x").pathname : "/",
    type: currentType,
    purpose: inferSurfacePurpose(currentType, currentName),
    confidence: title ? 0.85 : 0.6,
    detectedFrom: { url, title, textSignals: (summary.headings ?? []).map((h) => h.text).slice(0, 5) },
    elements: summary.interactive ?? [],
    forms: summary.forms ?? []
  };
  surfaces.push(current);

  // 2) Each primary nav link is a candidate surface (different view of the app).
  for (const link of summary.navLinks ?? []) {
    const type = inferSurfaceType(link.label, link.href, "");
    const id = generateSurfaceId({ name: link.label, urlPattern: link.href });
    if (surfaces.some((s) => s.id === id)) continue;
    surfaces.push({
      id, name: link.label,
      urlPattern: link.href ?? `/${id}`,
      type,
      purpose: inferSurfacePurpose(type, link.label),
      confidence: 0.7,
      detectedFrom: { url: link.href, title: link.label, textSignals: [link.label] },
      elements: [], // discovered when navigated (V2)
      forms: []
    });
  }

  return surfaces;
}
