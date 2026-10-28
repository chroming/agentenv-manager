import { describe, expect, it, vi } from "vitest";
import { createAIJsonClient } from "../../src/main/ai/aiJsonClient";

describe("AI Chat Completions address resolution", () => {
  const input = { endpoint: "https://example.test/v1", model: "fixture", key: "fixture-secret", system: "Return JSON", content: "{}", signal: new AbortController().signal };
  it("keeps a billed result even if a progress observer closes", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{"choices":[]}'));
    await expect(createAIJsonClient(transport)({ ...input, onProgress: () => { throw new Error("observer closed"); } })).resolves.toEqual({ choices: [] });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, { error: { code: "invalid_api_key" } }, "AI_AUTH"],
    [403, {}, "AI_PERMISSION"], [402, {}, "AI_QUOTA"], [429, { error: { code: "rate_limit_exceeded" } }, "AI_RATE_LIMIT"],
    [503, {}, "AI_UNAVAILABLE"],
    [400, { error: { code: "unsupported_parameter", param: "response_format" } }, "AI_PARAMETERS"]
  ])("classifies HTTP %s without additional calls", async (status, body, code) => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { "x-request-id": "req_test" } }));
    await expect(createAIJsonClient(transport)(input)).rejects.toMatchObject({ code, status, requestId: "req_test" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("keeps body disconnections actionable and does not expose the low-level error", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("private-error-body")); } }), { headers: { "x-request-id": "req_body" } }));
    const failure = createAIJsonClient(transport)(input);
    await expect(failure).rejects.toMatchObject({ code: "AI_INTERRUPTED", requestId: "req_body" });
    await expect(failure).rejects.not.toThrow("private-error-body");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("counts escaped content, system instructions and the envelope before sending", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(createAIJsonClient(transport)({ ...input, content: "\\\"".repeat(35_000) })).rejects.toThrow("No request was sent");
    await expect(createAIJsonClient(transport)({ ...input, system: "x".repeat(96_000) })).rejects.toThrow("No request was sent");
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not send an already cancelled request", async () => {
    const transport = vi.fn<typeof fetch>(); const controller = new AbortController(); controller.abort();
    await expect(createAIJsonClient(transport)({ ...input, signal: controller.signal })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("bounds responses and does not let cancellation errors hide a usable response", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"choices":[]}')); controller.close(); }, cancel() { throw new Error("private-cancel"); } })));
    await expect(createAIJsonClient(transport)(input)).resolves.toEqual({ choices: [] });
    const large = vi.fn<typeof fetch>(async () => new Response("x".repeat(128_001)));
    await expect(createAIJsonClient(large)(input)).rejects.toMatchObject({ code: "AI_RESPONSE_SIZE" });
  });
  it.each([
    ["https://api.openai.com/v1", "gpt-5-mini", "max_completion_tokens", "json_schema"],
    ["https://api.openai.com/v1", "gpt-4o-2024-05-13", "max_tokens", "json_object"],
    ["https://api.openai.com/v1", "gpt-4.1-mini", "max_tokens", "json_schema"],
    ["https://example.test/v1", "gpt-5-mini", "max_tokens", "json_object"]
  ])("adapts known models without guessing custom service support: %s %s", async (endpoint, model, tokenParameter, format) => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{"choices":[]}'));
    await createAIJsonClient(transport)({ ...input, endpoint, model, outputSchema: { name: "fixture", schema: { type: "object" } } });
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body[tokenParameter]).toBe(2500);
    expect(body.response_format.type).toBe(format);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("distinguishes quota errors and keeps safe request metadata without leaking provider text", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "private-provider-detail" } }),
      { status: 429, headers: { "x-request-id": "req_fixture", "retry-after": "3" } }));
    let caught: unknown;
    try { await createAIJsonClient(transport)({ endpoint: "https://example.test/v1", model: "fixture", key: "fixture", system: "JSON", content: "{}", signal: new AbortController().signal }); }
    catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "AI_QUOTA", requestId: "req_fixture", retryAfterMs: 3000 });
    expect(String(caught)).not.toContain("private-provider-detail");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["https://api.deepseek.com/", "deepseek-v4-flash", true],
    ["https://api.deepseek.com/v1", "deepseek-v4-pro", true],
    ["https://example.test/v1", "deepseek-v4-flash", false],
    ["https://api.deepseek.com/", "another-model", false]
  ])("uses bounded non-thinking JSON output only for supported DeepSeek service/model: %s %s", async (endpoint, model, disableThinking) => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{"choices":[]}'));
    await createAIJsonClient(transport)({ endpoint, model, key: "fixture", system: "JSON", content: "{}", signal: new AbortController().signal });
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.thinking).toEqual(disableThinking ? { type: "disabled" } : undefined);
    expect(body.max_tokens).toBe(2500);
  });
  it.each([
    ["https://api.deepseek.com/", "https://api.deepseek.com/chat/completions"],
    ["https://example.test/v1", "https://example.test/v1/chat/completions"],
    ["https://example.test/v1/", "https://example.test/v1/chat/completions"],
    ["https://example.test/gateway/v1", "https://example.test/gateway/v1/chat/completions"],
    ["https://example.test/v1/chat/completions", "https://example.test/v1/chat/completions"],
    ["http://127.0.0.1:9000/custom-endpoint", "http://127.0.0.1:9000/custom-endpoint"],
    ["http://192.0.2.20:8080/v1", "http://192.0.2.20:8080/v1/chat/completions"],
    ["http://inference.internal:8000/v1", "http://inference.internal:8000/v1/chat/completions"]
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
