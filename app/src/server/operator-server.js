import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { APP_ROOT, DEFAULT_OPERATOR_PORT } from "../config.js";
import { OperatorService } from "../service/operator-service.js";

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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function matchRoute(pathname, expression) {
  const match = pathname.match(expression);
  return match?.groups ?? null;
}

async function serveStaticAsset(response, pathname) {
  const requested = pathname === "/"
    ? "/index.html"
    : pathname === "/admin" || pathname === "/admin/"
      ? "/admin.html"
      : pathname;
  const assetPath = path.normalize(path.join(UI_ROOT, requested));
  if (!assetPath.startsWith(UI_ROOT)) {
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

export async function createOperatorServer({
  port = DEFAULT_OPERATOR_PORT,
  operatorServiceOptions = {}
} = {}) {
  const operatorService = await OperatorService.create(operatorServiceOptions);
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

  const server = http.createServer(async (request, response) => {
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
          fixtureBaseUrl: operatorService.fixtureManifest.baseUrl
        });
        return;
      }

      if (pathname === "/api/dashboard" && request.method === "GET") {
        sendJson(response, 200, await operatorService.getDashboard(url.searchParams.get("projectId")));
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
      if (pathname === "/api/capabilities/feedback" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await operatorService.recordOperatorCapabilityFeedback(body));
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

      const projectRoute = matchRoute(pathname, /^\/api\/projects\/(?<projectId>[^/]+)$/);
      if (projectRoute && request.method === "DELETE") {
        sendJson(response, 200, await operatorService.deleteProject(projectRoute.projectId));
        return;
      }

      const runRoute = matchRoute(pathname, /^\/api\/runs\/(?<runId>[^/]+)$/);
      if (runRoute && request.method === "GET") {
        const detail = await operatorService.getRunDetail(runRoute.runId);
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
      console.error(`[operator-server] ${error.message}`);
      sendError(response, 500, error.message, error.stack);
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    operatorService,
    async close() {
      operatorService.off("state.changed", handleStateChanged);
      for (const response of eventSubscribers) {
        response.end();
      }
      eventSubscribers.clear();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await operatorService.close();
    }
  };
}
