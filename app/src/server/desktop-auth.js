import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Central authentication / network-exposure model for the operator server.
//
// SECURE BY DEFAULT:
//  - bind 127.0.0.1 (loopback only) unless LAN is explicitly opted into;
//  - loopback requests are trusted (the local desktop user already owns the box);
//  - when exposed on the LAN, desktop /api/* routes require a desktop token, and
//    mobile routes keep enforcing their own paired-session check.
//
// This fixes the audit's T1 (whole desktop API exposed unauthenticated on the LAN).

const COWORK_HOME = process.env.COWORK_HOME ?? path.join(os.homedir(), ".cowork");
const TOKEN_FILE = path.join(COWORK_HOME, "desktop-token");

// Resolve bind host. Default = loopback. LAN only via explicit opt-in. Supports
// new JON_* envs and the legacy COWORK_* ones for backwards compatibility.
export function resolveBindConfig(env = process.env) {
  const lanOptIn = env.JON_ALLOW_LAN === "true" || env.COWORK_LAN === "1";
  const explicitHost = env.JON_BIND_HOST ?? env.COWORK_BIND_HOST ?? null;
  const bindHost = explicitHost ?? (lanOptIn ? "0.0.0.0" : "127.0.0.1");
  const lanEnabled = bindHost === "0.0.0.0" || bindHost === "::";
  return { bindHost, lanEnabled, lanOptIn };
}

// A stable per-install desktop token, persisted with owner-only permissions.
// Used to authorize desktop routes when the server is reachable over the LAN.
export function loadOrCreateDesktopToken(env = process.env) {
  if (env.JON_DESKTOP_TOKEN) return env.JON_DESKTOP_TOKEN;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (existing) return existing;
    }
  } catch { /* fall through to create */ }
  const token = crypto.randomBytes(24).toString("base64url");
  try {
    fs.mkdirSync(COWORK_HOME, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  } catch { /* best effort; token still returned for this process */ }
  return token;
}

export function isLoopbackAddress(address) {
  if (!address) return false;
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1"
    || address.startsWith("127.");
}

function constantTimeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

export function desktopTokenFromRequest(request) {
  const auth = request.headers?.["authorization"] ?? "";
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const header = request.headers?.["x-jon-desktop-token"];
  if (typeof header === "string" && header) return header.trim();
  return null;
}

// Paths reachable without any auth (needed to bootstrap, render, or pair).
const PUBLIC_EXACT = new Set([
  "/api/health",
  "/health",
  "/api/mobile/pairing/start",
  "/api/mobile/pairing/confirm",
  "/api/mobile/connectivity",
  "/api/mobile/client/logs"
]);

export function isPublicPath(pathname) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  // Static assets / HTML (desktop UI, mobile UI, manifest, css, js, images).
  // Anything that is NOT an API/stream route is a static asset and is public.
  if (!pathname.startsWith("/api/") && pathname !== "/events" && pathname !== "/sse") {
    return true;
  }
  return false;
}

// Central authorization decision. Returns { allowed, reason }.
export function authorizeRequest(request, pathname, { desktopToken = null } = {}) {
  if (isPublicPath(pathname)) return { allowed: true, reason: "public" };

  const remote = request.socket?.remoteAddress ?? null;
  if (isLoopbackAddress(remote)) return { allowed: true, reason: "loopback" };

  // Non-loopback (LAN). Mobile routes self-enforce a paired session in their
  // handlers, so let them through the central gate (the handler returns 401).
  if (pathname.startsWith("/api/mobile/")) return { allowed: true, reason: "mobile_session_enforced" };

  // Any other sensitive route over the LAN needs the desktop token.
  const presented = desktopTokenFromRequest(request);
  if (desktopToken && constantTimeEquals(presented, desktopToken)) {
    return { allowed: true, reason: "desktop_token" };
  }
  return { allowed: false, reason: "desktop_auth_required" };
}
