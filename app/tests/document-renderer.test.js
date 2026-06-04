import assert from "node:assert/strict";
import {
  parseMarkdownBlocks,
  renderArtifactDeliverables,
  mimeForFormat
} from "../src/artifacts/document-renderer.js";
import { buildCollectionTable, buildDecisionNote } from "../src/artifacts/builders.js";

export async function run() {
  // --- Markdown parsing ---
  const blocks = parseMarkdownBlocks([
    "# Title",
    "Some paragraph.",
    "- item one",
    "- item two",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |"
  ].join("\n"));

  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, ["heading", "paragraph", "list", "table"]);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[2].items, ["item one", "item two"]);
  assert.deepEqual(blocks[3].header, ["A", "B"]);
  assert.deepEqual(blocks[3].rows, [["1", "2"]]);

  assert.equal(mimeForFormat("pdf"), "application/pdf");
  assert.ok(mimeForFormat("docx").includes("wordprocessingml"));
  assert.ok(mimeForFormat("xlsx").includes("spreadsheetml"));

  // --- Decision note renders real PDF + DOCX ---
  const note = buildDecisionNote({
    mission: "Compare controlled pages",
    runId: "run_test",
    collectionArtifactId: "art_collection",
    records: [{
      sourceTitle: "Alpha", sourceId: "s1", sourceReference: "http://x",
      tagline: "fast", priceLevel: "Low", deliverySpeed: "Fast", riskNote: "none",
      evidenceId: "e1", evidenceReference: "ev"
    }],
    sourceReferences: [{ id: "s1", title: "Alpha", canonicalRef: "http://x" }]
  });
  const noteOut = await renderArtifactDeliverables(note);
  const noteFormats = noteOut.map((o) => o.format).sort();
  assert.deepEqual(noteFormats, ["docx", "pdf"]);
  for (const item of noteOut) {
    assert.equal(item.errored ?? false, false, `${item.format} should render`);
    assert.ok(item.buffer && item.buffer.length > 0, `${item.format} buffer non-empty`);
  }
  // PDF magic = %PDF
  const pdf = noteOut.find((o) => o.format === "pdf");
  assert.equal(pdf.buffer.slice(0, 4).toString("ascii"), "%PDF");
  // DOCX magic = PK (zip)
  const docx = noteOut.find((o) => o.format === "docx");
  assert.equal(docx.buffer.slice(0, 2).toString("ascii"), "PK");

  // --- Collection table renders real XLSX + PDF ---
  const table = buildCollectionTable({
    mission: "Compare", runId: "run_test",
    records: [{ sourceTitle: "Alpha", sourceReference: "http://x", fact: "f", confidence: "High", note: "n", evidenceReference: "ev" }]
  });
  const tableOut = await renderArtifactDeliverables(table);
  const tableFormats = tableOut.map((o) => o.format).sort();
  assert.deepEqual(tableFormats, ["pdf", "xlsx"]);
  const xlsx = tableOut.find((o) => o.format === "xlsx");
  assert.equal(xlsx.errored ?? false, false);
  assert.equal(xlsx.buffer.slice(0, 2).toString("ascii"), "PK");
}
