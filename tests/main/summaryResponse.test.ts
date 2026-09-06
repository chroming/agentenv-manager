import { describe, expect, it } from "vitest";
import { parseSummaryResponse } from "../../src/main/skillSummaries/summaryResponse";

const valid = { overview: "Changed workflow", items: [{ category: "usage", fact: "New step", implication: "Review it", paths: ["SKILL.md"] }] };
const envelope = (content: string, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content } }] });
describe("summary response diagnostics", () => {
  it.each([
    [envelope("private body"), "invalid JSON"],
    [envelope(JSON.stringify({ overview: "private body", items: "bad" })), "items: invalid_type"],
    [envelope("private body", "content_filter"), "filtered"],
    [envelope("private body", "unexpected-private-reason"), "did not report a completed"],
    [{}, "invalid Chat Completions response"]
  ])("reports the failure category without logging content", (response, expected) => {
    let error = "";
    try { parseSummaryResponse(response, ["SKILL.md"]); } catch (caught) { error = String(caught); }
    expect(error).toContain(expected);
    expect(error).not.toContain("private body");
    expect(error).not.toContain("unexpected-private-reason");
  });
  it("does not let fenced JSON bypass file evidence validation", () => {
    const bad = { ...valid, items: [{ ...valid.items[0], paths: ["not-supplied.md"] }] };
    expect(() => parseSummaryResponse(envelope(`\u0060\u0060\u0060json\n${JSON.stringify(bad)}\n\u0060\u0060\u0060`), ["SKILL.md"])).toThrow("invalid file references");
  });
  it("treats null usage as unavailable instead of rejecting valid content", () => {
    const result = parseSummaryResponse({ ...envelope(JSON.stringify(valid)), usage: { prompt_tokens: null, completion_tokens: null } }, ["SKILL.md"]);
    expect(result.parsed).toEqual(valid);
    expect(result.usage).toBeUndefined();
  });
});
