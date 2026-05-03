import assert from "node:assert/strict";
import http from "node:http";
import { runRealSurfaceSmokePipeline } from "../src/smoke/real-surface-smoke-pipeline.js";

const PDF_BYTES = Buffer.from(`%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);

async function createSmokeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/canvas") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><canvas id="chart" width="240" height="120"></canvas><script>
        const ctx = document.getElementById('chart').getContext('2d');
        ctx.fillStyle = '#1473e6';
        ctx.fillRect(0, 0, 240, 120);
        ctx.fillStyle = '#fff';
        ctx.font = '20px sans-serif';
        ctx.fillText('Canvas Smoke', 30, 64);
      </script></body></html>`);
      return;
    }
    if (url.pathname === "/dropdown") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><form><select id="region">
        <option value="">Choose</option><option value="eu">Europe</option><option value="us">US</option>
      </select><p id="selected"></p><button type="submit">Submit</button></form><script>
        document.getElementById('region').addEventListener('change', (event) => {
          document.getElementById('selected').textContent = 'selected=' + event.target.value;
        });
      </script></body></html>`);
      return;
    }
    if (url.pathname === "/slow") {
      await new Promise((resolve) => setTimeout(resolve, 120));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><main id=\"ready\">Slow page ready</main></body></html>");
      return;
    }
    if (url.pathname === "/doc.pdf") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(PDF_BYTES);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

export async function run() {
  const server = await createSmokeServer();
  try {
    const report = await runRealSurfaceSmokePipeline({
      persist: false,
      runner: "test",
      config: {
        allowHttp: true,
        allowLoopback: true,
        targets: {
          canvas: {
            url: `${server.baseUrl}/canvas`,
            minCanvasCount: 1
          },
          pdf: {
            url: `${server.baseUrl}/doc.pdf`
          },
          dropdown: {
            url: `${server.baseUrl}/dropdown`,
            selectSelector: "#region",
            optionValue: "eu",
            expectedTextSelector: "#selected"
          },
          networkError: {
            url: `${server.baseUrl}/missing`,
            expectFailure: true
          },
          slowPage: {
            url: `${server.baseUrl}/slow`,
            readySelector: "#ready",
            minElapsedMs: 80
          }
        }
      }
    });

    assert.equal(report.status, "degraded");
    assert.equal(report.summary.passed, 5);
    assert.equal(report.summary.blocked, 1);
    assert.equal(report.cases.find((entry) => entry.id === "real_web_canvas_probe")?.status, "pass");
    assert.equal(report.cases.find((entry) => entry.id === "real_web_pdf_probe")?.status, "pass");
    assert.equal(report.cases.find((entry) => entry.id === "real_web_dropdown_probe")?.status, "pass");
    assert.equal(report.cases.find((entry) => entry.id === "real_web_network_error_probe")?.status, "pass");
    assert.equal(report.cases.find((entry) => entry.id === "real_web_slow_page_probe")?.status, "pass");
    assert.equal(report.cases.find((entry) => entry.id === "real_web_operator_research")?.status, "blocked");
  } finally {
    await server.close();
  }
}
