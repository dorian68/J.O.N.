import { resolveBindConfig } from "./desktop-auth.js";

// Production readiness checks. In production (JON_PRODUCTION=true / NODE_ENV=production)
// the server should refuse to start when a hard check fails — so an insecure
// config never ships silently. Pure over env (+ optional gateway status) so it is
// unit-testable and reusable by the CLI doctor.
export function evaluateProductionReadiness(env = process.env, { gatewayStatus = null, workspaceRootExists = null } = {}) {
  const production = env.JON_PRODUCTION === "true" || env.NODE_ENV === "production";
  const { bindHost, lanEnabled, lanOptIn } = resolveBindConfig(env);
  const checks = [];
  const add = (id, status, label, detail) => checks.push({ id, status, label, detail });

  // Network exposure — LAN is only acceptable because desktop routes now require
  // the desktop token; flag it so the operator is aware.
  if (lanEnabled) {
    add("network_exposure", "warn", "Exposition réseau (LAN)",
      "LAN activé (JON_ALLOW_LAN). Les routes desktop exigent le token desktop ; protège ~/.cowork/desktop-token.");
  } else {
    add("network_exposure", "pass", "Exposition réseau", `Bind loopback (${bindHost}) — non exposé sur le LAN.`);
  }

  // MCP stdio — must be disabled, or enabled WITH a non-empty allowlist.
  const stdioEnabled = env.JON_ENABLE_MCP_STDIO === "true";
  if (!stdioEnabled) {
    add("mcp_stdio", "pass", "MCP stdio", "Désactivé (défaut sûr).");
  } else {
    let allowlistSize = 0;
    try { allowlistSize = Object.keys(JSON.parse(env.JON_MCP_STDIO_ALLOWLIST || "{}")).length; } catch { allowlistSize = -1; }
    add("mcp_stdio", allowlistSize > 0 ? "warn" : "fail", "MCP stdio",
      allowlistSize > 0
        ? `Activé avec ${allowlistSize} serveur(s) allowlistés.`
        : "Activé SANS allowlist valide — exécution de commande possible. Définis JON_MCP_STDIO_ALLOWLIST.");
  }

  // Browser eval / CDP — must be gated by default.
  const evalEnabled = env.JON_ENABLE_BROWSER_EVAL === "true";
  add("browser_eval", evalEnabled ? "warn" : "pass", "Browser eval/CDP",
    evalEnabled ? "Activé — n'autorise que des plans de confiance." : "Verrouillé (défaut).");

  // Workspace root for file primitives.
  if (env.JON_WORKSPACE_ROOT) {
    add("workspace_root", workspaceRootExists === false ? "fail" : "pass", "Workspace root",
      workspaceRootExists === false ? `JON_WORKSPACE_ROOT défini mais introuvable: ${env.JON_WORKSPACE_ROOT}` : env.JON_WORKSPACE_ROOT);
  } else {
    add("workspace_root", production ? "warn" : "pass", "Workspace root",
      "JON_WORKSPACE_ROOT non défini — les opérations fichier utilisent les gardes par défaut.");
  }

  // LLM provider in production must be live (not mock).
  if (production && gatewayStatus) {
    const live = (gatewayStatus.availableProviders ?? []).some((a) => a !== "mock_offline");
    add("llm_provider", live ? "pass" : "fail", "Fournisseur LLM",
      live ? "Fournisseur live configuré." : "Aucun fournisseur LLM live en production (tournerait en mock).");
  }

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  return {
    production,
    bindHost,
    lanEnabled,
    lanOptIn,
    checks,
    failCount,
    warnCount,
    ok: failCount === 0,
    // In production a failed hard-check must block startup.
    shouldRefuseStart: production && failCount > 0
  };
}
