export const REAL_SURFACE_RESULT = Object.freeze({
  PASS: "pass",
  PARTIAL: "partial",
  FAIL: "fail",
  BLOCKED: "blocked"
});

export function getRealSurfaceScenarioCatalog() {
  return [
    {
      id: "live_llm_provider_smoke",
      label: "Live LLM provider smoke",
      surfaceType: "llm_provider",
      executionMode: "scripted_smoke",
      objective: "Prove one bounded live provider request, one forced adapter failure, and one deterministic degraded runtime path.",
      preconditions: [
        "Runtime-only provider key configured.",
        "Mock fallback disabled for strict live proof.",
        "Deterministic fallback allowed for degraded-mode proof."
      ],
      commands: [
        "npm run llm:smoke -- live-success",
        "npm run llm:smoke -- provider-unavailable",
        "npm run llm:smoke -- runtime-degraded"
      ],
      requiredArtifacts: [],
      requiredEvidence: [
        "app/.runtime-data/smoke/live-success.json",
        "app/.runtime-data/smoke/provider-unavailable.json",
        "app/.runtime-data/smoke/runtime-degraded.json"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: false,
        artifactIds: 0,
        evidenceIds: 0,
        llmCallIds: 1,
        reasoningSnapshotIds: 0,
        logPaths: 1
      },
      passCriteria: [
        "live-success uses providerAlias=openai_compatible with empty fallbackChain",
        "provider-unavailable reports errorCategory=provider_unavailable",
        "runtime-degraded completes with planGenerationMode=deterministic_fallback"
      ]
    },
    {
      id: "desktop_shell_local_smoke",
      label: "Desktop shell local smoke",
      surfaceType: "desktop_wrapper",
      executionMode: "manual_local_shell",
      objective: "Verify the thin local shell starts only against the loopback operator surface and remains a wrapper with no new product logic.",
      preconditions: [
        "A supported local browser executable is present or COWORK_DESKTOP_BROWSER_PATH is set.",
        "Operator server health endpoint is reachable on loopback."
      ],
      commands: [
        "npm run desktop:dry-run",
        "npm run desktop:dev"
      ],
      requiredArtifacts: [],
      requiredEvidence: [],
      requiredLogs: [
        "stdout dry-run JSON showing loopback operatorBaseUrl"
      ],
      minimumTraceability: {
        runId: false,
        artifactIds: 0,
        evidenceIds: 0,
        llmCallIds: 0,
        reasoningSnapshotIds: 0,
        logPaths: 1
      },
      passCriteria: [
        "Dry-run output reports a loopback-only operatorBaseUrl",
        "The wrapper launches the current operator surface without changing business behavior",
        "Closing the wrapper stops the owned operator child process"
      ]
    },
    {
      id: "bounded_real_web_research",
      label: "Bounded real-surface web research",
      surfaceType: "real_web_read_only",
      executionMode: "manual_operator_run",
      objective: "Validate the research flow on one explicitly allowlisted, low-risk, read-only real web surface without login or write actions.",
      preconditions: [
        "Only allowlisted, non-authenticated, low-risk web pages are used.",
        "No submit, send, publish, upload, or delete path is exercised.",
        "The operator is ready to review approvals, evidence, artifacts, and LLM call traces."
      ],
      commands: [
        "npm run operator:server",
        "Launch one bounded research run through the operator surface"
      ],
      requiredArtifacts: [
        "Tableau de collecte navigateur",
        "Note de decision"
      ],
      requiredEvidence: [
        "At least one page evidence capture per consulted source",
        "Reasoning snapshots linked to LLM calls"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 2,
        evidenceIds: 2,
        llmCallIds: 2,
        reasoningSnapshotIds: 2,
        logPaths: 1
      },
      passCriteria: [
        "The run stays inside browser-first / DOM-first behavior",
        "At least two sources are traceable through events, evidence, artifacts, and reasoning snapshots",
        "No out-of-scope write or desktop escalation occurs"
      ]
    },
    {
      id: "bounded_local_window_observation",
      label: "Bounded local window observation",
      surfaceType: "real_local_surface",
      executionMode: "manual_operator_run",
      objective: "Validate the bounded computer-control path on one allowlisted local window with focus, visible inspection, and outcome proof only.",
      preconditions: [
        "The local surface is explicitly allowlisted.",
        "No desktop click, drag, type, or hotkey actuation is attempted.",
        "The operator is ready to approve local focus explicitly."
      ],
      commands: [
        "npm run operator:server",
        "Launch one bounded computer observation run through the operator surface"
      ],
      requiredArtifacts: [],
      requiredEvidence: [
        "Window capture evidence",
        "Outcome verification evidence"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 0,
        evidenceIds: 2,
        llmCallIds: 1,
        reasoningSnapshotIds: 1,
        logPaths: 1
      },
      passCriteria: [
        "The run obtains explicit focus approval before focus changes",
        "The correct local surface is evidenced and verified",
        "No generalized desktop actuation occurs"
      ]
    },
    {
      id: "real_web_canvas_interaction",
      label: "Real web canvas interaction",
      surfaceType: "real_web_canvas",
      executionMode: "manual_operator_run",
      objective: "Validate browser perception and proof capture on an allowlisted page where essential state is rendered in canvas rather than exposed as ordinary DOM text.",
      surfaceComplexityTags: ["canvas", "visual_state", "dom_gap", "screenshot_evidence"],
      preconditions: [
        "The page is public, allowlisted, low-risk, and does not require login.",
        "The operator has defined the expected canvas-visible state before the run.",
        "No game, payment, credential, or anti-bot flow is used."
      ],
      commands: [
        "npm run operator:server",
        "Launch one bounded browser autonomy run against the allowlisted canvas page"
      ],
      requiredArtifacts: [],
      requiredEvidence: [
        "Canvas-visible before/after screenshot evidence",
        "A visual description or OCR/perception note explaining why DOM-only extraction is insufficient"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 0,
        evidenceIds: 2,
        llmCallIds: 1,
        reasoningSnapshotIds: 1,
        logPaths: 1
      },
      passCriteria: [
        "The run explicitly detects that the target state is visual/canvas-backed",
        "The final answer cites screenshot evidence rather than pretending DOM text was available",
        "No hidden or synthetic canvas state is inferred without proof"
      ]
    },
    {
      id: "real_web_pdf_extraction",
      label: "Real web PDF extraction",
      surfaceType: "real_web_pdf",
      executionMode: "manual_operator_run",
      objective: "Validate extraction and citation behavior on an allowlisted public PDF opened through the browser surface.",
      surfaceComplexityTags: ["pdf", "download_or_inline_viewer", "citation", "long_document"],
      preconditions: [
        "The PDF is public, allowlisted, and safe to download or view inline.",
        "The operator has selected a PDF with at least two pages and visible headings.",
        "No copyrighted full-text reproduction is requested."
      ],
      commands: [
        "npm run operator:server",
        "Launch one bounded PDF review mission through the operator surface"
      ],
      requiredArtifacts: [
        "Short extraction summary or decision note"
      ],
      requiredEvidence: [
        "PDF URL/source evidence",
        "Page-level screenshot or extraction proof"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 1,
        evidenceIds: 2,
        llmCallIds: 1,
        reasoningSnapshotIds: 1,
        logPaths: 1
      },
      passCriteria: [
        "The output identifies the PDF source and page/section evidence used",
        "The run does not quote excessive PDF text",
        "The operator can trace each extracted claim to persisted evidence"
      ]
    },
    {
      id: "real_web_dropdown_form_preparation",
      label: "Real web dropdown form preparation",
      surfaceType: "real_web_form",
      executionMode: "manual_operator_run",
      objective: "Validate supervised form preparation on an allowlisted real page with selects, dependent dropdowns, and explicit stop-before-submit behavior.",
      surfaceComplexityTags: ["form", "select", "dependent_dropdown", "approval", "no_submit"],
      preconditions: [
        "The form is public or a test/staging form explicitly owned by the operator.",
        "The operator has approved test values that do not submit real transactions.",
        "Submission, payment, publication, or account mutation is out of scope."
      ],
      commands: [
        "npm run operator:server",
        "Launch one bounded form-preparation run and stop before submit"
      ],
      requiredArtifacts: [],
      requiredEvidence: [
        "Pre-edit approval context evidence",
        "Post-edit stop-before-submit evidence"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 0,
        evidenceIds: 2,
        llmCallIds: 1,
        reasoningSnapshotIds: 1,
        logPaths: 1
      },
      passCriteria: [
        "Each non-read field change has an explicit approval record or trusted test-mode policy",
        "Dependent dropdown state is verified after selection",
        "The run stops before submit and records proof of that boundary"
      ]
    },
    {
      id: "real_web_network_error_recovery",
      label: "Real web network error recovery",
      surfaceType: "real_web_resilience",
      executionMode: "manual_operator_run",
      objective: "Validate that browser missions classify and recover from real navigation failures without hallucinating completed work.",
      surfaceComplexityTags: ["network_error", "timeout", "retry", "blocked_navigation", "honest_failure"],
      preconditions: [
        "The operator selects an allowlisted URL with a known temporary failure, timeout, or blocked route.",
        "The expected behavior is retry/classify/report, not bypass.",
        "No authentication or anti-bot bypass is attempted."
      ],
      commands: [
        "npm run operator:server",
        "Launch one bounded browser mission against the failing allowlisted route"
      ],
      requiredArtifacts: [
        "Failure/recovery note"
      ],
      requiredEvidence: [
        "Navigation failure evidence",
        "Retry or blocker-classification evidence"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 1,
        evidenceIds: 2,
        llmCallIds: 1,
        reasoningSnapshotIds: 1,
        logPaths: 1
      },
      passCriteria: [
        "The run reports the failure class and does not claim task completion",
        "At least one retry or alternate observation is evidenced",
        "The final recommendation is a safe handoff or bounded next step"
      ]
    },
    {
      id: "desktop_app_variety_matrix",
      label: "Desktop app variety matrix",
      surfaceType: "real_local_desktop_matrix",
      executionMode: "manual_operator_run",
      objective: "Validate governed desktop autonomy across several local app classes instead of one controlled fake window.",
      surfaceComplexityTags: ["desktop", "app_matrix", "accessibility", "ocr", "recovery"],
      preconditions: [
        "The operator explicitly allowlists each target app/window.",
        "The matrix includes at least a text editor, a file manager, and one browser window.",
        "No credential entry, payment, destructive file operation, or privileged OS change is attempted."
      ],
      commands: [
        "npm run validation:advanced-desktop -- --real-matrix",
        "npm run operator:server"
      ],
      requiredArtifacts: [
        "Desktop matrix validation summary"
      ],
      requiredEvidence: [
        "One evidence record per app class",
        "Accessibility/OCR/perception notes for each app class"
      ],
      requiredLogs: [
        "app/.runtime-data/logs/llm-runtime.jsonl"
      ],
      minimumTraceability: {
        runId: true,
        artifactIds: 1,
        evidenceIds: 3,
        llmCallIds: 1,
        reasoningSnapshotIds: 1,
        logPaths: 1
      },
      passCriteria: [
        "Each app class has a persisted observation or action proof",
        "The run records which perception channel was used for each app",
        "Recovery or honest stop behavior is evidenced for at least one non-ideal app state"
      ]
    }
  ];
}

export function getRealSurfaceScenario(scenarioId) {
  return getRealSurfaceScenarioCatalog().find((scenario) => scenario.id === scenarioId) ?? null;
}
