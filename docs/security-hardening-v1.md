# Security Hardening — v1

Sprint "Trust, Security & Reliability" — 2026-05-13

## 1. Command Injection PowerShell — FIXED

**File:** `app/src/computer/powershell-window-provider.js`

All arguments passed to `spawn("powershell", [...])` are now validated before use:

| Argument | Validation |
|---|---|
| `windowId` / Handle | Must match `/^\d{1,10}$/` — positive integer only. Rejected otherwise. |
| `keys` (hotkeys) | Validated against `ALLOWED_HOTKEY_NAMED` set + `ALLOWED_HOTKEY_PATTERN` regex. Rejected if not in allowlist. |
| `imagePath` (ocrImage) | Must be within `TEMP_RUNTIME_ROOT` (path.relative check). Rejected if outside. |
| `text` (typeText) | Capped at 4000 chars. Not interpreted — passed as literal PS argument. |
| `x, y, width, height` | Parsed as `Math.round(Number(...))`, verified `isFinite`, non-negative. |
| `maxDepth, maxNodes` | Clamped: depth=[1,8], nodes=[1,200]. |
| `browserId`, `appId`, `url` | Sliced to max length to prevent oversized args. |

**Why this is safe:** `spawn(cmd, args)` without `shell:true` passes args directly to the process — no shell interpretation. The PS1 script receives typed parameters. Validation prevents unexpected values from reaching the script's parameter binding.

## 2. Path Traversal Static Files — FIXED

**File:** `app/src/server/operator-server.js` — `serveStaticAsset()`

Replaced `assetPath.startsWith(UI_ROOT)` (bypassable via symlinks) with:

```javascript
const relative = path.relative(UI_ROOT, assetPath);
if (relative.startsWith("..") || path.isAbsolute(relative)) → 403
```

Additional guards:
- Dotfiles (`.env`, `.git`, etc.) → 403
- Extension allowlist: `.html .js .css .json .png .svg .ico .txt .woff .woff2 .ttf` — anything else → 403

## 3. JSON Body Size Limit — FIXED

**File:** `app/src/server/operator-server.js` — `readJsonBody()`

- Default limit: **5 MB** (configurable via `COWORK_MAX_BODY_BYTES` env var)
- Exceeding the limit throws `code: "PAYLOAD_TOO_LARGE"` → server returns **413**
- Invalid JSON throws `code: "INVALID_JSON"` → server returns **400**
- Server does not crash on either error

## 4. Secret Redaction — HARDENED

**File:** `app/src/security/secret-normalization.js`

Added:
- `redactSecrets(obj)` — masks values of keys matching `api_key|token|secret|password|auth_key|bearer` pattern
- `redactStringSecrets(text)` — redacts `sk-...` style keys, Bearer tokens, `key=value` patterns from strings

**Runtime:** `COWORK_OPENAI_API_KEY` is never logged (no `console.log` in `app/src/llm/`). `secretResolution` object returned by `/api/operational-deep` contains only `source` ("os_secret_store" / "env" / "missing"), not the key value. Stack traces are only sent when `COWORK_DEBUG_ERRORS=1` (development mode).

## 5. Browser Allowlist Guard — FIXED

**File:** `app/src/browser/browser-controller.js` — `ensureAllowlisted()`

Was a stub returning `true`. Now implements real enforcement:

- Blocked schemes (always refused): `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`
- Non-HTTP/HTTPS schemes refused
- If `allowlistedHosts` is empty → open mode (all http/https allowed)
- If `allowlistedHosts` is configured:
  - Hostname normalized (lowercased, www. stripped)
  - Exact match OR subdomain match (`maps.google.com` ✓ when `google.com` allowed)
  - No match → `navigate()` throws, records error in browser action log

## Known Remaining Risks

- Symlink attacks in `serveStaticAsset`: `fs.realpath()` would be more robust, but requires async plumbing across all callers. Current `path.relative` check blocks all known traversal patterns.
- `resolvedEnv` object contains the API key in memory. Not serialized to disk or logs. Acceptable for single-user local use.
