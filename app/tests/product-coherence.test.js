import assert from "node:assert/strict";
import { listMcpServerCatalog } from "../src/connectors/mcp-server-catalog.js";
import { OperatorService } from "../src/service/operator-service.js";

// Lot 4 — product coherence (audit F1, F2).
export async function run() {
  // ── F2: MCP catalog is honest (available vs coming_soon) ────────────────────
  const catalog = listMcpServerCatalog({ env: {} });
  assert.ok(catalog.length > 0, "catalog not empty");
  for (const entry of catalog) {
    assert.ok(["available", "coming_soon", "requires_config"].includes(entry.status), `valid status for ${entry.id}`);
    // available <=> has an endpoint <=> connectable. No "fake available".
    assert.equal(entry.status === "available", Boolean(entry.url), `status matches endpoint for ${entry.id}`);
    assert.equal(entry.connectable, Boolean(entry.url), `connectable matches endpoint for ${entry.id}`);
  }
  const available = catalog.filter((e) => e.status === "available");
  const comingSoon = catalog.filter((e) => e.status === "coming_soon");
  assert.ok(available.length > 0 && available.every((e) => e.url), "available entries all have endpoints");
  assert.ok(comingSoon.length > 0 && comingSoon.every((e) => !e.url), "coming_soon entries have no endpoint (not masquerading)");

  // An env-provided URL promotes a coming_soon entry to available.
  const promoted = listMcpServerCatalog({ env: { COWORK_MCP_YOUTUBE_URL: "https://example.com/mcp" } })
    .find((e) => e.id === "youtube");
  assert.equal(promoted.status, "available", "env URL makes an entry available");
  assert.equal(promoted.configuredViaEnv, true);

  // ── F1: desktop run-artifacts list method is wired ──────────────────────────
  assert.equal(typeof OperatorService.prototype.listRunArtifactsWithDeliverables, "function",
    "listRunArtifactsWithDeliverables exists (desktop /api/runs/:id/artifacts uses it)");
}
