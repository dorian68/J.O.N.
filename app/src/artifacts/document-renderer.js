// Renders JON artifacts into real, openable office deliverables (PDF / DOCX / XLSX)
// instead of leaving them as raw Markdown. The artifact builders emit a Markdown
// `content` string; this module parses that into a small block model and renders
// genuine binary files with battle-tested libraries.
//
// Design goals:
// - Never throw the whole run: if a renderer fails, the caller still has the .md.
// - Zero LLM dependency — pure deterministic transformation.
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType
} from "docx";
import ExcelJS from "exceljs";
import { ARTIFACT_TYPE } from "../config.js";

// ---------------------------------------------------------------------------
// Markdown -> block model
// ---------------------------------------------------------------------------

// Parses the constrained Markdown emitted by src/artifacts/builders.js:
// headings (#..######), bullet lines (- ...), pipe tables (| a | b |), and
// plain paragraphs. Returns an ordered array of blocks.
export function parseMarkdownBlocks(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const blocks = [];
  let i = 0;

  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isSeparatorRow = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

  const splitRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    if (isTableRow(line)) {
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const rows = tableLines.map(splitRow);
      let header = null;
      let body = rows;
      if (rows.length >= 2 && isSeparatorRow(tableLines[1])) {
        header = rows[0];
        body = rows.slice(2);
      }
      blocks.push({ type: "table", header, rows: body });
      continue;
    }

    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    blocks.push({ type: "paragraph", text: line.trim() });
    i += 1;
  }

  return blocks;
}

// Extract the first table found (used for spreadsheet rendering).
function firstTable(blocks) {
  return blocks.find((block) => block.type === "table") ?? null;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export async function renderPdf(blocks, { title } = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const promise = pdfToBuffer(doc);

  if (title) {
    doc.font("Helvetica-Bold").fontSize(20).text(title, { align: "left" });
    doc.moveDown(0.6);
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      const size = Math.max(11, 19 - block.level * 2);
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(size).text(block.text);
      doc.moveDown(0.2);
    } else if (block.type === "paragraph") {
      doc.font("Helvetica").fontSize(11).text(block.text, { align: "left" });
      doc.moveDown(0.4);
    } else if (block.type === "list") {
      doc.font("Helvetica").fontSize(11).list(block.items, { bulletRadius: 2, textIndent: 12 });
      doc.moveDown(0.4);
    } else if (block.type === "table") {
      renderPdfTable(doc, block);
      doc.moveDown(0.6);
    }
  }

  return promise;
}

function renderPdfTable(doc, table) {
  const header = table.header ?? [];
  const rows = table.rows ?? [];
  const allRows = header.length ? [header, ...rows] : rows;
  if (!allRows.length) return;

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colCount = Math.max(...allRows.map((r) => r.length));
  const colWidth = usableWidth / colCount;
  const cellPad = 4;

  doc.fontSize(9);
  for (let r = 0; r < allRows.length; r += 1) {
    const row = allRows[r];
    const isHeader = header.length && r === 0;
    doc.font(isHeader ? "Helvetica-Bold" : "Helvetica");

    // Compute row height from the tallest cell.
    let rowHeight = 0;
    for (let c = 0; c < colCount; c += 1) {
      const text = String(row[c] ?? "");
      const h = doc.heightOfString(text, { width: colWidth - cellPad * 2 });
      rowHeight = Math.max(rowHeight, h + cellPad * 2);
    }

    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    const y = doc.y;
    for (let c = 0; c < colCount; c += 1) {
      const x = startX + c * colWidth;
      doc.rect(x, y, colWidth, rowHeight).strokeColor("#cccccc").lineWidth(0.5).stroke();
      doc.fillColor("#000000").text(String(row[c] ?? ""), x + cellPad, y + cellPad, {
        width: colWidth - cellPad * 2
      });
    }
    doc.y = y + rowHeight;
  }
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const DOCX_HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
};

export async function renderDocx(blocks, { title } = {}) {
  const children = [];

  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({
        text: block.text,
        heading: DOCX_HEADING[block.level] ?? HeadingLevel.HEADING_3
      }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ children: [new TextRun(block.text)] }));
    } else if (block.type === "list") {
      for (const item of block.items) {
        children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
      }
    } else if (block.type === "table") {
      children.push(buildDocxTable(block));
      children.push(new Paragraph({ text: "" }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function buildDocxTable(table) {
  const header = table.header ?? [];
  const rows = table.rows ?? [];
  const allRows = header.length ? [header, ...rows] : rows;
  const colCount = Math.max(1, ...allRows.map((r) => r.length));

  const tableRows = allRows.map((row, rowIndex) => {
    const cells = [];
    for (let c = 0; c < colCount; c += 1) {
      const isHeader = header.length && rowIndex === 0;
      cells.push(new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: String(row[c] ?? ""), bold: Boolean(isHeader) })]
        })]
      }));
    }
    return new TableRow({ children: cells });
  });

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

export async function renderXlsx(blocks, { title, sheetName = "Data" } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JON";
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Data");

  const table = firstTable(blocks);
  if (table) {
    const header = table.header ?? [];
    if (header.length) {
      const headerRow = sheet.addRow(header);
      headerRow.font = { bold: true };
      sheet.columns = header.map((h) => ({ width: Math.min(60, Math.max(14, String(h).length + 6)) }));
    }
    for (const row of table.rows ?? []) {
      sheet.addRow(row);
    }
  } else {
    // No table: render the document as a one-column outline so the file is still
    // meaningful rather than empty.
    if (title) {
      const t = sheet.addRow([title]);
      t.font = { bold: true, size: 14 };
    }
    for (const block of blocks) {
      if (block.type === "heading") {
        const r = sheet.addRow([block.text]);
        r.font = { bold: true };
      } else if (block.type === "paragraph") {
        sheet.addRow([block.text]);
      } else if (block.type === "list") {
        for (const item of block.items) sheet.addRow([`• ${item}`]);
      }
    }
    sheet.columns = [{ width: 100 }];
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// Which binary deliverables to emit per artifact type. PDF is universal;
// DOCX is added for editable narrative documents; XLSX for tabular artifacts.
function formatsForArtifactType(artifactType) {
  switch (artifactType) {
    case ARTIFACT_TYPE.COLLECTION_TABLE:
      return ["xlsx", "pdf"];
    case ARTIFACT_TYPE.DECISION_NOTE:
      return ["pdf", "docx"];
    default:
      return ["pdf", "docx"];
  }
}

const MIME_BY_FORMAT = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown"
};

export function mimeForFormat(format) {
  return MIME_BY_FORMAT[format] ?? "application/octet-stream";
}

async function renderOne(format, blocks, options) {
  switch (format) {
    case "pdf": return renderPdf(blocks, options);
    case "docx": return renderDocx(blocks, options);
    case "xlsx": return renderXlsx(blocks, options);
    default: throw new Error(`Unsupported deliverable format: ${format}`);
  }
}

// Renders all binary deliverables for an artifact. Returns an array of
// { format, ext, mime, buffer }. Failures for a single format are captured in
// the result (errored: true) rather than aborting the others.
export async function renderArtifactDeliverables({ artifactType, title, content }) {
  const blocks = parseMarkdownBlocks(content);
  const formats = formatsForArtifactType(artifactType);
  const results = [];
  for (const format of formats) {
    try {
      const buffer = await renderOne(format, blocks, { title });
      results.push({ format, ext: format, mime: mimeForFormat(format), buffer });
    } catch (error) {
      results.push({ format, ext: format, mime: mimeForFormat(format), buffer: null, errored: true, error: String(error?.message ?? error) });
    }
  }
  return results;
}
