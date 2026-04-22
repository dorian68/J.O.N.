function cleanText(value, maxLength = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeId(value) {
  return cleanText(value, 160).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");
}

function wordsForTool(tool = {}) {
  return [
    tool.name,
    tool.title,
    tool.description,
    ...(Array.isArray(tool.tags) ? tool.tags : [])
  ].join(" ").toLowerCase();
}

export function inferExternalToolRisk(tool = {}) {
  const text = wordsForTool(tool);
  if (/\b(delete|remove|write|create|update|modify|move|rename|send|submit|publish|upload|purchase|payment|shell|exec|command)\b/i.test(text)) {
    return {
      riskLevel: "high",
      approvalRequired: true,
      policyHooks: ["external_tool_mutation", "approval_required"]
    };
  }
  if (/\b(read|get|list|search|fetch|query|inspect|summarize)\b/i.test(text)) {
    return {
      riskLevel: "medium",
      approvalRequired: true,
      policyHooks: ["external_tool_read", "provenance_review"]
    };
  }
  return {
    riskLevel: "high",
    approvalRequired: true,
    policyHooks: ["external_tool_unknown", "approval_required"]
  };
}

export function normalizeMcpToolDescriptor({ server = {}, tool = {} } = {}) {
  const serverId = safeId(server.id ?? server.name ?? "external_mcp");
  const toolName = safeId(tool.name ?? tool.title ?? "tool");
  const risk = inferExternalToolRisk(tool);
  const description = cleanText(tool.description ?? tool.title ?? tool.name, 900);
  return {
    id: `${serverId}.${toolName}`,
    label: cleanText(tool.title ?? tool.name ?? toolName, 180),
    sourceKind: "mcp_server",
    sourceId: `${serverId}:${toolName}`,
    serverId,
    toolName,
    riskLevel: risk.riskLevel,
    approvalRequired: risk.approvalRequired,
    rollbackPossible: false,
    relevance: {
      desktop_action: 0.25,
      safe_inspection: description.match(/\b(read|get|list|search|fetch|query|inspect|summarize)\b/i) ? 0.55 : 0.15
    },
    payload: {
      providerType: "mcp",
      serverId,
      serverLabel: cleanText(server.label ?? server.name ?? serverId, 180),
      toolName,
      originalName: cleanText(tool.name ?? toolName, 180),
      description,
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null,
      trustLevel: cleanText(server.trustLevel ?? "untrusted", 80),
      enabled: Boolean(server.enabled),
      policyHooks: risk.policyHooks,
      evidenceExpected: ["external_tool_call_log", "tool_result_summary"],
      affordances: Array.isArray(tool.affordances) && tool.affordances.length
        ? tool.affordances.map((entry) => cleanText(entry, 140)).filter(Boolean).slice(0, 8)
        : [description || `Invoke ${toolName} through external MCP provider`],
      knownLimits: [
        "External MCP tools are not trusted by metadata alone.",
        "Disabled or untrusted tools must not be invoked by the executor.",
        "Policy and approval still decide before execution."
      ]
    }
  };
}

export function normalizeMcpServerTools({ server = {}, tools = [] } = {}) {
  return tools.map((tool) => normalizeMcpToolDescriptor({ server, tool }));
}
