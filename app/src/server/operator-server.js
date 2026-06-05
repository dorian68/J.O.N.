import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import QRCode from "qrcode";
import { APP_ROOT, DEFAULT_OPERATOR_PORT } from "../config.js";
import { OperatorService } from "../service/operator-service.js";
import { attachMobileTerminalWs } from "../mobile/mobile-terminal-ws.js";
import { buildNetworkAdvice } from "./network-advisor.js";
import { CoworkSmokeBackofficeService } from "../smoke/cowork-smoke-pipeline.js";
import { RealSurfaceSmokeBackofficeService } from "../smoke/real-surface-smoke-pipeline.js";

const COWORK_HOME = process.env.COWORK_HOME ?? path.join(os.homedir(), ".cowork");
const TLS_DIR = path.join(COWORK_HOME, "tls");

function getLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const iface of list) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      const score = scoreLanAddress(iface.address, name);
      candidates.push({ address: iface.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) return candidates[0].address;
  return "127.0.0.1";
}

function scoreLanAddress(address, interfaceName = "") {
  let score = 0;
  if (/^192\.168\./.test(address)) score += 100;
  if (/^10\./.test(address)) score += 95;
  const secondOctet = Number(address.split(".")[1]);
  if (/^172\./.test(address) && secondOctet >= 16 && secondOctet <= 31) score += 95;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) score += 20;
  if (/wi-?fi|ethernet/i.test(interfaceName)) score += 25;
  if (/tailscale|wsl|hyper-v|vethernet|virtual|vpn|bluetooth|hotspot/i.test(interfaceName)) score -= 50;
  return score;
}

const UI_ROOT = path.join(APP_ROOT, "ui");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function shouldExposeDebugDetails() {
  return process.env.COWORK_DEBUG_ERRORS === "1";
}

function sendError(response, statusCode, message, details = null) {
  sendJson(response, statusCode, {
    error: {
      message,
      details: shouldExposeDebugDetails() ? details : null
    }
  });
}

function writeSse(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunkText(text, maxChunkLength = 18) {
  const tokens = String(text ?? "").match(/\S+\s*/g) ?? [];
  const chunks = [];
  let current = "";
  for (const token of tokens) {
    if (current && (current + token).length > maxChunkLength) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_JSON_BODY_BYTES = Number.parseInt(process.env.COWORK_MAX_BODY_BYTES ?? "", 10) || 5 * 1024 * 1024; // 5 MB default

async function readJsonBody(request, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buf = Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > maxBytes) {
      const err = new Error(`Request body exceeds maximum allowed size (${maxBytes} bytes).`);
      err.code = "PAYLOAD_TOO_LARGE";
      throw err;
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("Request body is not valid JSON.");
    err.code = "INVALID_JSON";
    throw err;
  }
}

function matchRoute(pathname, expression) {
  const match = pathname.match(expression);
  return match?.groups ?? null;
}

const ALLOWED_STATIC_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".png", ".svg", ".ico", ".txt", ".woff", ".woff2", ".ttf"]);

async function serveStaticAsset(response, pathname) {
  const requested = pathname === "/"
    ? "/index.html"
    : pathname === "/admin" || pathname === "/admin/"
      ? "/admin.html"
      : pathname === "/mobile" || pathname === "/mobile/"
        ? "/mobile/index.html"
        : pathname;

  // Normalize to prevent path traversal via ../
  const assetPath = path.normalize(path.join(UI_ROOT, requested));

  // Reject any path that escapes UI_ROOT after normalization
  const relative = path.relative(UI_ROOT, assetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendError(response, 403, "Forbidden");
    return true;
  }

  // Reject dotfiles (e.g. .env, .git)
  const basename = path.basename(assetPath);
  if (basename.startsWith(".")) {
    sendError(response, 403, "Forbidden");
    return true;
  }

  // Allowlist by extension
  const ext = path.extname(assetPath).toLowerCase();
  if (ext && !ALLOWED_STATIC_EXTENSIONS.has(ext)) {
    sendError(response, 403, "Forbidden");
    return true;
  }

  try {
    const content = await fs.readFile(assetPath);
    response.writeHead(200, {
      "content-type": contentTypeFor(assetPath),
      "cache-control": "no-store"
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function generateSelfSignedCert() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

  // Minimal self-signed X.509 cert using Node.js built-in crypto (available since v15)
  // Falls back gracefully if X509Certificate generation is not available
  try {
    const cert = crypto.X509Certificate
      ? (() => {
        // Use forge-style minimal DER encoding — if unavailable, fall through
        throw new Error("use-selfsigned");
      })()
      : null;
    if (cert) return { key: privateKeyPem, cert };
  } catch {}

  // Fallback: use openssl via child_process if available, else return null (HTTP fallback)
  try {
    const { execFileSync } = await import("node:child_process");
    const key = execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", "/dev/stdout",
      "-out", "/dev/stdout", "-days", "365", "-nodes",
      "-subj", "/CN=JON-local"
    ], { encoding: "utf8", timeout: 10000 });
    return { key, cert: key };
  } catch {}

  return null;
}

async function buildTlsCredentials() {
  const keyPath = path.join(TLS_DIR, "jon-local.key");
  const certPath = path.join(TLS_DIR, "jon-local.crt");

  // Reuse persistent cert if < 180 days old
  try {
    const stat = await fs.stat(certPath);
    if ((Date.now() - stat.mtimeMs) / 86400000 < 180) {
      return {
        key: await fs.readFile(keyPath, "utf8"),
        cert: await fs.readFile(certPath, "utf8")
      };
    }
  } catch {}

  await fs.mkdir(TLS_DIR, { recursive: true });
  const localIp = getLanIp();

  await new Promise((resolve, reject) => {
    const proc = spawn("openssl", [
      "req", "-x509", "-newkey", "rsa:2048",
      "-keyout", keyPath, "-out", certPath,
      "-days", "365", "-nodes",
      "-subj", `/CN=JON-local/O=JON`,
      "-addext", `subjectAltName=IP:${localIp},IP:127.0.0.1`
    ], { stdio: "ignore" });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`openssl exit ${code}`)));
    proc.on("error", reject);
  });

  return {
    key: await fs.readFile(keyPath, "utf8"),
    cert: await fs.readFile(certPath, "utf8")
  };
}

export async function createOperatorServer({
  port = DEFAULT_OPERATOR_PORT,
  operatorServiceOptions = {}
} = {}) {
  const useTls = process.env.COWORK_TLS === "1";
  let tlsCredentials = null;
  if (useTls) {
    try {
      tlsCredentials = await buildTlsCredentials();
      console.log(`[TLS] Certificate ready — ${path.join(TLS_DIR, "jon-local.crt")}`);
    } catch (err) {
      console.warn(`[TLS] Certificate generation failed (${err.message}). Falling back to HTTP.`);
    }
  }
  const serverInfo = { scheme: "http", port, lanIp: getLanIp() };

  const operatorService = await OperatorService.create(operatorServiceOptions);
  const smokeBackoffice = new CoworkSmokeBackofficeService();
  const realSurfaceSmokeBackoffice = new RealSurfaceSmokeBackofficeService();
  const eventSubscribers = new Set();

  const broadcastEvent = (payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const response of eventSubscribers) {
      try {
        response.write(frame);
      } catch {
        eventSubscribers.delete(response);
      }
    }
  };

  const handleStateChanged = (payload) => {
    broadcastEvent(payload);
  };

  operatorService.on("state.changed", handleStateChanged);

  const requestHandler = async (request, response) => {
    try {
      if (!request.url) {
        sendError(response, 400, "Missing URL");
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname;

      if (pathname === "/api/health" && request.method === "GET") {
        sendJson(response, 200, {
          status: "ok",
          fixtureBaseUrl: operatorService.fixtureManifest.baseUrl,
          browserExtension: operatorService.getBrowserExtensionHealth()
        });
        return;
      }

      if (pathname === "/api/browser-extension/health" && request.method === "GET") {
        sendJson(response, 200, operatorService.getBrowserExtensionHealth());
        return;
      }

      if (pathname === "/api/browser-extension/tabs" && request.method === "GET") {
        try {
          sendJson(response, 200, {
            tabs: operatorService.listBrowserExtensionTabs({
              projectId: url.searchParams.get("projectId"),
              includeClosed: url.searchParams.get("includeClosed") === "1",
              limit: url.searchParams.get("limit") ?? 50
            })
          });
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }

      if (pathname === "/api/browser-extension/events" && request.method === "GET") {
        try {
          sendJson(response, 200, {
            events: operatorService.listBrowserExtensionEvents({
              projectId: url.searchParams.get("projectId"),
              tabSessionId: url.searchParams.get("tabSessionId"),
              runId: url.searchParams.get("runId"),
              limit: url.searchParams.get("limit") ?? 100
            })
          });
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }

      const browserExtensionTabCommandRoute = matchRoute(pathname, /^\/api\/browser-extension\/tabs\/(?<tabSessionId>[^/]+)\/command$/);
      if (browserExtensionTabCommandRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.sendBrowserExtensionCommand(
            body.projectId ?? url.searchParams.get("projectId") ?? null,
            decodeURIComponent(browserExtensionTabCommandRoute.tabSessionId),
            body
          ));
        } catch (err) {
          const status = err.code === "BROWSER_EXTENSION_TAB_NOT_CONNECTED" ? 409
            : err.code === "BROWSER_EXTENSION_TAB_NOT_FOUND" ? 404
              : 400;
          sendError(response, status, err.message, { code: err.code });
        }
        return;
      }

      if (pathname === "/api/dashboard" && request.method === "GET") {
        sendJson(response, 200, await operatorService.getDashboard(url.searchParams.get("projectId")));
        return;
      }

      if (pathname === "/api/smoke/status" && request.method === "GET") {
        sendJson(response, 200, smokeBackoffice.getStatus());
        return;
      }
      if (pathname === "/api/smoke/latest" && request.method === "GET") {
        sendJson(response, 200, {
          latest: await smokeBackoffice.getLatest(),
          history: await smokeBackoffice.listReports({ limit: 5 }),
          status: smokeBackoffice.getStatus()
        });
        return;
      }
      if (pathname === "/api/smoke/run" && request.method === "POST") {
        const body = await readJsonBody(request);
        const report = await smokeBackoffice.run({
          includeBrowser: body.includeBrowser !== false,
          runner: body.runner ?? "backoffice"
        });
        sendJson(response, 200, {
          report
        });
        return;
      }
      if (pathname === "/api/smoke/real-surfaces/status" && request.method === "GET") {
        sendJson(response, 200, realSurfaceSmokeBackoffice.getStatus());
        return;
      }
      if (pathname === "/api/smoke/real-surfaces/latest" && request.method === "GET") {
        sendJson(response, 200, {
          latest: await realSurfaceSmokeBackoffice.getLatest(),
          history: await realSurfaceSmokeBackoffice.listReports({ limit: 5 }),
          status: realSurfaceSmokeBackoffice.getStatus()
        });
        return;
      }
      if (pathname === "/api/smoke/real-surfaces/run" && request.method === "POST") {
        const body = await readJsonBody(request);
        const report = await realSurfaceSmokeBackoffice.run({
          configPath: body.configPath ?? null,
          runner: body.runner ?? "backoffice"
        });
        sendJson(response, 200, {
          report
        });
        return;
      }

      if (pathname === "/api/memory/startup" && request.method === "GET") {
        sendJson(response, 200, operatorService.getStartupMemoryContext(url.searchParams.get("projectId")));
        return;
      }
      if (pathname === "/api/memory/records" && request.method === "GET") {
        sendJson(response, 200, {
          records: operatorService.listUserMemoryRecords({
            projectId: url.searchParams.get("projectId"),
            category: url.searchParams.get("category"),
            limit: url.searchParams.get("limit") ?? 50
          })
        });
        return;
      }
      if (pathname === "/api/memory/search" && request.method === "GET") {
        sendJson(response, 200, {
          records: operatorService.searchUserMemoryRecords({
            query: url.searchParams.get("q") ?? "",
            projectId: url.searchParams.get("projectId"),
            category: url.searchParams.get("category"),
            limit: url.searchParams.get("limit") ?? 25
          })
        });
        return;
      }

      if (pathname === "/api/settings/preferences" && request.method === "GET") {
        sendJson(response, 200, {
          preferences: operatorService.getUserPreferencesSummary()
        });
        return;
      }
      if (pathname === "/api/settings/preferences" && request.method === "PUT") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          preferences: operatorService.updateUserPreferences(body.preferences ?? body)
        });
        return;
      }
      if (pathname === "/api/settings/preferences/reset" && request.method === "POST") {
        sendJson(response, 200, {
          preferences: operatorService.resetUserPreferences()
        });
        return;
      }

      if (pathname === "/api/connectors" && request.method === "GET") {
        sendJson(response, 200, {
          connectors: operatorService.listConnectors(),
          actionLog: operatorService.getConnectorActionLog({ limit: 30 })
        });
        return;
      }

      // ── MCP connectors (desktop surface — shares the same service/store as mobile) ──
      if (pathname === "/api/mcp/providers" && request.method === "GET") {
        sendJson(response, 200, { providers: operatorService.listMcpProviders() });
        return;
      }
      if (pathname === "/api/mcp/connectors" && request.method === "GET") {
        sendJson(response, 200, { connectors: operatorService.listMcpConnectors(), tools: operatorService.listConnectedMcpTools() });
        return;
      }
      if (pathname === "/api/mcp/catalog" && request.method === "GET") {
        sendJson(response, 200, { catalog: operatorService.listMcpCatalog() });
        return;
      }
      if (pathname === "/api/mcp/remote/connect" && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.connectRemoteMcpServer(body.connectorId ?? body.server, body.server ?? body, { scopes: body.scopes ?? null }));
        } catch (err) { sendError(response, 400, err.message, { code: err.code }); }
        return;
      }
      if (pathname === "/api/mcp/oauth/start" && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.startMcpOAuthConnect(body.connectorId ?? body.provider, body.providerConfig ?? body.provider, { scopes: body.scopes ?? null }));
        } catch (err) { sendError(response, 400, err.message, { code: err.code }); }
        return;
      }
      if (pathname === "/api/mcp/stdio/connect" && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.connectMcpStdio(body.connectorId, body.connection ?? body));
        } catch (err) { sendError(response, 400, err.message, { code: err.code }); }
        return;
      }
      const desktopMcpStatusRoute = matchRoute(pathname, /^\/api\/mcp\/(?<connectorId>[^/]+)\/status$/);
      if (desktopMcpStatusRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.getMcpConnectorStatus(desktopMcpStatusRoute.connectorId));
        return;
      }
      const desktopMcpCallRoute = matchRoute(pathname, /^\/api\/mcp\/(?<connectorId>[^/]+)\/call$/);
      if (desktopMcpCallRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.callMcpTool(desktopMcpCallRoute.connectorId, body.tool, body.args ?? {}));
        } catch (err) { sendError(response, 400, err.message, { code: err.code }); }
        return;
      }
      const desktopMcpDisconnectRoute = matchRoute(pathname, /^\/api\/mcp\/(?<connectorId>[^/]+)$/);
      if (desktopMcpDisconnectRoute && request.method === "DELETE") {
        sendJson(response, 200, await operatorService.disconnectMcpConnector(desktopMcpDisconnectRoute.connectorId));
        return;
      }
      if (pathname === "/api/connectors" && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 201, {
            connector: await operatorService.addConnector(body.connector ?? body)
          });
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      const desktopConnectorRoute = matchRoute(pathname, /^\/api\/connectors\/(?<connectorId>[^/]+)$/);
      if (desktopConnectorRoute && request.method === "GET") {
        try {
          const connector = operatorService.getConnector(decodeURIComponent(desktopConnectorRoute.connectorId));
          sendJson(response, 200, connector);
        } catch (err) {
          sendError(response, 404, err.message, { code: err.code });
        }
        return;
      }
      if (desktopConnectorRoute && request.method === "DELETE") {
        try {
          sendJson(response, 200, await operatorService.removeConnector(decodeURIComponent(desktopConnectorRoute.connectorId)));
        } catch (err) {
          sendError(response, 404, err.message, { code: err.code });
        }
        return;
      }
      if (pathname === "/api/connectors/email_draft/draft" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          ...(await operatorService.draftEmailViaConnector({
            to: body.to,
            subject: body.subject,
            body: body.body,
            runId: body.runId ?? null,
            requestedBy: "desktop"
          }))
        });
        return;
      }

      if (pathname === "/api/agent/config" && request.method === "GET") {
        sendJson(response, 200, {
          config: operatorService.getAgentConfiguration()
        });
        return;
      }
      if (pathname === "/api/agent/config" && request.method === "PUT") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          config: operatorService.updateAgentConfiguration(body.config ?? body)
        });
        return;
      }
      if (pathname === "/api/agent/config/reset" && request.method === "POST") {
        sendJson(response, 200, {
          config: operatorService.resetAgentConfiguration()
        });
        return;
      }
      if (pathname === "/api/agent/config/preview" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.previewAgentConfiguration(body.message ?? ""));
        return;
      }

      if (pathname === "/api/capabilities" && request.method === "GET") {
        sendJson(response, 200, await operatorService.getCapabilityGraph());
        return;
      }
      if (pathname === "/api/capabilities/refresh" && request.method === "POST") {
        sendJson(response, 200, await operatorService.refreshCapabilityGraph());
        return;
      }
      if (pathname === "/api/capabilities/descriptions/generate" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.generateCapabilityDescriptions(body));
        return;
      }
      if (pathname === "/api/capabilities/rank" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.explainCapabilityRanking(body.mission ?? "", {
          limit: body.limit ?? 12
        }));
        return;
      }
      if (pathname === "/api/capabilities/build/propose" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.proposeCapabilityBuild(body));
        return;
      }
      if (pathname === "/api/capabilities/candidates" && request.method === "GET") {
        sendJson(response, 200, {
          candidates: operatorService.listCapabilityCandidates({
            status: url.searchParams.get("status")
          })
        });
        return;
      }
      if (pathname === "/api/capabilities/candidates" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 201, await operatorService.createCapabilityCandidate(body));
        return;
      }
      const capabilityCandidateValidateRoute = matchRoute(pathname, /^\/api\/capabilities\/candidates\/(?<candidateId>[^/]+)\/validate$/);
      if (capabilityCandidateValidateRoute && request.method === "POST") {
        sendJson(response, 200, await operatorService.validateCapabilityCandidate(decodeURIComponent(capabilityCandidateValidateRoute.candidateId)));
        return;
      }
      const capabilityCandidateEnableRoute = matchRoute(pathname, /^\/api\/capabilities\/candidates\/(?<candidateId>[^/]+)\/enable$/);
      if (capabilityCandidateEnableRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.enableCapabilityCandidate(decodeURIComponent(capabilityCandidateEnableRoute.candidateId), body));
        return;
      }
      const capabilityCandidateDisableRoute = matchRoute(pathname, /^\/api\/capabilities\/candidates\/(?<candidateId>[^/]+)\/disable$/);
      if (capabilityCandidateDisableRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.disableCapabilityCandidate(decodeURIComponent(capabilityCandidateDisableRoute.candidateId), body));
        return;
      }
      const capabilityCandidateRunHtmlRoute = matchRoute(pathname, /^\/api\/capabilities\/candidates\/(?<candidateId>[^/]+)\/run-html$/);
      if (capabilityCandidateRunHtmlRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.executeCapabilityCandidateOnHtml(decodeURIComponent(capabilityCandidateRunHtmlRoute.candidateId), body));
        return;
      }
      if (pathname === "/api/capabilities/feedback" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.recordOperatorCapabilityFeedback(body));
        return;
      }
      const capabilityCandidateStatsRoute = matchRoute(pathname, /^\/api\/capabilities\/candidates\/(?<candidateId>[^/]+)\/stats$/);
      if (capabilityCandidateStatsRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.getCapabilityCandidateStats(decodeURIComponent(capabilityCandidateStatsRoute.candidateId)));
        return;
      }
      const capabilityCandidateOutcomeRoute = matchRoute(pathname, /^\/api\/capabilities\/candidates\/(?<candidateId>[^/]+)\/outcome$/);
      if (capabilityCandidateOutcomeRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.recordCapabilityRunOutcome(
          decodeURIComponent(capabilityCandidateOutcomeRoute.candidateId),
          { runId: body.runId ?? null, projectId: body.projectId ?? null, mission: body.mission ?? null, outcomeStatus: body.outcomeStatus, approvalCount: body.approvalCount ?? 0, evidenceCount: body.evidenceCount ?? 0 }
        ));
        return;
      }
      if (pathname === "/api/capabilities/candidates/select" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, { candidate: operatorService.selectEnabledCapabilityForMission(body.mission ?? "", body.desiredOutcome ?? "") });
        return;
      }
      if (pathname === "/api/skills" && request.method === "GET") {
        sendJson(response, 200, operatorService.getSkillRegistry());
        return;
      }
      if (pathname === "/api/skills/deep-validation" && request.method === "GET") {
        sendJson(response, 200, operatorService.getDeepSkillValidation());
        return;
      }
      if (pathname === "/api/operational-deep" && request.method === "GET") {
        sendJson(response, 200, await operatorService.getOperationalDeepReadiness());
        return;
      }
      if (pathname === "/api/skills/user-defined" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.upsertUserSkillManifest(body.manifest ?? body));
        return;
      }
      const capabilityNodeRoute = matchRoute(pathname, /^\/api\/capabilities\/(?<nodeId>.+)$/);
      if (capabilityNodeRoute && request.method === "PUT") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.updateCapabilityNode(decodeURIComponent(capabilityNodeRoute.nodeId), body));
        return;
      }

      if (pathname === "/api/events" && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        });
        response.write(`data: ${JSON.stringify({
          type: "stream.connected",
          createdAt: new Date().toISOString()
        })}\n\n`);
        eventSubscribers.add(response);
        request.on("close", () => {
          eventSubscribers.delete(response);
        });
        return;
      }

      if (pathname === "/api/projects" && request.method === "GET") {
        sendJson(response, 200, {
          projects: operatorService.listProjects()
        });
        return;
      }

      if (pathname === "/api/projects/ensure-demo" && request.method === "POST") {
        sendJson(response, 200, {
          project: await operatorService.ensureDemoProject()
        });
        return;
      }

      const projectRunsRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/runs$/);
      if (projectRunsRoute && request.method === "GET") {
        sendJson(response, 200, {
          runs: operatorService.listRuns(projectRunsRoute.projectId)
        });
        return;
      }

      const runAuditRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/runs\/(?<runId>[^/]+)\/audit$/);
      if (runAuditRoute && request.method === "GET") {
        const audit = await operatorService.extractRunAudit(runAuditRoute.runId);
        if (!audit) { sendError(response, 404, "Run not found"); return; }
        sendJson(response, 200, audit);
        return;
      }

      const runProgressRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/runs\/(?<runId>[^/]+)\/progress$/);
      if (runProgressRoute && request.method === "GET") {
        const detail = await operatorService.getRunDetail(runProgressRoute.runId).catch(() => null);
        if (!detail) { sendError(response, 404, "Run not found"); return; }
        const sv = detail.run.metadata?.semanticVerification ?? null;
        const mp = detail.run.metadata?.missionProgress ?? null;
        sendJson(response, 200, {
          runId: runProgressRoute.runId,
          status: detail.run.status,
          lifecycleStage: detail.run.lifecycleStage,
          summary: detail.run.summary,
          mission: detail.run.mission,
          objectiveSatisfied: sv?.objectiveSatisfied ?? null,
          verificationVerdict: sv?.verificationVerdict ?? null,
          confidence: sv?.confidence ?? null,
          failureReason: sv?.failureReason ?? null,
          nextBestAction: sv?.nextBestAction ?? null,
          nextActionRecommended: sv?.nextBestAction ?? mp?.semanticVerification?.nextBestAction ?? null,
          proofStatus: {
            evidenceUsed: sv?.evidenceUsed ?? mp?.proof?.evidenceUsedInVerification ?? [],
            evidenceCount: detail.evidence?.length ?? 0,
            artifactCount: detail.artifacts?.length ?? 0,
            missingEvidence: sv?.missingEvidence ?? mp?.proof?.missingEvidence ?? []
          },
          satisfiedOutcomes: sv?.satisfiedOutcomes ?? [],
          unsatisfiedOutcomes: sv?.unsatisfiedOutcomes ?? [],
          whereAreWe: mp ? {
            progress: mp.steps ? `${mp.steps.completed}/${mp.steps.total ?? "?"} steps` : null,
            consecutiveFailures: mp.steps?.consecutiveFailures ?? 0,
            activeSurface: mp.surfaces?.active ?? null,
            finalStatus: mp.finalStatus ?? null,
            objectiveSatisfied: mp.semanticVerification?.objectiveSatisfied ?? sv?.objectiveSatisfied ?? null,
            blocking: mp.semanticVerification?.failureReason ?? null
          } : null,
          currentBlockage: sv?.objectiveSatisfied === false
            ? (sv.failureReason ?? "Mission objective has not been verified.")
            : null,
          userNeed: sv && !sv.objectiveSatisfied
            ? (sv.failureReason ? `Mission non vérifiée : ${sv.failureReason}` : null)
            : null,
          evidenceCount: detail.evidence?.length ?? 0,
          artifactCount: detail.artifacts?.length ?? 0
        });
        return;
      }
      if (projectRunsRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 202, await operatorService.startScenario(projectRunsRoute.projectId, body.scenarioId));
        return;
      }

      const projectMissionsRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/missions$/);
      if (projectMissionsRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 202, await operatorService.startMission(projectMissionsRoute.projectId, body));
        return;
      }

      const projectMissionPreflightRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/missions\/preflight$/);
      if (projectMissionPreflightRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.previewMission(projectMissionPreflightRoute.projectId, body));
        return;
      }

      const projectConversationTurnRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/conversation\/turn$/);
      if (projectConversationTurnRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.handleConversationTurn(projectConversationTurnRoute.projectId, body));
        return;
      }

      const projectConversationStreamRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/conversation\/stream$/);
      if (projectConversationStreamRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        });
        writeSse(response, "turn.started", {
          projectId: projectConversationStreamRoute.projectId,
          createdAt: new Date().toISOString()
        });
        try {
          const payload = await operatorService.handleConversationTurn(projectConversationStreamRoute.projectId, body);
          const replyChunks = chunkText(payload.turn?.reply ?? "");
          for (const chunk of replyChunks) {
            writeSse(response, "reply.delta", {
              text: chunk
            });
            await delay(18);
          }
          writeSse(response, "turn.completed", payload);
        } catch (error) {
          writeSse(response, "turn.error", {
            message: error.message,
            details: shouldExposeDebugDetails() ? error.stack : null
          });
        } finally {
          response.end();
        }
        return;
      }

      const projectConversationRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/conversation$/);
      if (projectConversationRoute && request.method === "GET") {
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "80", 10);
        const conversationId = url.searchParams.get("conversationId") ?? null;
        sendJson(response, 200, {
          turns: operatorService.listConversationTurns(projectConversationRoute.projectId, {
            limit: Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 80,
            conversationId
          })
        });
        return;
      }

      const projectConversationsRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/conversations$/);
      if (projectConversationsRoute && request.method === "GET") {
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        sendJson(response, 200, {
          conversations: operatorService.listConversations(projectConversationsRoute.projectId, {
            limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 50
          })
        });
        return;
      }

      if (projectConversationsRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 201, {
          conversation: operatorService.createConversation(projectConversationsRoute.projectId, body)
        });
        return;
      }

      const projectWorkspaceRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace$/);
      if (projectWorkspaceRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.getWorkspaceState(projectWorkspaceRoute.projectId, {
          conversationId: url.searchParams.get("conversationId") ?? null
        }));
        return;
      }

      const projectWorkspaceBriefRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/mission-brief$/);
      if (projectWorkspaceBriefRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.upsertWorkspaceMissionBrief(projectWorkspaceBriefRoute.projectId, body));
        return;
      }

      const projectWorkspaceTerminalsRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminals$/);
      if (projectWorkspaceTerminalsRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 201, operatorService.attachWorkspaceTerminal(projectWorkspaceTerminalsRoute.projectId, body));
        return;
      }

      const projectWorkspaceTerminalProcessesRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminal-processes$/);
      if (projectWorkspaceTerminalProcessesRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 201, operatorService.startWorkspaceTerminalProcess(projectWorkspaceTerminalProcessesRoute.projectId, body));
        return;
      }

      const projectWorkspaceTerminalRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminals\/(?<terminalId>[^/]+)$/);
      if (projectWorkspaceTerminalRoute && request.method === "PATCH") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.updateWorkspaceTerminal(
          projectWorkspaceTerminalRoute.projectId,
          decodeURIComponent(projectWorkspaceTerminalRoute.terminalId),
          body
        ));
        return;
      }

      const projectWorkspaceTerminalInputRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminals\/(?<terminalId>[^/]+)\/input$/);
      if (projectWorkspaceTerminalInputRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.writeWorkspaceTerminalInput(
          projectWorkspaceTerminalInputRoute.projectId,
          decodeURIComponent(projectWorkspaceTerminalInputRoute.terminalId),
          body
        ));
        return;
      }

      const projectWorkspaceTerminalStreamRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminals\/(?<terminalId>[^/]+)\/stream$/);
      if (projectWorkspaceTerminalStreamRoute && request.method === "GET") {
        const { projectId: streamProjectId } = projectWorkspaceTerminalStreamRoute;
        const terminalId = decodeURIComponent(projectWorkspaceTerminalStreamRoute.terminalId);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        });

        if (operatorService.isPtyTerminalActive(terminalId)) {
          // PTY path — raw binary stream via base64
          response.write(`event: pty.connected\ndata: ${JSON.stringify({ terminalId, createdAt: new Date().toISOString() })}\n\n`);
          const cb = (data, exitInfo) => {
            if (exitInfo !== null) {
              try {
                response.write(`event: pty.exit\ndata: ${JSON.stringify({ terminalId, exitCode: exitInfo.exitCode })}\n\n`);
                response.end();
              } catch { /* response already closed */ }
              return;
            }
            try {
              const chunk = Buffer.from(data, "binary").toString("base64");
              response.write(`event: pty.data\ndata: ${JSON.stringify({ chunk })}\n\n`);
            } catch { /* response already closed */ }
          };
          operatorService.subscribeRawTerminalOutput(terminalId, cb);
          request.on("close", () => {
            operatorService.unsubscribeRawTerminalOutput(terminalId, cb);
          });
          return;
        }

        const isCliActive = operatorService.isCliTerminalActive(terminalId);
        const isPipeType = operatorService.isTerminalTypePipe(terminalId);

        if (!isCliActive && !isPipeType) {
          // Not a known live terminal — send exit immediately
          response.write(`event: pty.exit\ndata: ${JSON.stringify({ terminalId, exitCode: null })}\n\n`);
          response.end();
          return;
        }

        // Pipe terminal path — replay stored history then optionally stream live
        response.write(`event: pty.connected\ndata: ${JSON.stringify({ terminalId, createdAt: new Date().toISOString() })}\n\n`);
        const history = operatorService.getPipeTerminalHistory(streamProjectId, terminalId);
        for (const event of history) {
          let line = "";
          if (event.eventType === "process.started") {
            line = "[process started]\r\n";
          } else if (event.content) {
            line = event.content.replace(/\r?\n/g, "\r\n");
            if (!line.endsWith("\r\n")) line += "\r\n";
          }
          if (line) {
            try {
              const chunk = Buffer.from(line, "utf8").toString("base64");
              response.write(`event: pty.data\ndata: ${JSON.stringify({ chunk })}\n\n`);
            } catch { /* response already closed */ }
          }
        }

        if (isCliActive) {
          // Subscribe to live output from the running process
          const cb = (data, exitInfo) => {
            if (exitInfo !== null) {
              try {
                response.write(`event: pty.exit\ndata: ${JSON.stringify({ terminalId, exitCode: exitInfo.exitCode })}\n\n`);
                response.end();
              } catch { /* response already closed */ }
              return;
            }
            try {
              const text = data.replace(/\r?\n/g, "\r\n");
              const line = text.endsWith("\r\n") ? text : text + "\r\n";
              const chunk = Buffer.from(line, "utf8").toString("base64");
              response.write(`event: pty.data\ndata: ${JSON.stringify({ chunk })}\n\n`);
            } catch { /* response already closed */ }
          };
          operatorService.subscribePipeTerminalOutput(terminalId, cb);
          request.on("close", () => {
            operatorService.unsubscribePipeTerminalOutput(terminalId, cb);
          });
        } else {
          // Process has already exited — send exit after history replay
          response.write(`event: pty.exit\ndata: ${JSON.stringify({ terminalId, exitCode: null })}\n\n`);
          response.end();
        }
        return;
      }

      const projectWorkspaceTerminalResizeRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminals\/(?<terminalId>[^/]+)\/resize$/);
      if (projectWorkspaceTerminalResizeRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.resizeWorkspaceTerminal(
          projectWorkspaceTerminalResizeRoute.projectId,
          decodeURIComponent(projectWorkspaceTerminalResizeRoute.terminalId),
          body
        ));
        return;
      }

      const projectWorkspaceTerminalStopRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/terminals\/(?<terminalId>[^/]+)\/stop$/);
      if (projectWorkspaceTerminalStopRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.stopWorkspaceTerminalProcess(
          projectWorkspaceTerminalStopRoute.projectId,
          decodeURIComponent(projectWorkspaceTerminalStopRoute.terminalId),
          body
        ));
        return;
      }

      const projectExternalTerminalsRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/external-terminals$/);
      if (projectExternalTerminalsRoute && request.method === "GET") {
        try {
          sendJson(response, 200, await operatorService.detectExternalTerminals(projectExternalTerminalsRoute.projectId));
        } catch (err) {
          sendJson(response, 500, { error: err.message });
        }
        return;
      }
      if (projectExternalTerminalsRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.adoptExternalTerminal(projectExternalTerminalsRoute.projectId, body));
        } catch (err) {
          sendJson(response, 400, { error: err.message });
        }
        return;
      }

      const projectExternalTerminalStopRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/external-terminals\/(?<terminalId>[^/]+)\/stop$/);
      if (projectExternalTerminalStopRoute && request.method === "POST") {
        try {
          sendJson(response, 200, await operatorService.stopExternalTerminalAdoption(
            projectExternalTerminalStopRoute.projectId,
            decodeURIComponent(projectExternalTerminalStopRoute.terminalId)
          ));
        } catch (err) {
          sendJson(response, 400, { error: err.message });
        }
        return;
      }

      const projectWorkspacePlansRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/plans$/);
      if (projectWorkspacePlansRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 201, operatorService.createWorkspacePlan(projectWorkspacePlansRoute.projectId, body));
        return;
      }
      if (projectWorkspacePlansRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.listWorkspacePlans(projectWorkspacePlansRoute.projectId, {
          conversationId: url.searchParams.get("conversationId") ?? null
        }));
        return;
      }

      const projectWorkspacePlanRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/plans\/(?<planId>[^/]+)$/);
      if (projectWorkspacePlanRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.getWorkspacePlanState(
          projectWorkspacePlanRoute.projectId,
          projectWorkspacePlanRoute.planId
        ));
        return;
      }

      const projectWorkspacePlanActivateRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/plans\/(?<planId>[^/]+)\/activate$/);
      if (projectWorkspacePlanActivateRoute && request.method === "POST") {
        sendJson(response, 200, operatorService.activateWorkspacePlan(
          projectWorkspacePlanActivateRoute.projectId,
          projectWorkspacePlanActivateRoute.planId
        ));
        return;
      }

      const projectWorkspacePlanStageRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/plans\/(?<planId>[^/]+)\/stages\/(?<stageId>[^/]+)$/);
      if (projectWorkspacePlanStageRoute && request.method === "PATCH") {
        const body = await readJsonBody(request);
        sendJson(response, 200, operatorService.resolveWorkspacePlanStage(
          projectWorkspacePlanStageRoute.projectId,
          projectWorkspacePlanStageRoute.planId,
          projectWorkspacePlanStageRoute.stageId,
          body
        ));
        return;
      }

      const projectTokenUsageRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/token-usage$/);
      if (projectTokenUsageRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.getTokenUsageSummary(projectTokenUsageRoute.projectId));
        return;
      }

      const projectBrowserRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/browser$/);
      if (projectBrowserRoute && request.method === "GET") {
        sendJson(response, 200, operatorService.getWorkspaceBrowserState(projectBrowserRoute.projectId));
        return;
      }
      const projectBrowserOpenRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/workspace\/browser\/open$/);
      if (projectBrowserOpenRoute && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        try {
          const session = await operatorService.openWorkspaceBrowserSession(projectBrowserOpenRoute.projectId, { url: body.url ?? null });
          sendJson(response, 200, { session });
        } catch (err) {
          sendJson(response, 500, { error: err.message });
        }
        return;
      }
      const projectAllowlistRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)\/allowlisted-domains$/);
      if (projectAllowlistRoute && request.method === "PUT") {
        const body = await readJsonBody(request);
        const project = operatorService.updateProjectAllowlistedDomains(projectAllowlistRoute.projectId, body.domains ?? []);
        sendJson(response, 200, { allowlistedDomains: project?.allowlistedDomains ?? [] });
        return;
      }

      // ─── Mobile Gateway Routes ────────────────────────────────────────

      if (pathname === "/api/mobile/server-info" && request.method === "GET") {
        const { scheme: si_scheme, port: si_port } = serverInfo;
        // Recompute the LAN IP per request so a DHCP reassignment doesn't leave
        // the advertised URL/QR pointing at a stale address (a silent "mobile
        // can't connect" cause). Refresh the cache too for log consistency.
        const lanIp = getLanIp();
        serverInfo.lanIp = lanIp;
        const publicUrl = process.env.COWORK_PUBLIC_URL ?? null;
        const network = buildNetworkAdvice(os.networkInterfaces(), {
          scheme: si_scheme, port: si_port, primaryLanIp: lanIp
        });
        sendJson(response, 200, {
          scheme: si_scheme,
          lanUrl: `${si_scheme}://${lanIp}:${si_port}`,
          mobileUrl: `${si_scheme}://${lanIp}:${si_port}/mobile/`,
          publicUrl,
          tls: Boolean(tlsCredentials),
          lanEnabled: bindHost === "0.0.0.0",
          network
        });
        return;
      }

      if (pathname === "/api/mobile/pairing/start" && request.method === "POST") {
        try {
          const pairing = operatorService.startMobilePairing();
          const { scheme: si_scheme, port: si_port } = serverInfo;
          const lanIp = getLanIp();
          serverInfo.lanIp = lanIp;
          const publicUrl = process.env.COWORK_PUBLIC_URL ?? null;
          const lanBase = `${si_scheme}://${lanIp}:${si_port}`;
          const pairingUrl = `${publicUrl ?? lanBase}/mobile/?code=${pairing.pairingCode}`;
          let qrDataUri = null;
          try { qrDataUri = await QRCode.toDataURL(pairingUrl, { margin: 2, width: 240 }); } catch {}

          // VPN-aware pairing advice: warn if a VPN is active and offer alternate
          // (Tailscale) URLs/QRs that survive LAN isolation.
          const network = buildNetworkAdvice(os.networkInterfaces(), {
            scheme: si_scheme, port: si_port, primaryLanIp: lanIp, pairingCode: pairing.pairingCode
          });
          for (const alternate of network.alternates ?? []) {
            try { alternate.qrDataUri = await QRCode.toDataURL(alternate.pairingUrl, { margin: 2, width: 240 }); }
            catch { alternate.qrDataUri = null; }
          }

          sendJson(response, 200, {
            ...pairing,
            lanUrl: lanBase,
            publicUrl,
            pairingUrl,
            qrDataUri,
            lanEnabled: bindHost === "0.0.0.0",
            network
          });
        } catch (err) {
          sendError(response, 400, err.message);
        }
        return;
      }

      if (pathname === "/api/mobile/pairing/confirm" && request.method === "POST") {
        const body = await readJsonBody(request);
        try {
          const result = operatorService.confirmMobilePairing(body.pairingCode, {
            deviceName: body.deviceName,
            deviceFingerprint: body.deviceFingerprint
          });
          sendJson(response, 200, result);
        } catch (err) {
          sendError(response, 400, err.message);
        }
        return;
      }

      if (pathname === "/api/mobile/session/revoke" && request.method === "POST") {
        const authHeader = request.headers["authorization"] ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (token) operatorService.revokeMobileSession(token);
        sendJson(response, 200, { revoked: true });
        return;
      }

      if (pathname === "/api/mobile/client/logs" && request.method === "POST") {
        const authHeader = request.headers["authorization"] ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const session = token ? operatorService.validateMobileSession(token) : null;
        try {
          const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
          const result = operatorService.recordMobileClientLogs(body.entries ?? body.logs ?? body, {
            deviceId: session?.device?.id ?? null,
            token,
            sessionStatus: session ? "valid" : token ? "invalid" : "anonymous"
          });
          sendJson(response, 200, { ok: true, ...result });
        } catch (err) {
          sendError(response, err.code === "PAYLOAD_TOO_LARGE" ? 413 : 400, err.message);
        }
        return;
      }

      // All routes below require a valid mobile session token
      const mobileAuthHeader = request.headers["authorization"] ?? "";
      const mobileToken = mobileAuthHeader.startsWith("Bearer ") ? mobileAuthHeader.slice(7) : null;
      const mobileSession = mobileToken ? operatorService.validateMobileSession(mobileToken) : null;

      if (pathname === "/api/mobile/session/status" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, { active: true, ...operatorService.mobileDeviceRegistry.getSessionInfo(mobileToken) });
        return;
      }

      if (pathname === "/api/mobile/events" && request.method === "GET") {
        // EventSource cannot send Authorization headers — accept token from query param as fallback
        const sseUrl = new URL(request.url, "http://localhost");
        const sseQueryToken = sseUrl.searchParams.get("token") ?? null;
        const sseSession = mobileSession ?? (sseQueryToken ? operatorService.validateMobileSession(sseQueryToken) : null);
        if (!sseSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const since = sseUrl.searchParams.get("since") ?? null;
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*"
        });
        response.write(": jon-mobile-events\n\n");
        const flushBuffer = () => {
          const events = operatorService.getMobileEventsSince(since);
          for (const event of events) {
            writeSse(response, "mobile.event", event);
          }
        };
        flushBuffer();
        const unsub = operatorService.subscribeMobileEvents((event) => {
          writeSse(response, "mobile.event", event);
        });
        const heartbeat = setInterval(() => {
          try { response.write(": heartbeat\n\n"); } catch {}
        }, 25000);
        request.on("close", () => {
          clearInterval(heartbeat);
          unsub();
        });
        return;
      }

      const mobileRunsRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/runs$/);
      if (mobileRunsRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, operatorService.getMobileRuns(mobileRunsRoute.projectId));
        return;
      }

      const mobileApprovalsRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/approvals$/);
      if (mobileApprovalsRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, operatorService.getMobilePendingApprovals(mobileApprovalsRoute.projectId));
        return;
      }

      // Mobile: list a run's artifacts with their downloadable deliverables.
      const mobileRunArtifactsRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/runs\/(?<runId>[^/]+)\/artifacts$/);
      if (mobileRunArtifactsRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, operatorService.listRunArtifactsWithDeliverables(mobileRunArtifactsRoute.runId));
        return;
      }

      // Mobile: download a binary deliverable (auth-checked, then streamed).
      const mobileDeliverableRoute = matchRoute(pathname, /^\/api\/mobile\/runs\/(?<runId>[^/]+)\/artifacts\/(?<artifactId>[^/]+)\/deliverable\/(?<format>[a-z0-9]+)$/);
      if (mobileDeliverableRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const deliverable = await operatorService.readArtifactDeliverable(
          mobileDeliverableRoute.runId,
          mobileDeliverableRoute.artifactId,
          mobileDeliverableRoute.format
        );
        if (!deliverable) { sendError(response, 404, "Deliverable not found"); return; }
        const content = await fs.readFile(deliverable.filePath);
        response.writeHead(200, {
          "content-type": deliverable.mime,
          "content-disposition": `attachment; filename="${deliverable.downloadName}"`,
          "cache-control": "no-store"
        });
        response.end(content);
        return;
      }

      const mobileTerminalsRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/terminals$/);
      if (mobileTerminalsRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, operatorService.getMobileTerminals(mobileTerminalsRoute.projectId));
        return;
      }

      const mobileScreenshotRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/screenshot$/);
      if (mobileScreenshotRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const screenshot = await operatorService.requestMobileScreenshot(mobileScreenshotRoute.projectId);
        sendJson(response, 200, { screenshotBase64: screenshot ?? null });
        return;
      }

      const mobileDesktopStateRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/desktop\/state$/);
      if (mobileDesktopStateRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, await operatorService.getMobileDesktopState(mobileDesktopStateRoute.projectId));
        return;
      }

      const mobileDesktopActionRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/desktop\/action$/);
      if (mobileDesktopActionRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          const result = await operatorService.dispatchMobileDesktopAction(
            mobileDesktopActionRoute.projectId,
            body.action ?? body,
            { deviceId: mobileSession.device.id, token: mobileToken }
          );
          sendJson(response, 200, { ok: true, ...result });
        } catch (err) {
          sendError(response, err.code === "MOBILE_CONTROL_DISABLED" ? 403 : 400, err.message);
        }
        return;
      }

      const mobileControlStateRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/control\/state$/);
      if (mobileControlStateRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, await operatorService.getMobileControlState(mobileControlStateRoute.projectId));
        return;
      }

      const mobileControlActionRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/control\/action$/);
      if (mobileControlActionRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          const result = await operatorService.dispatchMobileControlAction(
            mobileControlActionRoute.projectId,
            body.action ?? body,
            { deviceId: mobileSession.device.id, token: mobileToken }
          );
          sendJson(response, 200, { ok: true, ...result });
        } catch (err) {
          sendError(response, err.code === "MOBILE_CONTROL_DISABLED" ? 403 : 400, err.message);
        }
        return;
      }

      const mobileBrowserTabsRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/browser\/tabs$/);
      if (mobileBrowserTabsRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, await operatorService.getMobileBrowserTabs(mobileBrowserTabsRoute.projectId));
        return;
      }

      const mobileBrowserTabsActionRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/browser\/tabs\/action$/);
      if (mobileBrowserTabsActionRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          const result = await operatorService.dispatchMobileBrowserTabAction(
            mobileBrowserTabsActionRoute.projectId,
            body.action ?? body,
            { deviceId: mobileSession.device.id, token: mobileToken }
          );
          sendJson(response, 200, { ok: true, ...result });
        } catch (err) {
          sendError(response, err.code === "MOBILE_CONTROL_DISABLED" ? 403 : 400, err.message);
        }
        return;
      }

      // Agentic natural-language mission scoped to one browser tab.
      const mobileTabMissionRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/browser\/tabs\/(?<targetId>[^/]+)\/mission$/);
      if (mobileTabMissionRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.dispatchMobileTabMission(
            mobileTabMissionRoute.projectId,
            decodeURIComponent(mobileTabMissionRoute.targetId),
            body.instruction ?? body.objective ?? ""
          ));
        } catch (err) {
          sendError(response, err.code === "MOBILE_CONTROL_DISABLED" ? 403 : 400, err.message, { code: err.code });
        }
        return;
      }

      // ── Connectors ───────────────────────────────────────────────────────────
      if (pathname === "/api/mobile/connectors" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, { connectors: operatorService.listConnectors() });
        return;
      }

      // ── MCP connectors (OAuth-fluent tool integrations) ──
      if (pathname === "/api/mobile/mcp/providers" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, { providers: operatorService.listMcpProviders() });
        return;
      }
      if (pathname === "/api/mobile/mcp/connectors" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, { connectors: operatorService.listMcpConnectors(), tools: operatorService.listConnectedMcpTools() });
        return;
      }
      if (pathname === "/api/mobile/mcp/catalog" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, { catalog: operatorService.listMcpCatalog() });
        return;
      }

      // Mobile: preview a mission plan before executing ("propose plan first").
      const mobilePreflightRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/missions\/preflight$/);
      if (mobilePreflightRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.previewMission(mobilePreflightRoute.projectId, body));
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      if (pathname === "/api/mobile/mcp/remote/connect" && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.connectRemoteMcpServer(body.connectorId ?? body.server, body.server ?? body, { scopes: body.scopes ?? null }));
        } catch (err) { sendError(response, 400, err.message, { code: err.code }); }
        return;
      }
      if (pathname === "/api/mobile/mcp/oauth/start" && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.startMcpOAuthConnect(
            body.connectorId ?? body.provider,
            body.providerConfig ?? body.provider,
            { scopes: body.scopes ?? null }
          ));
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      if (pathname === "/api/mobile/mcp/stdio/connect" && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.connectMcpStdio(body.connectorId, body.connection ?? body));
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      const mcpStatusRoute = matchRoute(pathname, /^\/api\/mobile\/mcp\/(?<connectorId>[^/]+)\/status$/);
      if (mcpStatusRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, operatorService.getMcpConnectorStatus(mcpStatusRoute.connectorId));
        return;
      }
      const mcpToolsRoute = matchRoute(pathname, /^\/api\/mobile\/mcp\/(?<connectorId>[^/]+)\/tools$/);
      if (mcpToolsRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        try {
          sendJson(response, 200, { tools: await operatorService.listMcpTools(mcpToolsRoute.connectorId) });
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      const mcpCallRoute = matchRoute(pathname, /^\/api\/mobile\/mcp\/(?<connectorId>[^/]+)\/call$/);
      if (mcpCallRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await operatorService.callMcpTool(mcpCallRoute.connectorId, body.tool, body.args ?? {}));
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      const mcpDisconnectRoute = matchRoute(pathname, /^\/api\/mobile\/mcp\/(?<connectorId>[^/]+)$/);
      if (mcpDisconnectRoute && request.method === "DELETE") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, await operatorService.disconnectMcpConnector(mcpDisconnectRoute.connectorId));
        return;
      }
      if (pathname === "/api/mobile/connectors" && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          sendJson(response, 201, {
            connector: await operatorService.addConnector({
              ...(body.connector ?? body),
              source: "mobile_configured"
            })
          });
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }

      const connectorRoute = matchRoute(pathname, /^\/api\/mobile\/connectors\/(?<connectorId>[^/]+)$/);
      if (connectorRoute && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        try {
          sendJson(response, 200, operatorService.getConnector(connectorRoute.connectorId));
        } catch (err) {
          sendError(response, 404, err.message);
        }
        return;
      }

      if (pathname === "/api/mobile/connectors/email_draft/drafts" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        sendJson(response, 200, { drafts: await operatorService.listConnectorDrafts() });
        return;
      }

      if (pathname === "/api/mobile/connectors/email_draft/draft" && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          const result = await operatorService.draftEmailViaConnector({
            to: body.to,
            subject: body.subject,
            body: body.body,
            runId: body.runId ?? null,
            requestedBy: mobileSession?.device?.id ?? null
          });
          sendJson(response, 200, { ok: true, ...result });
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────

      if (pathname === "/api/mobile/status" && request.method === "GET") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const projects = operatorService.listProjects();
        sendJson(response, 200, operatorService.getMobileStatus(projects[0]?.id ?? null));
        return;
      }

      if (pathname === "/api/mobile/admin/devices" && request.method === "GET") {
        sendJson(response, 200, operatorService.mobileDeviceRegistry.listDevices());
        return;
      }

      const mobileRevokeDeviceRoute = matchRoute(pathname, /^\/api\/mobile\/admin\/devices\/(?<deviceId>[^/]+)\/revoke$/);
      if (mobileRevokeDeviceRoute && request.method === "POST") {
        const ok = operatorService.revokeMobileDevice(mobileRevokeDeviceRoute.deviceId);
        sendJson(response, 200, { revoked: ok });
        return;
      }

      if (pathname === "/api/mobile/admin/audit" && request.method === "GET") {
        sendJson(response, 200, operatorService.mobileAuditLog.list({ limit: 100 }));
        return;
      }

      const mobileCommandsRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/commands$/);
      if (mobileCommandsRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        try {
          const result = await operatorService.dispatchMobileCommand(
            body.command,
            { ...body.params, _deviceId: mobileSession.device.id },
            { projectId: mobileCommandsRoute.projectId, deviceId: mobileSession.device.id, token: mobileToken }
          );
          sendJson(response, 200, { ok: true, result });
        } catch (err) {
          sendError(response, err.code === "BLOCKED_COMMAND" ? 403 : 400, err.message);
        }
        return;
      }

      const mobileApprovalRoute = matchRoute(pathname, /^\/api\/mobile\/approvals\/(?<approvalId>[^/]+)\/respond$/);
      if (mobileApprovalRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        const decision = body.decision === "approve" ? "approved_once" : "stop_run";
        try {
          await operatorService.resolveApproval(mobileApprovalRoute.approvalId, decision, { source: "mobile", deviceId: mobileSession.device.id });
          sendJson(response, 200, { resolved: true, decision });
        } catch (err) {
          sendError(response, 400, err.message);
        }
        return;
      }

      const llmInlineResolveRoute = matchRoute(pathname, /^\/api\/mobile\/projects\/(?<projectId>[^/]+)\/llm-inline-resolve$/);
      if (llmInlineResolveRoute && request.method === "POST") {
        if (!mobileSession) { sendError(response, 401, "Invalid or expired session"); return; }
        const body = await readJsonBody(request);
        const rawText = String(body?.text ?? "");
        const contextType = String(body?.contextType ?? "type_text");
        try {
          const result = await operatorService.resolveLlmInlineText(llmInlineResolveRoute.projectId, rawText, contextType);
          sendJson(response, 200, result);
        } catch (err) {
          sendError(response, 400, err.message, { code: err.code });
        }
        return;
      }

      // ─────────────────────────────────────────────────────────────────

      const projectRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)$/);
      if (projectRoute && request.method === "DELETE") {
        sendJson(response, 200, await operatorService.deleteProject(projectRoute.projectId));
        return;
      }

      const runRecoverRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/recover$/);
      if (runRecoverRoute && request.method === "POST") {
        sendJson(response, 200, await operatorService.recoverIncompleteMission(decodeURIComponent(runRecoverRoute.runId)));
        return;
      }

      const runRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)$/);
      if (runRoute && request.method === "GET") {
        const detail = await operatorService.getRunDetail(runRoute.runId, {
          locale: url.searchParams.get("locale")
        });
        if (!detail) {
          sendError(response, 404, "Run not found");
          return;
        }
        sendJson(response, 200, detail);
        return;
      }
      if (runRoute && request.method === "DELETE") {
        sendJson(response, 200, await operatorService.deleteRun(runRoute.runId));
        return;
      }

      const artifactRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/artifacts\/(?<artifactId>[^/]+)\/content$/);
      if (artifactRoute && request.method === "GET") {
        const artifactContent = await operatorService.readArtifactContent(artifactRoute.runId, artifactRoute.artifactId);
        if (!artifactContent) {
          sendError(response, 404, "Artifact not found");
          return;
        }
        sendJson(response, 200, artifactContent);
        return;
      }

      const artifactDeliverableRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/artifacts\/(?<artifactId>[^/]+)\/deliverable\/(?<format>[a-z0-9]+)$/);
      if (artifactDeliverableRoute && request.method === "GET") {
        const deliverable = await operatorService.readArtifactDeliverable(
          artifactDeliverableRoute.runId,
          artifactDeliverableRoute.artifactId,
          artifactDeliverableRoute.format
        );
        if (!deliverable) {
          sendError(response, 404, "Deliverable not found");
          return;
        }
        const content = await fs.readFile(deliverable.filePath);
        response.writeHead(200, {
          "content-type": deliverable.mime,
          "content-disposition": `attachment; filename="${deliverable.downloadName}"`,
          "cache-control": "no-store"
        });
        response.end(content);
        return;
      }

      const conversationArtifactRoute = matchRoute(pathname, /^\/api\/conversation\/artifacts\/(?<artifactId>[^/]+)\/content$/);
      if (conversationArtifactRoute && request.method === "GET") {
        const artifactContent = await operatorService.readConversationArtifact(conversationArtifactRoute.artifactId);
        if (!artifactContent) {
          sendError(response, 404, "Artifact not found");
          return;
        }
        sendJson(response, 200, artifactContent);
        return;
      }

      const artifactDeleteRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/artifacts\/(?<artifactId>[^/]+)$/);
      if (artifactDeleteRoute && request.method === "DELETE") {
        sendJson(response, 200, await operatorService.deleteArtifact(artifactDeleteRoute.runId, artifactDeleteRoute.artifactId));
        return;
      }

      const evidenceManifestRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/evidence\/(?<evidenceId>[^/]+)\/manifest$/);
      if (evidenceManifestRoute && request.method === "GET") {
        const manifest = await operatorService.readEvidenceManifest(evidenceManifestRoute.runId, evidenceManifestRoute.evidenceId);
        if (!manifest) {
          sendError(response, 404, "Evidence manifest not found");
          return;
        }
        sendJson(response, 200, manifest);
        return;
      }

      const evidenceScreenshotRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/evidence\/(?<evidenceId>[^/]+)\/screenshot$/);
      if (evidenceScreenshotRoute && request.method === "GET") {
        const screenshot = await operatorService.readEvidenceAsset(
          evidenceScreenshotRoute.runId,
          evidenceScreenshotRoute.evidenceId,
          "screenshot"
        );
        if (!screenshot) {
          sendError(response, 404, "Evidence screenshot not found");
          return;
        }
        const content = await fs.readFile(screenshot.filePath);
        response.writeHead(200, {
          "content-type": contentTypeFor(screenshot.filePath),
          "cache-control": "no-store"
        });
        response.end(content);
        return;
      }

      const evidenceDeleteRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/evidence\/(?<evidenceId>[^/]+)$/);
      if (evidenceDeleteRoute && request.method === "DELETE") {
        sendJson(response, 200, await operatorService.deleteEvidence(evidenceDeleteRoute.runId, evidenceDeleteRoute.evidenceId));
        return;
      }

      const approvalRoute = matchRoute(pathname, /^\/api\/approvals\/(?<approvalId>[^/]+)\/decision$/);
      if (approvalRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.resolveApproval(
          approvalRoute.approvalId,
          body.decision,
          body.rationale ?? null
        ));
        return;
      }

      // Global emergency stop — works for desktop and mobile, mid-step or paused.
      const emergencyStopRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)\/stop$/);
      if (emergencyStopRoute && request.method === "POST") {
        sendJson(response, 200, await operatorService.requestEmergencyStop(emergencyStopRoute.runId));
        return;
      }

      const mobileEmergencyStopRoute = matchRoute(pathname, /^\/api\/mobile\/runs\/(?<runId>[^/]+)\/stop$/);
      if (mobileEmergencyStopRoute && request.method === "POST") {
        sendJson(response, 200, await operatorService.requestEmergencyStop(mobileEmergencyStopRoute.runId));
        return;
      }

      if ((pathname === "/api/system/self-check" || pathname === "/api/mobile/system/self-check") && request.method === "GET") {
        sendJson(response, 200, await operatorService.getSelfCheck());
        return;
      }

      if (pathname === "/api/benchmarks/latest" && request.method === "GET") {
        sendJson(response, 200, {
          latest: await operatorService.getLatestBenchmarkReport(),
          history: await operatorService.listBenchmarkReports({ limit: 5 })
        });
        return;
      }

      if (pathname === "/api/benchmarks/run" && request.method === "POST") {
        sendJson(response, 200, {
          report: await operatorService.runBenchmarks()
        });
        return;
      }

      const benchmarkReviewRoute = matchRoute(pathname, /^\/api\/benchmarks\/(?<createdAt>[^/]+)\/review$/);
      if (benchmarkReviewRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          report: await operatorService.submitBenchmarkReview({
            createdAt: decodeURIComponent(benchmarkReviewRoute.createdAt),
            suiteId: body.suiteId,
            classification: body.classification,
            notes: body.notes ?? "",
            reviewer: body.reviewer ?? "operator"
          })
        });
        return;
      }

      if (pathname === "/api/runtime/cleanup-temp" && request.method === "POST") {
        sendJson(response, 200, await operatorService.clearTemporaryRuntimeState());
        return;
      }

      const servedStatic = await serveStaticAsset(response, pathname);
      if (!servedStatic) {
        sendError(response, 404, "Route not found");
      }
    } catch (error) {
      if (error.code === "PAYLOAD_TOO_LARGE") {
        sendError(response, 413, "Payload Too Large");
        return;
      }
      if (error.code === "INVALID_JSON") {
        sendError(response, 400, "Invalid JSON in request body");
        return;
      }
      console.error(`[operator-server] ${error.message}`);
      sendError(response, 500, error.message, shouldExposeDebugDetails() ? error.stack : null);
    }
  };

  const server = tlsCredentials
    ? https.createServer({ key: tlsCredentials.key, cert: tlsCredentials.cert }, requestHandler)
    : http.createServer(requestHandler);

  // Default: bind on all interfaces so mobile can connect without config.
  // Set COWORK_BIND_HOST=127.0.0.1 to restrict to localhost only.
  // Set COWORK_LAN=1 to force LAN exposure even if a shell sets COWORK_BIND_HOST.
  const bindHost = process.env.COWORK_LAN === "1"
    ? "0.0.0.0"
    : (process.env.COWORK_BIND_HOST ?? "0.0.0.0");
  await new Promise((resolve) => server.listen(port, bindHost, resolve));
  attachMobileTerminalWs(server, {
    validateSession: (token) => operatorService.validateMobileSession(token),
    screenStream: { captureFrame: () => operatorService.captureScreenFrame() }
  });
  operatorService.attachBrowserExtensionWs(server);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const actualHost = typeof address === "object" && address ? address.address : bindHost;
  // When bound to 0.0.0.0, the desktop shell uses loopback to reach its own server.
  const localHost = actualHost === "0.0.0.0" ? "127.0.0.1" : actualHost;

  const scheme = tlsCredentials ? "https" : "http";
  serverInfo.scheme = scheme;
  serverInfo.port = actualPort;
  if (tlsCredentials) {
    console.log(`[TLS] HTTPS on ${bindHost}:${actualPort} — cert: ${path.join(TLS_DIR, "jon-local.crt")}`);
  }
  if (bindHost === "0.0.0.0") {
    console.log(`[LAN] Mobile: ${scheme}://${serverInfo.lanIp}:${actualPort}/mobile/`);
  }

  // Startup self-test: surface broken subsystems immediately instead of failing
  // mid-mission. Non-blocking — never prevents the server from serving.
  operatorService.getSelfCheck()
    .then((report) => {
      const tag = report.ok ? "[SELF-CHECK ok]" : "[SELF-CHECK ATTENTION]";
      console.log(`${tag} ${report.summary}`);
    })
    .catch(() => { /* self-check must never crash startup */ });

  return {
    port: actualPort,
    baseUrl: `${scheme}://${localHost}:${actualPort}`,
    lanUrl: `${scheme}://${serverInfo.lanIp}:${actualPort}`,
    tls: Boolean(tlsCredentials),
    operatorService,
    async close({ timeoutMs = 0 } = {}) {
      operatorService.off("state.changed", handleStateChanged);
      for (const response of eventSubscribers) {
        response.end();
      }
      eventSubscribers.clear();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await operatorService.close({ timeoutMs });
    }
  };
}
