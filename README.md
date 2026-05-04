# J.O.N. — Desktop & Browser AI Coworker

**J.O.N.** is an autonomous AI agent that executes real work objectives on your computer — navigating websites, filling forms, collecting data, running terminal commands, and producing structured deliverables — while remaining under full human supervision through a granular approval system.

> Think of JON as a coworker who sits at your desktop, takes a briefing, executes the work step by step, and hands you back an artifact. You stay in control of every risky action.

---

## What JON does

- **Receives a mission** — a natural-language objective, optional deliverable format, constraints, and forbidden actions
- **Understands and plans** — decomposes the objective into typed steps (browser tasks, desktop tasks, terminal commands)
- **Executes autonomously** — drives a real Playwright browser or Windows desktop via UI automation
- **Asks before acting dangerously** — a policy layer intercepts actions by risk category and waits for your approval
- **Produces artefacts** — structured collection tables, decision notes, screenshots as evidence
- **Verifies its own outcome** — a semantic outcome verifier checks whether the objective was actually met before marking a mission complete
- **Exposes full observability** — every LLM call, browser action, approval decision, and token spend is logged and browsable in the UI

---

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│                   React UI (Vite)                   │
│  Conversation  │  Activity Panel  │  Terminal Panel  │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP + SSE + WebSocket
┌───────────────────────▼─────────────────────────────┐
│              Operator Server (Node.js)               │
│  REST API  │  Event Bus (SSE)  │  Mobile WS         │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│                 Prototype Agent Loop                 │
│                                                     │
│  MissionUnderstanding → Plan → Execute → Verify     │
│                                                     │
│  ┌──────────────┐   ┌──────────────┐               │
│  │ BrowserOp    │   │ ComputerCtrl │               │
│  │ (Playwright) │   │ (UIA/PS)     │               │
│  └──────────────┘   └──────────────┘               │
│                                                     │
│  LLM Gateway ← Token Governance ← Budget Ledger    │
│  Approval Broker ← Policy Engine                   │
│  SemanticOutcomeVerifier ← MissionProgressTracker  │
└─────────────────────────────────────────────────────┘
                        │
              SQLite  ·  File storage
```

---

## Key features

| Feature | Details |
|---|---|
| **Browser automation** | Playwright-driven browser with DOM strategy, element scoring, replan on blocker |
| **Desktop control** | Windows UI Automation + PowerShell terminal orchestration |
| **LLM agnostic** | OpenAI, any OpenAI-compatible endpoint, or offline mock mode |
| **Token governance** | Per-run and per-session hard budgets; per-stage ceilings; cost tracking |
| **Approval matrix** | 9 risk categories (Read, Navigate, Edit, Desktop, …); per-category auto-approve or human-gate |
| **Semantic verification** | Rule-based outcome verifier — critical blockers vs advisory checks, confidence score |
| **Structured artefacts** | Collection tables (scraped data), decision notes, screenshot evidence |
| **Configurable panel** | Right-side widget board: 14 live widgets (mission state, token budget, DOM size, semantic verdict, …) |
| **Full audit trail** | Every event persisted; `extract-run-audit` CLI for post-mortem inspection |
| **Mobile companion** | WebSocket + QR code for remote approval from a phone |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite 8 · XTerm.js |
| Backend | Node.js ≥ 24 · ES Modules · native `http` |
| Browser automation | Playwright 1.54 |
| Terminal control | node-pty |
| Real-time | Server-Sent Events (SSE) · WebSocket (ws) |
| Storage | SQLite (better-sqlite3) |
| Security | OS secret store · secret redaction pipeline |
| LLM | OpenAI-compatible REST — claude, gpt-4, any endpoint |

---

## Prerequisites

- **Node.js ≥ 24.0.0**
- **npm ≥ 10**
- Windows 10/11 (for desktop control features; browser-only mode works on any OS)
- A running LLM API endpoint (OpenAI, Anthropic via proxy, Ollama, etc.)

---

## Installation

```bash
git clone https://github.com/dorian68/PROJET_CLAUDE.git
cd PROJET_CLAUDE

# Install all dependencies (root + app)
npm install
cd app && npm install && cd ..

# Build the React UI
npm run ui:build
```

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key variables:

```env
# LLM provider
COWORK_LLM_PROVIDER_MODE=openai_compatible   # openai | openai_compatible | mock_offline
COWORK_OPENAI_BASE_URL=https://api.anthropic.com/v1
COWORK_OPENAI_MODEL=claude-sonnet-4-6
COWORK_OPENAI_API_KEY=sk-...

# Token & cost budgets
COWORK_LLM_BUDGET_PER_RUN_TOKENS=50000
COWORK_LLM_BUDGET_PER_SESSION_TOKENS=250000
COWORK_LLM_BUDGET_PER_RUN_USD=0.50
COWORK_LLM_BUDGET_PER_SESSION_USD=2.00

# Runtime profile
COWORK_LLM_RUNTIME_PROFILE=production_strict

# Browser (set to 0 to see the browser window)
COWORK_HEADLESS=1
```

For API keys, the secure path is the OS secret store (Credential Manager on Windows). JON will warn if keys are stored in plain `.env` with `COWORK_LLM_REQUIRE_OS_SECRET_STORE=1`.

---

## Running

```bash
# Start the operator server (backend + UI)
npm run operator:server
```

Open **http://localhost:41731** in your browser.

The server binds on port `41731` (UI/API) and `41732` (operator WebSocket). A QR code is printed in the terminal for mobile access on the same LAN.

---

## How a mission runs

1. **Brief** — Type an objective in the composer. Optionally add: expected deliverable, constraints, forbidden actions, browser mode.
2. **Mission understanding** — The LLM extracts a typed mission spec (goal, scope, surface type, success criteria).
3. **Planning** — A plan of typed steps is generated (browser navigation, form fill, data extraction, terminal command, …).
4. **Execution loop** — Each step executes on the selected surface. Browser steps drive Playwright; desktop steps invoke Windows UIA or PowerShell.
5. **Approval gates** — Risky actions (write, edit, execute) trigger a pause. You approve or deny in the UI or on mobile.
6. **Replan on blocker** — If a step fails or a CAPTCHA/login wall is detected, JON replans from the current state.
7. **Semantic verification** — After execution, `SemanticOutcomeVerifier` checks critical conditions (work executed, no failure cascade, browser fully completed, no blockers). Advisory checks lower confidence but don't block a pass.
8. **Artefact delivery** — Results are stored as a collection table or decision note, linked to the run. Evidence screenshots are attached.

---

## UI overview

### Left — Conversation rail
Active conversation threads. Each thread links to one or more runs. Supports clarification turns mid-execution.

### Center — Composer + message stream
Type your objective. JON streams its reasoning, plan steps, and status updates as it works.

### Right — Activity Panel (configurable)
Click **⚙** to choose which of the 14 widgets to display:

| Widget | What it shows |
|---|---|
| Mission & Progression | Objective, step progress bar, replan count, verdict badge |
| Ce que JON attend | Pending approvals, unverified objective, next best action |
| Vérification sémantique | Verifier verdict (pass/partial/fail), satisfied/unsatisfied outcomes |
| Budget tokens & DOM | Run token total, cost, DOM token estimate, per-stage breakdown |
| État du navigateur | Current URL, page title, navigation steps, blockers |
| État du desktop | Execution frame, capability, skill, policy |
| Approbations en attente | Queued approval cards with risk level |
| Trace de la mission | Step-by-step execution trace + SSE events |
| Appels LLM | Last 8 LLM calls with stage, status, token count |
| Preuves & captures | Screenshot evidence links |
| Artefacts | Downloadable output artefacts |
| Alertes terminal | Terminal approval alerts + decisions |
| Transcript terminal | Raw terminal event stream |
| Historique des missions | All runs for this conversation |

Widget visibility persists in `localStorage`.

### Bottom — Terminal panel
Embedded XTerm.js terminal surfaces for active shell sessions. Multiple tabs, live streaming output.

---

## Development

```bash
# Run all tests
npm test

# Run a specific test suite
node app/src/scripts/run-tests.js semantic-outcome-verifier
node app/src/scripts/run-tests.js mission-progress-tracker
node app/src/scripts/run-tests.js llm-gateway

# UI dev server (hot reload)
cd app/ui && npx vite

# Extract a run audit (post-mortem)
node app/src/scripts/extract-run-audit.js --runId=<id>
```

### Adding a new widget to the Activity Panel

1. Add an entry to `PANEL_WIDGET_REGISTRY` in `app/ui/src/main.jsx`
2. Add a `case "your_widget_id":` inside `renderWidget()`
3. Optionally create a `WYourWidget` sub-component above `ActivityPanel`
4. Add CSS classes to `app/ui/styles.css`

---

## Project structure

```
PROJET_CLAUDE/
├── app/
│   ├── src/
│   │   ├── browser/          # Playwright operator, planner, DOM strategy
│   │   ├── computer/         # Desktop UIA + recovery
│   │   ├── conversation/     # Mission setup, conversation turn, UI blocks
│   │   ├── llm/              # Gateway, providers, token governance
│   │   ├── mission/          # Mission understanding, plan generation
│   │   ├── policy/           # Permission engine, approval categories
│   │   ├── reasoning/        # Contextual reasoning, evaluator
│   │   ├── runtime/          # Prototype agent loop, semantic verifier,
│   │   │                     #   mission tracker, workspace snapshot
│   │   ├── server/           # HTTP/WS operator server
│   │   ├── service/          # OperatorService, LLM analytics, run review
│   │   ├── storage/          # SQLite database abstraction
│   │   ├── validation/       # Real-surface validation harness
│   │   └── workspace/        # Terminal orchestration, CLI catalog
│   ├── ui/
│   │   ├── src/main.jsx      # React SPA (single file, ~4 000 lines)
│   │   └── styles.css        # All UI styles
│   ├── prompts/              # Versioned LLM prompt templates (JSON)
│   └── tests/                # Unit & integration test suites
├── docs/                     # Architecture decisions, specs, product vision
├── .env.example
└── README.md
```

---

## Token governance

JON enforces layered token budgets to prevent runaway costs:

| Level | Default | Env var |
|---|---|---|
| Per run (tokens) | 50 000 | `COWORK_LLM_BUDGET_PER_RUN_TOKENS` |
| Per session (tokens) | 250 000 | `COWORK_LLM_BUDGET_PER_SESSION_TOKENS` |
| Per run (USD) | $0.50 | `COWORK_LLM_BUDGET_PER_RUN_USD` |
| Per session (USD) | $2.00 | `COWORK_LLM_BUDGET_PER_SESSION_USD` |

Per-stage hard ceilings (e.g. `BROWSER_PLAN` caps at 48 000 input tokens) prevent any single LLM call from consuming the entire budget. Mandatory calls (mission understanding, replan after blocker) bypass soft budget warnings but never bypass hard ceilings.

---

## Approval categories

| Category | Default | Examples |
|---|---|---|
| `read` | Auto-approved | Page read, DOM snapshot |
| `navigate` | Auto-approved | URL navigation, link click |
| `preparation` | Auto-approved | Open browser, resize window |
| `edit` | Human gate | Form fill, text input |
| `submit` | Human gate | Form submit, button click that triggers action |
| `desktop` | Human gate | UIA click, keyboard input |
| `execute` | Human gate | Terminal command |
| `external_service` | Human gate | API call, webhook |
| `sensitive_data` | Human gate | Credential input, payment |

Each category can be configured per-project to auto-approve or always require human confirmation.

---

## Semantic outcome verification

Before marking any run `completed`, `SemanticOutcomeVerifier` runs a two-tier check:

**Critical blockers** (any failure → run is `failed`, not `completed`):
- `work_executed` — at least one real action was taken
- `browser_fully_completed` — browser mission reached a terminal state
- `browser_no_blockers` — no unresolved CAPTCHA / login wall
- `no_critical_failures` — no fatal errors in the action log
- `no_failure_cascade` — consecutive failures stayed below threshold

**Advisory checks** (failures lower confidence, don't block pass):
- Keyword matching on expected outcomes in evidence
- Screenshot existence for evidence-required outcomes
- Artefact presence for deliverable outcomes

Verdict: **pass** (no critical blockers, ≤ 40 % advisory failures) · **partial** (> 40 % advisory failures) · **fail** (any critical blocker)

---

## License

Private — all rights reserved.

---

*Built with Node.js 24, React 19, Playwright, and Claude.*
