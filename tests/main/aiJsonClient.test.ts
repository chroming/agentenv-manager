import { describe, expect, it, vi } from "vitest";
import { createAIJsonClient } from "../../src/main/ai/aiJsonClient";

describe("AI Chat Completions address resolution", () => {
  it.each([
    ["https://api.deepseek.com/", "https://api.deepseek.com/chat/completions"],
    ["https://example.test/v1", "https://example.test/v1/chat/completions"],
    ["https://example.test/v1/", "https://example.test/v1/chat/completions"],
    ["https://example.test/gateway/v1", "https://example.test/gateway/v1/chat/completions"],
    ["https://example.test/v1/chat/completions", "https://example.test/v1/chat/completions"],
    ["http://127.0.0.1:9000/custom-endpoint", "http://127.0.0.1:9000/custom-endpoint"]
  ])("resolves %s without probing or retrying", async (endpoint, expected) => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{"choices":[]}'));
    await createAIJsonClient(transport as typeof fetch)({ endpoint, key: "fixture", model: "fixture", system: "JSON", content: "{}", signal: new AbortController().signal });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(expected);
  });
  it("reports a 404 as an address or model error without retries or provider body leaks", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response("private-provider-detail", { status: 404 }));
    await expect(createAIJsonClient(transport)({ endpoint: "https://example.test/v1", key: "fixture", model: "fixture", system: "JSON", content: "{}", signal: new AbortController().signal }))
      .rejects.toThrow("AI service returned HTTP 404. Check the Chat Completions API address and model name in Settings > AI assistance, then retry.");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
