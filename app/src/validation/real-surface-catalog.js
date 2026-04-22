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
      passCriteria: [
        "The run obtains explicit focus approval before focus changes",
        "The correct local surface is evidenced and verified",
        "No generalized desktop actuation occurs"
      ]
    }
  ];
}

export function getRealSurfaceScenario(scenarioId) {
  return getRealSurfaceScenarioCatalog().find((scenario) => scenario.id === scenarioId) ?? null;
}

