import { LLM_PROVIDER_ALIAS } from "../../config.js";
import { buildDeterministicFallbackOutput } from "../deterministic-fallbacks.js";

function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value ?? "").length / 4));
}

export class MockOfflineProvider {
  constructor() {
    this.providerAlias = LLM_PROVIDER_ALIAS.MOCK_OFFLINE;
  }

  isEnabled() {
    return true;
  }

  resolveModel(modelAlias) {
    return `mock/${modelAlias}`;
  }

  async generateText({ messages }) {
    const userMessage = messages?.find((m) => m.role === "user")?.content ?? "";
    const inputTokens = estimateTokens(JSON.stringify(messages));
    const mockText = `[Mock inline LLM pour : "${String(userMessage).slice(0, 80)}"]`;
    const outputTokens = estimateTokens(mockText);
    return {
      text: mockText,
      providerModel: "mock/inline_text",
      providerAlias: this.providerAlias,
      tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      estimatedCost: 0
    };
  }

  async generateStructured({ callType, modelAlias, input }) {
    const output = buildDeterministicFallbackOutput(callType, input);

    const rawOutput = JSON.stringify(output);
    const inputTokens = estimateTokens(JSON.stringify(input ?? {}));
    const outputTokens = estimateTokens(rawOutput);

    return {
      output,
      rawOutput,
      providerModel: this.resolveModel(modelAlias),
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      estimatedCost: 0
    };
  }
}
