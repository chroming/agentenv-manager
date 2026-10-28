import { describe, expect, it } from "vitest";
import { parseAnalysisResponse } from "../../src/main/ai/analysisResponse";
import { parseSummaryResponse } from "../../src/main/skillSummaries/summaryResponse";
import { evidenceIndex, referencesSchema } from "../../src/main/ai/aiResponse";

const envelope = (value: unknown, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] });
describe("AI response recovery", () => {
  it("does not generate oversized strict-schema enums for large inventories", () => {
    const schema = referencesSchema(Array.from({ length: 2000 }, (_, index) => `D${index}`));
    expect(schema.items).toEqual({ type: "string" });
    expect(parseAnalysisResponse(envelope({ overview: "Review", findings: [{ category: "risk", detail: "Unproven", evidence: ["D9999"] }] }), ["doc"]).findings[0].evidenceStatus).toBe("unverified");
  });
  it("avoids short-ID collisions with real file identities", () => {
    const aliases = evidenceIndex(["F1", "SKILL.md"], "F");
    expect([...aliases.keys()]).toEqual(["F_1", "F_2"]);
    expect(parseSummaryResponse(envelope({ overview: "Review", items: [{ category: "security", fact: "Check", paths: ["F_2"] }] }), ["F1", "SKILL.md"], aliases).parsed.items[0].paths).toEqual(["SKILL.md"]);
  });
  it("accepts null optional titles without discarding analysis", () => {
    const result = parseAnalysisResponse(envelope({ overview: "Review", findings: [
      { category: "risk", title: null, detail: "Exposes logs", suggestion: null, evidence: ["doc"] }
    ] }), ["doc"]);
    expect(result.findings).toEqual([{ category: "risk", detail: "Exposes logs", suggestion: "", evidence: ["doc"] }]);
  });
  it("preserves an unknown category without claiming it is an ordinary safe change", () => {
    const result = parseSummaryResponse(envelope({ overview: "Changed", items: [
      { category: "usage", fact: "New workflow", implication: null, paths: ["SKILL.md"] },
      { category: "unexpected", fact: "Potential exposure", paths: ["SKILL.md"] }
    ] }), ["SKILL.md"]);
    expect(result.parsed.items.map((item) => item.category)).toEqual(["usage", "unclassified"]);
    expect(result.parsed.responseIssues).toContain("unclassified");
  });
  it("retains valid findings and makes malformed entries inspectable", () => {
    const result = parseAnalysisResponse(envelope({ overview: "Review", findings: [
      { category: "observation", detail: "Valid", evidence: ["doc"] },
      { category: "risk", detail: { nested: "Cannot display" } }
    ] }), ["doc"]);
    expect(result.findings).toHaveLength(1);
    expect(result.responseIssues).toContain("invalid-items");
    expect(result.unparsedOutput).toContain("Cannot display");
  });
  it("marks complete JSON at the output limit as incomplete instead of losing all content", () => {
    const result = parseAnalysisResponse(envelope({ overview: "Review", findings: [] }, "length"), []);
    expect(result.responseIssues).toContain("truncated");
  });
});
