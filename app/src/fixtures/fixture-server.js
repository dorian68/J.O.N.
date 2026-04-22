import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { APP_ROOT, DEFAULT_SERVER_PORT } from "../config.js";

const FIXTURE_ROOT = path.join(APP_ROOT, "fixtures", "browser");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath)) ?? "text/plain; charset=utf-8";
}

function fixtureManifest(baseUrl) {
  return {
    baseUrl,
    hub: `${baseUrl}/index.html`,
    companies: [
      `${baseUrl}/company-alpha.html`,
      `${baseUrl}/company-beta.html`,
      `${baseUrl}/company-gamma.html`
    ],
    form: `${baseUrl}/form-simple.html`,
    longScroll: `${baseUrl}/long-scroll.html`,
    modal: `${baseUrl}/modal-blocker.html`,
    ambiguous: `${baseUrl}/ambiguous-targets.html`,
    outcome: `${baseUrl}/outcome-status.html`,
    authExpired: `${baseUrl}/auth-expired.html`
  };
}

async function listenWithFallback(server, preferredPort) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(preferredPort, "127.0.0.1");
  });
}

export async function createFixtureServer({ port = DEFAULT_SERVER_PORT } = {}) {
  let activePort = port;
  const server = http.createServer(async (request, response) => {
    try {
      if (!request.url) {
        response.writeHead(400).end("Missing URL");
        return;
      }
      const url = new URL(request.url, `http://127.0.0.1:${activePort}`);
      if (url.pathname === "/manifest.json") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8"
        });
        response.end(JSON.stringify(fixtureManifest(`http://127.0.0.1:${activePort}`), null, 2));
        return;
      }

      const requested = url.pathname === "/" ? "/index.html" : url.pathname;
      const targetPath = path.normalize(path.join(FIXTURE_ROOT, requested));
      if (!targetPath.startsWith(FIXTURE_ROOT)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const content = await fs.readFile(targetPath);
      response.writeHead(200, {
        "content-type": contentTypeFor(targetPath)
      });
      response.end(content);
    } catch (error) {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8"
      });
      response.end(`Fixture not found: ${error.message}`);
    }
  });

  try {
    await listenWithFallback(server, port);
  } catch (error) {
    if (error?.code !== "EADDRINUSE" || port !== DEFAULT_SERVER_PORT) {
      throw error;
    }
    await listenWithFallback(server, 0);
  }

  const address = server.address();
  activePort = typeof address === "object" && address?.port ? address.port : port;
  const baseUrl = `http://127.0.0.1:${activePort}`;

  return {
    port: activePort,
    baseUrl,
    manifest: fixtureManifest(baseUrl),
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
