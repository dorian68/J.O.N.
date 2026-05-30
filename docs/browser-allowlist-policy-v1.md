# Browser Allowlist Policy — v1

## Purpose

JON's browser autonomy must be bounded. The operator configures which domains the agent may visit; JON must never navigate outside that boundary without explicit approval.

## Implementation

**Guard:** `ensureAllowlisted(url, allowlistedHosts)` in `browser-controller.js`

**Called before every `navigate()` action.** If it returns false, `navigate()` throws and records the failure in the browser action log.

## Policy Rules

### Blocked schemes (always, regardless of allowlist)

`javascript:` `data:` `file:` `vbscript:` `blob:`

These cannot appear as navigation targets under any circumstances.

### Non-HTTP/HTTPS schemes

Refused. Only `http://` and `https://` are valid navigation targets.

### Empty allowlist → Open mode

If `allowlistedHosts = []` (no restriction configured), all HTTP/HTTPS URLs are permitted. This is the default when JON is started without project-level domain configuration.

### Configured allowlist → Enforced mode

Each entry in `allowlistedHosts` is a hostname (e.g., `google.com`).

Matching rules:
- `www.` prefix is stripped from both the configured entry and the URL hostname before comparison
- Exact match: `google.com` allows `google.com`
- Subdomain match: `google.com` allows `maps.google.com`, `accounts.google.com`, etc.

### Configuration surface

Operators configure allowed domains via:
- Settings modal → Domain Allowlist textarea
- API: `PUT /api/projects/:id/allowlisted-domains`

### Enforcement in mission runs

The `allowlistedHosts` array is passed to `BrowserController.openBrowserSession()` at the start of each browser run and stored on the controller instance. Every `navigate()` call checks against this list.

If a domain is blocked:
- Navigation does not proceed
- Error is recorded in step results: `"Target URL is not allowlisted: <url>"`
- Mission progress tracker records the failure
- SemanticOutcomeVerifier will fail `no_critical_failures` and `browser_fully_completed` checks → `verifiedByOutcomes = false`
- Run cannot complete

### Approval bypass

Domain allowlist enforcement is separate from the approval policy. Even if an action is "trusted" (e.g., `trustedBrowserIds`), the domain allowlist still applies. An operator cannot bypass the allowlist via the approval policy.
