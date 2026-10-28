import { describe, expect, it } from "vitest";
import { parseAnalysisResponse } from "../../src/main/ai/analysisResponse";

const response = (content: string, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content } }] });
const analysis = { overview: "Keep local edits", findings: [{ category: "risk", detail: "Unsaved work", evidence: ["state"] }] };

describe("analysis response boundaries", () => {
  it("accepts fenced JSON and optional empty fields without an extra request", () => {
    const parsed = parseAnalysisResponse(response(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``), ["state"]);
    expect(parsed.findings[0]).toMatchObject({ evidence: ["state"], suggestion: "" });
    expect(parsed.limitations).toEqual([]);
  });
  it("normalizes exact evidence formatting but never guesses references", () => {
    const parsed = parseAnalysisResponse(response(JSON.stringify({ ...analysis, findings: [
      { ...analysis.findings[0], category: " Risk ", evidence: [" `state` ", "State document", "state"] }
    ] })), ["state"]);
    expect(parsed.findings[0]).toMatchObject({ category: "risk", evidence: ["state"], evidenceStatus: "unverified" });
  });
  it.each([{ evidence: [] }, { evidence: ["unknown"] }])("marks missing or unverifiable evidence without discarding the finding", ({ evidence }) => {
    const parsed = parseAnalysisResponse(response(JSON.stringify({ ...analysis, findings: [{ ...analysis.findings[0], evidence }] })), ["state"]);
    expect(parsed.findings[0]).toMatchObject({ evidence: [], evidenceStatus: "unverified" });
  });
  it.each(["length", "content_filter", "tool_calls"])("rejects unfinished responses (%s)", (reason) => {
    expect(() => parseAnalysisResponse(response(reason === "length" ? '{"overview":"unfinished"' : JSON.stringify(analysis), reason), ["state"])).toThrow("Previous results are kept");
  });
  it("reports schema paths without exposing model content in diagnostics", () => {
    expect(() => parseAnalysisResponse(response(JSON.stringify({ ...analysis, findings: "private-secret" })), ["state"]))
      .toThrow("findings: invalid_type");
    expect(() => parseAnalysisResponse(response("not JSON"), ["state"])).toThrow("invalid JSON");
  });
});
