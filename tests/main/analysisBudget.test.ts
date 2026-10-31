import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIAnalysisDocument } from "../../src/shared/aiAssistance";
import { AI_INPUT_BYTES } from "../../src/main/ai/aiJsonClient";
import { analysisPayload, planAnalysisBudget } from "../../src/main/ai/analysisBudget";
import { redactSensitiveValues } from "../../src/main/secretWarnings";

afterEach(() => vi.restoreAllMocks());

// Keep the original whole-envelope calculation as an independent parity oracle.
const referencePlan = (input: { documents: AIAnalysisDocument[]; warnings: string[]; partial?: boolean }) => {
  const fits = (documents: AIAnalysisDocument[], warnings: string[]) =>
    Buffer.byteLength(JSON.stringify(analysisPayload(documents, warnings, false))) <= AI_INPUT_BYTES - 8192;
  const warnings = input.warnings.map(redactSensitiveValues);
  const documents: AIAnalysisDocument[] = [];
  let truncated = 0;
  let omitted = 0;
  if (!fits([], warnings)) throw new Error("Analysis scope exceeds the size limit. Select fewer resources.");
  for (const original of input.documents) {
    const prefix = Array.from(original.content.slice(0, 24000)).slice(0, 12000).join("");
    const text = Array.from(redactSensitiveValues(prefix));
    const doc = { ...original, label: redactSensitiveValues(original.label), content: "" };
    let low = 0;
    let high = Math.min(text.length, 12000);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits([...documents, { ...doc, content: text.slice(0, middle).join("") }], warnings)) low = middle;
      else high = middle - 1;
    }
    if ((text.length > 0 && low === 0) || !fits([...documents, doc], warnings)) {
      omitted += 1;
      continue;
    }
    doc.content = text.slice(0, low).join("");
    if (low < text.length || prefix.length < original.content.length) truncated += 1;
    documents.push(doc);
  }
  return { documents, warnings, partial: Boolean(input.partial) || truncated > 0 || omitted > 0,
    coverage: { total: input.documents.length, included: documents.length, truncated, omitted } };
};

describe("analysis input budget", () => {
  it("serializes the whole envelope only once regardless of document count", () => {
    const stringify = vi.spyOn(JSON, "stringify");
    const result = planAnalysisBudget({ documents: Array.from({ length: 250 }, (_, index) => ({
      id: String(index), label: `File ${index}`, content: "x".repeat(2000)
    })), warnings: [] });
    const envelopeCalls = stringify.mock.calls.filter(([value]) =>
      value && typeof value === "object" && "documents" in value).length;
    stringify.mockRestore();
    expect(envelopeCalls).toBe(1);
    expect(result.coverage.total).toBe(250);
    expect(result.coverage.omitted).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(analysisPayload(result.documents, result.warnings, result.partial))))
      .toBeLessThanOrEqual(AI_INPUT_BYTES - 8192);
  });

  it.each([
    { documents: [], warnings: [] },
    { documents: [{ id: "empty", label: "Empty", content: "" }], warnings: [], partial: true },
    { documents: Array.from({ length: 18 }, (_, index) => ({
      id: `${index}\"\\`, label: `File ${index}\n`,
      content: index % 3 === 0 ? "" : 'Line\n\t\\\"'.repeat(1600)
    })), warnings: ["Some files are unavailable."] },
    { documents: Array.from({ length: 18 }, (_, index) => ({
      id: String(index), label: `文件 ${index}`, content: "中文\u{1F600}".repeat(3500)
    })), warnings: ["凭据已省略。"] },
    { documents: [{ id: "long-label", label: "!".repeat(AI_INPUT_BYTES), content: "" },
      { id: "secret", label: "Configuration", content: 'password="fixture-secret"\npublic=true\n' }], warnings: [] }
  ])("preserves the exact original selection, truncation, redaction and coverage %#", (input) => {
    expect(planAnalysisBudget(input)).toEqual(referencePlan(input));
  });

  it("rejects an oversized warnings envelope even when no documents are supplied", () => {
    expect(() => planAnalysisBudget({ documents: [], warnings: ["!".repeat(AI_INPUT_BYTES)] }))
      .toThrow("Analysis scope exceeds the size limit");
  });
});
