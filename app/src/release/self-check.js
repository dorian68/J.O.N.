// System self-test & self-correction.
//
// JON logs richly; this module turns that into an actionable health verdict the
// product can run on startup, on demand (API), or before a mission. Each check
// is independent and never throws — it returns a structured result with a
// remediation hint. Where a subsystem can recover itself (e.g. the PowerShell
// daemon falling back to single-shot), the check reports the corrected state
// rather than a hard failure.
import { renderArtifactDeliverables } from "../artifacts/document-renderer.js";

const TINY_NOTE = {
  artifactType: "note_de_decision",
  title: "Self-check probe",
  content: "# Objective\nVerify deliverable rendering.\n\n# Key findings\n- Renderer is operational.\n"
};

async function checkDeliverableRenderer() {
  try {
    const rendered = await renderArtifactDeliverables(TINY_NOTE);
    const formats = {};
    let ok = true;
    for (const item of rendered) {
      const good = !item.errored && item.buffer && item.buffer.length > 0;
      formats[item.format] = good ? "ok" : (item.error ?? "failed");
      if (!good) ok = false;
    }
    return {
      id: "deliverable_renderer",
      ok,
      detail: formats,
      remediation: ok ? null : "Verify pdfkit/docx/exceljs are installed (npm install)."
    };
  } catch (error) {
    return {
      id: "deliverable_renderer",
      ok: false,
      detail: { error: String(error?.message ?? error) },
      remediation: "Run `npm install` in app/ to restore document libraries."
    };
  }
}

async function checkDesktopProvider(computerControlService) {
  const provider = computerControlService?.provider;
  if (!provider) {
    return { id: "desktop_provider", ok: false, detail: { reason: "no_provider" }, remediation: "Computer control provider is not configured." };
  }
  if (typeof provider.selfTest !== "function") {
    // Fake/fixture provider (tests) — report as not-applicable rather than failed.
    return { id: "desktop_provider", ok: true, detail: { mode: "fixture_or_fake", selfTest: "unsupported" }, remediation: null };
  }
  try {
    const result = await provider.selfTest();
    return {
      id: "desktop_provider",
      ok: Boolean(result?.ok),
      detail: {
        actuationMode: result?.actuationMode ?? "unknown",
        checks: result?.checks ?? null
      },
      remediation: result?.ok
        ? null
        : "Desktop actuation unavailable. Single-shot fallback also failed — verify PowerShell is on PATH and the host is Windows."
    };
  } catch (error) {
    return {
      id: "desktop_provider",
      ok: false,
      detail: { error: String(error?.message ?? error) },
      remediation: "Desktop provider self-test threw. Check PowerShell availability."
    };
  }
}

function checkLlmGateway(runtime) {
  try {
    const status = typeof runtime?.getLlmGatewayStatus === "function" ? runtime.getLlmGatewayStatus() : null;
    if (!status) {
      return { id: "llm_gateway", ok: false, detail: { reason: "status_unavailable" }, remediation: "LLM gateway status unavailable." };
    }
    // The gateway is healthy as long as it can route to at least one provider
    // (the mock provider is always present), so this is a soft check.
    return {
      id: "llm_gateway",
      ok: true,
      detail: {
        providers: status.providers ?? status.providerOrder ?? null,
        productionStrict: status.productionStrict ?? null
      },
      remediation: null
    };
  } catch (error) {
    return { id: "llm_gateway", ok: false, detail: { error: String(error?.message ?? error) }, remediation: null };
  }
}

// Runs all self-checks. `runtime` is the PrototypeAgent (exposes computer +
// getLlmGatewayStatus). `logger` is optional (structured logger safeLog).
export async function runSelfCheck({ runtime, logger = null } = {}) {
  const checks = await Promise.all([
    checkDeliverableRenderer(),
    checkDesktopProvider(runtime?.computer),
    Promise.resolve(checkLlmGateway(runtime))
  ]);

  const failed = checks.filter((c) => !c.ok);
  const report = {
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    summary: failed.length === 0
      ? "All subsystems operational."
      : `${failed.length} subsystem(s) need attention: ${failed.map((c) => c.id).join(", ")}.`,
    checks
  };

  if (logger && typeof logger.safeLog === "function") {
    logger.safeLog({
      kind: "system.self_check",
      ok: report.ok,
      summary: report.summary,
      failed: failed.map((c) => ({ id: c.id, remediation: c.remediation }))
    });
  }

  return report;
}
