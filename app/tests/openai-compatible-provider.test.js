import assert from "node:assert/strict";
import { OpenAiCompatibleProvider } from "../src/llm/providers/openai-compatible-provider.js";

export async function run() {
  let capturedRequest = null;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "runtime-only-\nsecret",
    apiKeyHeader: "authorization",
    apiKeyPrefix: "Bearer ",
    modelMap: {
      primary_reasoning: "gpt-4.1-mini"
    },
    fetchImpl: async (_url, request) => {
      capturedRequest = request;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  steps: ["step one"],
                  assumptions: []
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20
          }
        })
      };
    }
  });

  const response = await provider.generateStructured({
    modelAlias: "primary_reasoning",
    messages: [
      {
        role: "system",
        content: "You are a precise planning assistant."
      },
      {
        role: "user",
        content: "Produce a two-step plan."
      }
    ]
  });

  assert.equal(response.providerModel, "gpt-4.1-mini");
  assert.deepEqual(response.output.steps, ["step one"]);
  assert.equal(response.tokenUsage.totalTokens, 20);
  assert.ok(capturedRequest, "Expected provider fetch to be invoked.");

  const body = JSON.parse(capturedRequest.body);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /\bjson\b/i);
  assert.equal(capturedRequest.headers.authorization, "Bearer runtime-only-secret");

  let visionRequest = null;
  const visionProvider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "runtime-only-secret",
    fetchImpl: async (_url, request) => {
      visionRequest = request;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  description: "Fixture image",
                  keyElements: ["Fixture"],
                  pageType: "browser_page"
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 6,
            total_tokens: 16
          }
        })
      };
    }
  });
  const visionResponse = await visionProvider.generateStructured({
    modelAlias: "vision_fallback",
    messages: [{ role: "user", content: "Describe image as JSON." }],
    extraMessages: [{
      role: "user",
      content: [{
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,ZmFrZQ==",
          detail: "low"
        }
      }]
    }]
  });
  const visionBody = JSON.parse(visionRequest.body);
  assert.equal(visionResponse.providerModel, "gpt-5-mini");
  assert.equal("temperature" in visionBody, false);
  assert.equal(visionBody.messages.at(-1).content[0].image_url.detail, "low");
}
