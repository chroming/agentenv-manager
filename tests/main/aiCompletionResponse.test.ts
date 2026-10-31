import { describe, expect, it, vi } from "vitest";
import { decodeAIResponse } from "../../src/main/ai/aiResponse";
import { createAIJsonClient } from "../../src/main/ai/aiJsonClient";
import { sanitizeDiagnosticError } from "../../src/main/diagnosticRedaction";
import { formatDiagnosticIssue } from "../../src/renderer/diagnostics";

const completion = (message: Record<string, unknown>, finish_reason: unknown = "stop", usage?: unknown) => ({
  choices: [{ finish_reason, message }], ...(usage ? { usage } : {})
});
const errorFrom = (response: unknown) => {
  try { decodeAIResponse(response); } catch (error) { return error; }
};
const report = (error: unknown) => formatDiagnosticIssue({
  reference: "AEM-FIXTURE", action: "ai:generate", occurredAt: "2026-10-31T00:00:00Z",
  category: "ai", events: [], error: sanitizeDiagnosticError(error, "")
});

describe("AI final-answer compatibility and diagnostics", () => {
  it("distinguishes output exhaustion from a genuinely empty completion without using reasoning as an answer", () => {
    const error = errorFrom(completion({ content: null, reasoning_content: "private reasoning" }, "length", {
      prompt_tokens: 1200, completion_tokens: 2500, completion_tokens_details: { reasoning_tokens: 2500 }
    }));
    expect(error).toMatchObject({ code: "AI_OUTPUT_LIMIT" });
    const diagnostic = report(error);
    expect(diagnostic).toContain("finish=length");
    expect(diagnostic).toContain("completion_tokens=2500");
    expect(diagnostic).toContain("reasoning_tokens=2500");
    expect(diagnostic).not.toContain("private reasoning");
  });

  it("reports a reasoning-only terminal response even when its reasoning contains valid analysis JSON", () => {
    const error = errorFrom(completion({ content: "", reasoning_content: '{"overview":"private abandoned draft","findings":[]}' }));
    expect(error).toMatchObject({ code: "AI_REASONING_ONLY" });
    expect(report(error)).toContain("reasoning_present=true");
    expect(report(error)).not.toContain("private abandoned draft");
    expect(errorFrom(completion({ content: null }, "stop", { completion_tokens_details: { reasoning_tokens: 100 } })))
      .toMatchObject({ code: "AI_REASONING_ONLY" });
  });

  it("identifies blank JSON-mode output separately from missing text", () => {
    const error = errorFrom(completion({ content: "   \n\t" }));
    expect(error).toMatchObject({ code: "AI_BLANK_OUTPUT" });
    expect(report(error)).toContain("content_characters=5");
    expect(report(error)).toContain("visible_characters=0");
    expect(errorFrom(completion({ content: null }))).toMatchObject({ code: "AI_EMPTY_OUTPUT" });
  });

  it("decodes final text parts without incorporating thinking parts", () => {
    const result = decodeAIResponse(completion({ content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: '{"overview":' },
      { type: "output_text", text: '"Final answer","findings":[]}' }
    ] }));
    expect(result.data).toEqual({ overview: "Final answer", findings: [] });
    expect(result.raw).not.toContain("private reasoning");
  });

  it("does not treat unsupported content or tool requests as final analysis", () => {
    expect(errorFrom(completion({ content: [{ type: "image", data: "private image" }] })))
      .toMatchObject({ code: "AI_RESPONSE_FORMAT" });
    expect(errorFrom(completion({ content: '{"ok":true}', tool_calls: [{ id: "private-tool", function: { arguments: "private arguments" } }] })))
      .toMatchObject({ code: "AI_TOOL_OUTPUT" });
    expect(errorFrom(completion({ content: [{ type: "refusal", refusal: "private refusal" }] })))
      .toMatchObject({ code: "AI_FILTERED" });
  });

  it("keeps final JSON at the output limit partial and rejects genuinely truncated JSON", () => {
    expect(decodeAIResponse(completion({ content: '{"ok":true}' }, "length")).responseIssues).toEqual(["truncated"]);
    expect(errorFrom(completion({ content: '{"ok":' }, "length"))).toMatchObject({ code: "AI_OUTPUT_LIMIT" });
  });

  it("copies safe HTTP and completion facts without the model, answer, prompt or key and does not retry", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ...completion({ content: null, reasoning_content: "private thought" }, "length", { completion_tokens: 2500 }),
      model: "private model"
    }), { headers: { "x-request-id": "req_fixture" } }));
    const response = await createAIJsonClient(transport)({ endpoint: "https://example.test/v1", model: "private model",
      key: "private key", system: "private instruction", content: "private document", signal: new AbortController().signal });
    const error = errorFrom(response);
    expect(error).toMatchObject({ code: "AI_OUTPUT_LIMIT", requestId: "req_fixture", status: 200 });
    const diagnostic = report(error);
    for (const fact of ["req_fixture", "HTTP 200", "max_output_tokens=2500", "format=json_object", "finish=length"])
      expect(diagnostic).toContain(fact);
    for (const secret of ["private thought", "private model", "private key", "private instruction", "private document"])
      expect(diagnostic).not.toContain(secret);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not copy arbitrary finish reasons or nonnumeric usage fields into diagnostic reports", () => {
    const error = errorFrom(completion({ content: null }, "private finish reason", {
      prompt_tokens: "private usage", completion_tokens: -1, completion_tokens_details: { reasoning_tokens: { secret: "private" } }
    }));
    expect(error).toMatchObject({ code: "AI_RESPONSE_INCOMPLETE" });
    const diagnostic = report(error);
    expect(diagnostic).toContain("finish=other");
    expect(diagnostic).not.toContain("private");
    expect(diagnostic).not.toContain("completion_tokens=-1");
    const malformed = errorFrom(completion({ content: null }, { toString: "private value" }));
    expect(malformed).toMatchObject({ code: "AI_RESPONSE_FORMAT" });
    expect(report(malformed)).toContain("finish=other");
    expect(report(malformed)).not.toContain("private value");
  });
});
