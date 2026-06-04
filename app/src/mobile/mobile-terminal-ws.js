import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let _WebSocketServer = null;
let _nodePty = null;
try { ({ WebSocketServer: _WebSocketServer } = require("ws")); } catch {}
try { _nodePty = require("node-pty"); } catch {}

const MAX_ACTIVE_SHELLS = 10;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function getShell() {
  return process.platform === "win32" ? "powershell.exe" : (process.env.SHELL ?? "bash");
}

export function attachMobileTerminalWs(httpServer, { validateSession, screenStream = null }) {
  if (!_WebSocketServer) {
    console.warn("[mobile-terminal] ws package not available — interactive terminal disabled.");
    return;
  }
  const terminalEnabled = Boolean(_nodePty);
  if (!terminalEnabled) {
    console.warn("[mobile-terminal] node-pty not available — interactive terminal disabled (screen stream still available).");
  }

  const wss = new _WebSocketServer({ noServer: true });
  const screenWss = new _WebSocketServer({ noServer: true });
  let activeCount = 0;

  // Single upgrade router for ALL mobile WebSocket paths — avoids the
  // multiple-listener socket.destroy() conflict.
  httpServer.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(request.url, "http://x");
      const path = url.pathname;
      if (path !== "/api/mobile/terminal/ws" && path !== "/api/mobile/screen/ws") {
        return; // not ours — let other listeners handle (or it times out)
      }

      const token = url.searchParams.get("token");
      if (!token || !validateSession(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
        socket.destroy();
        return;
      }

      if (path === "/api/mobile/screen/ws") {
        if (!screenStream?.captureFrame) { socket.destroy(); return; }
        screenWss.handleUpgrade(request, socket, head, (ws) => handleScreenStream(ws));
        return;
      }

      if (!terminalEnabled) {
        socket.write("HTTP/1.1 503 Terminal Unavailable\r\nContent-Length: 0\r\n\r\n");
        socket.destroy();
        return;
      }
      if (activeCount >= MAX_ACTIVE_SHELLS) {
        socket.write("HTTP/1.1 503 Too Many Sessions\r\nContent-Length: 0\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const cols = Math.max(10, Math.min(500, Number(url.searchParams.get("cols")) || DEFAULT_COLS));
        const rows = Math.max(5, Math.min(200, Number(url.searchParams.get("rows")) || DEFAULT_ROWS));
        handleShell(ws, { cols, rows });
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  // Screen stream: server-paced capture loop, pushing JPEG frames (binary) with
  // a small JSON metadata frame, at the bandwidth governor's recommended cadence.
  function handleScreenStream(ws) {
    let stopped = false;
    ws.on("close", () => { stopped = true; });
    ws.on("error", () => { stopped = true; });
    (async () => {
      while (!stopped && ws.readyState === 1) {
        let frame = null;
        try {
          frame = await screenStream.captureFrame();
        } catch (error) {
          try { ws.send(JSON.stringify({ type: "error", message: String(error?.message ?? error) })); } catch {}
        }
        if (stopped || ws.readyState !== 1) break;
        if (frame?.buffer) {
          try {
            // Metadata first (JSON text), then the binary frame.
            ws.send(JSON.stringify({
              type: "frame_meta",
              screenX: frame.screenX, screenY: frame.screenY,
              screenWidth: frame.screenWidth, screenHeight: frame.screenHeight,
              mode: frame.mode, throughputKbps: frame.throughputKbps, mime: frame.mime ?? "image/jpeg"
            }));
            ws.send(frame.buffer); // binary
          } catch { break; }
        }
        const wait = Math.max(120, Number(frame?.intervalMs) || 800);
        await new Promise((r) => setTimeout(r, wait));
      }
      try { ws.close(); } catch {}
    })();
  }

  function handleShell(ws, { cols, rows }) {
    activeCount++;
    let pty;

    try {
      pty = _nodePty.spawn(getShell(), [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
        env: { ...process.env }
      });
    } catch (err) {
      activeCount = Math.max(0, activeCount - 1);
      try {
        ws.send(`\r\n\x1b[31mImpossible de démarrer le shell : ${err.message}\x1b[0m\r\n`);
        ws.close(1011);
      } catch {}
      return;
    }

    pty.onData((data) => {
      try { if (ws.readyState === 1) ws.send(data); } catch {}
    });

    pty.onExit(({ exitCode }) => {
      activeCount = Math.max(0, activeCount - 1);
      try {
        if (ws.readyState === 1) {
          ws.send(`\r\n\x1b[90m[Shell terminé — code ${exitCode ?? 0}]\x1b[0m\r\n`);
          ws.close(1000);
        }
      } catch {}
    });

    ws.on("message", (msg) => {
      try {
        const text = msg.toString();
        if (text.startsWith('{"')) {
          const cmd = JSON.parse(text);
          if (cmd.type === "resize" && cmd.cols && cmd.rows) {
            pty.resize(
              Math.max(10, Math.min(500, Number(cmd.cols))),
              Math.max(5,  Math.min(200, Number(cmd.rows)))
            );
          }
          return;
        }
        pty.write(text);
      } catch {}
    });

    const cleanup = () => {
      activeCount = Math.max(0, activeCount - 1);
      try { pty.kill(); } catch {}
    };

    ws.once("close", cleanup);
    ws.once("error", cleanup);
  }
}
