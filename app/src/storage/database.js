import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, RUNS_ROOT } from "../config.js";
import { ensureDataDirs, ensureDir } from "../utils/files.js";

function stringifyJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  return value == null ? fallback : JSON.parse(value);
}

export class PrototypeDatabase {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async open() {
    await ensureDataDirs();
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        allowlisted_domains_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        mission TEXT NOT NULL,
        status TEXT NOT NULL,
        lifecycle_stage TEXT NOT NULL,
        plan_json TEXT,
        summary TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        category TEXT NOT NULL,
        decision TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        action_label TEXT NOT NULL,
        target_label TEXT NOT NULL,
        reason TEXT NOT NULL,
        expected_effect TEXT NOT NULL,
        consequence_of_refusal TEXT NOT NULL,
        evidence_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        canonical_ref TEXT NOT NULL,
        trust_classification TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        evidence_type TEXT NOT NULL,
        label TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        linked_surface TEXT,
        linked_event_id TEXT,
        linked_source_id TEXT,
        sensitivity TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS llm_call_records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        call_type TEXT NOT NULL,
        provider_alias TEXT NOT NULL,
        model_alias TEXT NOT NULL,
        provider_model TEXT,
        prompt_refs_json TEXT NOT NULL,
        input_size_estimate INTEGER,
        output_size_estimate INTEGER,
        latency_ms INTEGER,
        token_usage_json TEXT,
        estimated_cost REAL,
        retry_count INTEGER NOT NULL,
        fallback_chain_json TEXT,
        result_status TEXT NOT NULL,
        error_category TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_turns (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        conversation_id TEXT,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        payload_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_graph_nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        skill_id TEXT,
        risk_level TEXT NOT NULL,
        approval_required INTEGER NOT NULL,
        rollback_possible INTEGER NOT NULL,
        relevance_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_graph_overrides (
        node_id TEXT PRIMARY KEY,
        label TEXT,
        description TEXT,
        affordances_json TEXT,
        known_limits_json TEXT,
        metadata_json TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_feedback_records (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        skill_id TEXT,
        mission TEXT,
        project_id TEXT,
        run_id TEXT,
        conversation_turn_id TEXT,
        selected_score REAL,
        outcome_status TEXT NOT NULL,
        approval_count INTEGER NOT NULL,
        evidence_count INTEGER NOT NULL,
        rollback_count INTEGER NOT NULL,
        notes TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reasoning_context_snapshots (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        reasoning_stage TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS deleted_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        project_id TEXT,
        run_id TEXT,
        label TEXT NOT NULL,
        metadata_json TEXT,
        deleted_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_project_updated
      ON conversations(project_id, updated_at DESC);
    `);
    this.migrateConversationSchema();
  }

  migrateConversationSchema() {
    const conversationTurnColumns = this.db.prepare(`PRAGMA table_info(conversation_turns)`).all()
      .map((row) => row.name);
    if (!conversationTurnColumns.includes("conversation_id")) {
      this.db.exec(`ALTER TABLE conversation_turns ADD COLUMN conversation_id TEXT`);
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_project_updated
      ON conversations(project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_conversation_turns_conversation_created
      ON conversation_turns(project_id, conversation_id, created_at ASC);
    `);
  }

  close() {
    this.db?.close();
  }

  async ensureRunDir(runId) {
    const runDir = path.join(RUNS_ROOT, runId);
    await ensureDir(runDir);
    await ensureDir(path.join(runDir, "artifacts"));
    await ensureDir(path.join(runDir, "evidence"));
    return runDir;
  }

  listProjects() {
    return this.db.prepare(`
      SELECT * FROM projects ORDER BY created_at ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      allowlistedDomains: parseJson(row.allowlisted_domains_json, []),
      createdAt: row.created_at
    }));
  }

  insertProject(project) {
    this.db.prepare(`
      INSERT INTO projects (id, name, description, allowlisted_domains_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      project.id,
      project.name,
      project.description,
      stringifyJson(project.allowlistedDomains),
      project.createdAt
    );
  }

  updateProject(projectId, patch) {
    const existing = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
    if (!existing) {
      throw new Error(`Project not found: ${projectId}`);
    }
    this.db.prepare(`
      UPDATE projects
      SET name = ?, description = ?, allowlisted_domains_json = ?
      WHERE id = ?
    `).run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      stringifyJson(patch.allowlistedDomains ?? parseJson(existing.allowlisted_domains_json, [])),
      projectId
    );
  }

  getProject(projectId) {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      allowlistedDomains: parseJson(row.allowlisted_domains_json, []),
      createdAt: row.created_at
    };
  }

  deleteProject(projectId) {
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  }

  insertRun(run) {
    this.db.prepare(`
      INSERT INTO runs (id, project_id, mission, status, lifecycle_stage, plan_json, summary, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.projectId,
      run.mission,
      run.status,
      run.lifecycleStage,
      stringifyJson(run.plan ?? null),
      run.summary ?? "",
      stringifyJson(run.metadata ?? {}),
      run.createdAt,
      run.updatedAt
    );
  }

  updateRun(runId, patch) {
    const existing = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }
    const next = {
      status: patch.status ?? existing.status,
      lifecycleStage: patch.lifecycleStage ?? existing.lifecycle_stage,
      plan: patch.plan ?? parseJson(existing.plan_json, null),
      summary: patch.summary ?? existing.summary,
      metadata: patch.metadata ?? parseJson(existing.metadata_json, {}),
      updatedAt: patch.updatedAt
    };
    this.db.prepare(`
      UPDATE runs
      SET status = ?, lifecycle_stage = ?, plan_json = ?, summary = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.lifecycleStage,
      stringifyJson(next.plan),
      next.summary,
      stringifyJson(next.metadata),
      next.updatedAt,
      runId
    );
  }

  getRun(runId) {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      projectId: row.project_id,
      mission: row.mission,
      status: row.status,
      lifecycleStage: row.lifecycle_stage,
      plan: parseJson(row.plan_json, null),
      summary: row.summary,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  deleteRun(runId) {
    this.db.prepare(`DELETE FROM runs WHERE id = ?`).run(runId);
  }

  listRuns(projectId) {
    return this.db.prepare(`
      SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      mission: row.mission,
      status: row.status,
      lifecycleStage: row.lifecycle_stage,
      plan: parseJson(row.plan_json, null),
      summary: row.summary,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  insertConversation(conversation) {
    this.db.prepare(`
      INSERT INTO conversations (
        id, project_id, title, summary, status, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversation.id,
      conversation.projectId,
      conversation.title,
      conversation.summary ?? "",
      conversation.status ?? "active",
      stringifyJson(conversation.metadata ?? {}),
      conversation.createdAt,
      conversation.updatedAt
    );
  }

  getConversation(conversationId) {
    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId);
    return row ? {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      summary: row.summary,
      status: row.status,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } : null;
  }

  listConversations(projectId, { limit = 50 } = {}) {
    return this.db.prepare(`
      SELECT * FROM conversations
      WHERE project_id = ?
      ORDER BY updated_at DESC, rowid DESC
      LIMIT ?
    `).all(projectId, limit).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      summary: row.summary,
      status: row.status,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  updateConversation(conversationId, patch) {
    const existing = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId);
    if (!existing) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    this.db.prepare(`
      UPDATE conversations
      SET title = ?, summary = ?, status = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.title ?? existing.title,
      patch.summary ?? existing.summary,
      patch.status ?? existing.status,
      stringifyJson(patch.metadata ?? parseJson(existing.metadata_json, {})),
      patch.updatedAt ?? existing.updated_at,
      conversationId
    );
  }

  deleteConversation(conversationId) {
    this.db.prepare(`DELETE FROM conversation_turns WHERE conversation_id = ?`).run(conversationId);
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);
  }

  insertEvent(runId, event) {
    this.db.prepare(`
      INSERT INTO events (id, run_id, type, actor, summary, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      runId,
      event.type,
      event.actor,
      event.summary,
      stringifyJson(event.payload),
      event.createdAt
    );
  }

  listEvents(runId) {
    return this.db.prepare(`
      SELECT * FROM events WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => ({
      id: row.id,
      runId: row.run_id,
      type: row.type,
      actor: row.actor,
      summary: row.summary,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at
    }));
  }

  insertApproval(runId, approval) {
    this.db.prepare(`
      INSERT INTO approvals (
        id, run_id, category, decision, risk_level, action_label, target_label, reason,
        expected_effect, consequence_of_refusal, evidence_id, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      approval.id,
      runId,
      approval.category,
      approval.decision,
      approval.riskLevel,
      approval.actionLabel,
      approval.targetLabel,
      approval.reason,
      approval.expectedEffect,
      approval.consequenceOfRefusal,
      approval.evidenceId ?? null,
      stringifyJson(approval.metadata ?? {}),
      approval.createdAt
    );
  }

  updateApproval(approvalId, patch) {
    const existing = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(approvalId);
    if (!existing) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    const nextMetadata = {
      ...parseJson(existing.metadata_json, {}),
      ...(patch.metadata ?? {})
    };
    this.db.prepare(`
      UPDATE approvals
      SET decision = ?, evidence_id = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      patch.decision ?? existing.decision,
      patch.evidenceId ?? existing.evidence_id,
      stringifyJson(nextMetadata),
      approvalId
    );
  }

  listApprovals(runId) {
    return this.db.prepare(`
      SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => ({
      id: row.id,
      runId: row.run_id,
      category: row.category,
      decision: row.decision,
      riskLevel: row.risk_level,
      actionLabel: row.action_label,
      targetLabel: row.target_label,
      reason: row.reason,
      expectedEffect: row.expected_effect,
      consequenceOfRefusal: row.consequence_of_refusal,
      evidenceId: row.evidence_id,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  getApproval(approvalId) {
    const row = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(approvalId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      runId: row.run_id,
      category: row.category,
      decision: row.decision,
      riskLevel: row.risk_level,
      actionLabel: row.action_label,
      targetLabel: row.target_label,
      reason: row.reason,
      expectedEffect: row.expected_effect,
      consequenceOfRefusal: row.consequence_of_refusal,
      evidenceId: row.evidence_id,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    };
  }

  insertSource(runId, source) {
    this.db.prepare(`
      INSERT INTO sources (id, run_id, title, canonical_ref, trust_classification, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id,
      runId,
      source.title,
      source.canonicalRef,
      source.trustClassification,
      stringifyJson(source.metadata ?? {}),
      source.createdAt
    );
  }

  listSources(runId) {
    return this.db.prepare(`
      SELECT * FROM sources WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => ({
      id: row.id,
      runId: row.run_id,
      title: row.title,
      canonicalRef: row.canonical_ref,
      trustClassification: row.trust_classification,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  insertEvidence(runId, evidence) {
    this.db.prepare(`
      INSERT INTO evidence (
        id, run_id, evidence_type, label, storage_path, linked_surface, linked_event_id,
        linked_source_id, sensitivity, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence.id,
      runId,
      evidence.evidenceType,
      evidence.label,
      evidence.storagePath,
      evidence.linkedSurface ?? null,
      evidence.linkedEventId ?? null,
      evidence.linkedSourceId ?? null,
      evidence.sensitivity,
      stringifyJson(evidence.metadata ?? {}),
      evidence.createdAt
    );
  }

  listEvidence(runId) {
    return this.db.prepare(`
      SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => ({
      id: row.id,
      runId: row.run_id,
      evidenceType: row.evidence_type,
      label: row.label,
      storagePath: row.storage_path,
      linkedSurface: row.linked_surface,
      linkedEventId: row.linked_event_id,
      linkedSourceId: row.linked_source_id,
      sensitivity: row.sensitivity,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  getEvidence(evidenceId) {
    const row = this.db.prepare(`SELECT * FROM evidence WHERE id = ?`).get(evidenceId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      runId: row.run_id,
      evidenceType: row.evidence_type,
      label: row.label,
      storagePath: row.storage_path,
      linkedSurface: row.linked_surface,
      linkedEventId: row.linked_event_id,
      linkedSourceId: row.linked_source_id,
      sensitivity: row.sensitivity,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    };
  }

  deleteEvidence(evidenceId) {
    this.db.prepare(`DELETE FROM evidence WHERE id = ?`).run(evidenceId);
  }

  updateEvidence(evidenceId, patch) {
    const existing = this.db.prepare(`SELECT * FROM evidence WHERE id = ?`).get(evidenceId);
    if (!existing) {
      throw new Error(`Evidence not found: ${evidenceId}`);
    }
    const nextMetadata = {
      ...parseJson(existing.metadata_json, {}),
      ...(patch.metadata ?? {})
    };
    this.db.prepare(`
      UPDATE evidence
      SET linked_surface = ?, linked_event_id = ?, linked_source_id = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      patch.linkedSurface ?? existing.linked_surface,
      patch.linkedEventId ?? existing.linked_event_id,
      patch.linkedSourceId ?? existing.linked_source_id,
      stringifyJson(nextMetadata),
      evidenceId
    );
  }

  insertArtifact(runId, artifact) {
    this.db.prepare(`
      INSERT INTO artifacts (id, run_id, artifact_type, status, title, storage_path, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      runId,
      artifact.artifactType,
      artifact.status,
      artifact.title,
      artifact.storagePath,
      stringifyJson(artifact.metadata ?? {}),
      artifact.createdAt
    );
  }

  listArtifacts(runId) {
    return this.db.prepare(`
      SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => ({
      id: row.id,
      runId: row.run_id,
      artifactType: row.artifact_type,
      status: row.status,
      title: row.title,
      storagePath: row.storage_path,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  getArtifact(artifactId) {
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(artifactId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      runId: row.run_id,
      artifactType: row.artifact_type,
      status: row.status,
      title: row.title,
      storagePath: row.storage_path,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    };
  }

  deleteArtifact(artifactId) {
    this.db.prepare(`DELETE FROM artifacts WHERE id = ?`).run(artifactId);
  }

  insertLlmCall(record) {
    this.db.prepare(`
      INSERT INTO llm_call_records (
        id, run_id, project_id, call_type, provider_alias, model_alias, provider_model,
        prompt_refs_json, input_size_estimate, output_size_estimate, latency_ms,
        token_usage_json, estimated_cost, retry_count, fallback_chain_json, result_status,
        error_category, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.projectId,
      record.callType,
      record.providerAlias,
      record.modelAlias,
      record.providerModel ?? null,
      stringifyJson(record.promptRefs ?? []),
      record.inputSizeEstimate ?? null,
      record.outputSizeEstimate ?? null,
      record.latencyMs ?? null,
      stringifyJson(record.tokenUsage ?? null),
      record.estimatedCost ?? null,
      record.retryCount ?? 0,
      stringifyJson(record.fallbackChain ?? []),
      record.resultStatus,
      record.errorCategory ?? null,
      stringifyJson(record.metadata ?? {}),
      record.createdAt
    );
  }

  listLlmCalls(runId) {
    return this.db.prepare(`
      SELECT * FROM llm_call_records WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => ({
      id: row.id,
      runId: row.run_id,
      projectId: row.project_id,
      callType: row.call_type,
      providerAlias: row.provider_alias,
      modelAlias: row.model_alias,
      providerModel: row.provider_model,
      promptRefs: parseJson(row.prompt_refs_json, []),
      inputSizeEstimate: row.input_size_estimate,
      outputSizeEstimate: row.output_size_estimate,
      latencyMs: row.latency_ms,
      tokenUsage: parseJson(row.token_usage_json, null),
      estimatedCost: row.estimated_cost,
      retryCount: row.retry_count,
      fallbackChain: parseJson(row.fallback_chain_json, []),
      resultStatus: row.result_status,
      errorCategory: row.error_category,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  listProjectLlmCalls(projectId, { limit = 500 } = {}) {
    return this.db.prepare(`
      SELECT * FROM llm_call_records
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit).map((row) => ({
      id: row.id,
      runId: row.run_id,
      projectId: row.project_id,
      callType: row.call_type,
      providerAlias: row.provider_alias,
      modelAlias: row.model_alias,
      providerModel: row.provider_model,
      promptRefs: parseJson(row.prompt_refs_json, []),
      inputSizeEstimate: row.input_size_estimate,
      outputSizeEstimate: row.output_size_estimate,
      latencyMs: row.latency_ms,
      tokenUsage: parseJson(row.token_usage_json, null),
      estimatedCost: row.estimated_cost,
      retryCount: row.retry_count,
      fallbackChain: parseJson(row.fallback_chain_json, []),
      resultStatus: row.result_status,
      errorCategory: row.error_category,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    })).reverse();
  }

  insertConversationTurn(turn) {
    this.db.prepare(`
      INSERT INTO conversation_turns (
        id, project_id, conversation_id, role, kind, content, payload_json, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      turn.id,
      turn.projectId,
      turn.conversationId ?? null,
      turn.role,
      turn.kind,
      turn.content,
      stringifyJson(turn.payload ?? null),
      stringifyJson(turn.metadata ?? {}),
      turn.createdAt
    );
  }

  listConversationTurns(projectId, { limit = 80, conversationId = null } = {}) {
    const rows = conversationId
      ? this.db.prepare(`
          SELECT * FROM conversation_turns
          WHERE project_id = ? AND conversation_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        `).all(projectId, conversationId, limit)
      : this.db.prepare(`
          SELECT * FROM conversation_turns
          WHERE project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        `).all(projectId, limit);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      conversationId: row.conversation_id ?? null,
      role: row.role,
      kind: row.kind,
      content: row.content,
      payload: parseJson(row.payload_json, null),
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    })).reverse();
  }

  deleteConversationTurns(projectId, { conversationId = null } = {}) {
    if (conversationId) {
      this.db.prepare(`DELETE FROM conversation_turns WHERE project_id = ? AND conversation_id = ?`).run(projectId, conversationId);
      return;
    }
    this.db.prepare(`DELETE FROM conversation_turns WHERE project_id = ?`).run(projectId);
  }

  getAppSetting(key, fallback = null) {
    const row = this.db.prepare(`
      SELECT * FROM app_settings WHERE key = ?
    `).get(key);
    return row
      ? {
        key: row.key,
        value: parseJson(row.value_json, fallback),
        updatedAt: row.updated_at
      }
      : {
        key,
        value: fallback,
        updatedAt: null
      };
  }

  upsertAppSetting(key, value) {
    const updatedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, stringifyJson(value), updatedAt);
    return this.getAppSetting(key, value);
  }

  deleteAppSetting(key) {
    this.db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
  }

  replaceCapabilityGraphNodes(nodes = []) {
    const updatedAt = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO capability_graph_nodes (
        id, kind, label, source_kind, source_id, skill_id, risk_level,
        approval_required, rollback_possible, relevance_json, payload_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM capability_graph_nodes`).run();
      for (const node of nodes) {
        insert.run(
          node.id,
          node.kind,
          node.label,
          node.sourceKind,
          node.sourceId,
          node.skillId ?? null,
          node.riskLevel ?? "medium",
          node.approvalRequired ? 1 : 0,
          node.rollbackPossible ? 1 : 0,
          stringifyJson(node.relevance ?? {}),
          stringifyJson(node.payload ?? {}),
          updatedAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listCapabilityGraphNodes();
  }

  listCapabilityGraphNodes({ kind = null, limit = 500 } = {}) {
    const rows = kind
      ? this.db.prepare(`
        SELECT * FROM capability_graph_nodes
        WHERE kind = ?
        ORDER BY kind ASC, label ASC
        LIMIT ?
      `).all(kind, limit)
      : this.db.prepare(`
        SELECT * FROM capability_graph_nodes
        ORDER BY kind ASC, label ASC
        LIMIT ?
      `).all(limit);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      skillId: row.skill_id,
      riskLevel: row.risk_level,
      approvalRequired: Boolean(row.approval_required),
      rollbackPossible: Boolean(row.rollback_possible),
      relevance: parseJson(row.relevance_json, {}),
      payload: parseJson(row.payload_json, {}),
      updatedAt: row.updated_at
    }));
  }

  listCapabilityGraphOverrides() {
    return this.db.prepare(`
      SELECT * FROM capability_graph_overrides
      ORDER BY updated_at DESC
    `).all().map((row) => ({
      nodeId: row.node_id,
      label: row.label,
      description: row.description,
      affordances: parseJson(row.affordances_json, null),
      knownLimits: parseJson(row.known_limits_json, null),
      metadata: parseJson(row.metadata_json, {}),
      updatedAt: row.updated_at
    }));
  }

  getCapabilityGraphOverride(nodeId) {
    const row = this.db.prepare(`
      SELECT * FROM capability_graph_overrides WHERE node_id = ?
    `).get(nodeId);
    if (!row) {
      return null;
    }
    return {
      nodeId: row.node_id,
      label: row.label,
      description: row.description,
      affordances: parseJson(row.affordances_json, null),
      knownLimits: parseJson(row.known_limits_json, null),
      metadata: parseJson(row.metadata_json, {}),
      updatedAt: row.updated_at
    };
  }

  upsertCapabilityGraphOverride(nodeId, patch = {}) {
    const existing = this.getCapabilityGraphOverride(nodeId);
    const updatedAt = new Date().toISOString();
    const next = {
      label: patch.label ?? existing?.label ?? null,
      description: patch.description ?? existing?.description ?? null,
      affordances: patch.affordances ?? existing?.affordances ?? null,
      knownLimits: patch.knownLimits ?? existing?.knownLimits ?? null,
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(patch.metadata ?? {})
      }
    };
    this.db.prepare(`
      INSERT INTO capability_graph_overrides (
        node_id, label, description, affordances_json, known_limits_json, metadata_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        affordances_json = excluded.affordances_json,
        known_limits_json = excluded.known_limits_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      nodeId,
      next.label,
      next.description,
      stringifyJson(next.affordances),
      stringifyJson(next.knownLimits),
      stringifyJson(next.metadata),
      updatedAt
    );
    return this.getCapabilityGraphOverride(nodeId);
  }

  deleteCapabilityGraphOverride(nodeId) {
    this.db.prepare(`DELETE FROM capability_graph_overrides WHERE node_id = ?`).run(nodeId);
  }

  insertCapabilityFeedback(record) {
    this.db.prepare(`
      INSERT INTO capability_feedback_records (
        id, node_id, skill_id, mission, project_id, run_id, conversation_turn_id,
        selected_score, outcome_status, approval_count, evidence_count, rollback_count,
        notes, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.nodeId,
      record.skillId ?? null,
      record.mission ?? null,
      record.projectId ?? null,
      record.runId ?? null,
      record.conversationTurnId ?? null,
      record.selectedScore ?? null,
      record.outcomeStatus,
      record.approvalCount ?? 0,
      record.evidenceCount ?? 0,
      record.rollbackCount ?? 0,
      record.notes ?? null,
      stringifyJson(record.metadata ?? {}),
      record.createdAt
    );
  }

  listCapabilityFeedback({ nodeId = null, limit = 500 } = {}) {
    const rows = nodeId
      ? this.db.prepare(`
        SELECT * FROM capability_feedback_records
        WHERE node_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(nodeId, limit)
      : this.db.prepare(`
        SELECT * FROM capability_feedback_records
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);
    return rows.map((row) => ({
      id: row.id,
      nodeId: row.node_id,
      skillId: row.skill_id,
      mission: row.mission,
      projectId: row.project_id,
      runId: row.run_id,
      conversationTurnId: row.conversation_turn_id,
      selectedScore: row.selected_score,
      outcomeStatus: row.outcome_status,
      approvalCount: row.approval_count,
      evidenceCount: row.evidence_count,
      rollbackCount: row.rollback_count,
      notes: row.notes,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at
    }));
  }

  summarizeCapabilityFeedback() {
    return this.db.prepare(`
      SELECT
        node_id,
        skill_id,
        COUNT(*) AS total,
        SUM(CASE WHEN outcome_status IN ('success', 'pass', 'completed') THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN outcome_status IN ('failed', 'fail', 'blocked') THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN outcome_status IN ('selected', 'candidate') THEN 1 ELSE 0 END) AS selections,
        SUM(approval_count) AS approvals,
        SUM(evidence_count) AS evidence,
        SUM(rollback_count) AS rollbacks,
        MAX(created_at) AS last_used_at
      FROM capability_feedback_records
      GROUP BY node_id, skill_id
      ORDER BY total DESC, last_used_at DESC
    `).all().map((row) => ({
      nodeId: row.node_id,
      skillId: row.skill_id,
      total: row.total,
      successes: row.successes ?? 0,
      failures: row.failures ?? 0,
      selections: row.selections ?? 0,
      approvals: row.approvals ?? 0,
      evidence: row.evidence ?? 0,
      rollbacks: row.rollbacks ?? 0,
      lastUsedAt: row.last_used_at
    }));
  }

  insertReasoningContextSnapshot(snapshot) {
    this.db.prepare(`
      INSERT INTO reasoning_context_snapshots (
        id, run_id, project_id, reasoning_stage, summary_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      snapshot.runId,
      snapshot.projectId,
      snapshot.stage,
      stringifyJson(snapshot),
      snapshot.createdAt
    );
  }

  listReasoningContextSnapshots(runId) {
    return this.db.prepare(`
      SELECT * FROM reasoning_context_snapshots WHERE run_id = ? ORDER BY created_at ASC
    `).all(runId).map((row) => parseJson(row.summary_json, {
      id: row.id,
      runId: row.run_id,
      projectId: row.project_id,
      stage: row.reasoning_stage,
      createdAt: row.created_at
    }));
  }

  getReasoningContextSnapshot(snapshotId) {
    const row = this.db.prepare(`SELECT * FROM reasoning_context_snapshots WHERE id = ?`).get(snapshotId);
    if (!row) {
      return null;
    }
    return parseJson(row.summary_json, {
      id: row.id,
      runId: row.run_id,
      projectId: row.project_id,
      stage: row.reasoning_stage,
      createdAt: row.created_at
    });
  }

  recordDeletion({ objectType, objectId, projectId = null, runId = null, label, metadata = {}, deletedAt }) {
    this.db.prepare(`
      INSERT INTO deleted_records (object_type, object_id, project_id, run_id, label, metadata_json, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      objectType,
      objectId,
      projectId,
      runId,
      label,
      stringifyJson(metadata),
      deletedAt
    );
  }

  listDeletedRecords({ projectId = null, runId = null, limit = 50 } = {}) {
    let query = `SELECT * FROM deleted_records`;
    const params = [];
    if (projectId && runId) {
      query += ` WHERE project_id = ? OR run_id = ?`;
      params.push(projectId, runId);
    } else if (projectId) {
      query += ` WHERE project_id = ?`;
      params.push(projectId);
    } else if (runId) {
      query += ` WHERE run_id = ?`;
      params.push(runId);
    }
    query += ` ORDER BY deleted_at DESC LIMIT ?`;
    params.push(limit);
    return this.db.prepare(query).all(...params).map((row) => ({
      id: row.id,
      objectType: row.object_type,
      objectId: row.object_id,
      projectId: row.project_id,
      runId: row.run_id,
      label: row.label,
      metadata: parseJson(row.metadata_json, {}),
      deletedAt: row.deleted_at
    }));
  }
}
