function cleanText(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hostFromUrl(value = "") {
  try {
    return new URL(String(value ?? "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathFromUrl(value = "") {
  try {
    return new URL(String(value ?? "")).pathname.toLowerCase();
  } catch {
    return "";
  }
}

const ANTI_BOT_PATTERNS = [
  /google\.com\/sorry/i,
  /\bnos systèmes ont détecté un trafic exceptionnel\b/i,
  /\bunusual traffic\b/i,
  /\bnot a robot\b/i,
  /\bverify that you'?re human\b/i,
  /\bvérifier que c['’]est bien vous\b/i,
  /\bcaptcha\b/i,
  /\brecaptcha\b/i,
  /\bhcaptcha\b/i,
  /\bcloudflare\b/i,
  /\bchecking your browser\b/i,
  /\bsecurity check\b/i,
  /\bautomated queries\b/i,
  /\bbot detection\b/i
];

const AUTH_GATE_PATTERNS = [
  /\bsign in\b/i,
  /\blog in\b/i,
  /\blogin\b/i,
  /\bconnexion\b/i,
  /\bconnecte[- ]?toi\b/i,
  /\bconnectez[- ]?vous\b/i,
  /\bidentifiants?\b/i,
  /\bmot de passe\b/i,
  /\bpassword\b/i,
  /\bauthentication required\b/i,
  /\bsession expired\b/i
];

const AUTH_PATH_PATTERNS = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/oauth\b/i,
  /\/auth\b/i,
  /\/account\/login\b/i
];

export function classifyBrowserBlockerSignal({
  url = "",
  title = "",
  bodyText = "",
  dialogText = ""
} = {}) {
  const compactUrl = cleanText(url, 1200);
  const host = hostFromUrl(compactUrl);
  const pathname = pathFromUrl(compactUrl);
  const titleText = cleanText(title, 300);
  const dialog = cleanText(dialogText, 500);
  const body = cleanText(bodyText, 5000);
  const combined = [compactUrl, titleText, dialog, body].filter(Boolean).join(" ");

  const antiBot = ANTI_BOT_PATTERNS.find((pattern) => pattern.test(combined));
  if (antiBot || (host.endsWith("google.com") && pathname.startsWith("/sorry"))) {
    return {
      blocked: true,
      type: "captcha_or_automation_block",
      reason: "Le navigateur est bloqué par une vérification anti-robot. JON ne doit pas la contourner.",
      requiresUserAction: true,
      userAction: "Termine la vérification manuellement dans le navigateur, puis reviens dire que c'est fait.",
      retryableAfterUserAction: true,
      observedUrl: compactUrl || null,
      observedTitle: titleText || null
    };
  }

  const authPath = AUTH_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  const authText = AUTH_GATE_PATTERNS.find((pattern) => pattern.test([titleText, dialog, body.slice(0, 1800)].join(" ")));
  if (authPath || authText) {
    return {
      blocked: true,
      type: "auth_gate",
      reason: "Le site demande une connexion ou une action de compte que JON ne peut pas faire seul.",
      requiresUserAction: true,
      userAction: "Connecte-toi ou confirme la session manuellement dans le navigateur, puis reviens dire que c'est fait.",
      retryableAfterUserAction: true,
      observedUrl: compactUrl || null,
      observedTitle: titleText || null
    };
  }

  if (dialog) {
    return {
      blocked: true,
      type: "modal_dialog",
      reason: dialog.slice(0, 180),
      requiresUserAction: false,
      userAction: null,
      retryableAfterUserAction: false,
      observedUrl: compactUrl || null,
      observedTitle: titleText || null
    };
  }

  return {
    blocked: false,
    type: null,
    reason: null,
    requiresUserAction: false,
    userAction: null,
    retryableAfterUserAction: false,
    observedUrl: compactUrl || null,
    observedTitle: titleText || null
  };
}
