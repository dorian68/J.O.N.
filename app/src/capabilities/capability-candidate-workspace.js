import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DATA_ROOT } from "../config.js";
import { ensureDir, readJson, sanitizeFilename, writeJson, writeText } from "../utils/files.js";
import { assessCapabilityGap, validateCapabilityBuildProposal } from "./capability-builder.js";

export const CAPABILITY_CANDIDATE_STORE_KEY = "capability.generated_candidates.v1";
export const CAPABILITY_ARTIFACT_CONTRACT_VERSION = "capability.artifact.v1";
export const WEB_DATA_ADAPTER_ARTIFACT_KIND = "web_data_adapter.v1";
export const FILE_TRANSFORM_ADAPTER_ARTIFACT_KIND = "file_transform_adapter.v1";
export const VERIFIER_ADAPTER_ARTIFACT_KIND = "verifier_adapter.v1";
export const CAPABILITY_CANDIDATE_STATUS = Object.freeze({
  DRAFT: "draft",
  CANDIDATE: "candidate",
  VALIDATED: "validated",
  ENABLED: "enabled",
  DISABLED: "disabled",
  FAILED_VALIDATION: "failed_validation"
});

export const CAPABILITY_CANDIDATE_ROOT = path.join(DATA_ROOT, "capabilities", "candidates");

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 1200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hashId(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 10);
}

function safeId(value, maxLength = 48) {
  return cleanText(value, maxLength)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength)
    || "candidate";
}

function parseRequestedRowCount(...texts) {
  const text = texts.map((entry) => cleanText(entry, 2000)).join(" ");
  const match = text.match(/\b([1-9][0-9]?)\b/);
  if (!match) {
    return 3;
  }
  return Math.max(1, Math.min(50, Number.parseInt(match[1], 10)));
}

function inferFieldNames(text) {
  const normalized = cleanText(text, 2000).toLowerCase();
  const fields = new Set(["title", "url", "summary"]);
  if (/invoice|facture|metadata|m[ée]tadonn/.test(normalized)) {
    fields.add("date");
    fields.add("amount");
    fields.add("status");
  }
  if (/profile|profil|supplier|fournisseur|candidate|contact/.test(normalized)) {
    fields.add("organization");
    fields.add("location");
  }
  if (/job|poste|mission|offer|offre/.test(normalized)) {
    fields.add("budget");
    fields.add("postedAt");
  }
  return Array.from(fields).slice(0, 10);
}

function normalizeStore(value = {}) {
  return {
    version: "1.0.0",
    candidates: Array.isArray(value.candidates) ? value.candidates.map(normalizeCandidateRecord) : []
  };
}

function normalizeCandidateRecord(record = {}) {
  return {
    id: cleanText(record.id, 80),
    proposalId: cleanText(record.proposalId, 80),
    skillId: cleanText(record.skillId, 160),
    title: cleanText(record.title, 240),
    capabilityKind: cleanText(record.capabilityKind, 80),
    artifactKind: cleanText(record.artifactKind, 120),
    status: Object.values(CAPABILITY_CANDIDATE_STATUS).includes(record.status)
      ? record.status
      : CAPABILITY_CANDIDATE_STATUS.DRAFT,
    mission: cleanText(record.mission, 2000),
    desiredOutcome: cleanText(record.desiredOutcome, 2000),
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    validatedAt: record.validatedAt ?? null,
    enabledAt: record.enabledAt ?? null,
    disabledAt: record.disabledAt ?? null,
    artifactDirectory: record.artifactDirectory ?? null,
    artifactPaths: record.artifactPaths ?? {},
    proposal: record.proposal ?? null,
    skillManifest: record.skillManifest ?? null,
    artifactSummary: record.artifactSummary ?? null,
    validation: record.validation ?? null,
    activation: record.activation ?? null,
    safety: record.safety ?? {
      executionMode: "declarative_dsl",
      generatedCode: false,
      runtimeCoreMutation: false
    }
  };
}

function storeFor(database) {
  return normalizeStore(database.getAppSetting(CAPABILITY_CANDIDATE_STORE_KEY, { candidates: [] }).value);
}

function saveStore(database, store) {
  return database.upsertAppSetting(CAPABILITY_CANDIDATE_STORE_KEY, normalizeStore(store)).value;
}

export function listCapabilityCandidates(database, { status = null } = {}) {
  const candidates = storeFor(database).candidates;
  return status ? candidates.filter((candidate) => candidate.status === status) : candidates;
}

export function getCapabilityCandidate(database, candidateId) {
  return listCapabilityCandidates(database).find((candidate) => candidate.id === candidateId) ?? null;
}

export function upsertCapabilityCandidate(database, candidate) {
  const normalized = normalizeCandidateRecord({
    ...candidate,
    updatedAt: nowIso()
  });
  const store = storeFor(database);
  const next = [
    ...store.candidates.filter((entry) => entry.id !== normalized.id),
    normalized
  ].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  saveStore(database, {
    ...store,
    candidates: next
  });
  return getCapabilityCandidate(database, normalized.id);
}

function buildWebDataAdapterArtifact({ candidateId, proposal, minimumRows }) {
  const fields = inferFieldNames(`${proposal.mission} ${proposal.desiredOutcome}`);
  return {
    contractVersion: CAPABILITY_ARTIFACT_CONTRACT_VERSION,
    artifactKind: WEB_DATA_ADAPTER_ARTIFACT_KIND,
    candidateId,
    skillId: proposal.proposedSkillManifest?.id ?? null,
    generatedCode: false,
    executionMode: "declarative_dsl",
    capabilityKind: "web_data_adapter",
    extractionPlan: {
      minimumRows,
      maxRows: Math.max(minimumRows, 25),
      rowSelectors: [
        "[data-capability-row]",
        "[data-result]",
        "article",
        "li",
        "tr",
        ".result",
        ".card",
        "[role='listitem']"
      ],
      fields,
      fieldSelectors: {
        title: ["[data-field='title']", "h1", "h2", "h3", "a", "strong"],
        url: ["a[href]"],
        summary: ["[data-field='summary']", "p", ".summary", ".description", "td"],
        organization: ["[data-field='organization']", ".organization", ".company", "[data-company]"],
        location: ["[data-field='location']", ".location", "[data-location]"],
        budget: ["[data-field='budget']", ".budget", "[data-budget]"],
        postedAt: ["[data-field='postedAt']", "time", "[data-posted-at]"],
        date: ["[data-field='date']", "time", "[data-date]"],
        amount: ["[data-field='amount']", ".amount", "[data-amount]"],
        status: ["[data-field='status']", ".status", "[data-status]"]
      }
    },
    verification: {
      requiredChecks: ["minimum_rows", "non_empty_primary_field", "negative_fixture_no_rows"],
      incompleteOutcomeStatus: "failed_incomplete_deliverable"
    },
    safety: {
      readOnly: true,
      allowedRuntimeSurfaces: ["browser_dom", "html_fixture"],
      forbiddenActions: ["click", "type", "submit", "publish", "delete", "credential_access"]
    }
  };
}

function inferFileFormats(text) {
  const normalized = cleanText(text, 2000).toLowerCase();
  const formats = new Set();
  if (/csv|comma/.test(normalized)) formats.add("csv");
  if (/json/.test(normalized)) formats.add("json");
  if (/pdf/.test(normalized)) formats.add("pdf");
  if (/xlsx|excel/.test(normalized)) formats.add("xlsx");
  if (/txt|text/.test(normalized)) formats.add("txt");
  if (formats.size === 0) { formats.add("csv"); formats.add("json"); }
  return Array.from(formats);
}

function buildFileTransformAdapterArtifact({ candidateId, proposal }) {
  const inputFormats = inferFileFormats(`${proposal.mission} ${proposal.desiredOutcome}`);
  return {
    contractVersion: CAPABILITY_ARTIFACT_CONTRACT_VERSION,
    artifactKind: FILE_TRANSFORM_ADAPTER_ARTIFACT_KIND,
    candidateId,
    skillId: proposal.proposedSkillManifest?.id ?? null,
    generatedCode: false,
    executionMode: "declarative_dsl",
    capabilityKind: "file_transform_adapter",
    transformPlan: {
      inputFormats,
      outputFormat: "json",
      transforms: [
        { id: "read_input", kind: "read_file", description: "Read the source file" },
        { id: "parse_input", kind: "parse", formats: inputFormats },
        { id: "map_fields", kind: "map_fields", description: "Map source fields to output schema" },
        { id: "write_output", kind: "write_file", description: "Write transformed output" }
      ],
      rollback: { strategy: "keep_original", backupSuffix: ".bak" }
    },
    verification: {
      requiredChecks: ["output_exists", "output_non_empty", "negative_fixture_empty"],
      incompleteOutcomeStatus: "failed_incomplete_deliverable"
    },
    safety: {
      readOnly: false,
      allowedExtensions: ["csv", "json", "txt", "xlsx", "pdf"],
      forbiddenActions: ["delete_original", "overwrite_without_backup", "credential_access", "network_access", "shell_exec"]
    }
  };
}

function buildVerifierAdapterArtifact({ candidateId, proposal }) {
  return {
    contractVersion: CAPABILITY_ARTIFACT_CONTRACT_VERSION,
    artifactKind: VERIFIER_ADAPTER_ARTIFACT_KIND,
    candidateId,
    skillId: proposal.proposedSkillManifest?.id ?? null,
    generatedCode: false,
    executionMode: "declarative_dsl",
    capabilityKind: "verifier_adapter",
    verificationPlan: {
      checks: [
        { id: "deliverable_non_empty", kind: "min_length", minLength: 10, description: "Deliverable must not be empty" },
        { id: "no_error_markers", kind: "pattern_absent", patterns: ["\\berror\\b", "\\bfailed\\b", "\\bundefined\\b"], description: "Deliverable must not contain error markers" },
        { id: "min_rows", kind: "min_rows", minRows: 1, description: "Deliverable must have at least one row or line" },
        { id: "no_hallucinated_success", kind: "pattern_absent", patterns: ["task complete", "done successfully", "mission accomplie"], description: "No completion claim without evidence" }
      ],
      incompleteOutcomeStatus: "failed_incomplete_deliverable"
    },
    safety: {
      readOnly: true,
      allowedRuntimeSurfaces: ["file_system", "browser_dom", "text_content"],
      forbiddenActions: ["write", "delete", "publish", "submit", "shell_exec"]
    }
  };
}

function positiveFixtureFor({ minimumRows, fields }) {
  const rows = Array.from({ length: minimumRows }, (_, index) => {
    const rowNumber = index + 1;
    const extraFields = fields
      .filter((field) => !["title", "url", "summary"].includes(field))
      .map((field) => `<span data-field="${field}">${field}-${rowNumber}</span>`)
      .join("\n      ");
    return `
    <article data-capability-row>
      <a data-field="title" href="/supplier-${rowNumber}">Supplier ${rowNumber}</a>
      <p data-field="summary">Validated supplier profile ${rowNumber}</p>
      ${extraFields}
    </article>`;
  }).join("\n");
  return `<!doctype html>
<html>
  <body>
    <main>
      ${rows}
    </main>
  </body>
</html>
`;
}

function negativeFixtureFor() {
  return `<!doctype html>
<html>
  <body>
    <main>
      <section data-empty-state>No matching rows are available.</section>
    </main>
  </body>
</html>
`;
}

function positiveFixtureForFileTransform() {
  return "title,url,summary\nSupplier 1,/supplier-1,Validated supplier profile 1\nSupplier 2,/supplier-2,Validated supplier profile 2\nSupplier 3,/supplier-3,Validated supplier profile 3\n";
}

function negativeFixtureForFileTransform() {
  return "";
}

function positiveFixtureForVerifier() {
  return JSON.stringify([
    { title: "Result 1", url: "/result-1", summary: "Verified result 1" },
    { title: "Result 2", url: "/result-2", summary: "Verified result 2" }
  ], null, 2);
}

function negativeFixtureForVerifier() {
  return "";
}

export function createDraftCapabilityProposal(database, proposal) {
  const validation = validateCapabilityBuildProposal(proposal);
  if (!validation.valid) {
    throw new Error(`Invalid capability build proposal: ${validation.errors.join("; ")}`);
  }
  if (proposal.status !== "draft_proposed") return null;
  const now = nowIso();
  const candidateId = `capcand_${hashId(`draft\n${proposal.id}`)}`;
  const existing = getCapabilityCandidate(database, candidateId);
  if (existing) return existing;
  const candidate = normalizeCandidateRecord({
    id: candidateId,
    proposalId: proposal.id,
    skillId: proposal.proposedSkillManifest?.id ?? null,
    title: proposal.title,
    capabilityKind: proposal.capabilityKind,
    artifactKind: null,
    status: CAPABILITY_CANDIDATE_STATUS.DRAFT,
    mission: proposal.mission,
    desiredOutcome: proposal.desiredOutcome,
    createdAt: now,
    updatedAt: now,
    proposal,
    skillManifest: proposal.proposedSkillManifest ?? null
  });
  return upsertCapabilityCandidate(database, candidate);
}

const SUPPORTED_ARTIFACT_KINDS = new Set(["web_data_adapter", "file_transform_adapter", "verifier_adapter"]);

export async function createCapabilityCandidateArtifact({
  proposal,
  draftCandidateId = null,
  rootDir = CAPABILITY_CANDIDATE_ROOT,
  now = nowIso()
} = {}) {
  const proposalValidation = validateCapabilityBuildProposal(proposal);
  if (!proposalValidation.valid) {
    throw new Error(`Invalid capability proposal: ${proposalValidation.errors.join("; ")}`);
  }
  if (proposal.status !== "draft_proposed" || !proposal.proposedSkillManifest) {
    throw new Error("Only draft capability proposals can create candidate artifacts.");
  }
  if (!SUPPORTED_ARTIFACT_KINDS.has(proposal.capabilityKind)) {
    throw new Error(`Candidate artifact generation is not implemented for ${proposal.capabilityKind}.`);
  }

  const candidateId = draftCandidateId ?? `capcand_${hashId(`${proposal.id}\n${now}`)}`;
  const dirName = sanitizeFilename(`${candidateId}-${safeId(proposal.title, 32)}`);
  const artifactDirectory = path.join(rootDir, dirName);

  let artifact;
  let positiveFixtureContent;
  let negativeFixtureContent;
  let positiveFixtureExt = "html";
  let artifactSummary;

  if (proposal.capabilityKind === "web_data_adapter") {
    const minimumRows = parseRequestedRowCount(proposal.mission, proposal.desiredOutcome);
    artifact = buildWebDataAdapterArtifact({ candidateId, proposal, minimumRows });
    positiveFixtureContent = positiveFixtureFor({ minimumRows, fields: artifact.extractionPlan.fields });
    negativeFixtureContent = negativeFixtureFor();
    artifactSummary = {
      contractVersion: artifact.contractVersion,
      artifactKind: artifact.artifactKind,
      executionMode: artifact.executionMode,
      minimumRows,
      fields: artifact.extractionPlan.fields
    };
  } else if (proposal.capabilityKind === "file_transform_adapter") {
    artifact = buildFileTransformAdapterArtifact({ candidateId, proposal });
    positiveFixtureContent = positiveFixtureForFileTransform();
    negativeFixtureContent = negativeFixtureForFileTransform();
    positiveFixtureExt = "csv";
    artifactSummary = {
      contractVersion: artifact.contractVersion,
      artifactKind: artifact.artifactKind,
      executionMode: artifact.executionMode,
      inputFormats: artifact.transformPlan.inputFormats,
      transforms: artifact.transformPlan.transforms.map((t) => t.id)
    };
  } else {
    artifact = buildVerifierAdapterArtifact({ candidateId, proposal });
    positiveFixtureContent = positiveFixtureForVerifier();
    negativeFixtureContent = negativeFixtureForVerifier();
    positiveFixtureExt = "json";
    artifactSummary = {
      contractVersion: artifact.contractVersion,
      artifactKind: artifact.artifactKind,
      executionMode: artifact.executionMode,
      checkCount: artifact.verificationPlan.checks.length
    };
  }

  const artifactPaths = {
    manifest: path.join(artifactDirectory, "candidate.json"),
    adapter: path.join(artifactDirectory, "adapter.json"),
    positiveFixture: path.join(artifactDirectory, "fixtures", `positive.${positiveFixtureExt}`),
    negativeFixture: path.join(artifactDirectory, "fixtures", `negative.${positiveFixtureExt}`),
    validationReport: path.join(artifactDirectory, "validation-report.json")
  };

  const candidate = normalizeCandidateRecord({
    id: candidateId,
    proposalId: proposal.id,
    skillId: proposal.proposedSkillManifest.id,
    title: proposal.title,
    capabilityKind: proposal.capabilityKind,
    artifactKind: artifact.artifactKind,
    status: CAPABILITY_CANDIDATE_STATUS.CANDIDATE,
    mission: proposal.mission,
    desiredOutcome: proposal.desiredOutcome,
    createdAt: now,
    updatedAt: now,
    artifactDirectory,
    artifactPaths,
    proposal,
    skillManifest: proposal.proposedSkillManifest,
    artifactSummary,
    safety: artifact.safety
  });

  await ensureDir(path.join(artifactDirectory, "fixtures"));
  await writeJson(artifactPaths.adapter, artifact);
  await writeText(artifactPaths.positiveFixture, positiveFixtureContent);
  await writeText(artifactPaths.negativeFixture, negativeFixtureContent);
  await writeJson(artifactPaths.manifest, candidate);
  return { candidate, artifact };
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function tagBlocks(html, tagName) {
  const escaped = tagName.replace(/[^a-z0-9-]/gi, "");
  if (!escaped) {
    return [];
  }
  const regex = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}>`, "gi");
  return Array.from(String(html ?? "").matchAll(regex), (match) => match[0]);
}

function dataRowBlocks(html) {
  const regex = /<([a-z0-9-]+)\b[^>]*(?:data-capability-row|data-result|role=["']listitem["'])[^>]*>[\s\S]*?<\/\1>/gi;
  return Array.from(String(html ?? "").matchAll(regex), (match) => match[0]);
}

function classRowBlocks(html) {
  const regex = /<([a-z0-9-]+)\b[^>]*class=["'][^"']*(?:result|card)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;
  return Array.from(String(html ?? "").matchAll(regex), (match) => match[0]);
}

function extractRowBlocks(html) {
  const candidates = [
    ...dataRowBlocks(html),
    ...tagBlocks(html, "article"),
    ...tagBlocks(html, "li"),
    ...tagBlocks(html, "tr"),
    ...classRowBlocks(html)
  ];
  const seen = new Set();
  return candidates.filter((block) => {
    const key = stripTags(block).slice(0, 300);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractDataField(block, fieldName) {
  const regex = new RegExp(`<([a-z0-9-]+)\\b[^>]*data-field=["']${fieldName}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  const match = block.match(regex);
  return match ? stripTags(match[2]) : "";
}

function extractFirstTagText(block, tags = []) {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    const text = match ? stripTags(match[1]) : "";
    if (text) {
      return text;
    }
  }
  return "";
}

function extractFirstHref(block, baseUrl = "about:blank") {
  const match = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (!match) {
    return "";
  }
  try {
    return new URL(decodeHtmlEntities(match[1]), baseUrl).toString();
  } catch {
    return decodeHtmlEntities(match[1]);
  }
}

function compactRow(row = {}) {
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    const cleaned = cleanText(value, 500);
    if (cleaned) {
      output[key] = cleaned;
    }
  }
  return output;
}

export function executeWebDataAdapterOnHtml({
  artifact,
  html,
  url = "about:blank"
} = {}) {
  if (artifact?.contractVersion !== CAPABILITY_ARTIFACT_CONTRACT_VERSION) {
    throw new Error("Unsupported capability artifact contract.");
  }
  if (artifact.artifactKind !== WEB_DATA_ADAPTER_ARTIFACT_KIND) {
    throw new Error(`Unsupported artifact kind: ${artifact.artifactKind}`);
  }
  const plan = artifact.extractionPlan ?? {};
  const fields = Array.isArray(plan.fields) && plan.fields.length > 0 ? plan.fields : ["title", "url", "summary"];
  const blocks = extractRowBlocks(html);
  const rows = blocks.map((block) => {
    const row = {};
    for (const field of fields) {
      if (field === "title") {
        row.title = extractDataField(block, "title") || extractFirstTagText(block, ["h1", "h2", "h3", "a", "strong"]);
      } else if (field === "url") {
        row.url = extractFirstHref(block, url);
      } else if (field === "summary") {
        row.summary = extractDataField(block, "summary") || extractFirstTagText(block, ["p", "td"]);
      } else {
        row[field] = extractDataField(block, field);
      }
    }
    if (!row.summary) {
      const text = stripTags(block);
      row.summary = row.title ? text.replace(row.title, "").trim() : text;
    }
    return compactRow(row);
  }).filter((row) => row.title || row.summary || row.url).slice(0, plan.maxRows ?? 25);

  const minimumRows = Number.isFinite(Number(plan.minimumRows)) ? Number(plan.minimumRows) : 1;
  return {
    status: rows.length >= minimumRows ? "pass" : "fail",
    rowCount: rows.length,
    minimumRows,
    rows,
    extractedAt: nowIso()
  };
}

export function executeFileTransformAdapterOnContent({ artifact, content, filename = "" } = {}) {
  if (artifact?.contractVersion !== CAPABILITY_ARTIFACT_CONTRACT_VERSION) {
    throw new Error("Unsupported capability artifact contract.");
  }
  if (artifact.artifactKind !== FILE_TRANSFORM_ADAPTER_ARTIFACT_KIND) {
    throw new Error(`Unsupported artifact kind: ${artifact.artifactKind}`);
  }
  const text = cleanText(String(content ?? ""), 100000);
  if (!text) {
    return { status: "fail", reason: "empty_input", rows: [], rowCount: 0, transformedAt: nowIso() };
  }
  let rows = [];
  let format = "unknown";
  const isCsv = filename.endsWith(".csv") || /^[^\n,]+,[^\n,]+/.test(text.slice(0, 300));
  if (isCsv) {
    format = "csv";
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = (lines[0] ?? "").split(",").map((h) => h.trim());
    rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      const row = {};
      headers.forEach((header, i) => { if (header && cells[i]) row[header] = cells[i]; });
      return row;
    }).filter((row) => Object.keys(row).length > 0);
  } else {
    try {
      const parsed = JSON.parse(text);
      format = "json";
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      format = "text";
      rows = text.split(/\r?\n/).filter(Boolean).map((line) => ({ content: line }));
    }
  }
  return {
    status: rows.length > 0 ? "pass" : "fail",
    rowCount: rows.length,
    rows: rows.slice(0, 50),
    format,
    transformedAt: nowIso()
  };
}

export function executeVerifierAdapterOnState({ artifact, state = {} } = {}) {
  if (artifact?.contractVersion !== CAPABILITY_ARTIFACT_CONTRACT_VERSION) {
    throw new Error("Unsupported capability artifact contract.");
  }
  if (artifact.artifactKind !== VERIFIER_ADAPTER_ARTIFACT_KIND) {
    throw new Error(`Unsupported artifact kind: ${artifact.artifactKind}`);
  }
  const plan = artifact.verificationPlan ?? {};
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const text = cleanText(
    String(state.text ?? state.content ?? (rows.length ? JSON.stringify(rows) : "") ?? ""),
    100000
  );
  const checks = (plan.checks ?? []).map((check) => {
    if (check.kind === "min_length") {
      return { ...check, pass: text.length >= (check.minLength ?? 1) };
    }
    if (check.kind === "pattern_absent") {
      const found = (check.patterns ?? []).find((pat) => {
        try { return new RegExp(pat, "i").test(text); } catch { return false; }
      });
      return { ...check, pass: !found, foundPattern: found ?? null };
    }
    if (check.kind === "min_rows") {
      const count = rows.length > 0 ? rows.length : text.split(/\r?\n/).filter(Boolean).length;
      return { ...check, pass: count >= (check.minRows ?? 1), rowCount: count };
    }
    return { ...check, pass: true };
  });
  const pass = checks.every((c) => c.pass);
  return {
    status: pass ? "pass" : "fail",
    pass,
    checkCount: checks.length,
    checks,
    failedChecks: checks.filter((c) => !c.pass).map((c) => c.id),
    verifiedAt: nowIso()
  };
}

export async function readCapabilityCandidateArtifact(candidate) {
  if (!candidate?.artifactPaths?.adapter) {
    throw new Error("Candidate artifact path is missing.");
  }
  return readJson(candidate.artifactPaths.adapter);
}

export async function validateCapabilityCandidateArtifact(candidate) {
  const artifact = await readCapabilityCandidateArtifact(candidate);
  const validatedAt = nowIso();
  let checks = [];
  let evidence = {};

  const baseChecks = [
    { id: "contract_version", pass: artifact.contractVersion === CAPABILITY_ARTIFACT_CONTRACT_VERSION },
    { id: "declarative_dsl_only", pass: artifact.generatedCode === false && artifact.executionMode === "declarative_dsl" }
  ];

  if (artifact.artifactKind === WEB_DATA_ADAPTER_ARTIFACT_KIND) {
    const positiveHtml = await fs.readFile(candidate.artifactPaths.positiveFixture, "utf8");
    const negativeHtml = await fs.readFile(candidate.artifactPaths.negativeFixture, "utf8");
    const positive = executeWebDataAdapterOnHtml({ artifact, html: positiveHtml, url: "https://fixture.local/results" });
    const negative = executeWebDataAdapterOnHtml({ artifact, html: negativeHtml, url: "https://fixture.local/results" });
    checks = [
      ...baseChecks,
      { id: "positive_fixture_minimum_rows", pass: positive.rowCount >= positive.minimumRows, rowCount: positive.rowCount, minimumRows: positive.minimumRows },
      { id: "positive_fixture_primary_field", pass: positive.rows.every((row) => Boolean(row.title || row.summary || row.url)), sample: positive.rows.slice(0, 3) },
      { id: "negative_fixture_no_false_positive", pass: negative.rowCount === 0, rowCount: negative.rowCount }
    ];
    evidence = { positiveFixture: candidate.artifactPaths.positiveFixture, negativeFixture: candidate.artifactPaths.negativeFixture, sampleRows: positive.rows.slice(0, 5) };
  } else if (artifact.artifactKind === FILE_TRANSFORM_ADAPTER_ARTIFACT_KIND) {
    const positiveContent = await fs.readFile(candidate.artifactPaths.positiveFixture, "utf8").catch(() => "");
    const negativeContent = await fs.readFile(candidate.artifactPaths.negativeFixture, "utf8").catch(() => "");
    const positive = executeFileTransformAdapterOnContent({ artifact, content: positiveContent, filename: "fixture.csv" });
    const negative = executeFileTransformAdapterOnContent({ artifact, content: negativeContent, filename: "fixture.csv" });
    checks = [
      ...baseChecks,
      { id: "positive_fixture_rows", pass: positive.rowCount > 0, rowCount: positive.rowCount },
      { id: "negative_fixture_empty", pass: negative.rowCount === 0, rowCount: negative.rowCount }
    ];
    evidence = { positiveFixture: candidate.artifactPaths.positiveFixture, negativeFixture: candidate.artifactPaths.negativeFixture, sampleRows: positive.rows.slice(0, 5) };
  } else if (artifact.artifactKind === VERIFIER_ADAPTER_ARTIFACT_KIND) {
    const positiveContent = await fs.readFile(candidate.artifactPaths.positiveFixture, "utf8").catch(() => "");
    const negativeContent = await fs.readFile(candidate.artifactPaths.negativeFixture, "utf8").catch(() => "");
    let positiveRows = [];
    try { positiveRows = JSON.parse(positiveContent); } catch { /* not JSON */ }
    const positive = executeVerifierAdapterOnState({ artifact, state: { text: positiveContent, rows: positiveRows } });
    const negative = executeVerifierAdapterOnState({ artifact, state: { text: negativeContent, rows: [] } });
    checks = [
      ...baseChecks,
      { id: "positive_fixture_passes", pass: positive.pass, failedChecks: positive.failedChecks },
      { id: "negative_fixture_fails", pass: !negative.pass }
    ];
    evidence = { positiveFixture: candidate.artifactPaths.positiveFixture, negativeFixture: candidate.artifactPaths.negativeFixture, positiveResult: positive };
  } else {
    checks = [...baseChecks, { id: "unknown_artifact_kind", pass: false }];
  }

  const pass = checks.every((check) => check.pass);
  const report = {
    id: `capreport_${hashId(`${candidate.id}\n${validatedAt}`)}`,
    candidateId: candidate.id,
    artifactKind: artifact.artifactKind,
    status: pass ? "pass" : "fail",
    validatedAt,
    proofLevel: "fixture_harness_validated",
    checks,
    evidence,
    limitations: [
      "Fixture validation proves the adapter contract and behavior on representative data.",
      "Live execution still requires runtime verification before claiming a deliverable complete."
    ]
  };
  await writeJson(candidate.artifactPaths.validationReport, report);
  return { artifact, report };
}

export async function validateStoredCapabilityCandidate(database, candidateId) {
  const candidate = getCapabilityCandidate(database, candidateId);
  if (!candidate) {
    throw new Error(`Capability candidate not found: ${candidateId}`);
  }
  const { report } = await validateCapabilityCandidateArtifact(candidate);
  const next = upsertCapabilityCandidate(database, {
    ...candidate,
    status: report.status === "pass"
      ? CAPABILITY_CANDIDATE_STATUS.VALIDATED
      : CAPABILITY_CANDIDATE_STATUS.FAILED_VALIDATION,
    validatedAt: report.validatedAt,
    validation: report
  });
  await writeJson(next.artifactPaths.manifest, next);
  return {
    candidate: next,
    validation: report
  };
}

export function enableStoredCapabilityCandidate(database, candidateId, {
  approvedBy = "operator",
  rationale = ""
} = {}) {
  const candidate = getCapabilityCandidate(database, candidateId);
  if (!candidate) {
    throw new Error(`Capability candidate not found: ${candidateId}`);
  }
  if (candidate.status !== CAPABILITY_CANDIDATE_STATUS.VALIDATED) {
    throw new Error(`Capability candidate must be validated before activation: ${candidate.status}`);
  }
  if (candidate.validation?.status !== "pass") {
    throw new Error("Capability candidate validation report is missing or failed.");
  }
  return upsertCapabilityCandidate(database, {
    ...candidate,
    status: CAPABILITY_CANDIDATE_STATUS.ENABLED,
    enabledAt: nowIso(),
    activation: {
      approvedBy: cleanText(approvedBy, 120),
      rationale: cleanText(rationale, 1000),
      approvedAt: nowIso(),
      gates: ["fixture_harness_passed", "declarative_dsl_only", "operator_activation"]
    }
  });
}

export function disableStoredCapabilityCandidate(database, candidateId, {
  rationale = ""
} = {}) {
  const candidate = getCapabilityCandidate(database, candidateId);
  if (!candidate) {
    throw new Error(`Capability candidate not found: ${candidateId}`);
  }
  return upsertCapabilityCandidate(database, {
    ...candidate,
    status: CAPABILITY_CANDIDATE_STATUS.DISABLED,
    disabledAt: nowIso(),
    activation: {
      ...(candidate.activation ?? {}),
      disabledAt: nowIso(),
      disabledReason: cleanText(rationale, 1000)
    }
  });
}

export async function executeStoredWebDataAdapterOnHtml(database, candidateId, input = {}) {
  const candidate = getCapabilityCandidate(database, candidateId);
  if (!candidate) {
    throw new Error(`Capability candidate not found: ${candidateId}`);
  }
  if (candidate.status !== CAPABILITY_CANDIDATE_STATUS.ENABLED) {
    throw new Error(`Capability candidate is not enabled: ${candidate.status}`);
  }
  const artifact = await readCapabilityCandidateArtifact(candidate);
  return executeWebDataAdapterOnHtml({
    artifact,
    html: input.html,
    url: input.url ?? "about:blank"
  });
}

export function checkCapabilityCircuitBreaker(database, candidateId, { windowSize = 10, maxFailureRate = 0.4 } = {}) {
  const feedback = (database.listCapabilityFeedback?.({ nodeId: candidateId, limit: windowSize }) ?? [])
    .filter((record) => record.nodeId === candidateId)
    .slice(0, windowSize);
  if (feedback.length < 3) {
    return { tripped: false, reason: "insufficient_data", sampleSize: feedback.length };
  }
  const failures = feedback.filter((record) =>
    record.outcomeStatus === "failed" || record.outcomeStatus === "failed_incomplete_deliverable"
  ).length;
  const failureRate = failures / feedback.length;
  const tripped = failureRate > maxFailureRate;
  return {
    tripped,
    failureRate: Math.round(failureRate * 100) / 100,
    failures,
    sampleSize: feedback.length,
    reason: tripped
      ? `failure_rate_${Math.round(failureRate * 100)}pct_over_last_${feedback.length}_runs`
      : "within_threshold"
  };
}

export function recordCapabilityRunOutcome(database, candidateId, {
  runId = null,
  projectId = null,
  mission = null,
  outcomeStatus,
  approvalCount = 0,
  evidenceCount = 0
} = {}) {
  const candidate = getCapabilityCandidate(database, candidateId);
  if (!candidate) return null;
  database.insertCapabilityFeedback?.({
    id: `capfb_${hashId(`${candidateId}\n${runId ?? ""}\n${nowIso()}`)}`,
    nodeId: candidateId,
    skillId: candidate.skillId ?? null,
    mission: cleanText(mission ?? candidate.mission, 500),
    projectId: projectId ?? null,
    runId: runId ?? null,
    outcomeStatus: cleanText(outcomeStatus, 80),
    approvalCount: Math.max(0, Number.isFinite(approvalCount) ? approvalCount : 0),
    evidenceCount: Math.max(0, Number.isFinite(evidenceCount) ? evidenceCount : 0),
    rollbackCount: 0,
    createdAt: nowIso()
  });
  const circuitBreaker = checkCapabilityCircuitBreaker(database, candidateId);
  if (circuitBreaker.tripped && candidate.status === CAPABILITY_CANDIDATE_STATUS.ENABLED) {
    disableStoredCapabilityCandidate(database, candidateId, {
      rationale: `Auto-disabled by circuit breaker: ${circuitBreaker.reason}`
    });
    return { autoDisabled: true, circuitBreaker };
  }
  return { autoDisabled: false, circuitBreaker };
}

export function getCapabilityCandidateStats(database, candidateId) {
  const candidate = getCapabilityCandidate(database, candidateId);
  if (!candidate) return null;
  const feedback = database.listCapabilityFeedback?.({ nodeId: candidateId, limit: 100 }) ?? [];
  const total = feedback.length;
  const successes = feedback.filter((r) => r.outcomeStatus === "completed").length;
  const failures = feedback.filter((r) =>
    r.outcomeStatus === "failed" || r.outcomeStatus === "failed_incomplete_deliverable"
  ).length;
  const circuitBreaker = checkCapabilityCircuitBreaker(database, candidateId);
  return {
    candidateId,
    title: candidate.title,
    status: candidate.status,
    capabilityKind: candidate.capabilityKind,
    totalRuns: total,
    successes,
    failures,
    successRate: total > 0 ? Math.round((successes / total) * 100) / 100 : null,
    circuitBreaker,
    recentOutcomes: feedback.slice(0, 10).map((r) => ({ outcomeStatus: r.outcomeStatus, runId: r.runId, createdAt: r.createdAt }))
  };
}

export function selectEnabledCapabilityForMission(database, mission, desiredOutcome = "") {
  const enabled = listCapabilityCandidates(database, { status: CAPABILITY_CANDIDATE_STATUS.ENABLED });
  if (enabled.length === 0) return null;
  const missionAssessment = assessCapabilityGap({ mission, desiredOutcome, capabilityGraph: [] });
  const scored = enabled.map((candidate) => {
    const circuitBreaker = checkCapabilityCircuitBreaker(database, candidate.id);
    if (circuitBreaker.tripped) return { candidate, score: -1, circuitBreakerTripped: true };
    const kindBoost = missionAssessment.capabilityKind === candidate.capabilityKind ? 4 : 0;
    const missionTokens = new Set(
      `${mission} ${desiredOutcome}`.toLowerCase().split(/\W+/).filter((t) => t.length >= 3)
    );
    const candidateTokens = `${candidate.mission} ${candidate.desiredOutcome} ${candidate.title} ${candidate.skillId ?? ""}`.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);
    const tokenMatch = candidateTokens.filter((t) => missionTokens.has(t)).length;
    return { candidate, score: tokenMatch + kindBoost, circuitBreakerTripped: false };
  }).filter((entry) => entry.score >= 3).sort((a, b) => b.score - a.score);
  return scored[0]?.candidate ?? null;
}

export function generatedCandidatesToExternalToolProvider(candidates = []) {
  const enabled = candidates.filter((candidate) => candidate.status === CAPABILITY_CANDIDATE_STATUS.ENABLED);
  return {
    id: "jon_generated_capabilities",
    name: "JON generated capabilities",
    label: "JON generated capabilities",
    trustLevel: "local_validated",
    enabled: true,
    tools: enabled.map((candidate) => ({
      name: `generated_${safeId(candidate.id, 36)}`,
      title: candidate.title || candidate.skillId || candidate.id,
      description: cleanText([
        "Read and extract structured data with a validated generated capability.",
        `Candidate: ${candidate.id}.`,
        candidate.mission,
        `Artifact kind: ${candidate.artifactKind}.`,
        "Requires runtime verification before marking a live deliverable complete."
      ].join(" "), 900),
      tags: ["generated_capability", candidate.capabilityKind, candidate.artifactKind],
      inputSchema: {
        type: "object",
        properties: {
          targetId: { type: "string" },
          html: { type: "string" },
          url: { type: "string" }
        }
      },
      affordances: candidate.skillManifest?.affordances ?? [
        `Use generated capability ${candidate.id}`
      ]
    }))
  };
}
