import { describe, expect, it, vi } from "vitest";
import { testAIService } from "../../src/main/ai/testAIService";

describe("AI connection probe", () => {
  const config = { endpoint: "https://example.test/v1", model: "fixture", key: "secret" };
  it("tests the configured model with a bounded synthetic JSON request", async () => {
    const request = vi.fn().mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
    await testAIService(config, request);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toMatchObject({ ...config, maxTokens: 64, content: "Connection test." });
  });
  it.each([{}, { choices: [{ finish_reason: "length", message: { content: '{"ok":true}' } }] },
    { choices: [{ finish_reason: "stop", message: { content: "not json" } }] }])("rejects unusable output", async (response) => {
    await expect(testAIService(config, vi.fn().mockResolvedValue(response))).rejects.toThrow("JSON output");
  });
  it("preserves connection errors without retrying", async () => {
    const request = vi.fn().mockRejectedValue(new Error("HTTP 401"));
    await expect(testAIService(config, request)).rejects.toThrow("HTTP 401");
    expect(request).toHaveBeenCalledOnce();
  });
});
