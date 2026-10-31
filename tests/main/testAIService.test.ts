import { describe, expect, it, vi } from "vitest";
import { testAIService } from "../../src/main/ai/testAIService";
import { rememberAICompletion } from "../../src/main/ai/aiCompletionDiagnostics";
import { sanitizeDiagnosticError } from "../../src/main/diagnosticRedaction";

describe("AI connection probe", () => {
  const config = { endpoint: "https://example.test/v1", model: "fixture", key: "secret" };
  it("tests the configured model with a bounded synthetic JSON request", async () => {
    const request = vi.fn().mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
    await testAIService(config, request);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toMatchObject({ ...config, maxTokens: 64, content: "Connection test." });
  });
  it("uses the same fenced JSON handling as the real features", async () => {
    const request = vi.fn().mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: '```json\n{"ok":true}\n```' } }] });
    await expect(testAIService(config, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
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
  it("keeps completion and HTTP facts through the connection-test wrapper", async () => {
    const response = { choices: [{ finish_reason: "length", message: { content: null, reasoning_content: "private thought" } }] };
    rememberAICompletion(response, { requestId: "req_probe_fixture", status: 200, maxTokens: 64, format: "json_object" });
    const request = vi.fn().mockResolvedValue(response);
    const error = await testAIService(config, request).catch((error: unknown) => error);
    const diagnostic = JSON.stringify(sanitizeDiagnosticError(error, ""));
    for (const fact of ["AI_OUTPUT_LIMIT", "finish=length", "max_output_tokens=64", "req_probe_fixture", "HTTP 200"])
      expect(diagnostic).toContain(fact);
    expect(diagnostic).not.toContain("private thought");
    expect(request).toHaveBeenCalledOnce();
  });
});
