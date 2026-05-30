# JON Functional Readiness Criteria - v1

Audit date: 2026-05-07

JON is functional only when real missions complete on real surfaces with verified outcomes. Mock/fallback success is useful for regression tests but not proof of agentic readiness.

## Functional Criteria

| Area | Ready when | Current verdict |
|---|---|---|
| Mission understanding | Natural requests route to chat, inspection, desktop, browser, terminal, or clarification correctly. | Partial |
| State awareness | Workspace snapshot exposes run, windows, browser, terminals, approvals, evidence, blockers, next action. | Partial |
| Desktop control | Can launch/focus/type/capture/verify/recover on real Windows surfaces. | Partial |
| Browser control | Can use controlled browser session, URL/title/DOM/screenshot/extraction, and verify target page/domain. | Partial |
| Terminal orchestration | Can detect waiting/error/completion and inject only authorized non-sensitive context. | Partial |
| Semantic verification | Completion blocked without objective satisfaction, evidence, alignment, artifacts, no blockers. | Strengthened with central false-completion guard |
| Recovery | Can retry/reobserve/refocus/recapture/repair/ask/stop with proof. | Partial |
| UX/API | User sees objective status, proof used/missing, blockage, next action, user need. | Partial |
| Acceptance harness | 12 benchmark definitions exist and can be listed/executed. | Defined, not passing |

## Non-Negotiable Pass Rules

- No `completed` run without `verifiedByOutcomes === true`.
- No `completed` run when screenshot/proof was requested and missing.
- No `completed` run with off-target evidence.
- No `completed` run with a blocked/waiting terminal.
- No crash on malformed LLM output.
- No sensitive desktop/browser/terminal action without approval.
- No system/user browser profile use without explicit consent.
- No dangerous shell action without policy/approval.

## Current Reality

JON is not fully functional today. It is a stronger prototype with real foundations and a central false-completion guard. It still needs deeper real-surface validation, stronger multi-surface mission execution, and better terminal/browser/desktop recovery before it can be called a true end-to-end desktop/browser/workspace AI agent.
## 2026-05-07 Iteration Update

New readiness improvements:

- SurfaceRouter v1 is implemented and wired before mission normalization.
- Harness approval policy can auto-resolve safe benchmark approvals for missions 1 and 2.
- Tool call lifecycle events now exist for desktop autonomy and desktop-browser launch/search paths.
- Mobile Live cards expose compact execution thread, active tool, proof count, artifact count, and verification verdict.

Readiness is still not production-ready because:

- missions 1 and 2 still require real-environment validation on the user's desktop/browser;
- lifecycle coverage is partial outside desktop autonomy and local browser launch;
- terminal missions are still not a complete end-to-end mission executor;
- mobile proof review and run drill-down are still V1.
