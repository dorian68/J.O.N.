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

export function attachMobileTerminalWs(httpServer, { validateSession }) {
  if (!_WebSocketServer) {
    console.warn("[mobile-terminal] ws package not available — interactive terminal disabled.");
    return;
  }
  if (!_nodePty) {
    console.warn("[mobile-terminal] node-pty not available — interactive terminal disabled.");
    return;
  }

  const wss = new _WebSocketServer({ noServer: true });
  let activeCount = 0;

  httpServer.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(request.url, "http://x");
      if (url.pathname !== "/api/mobile/terminal/ws") {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get("token");
      if (!token || !validateSession(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
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
