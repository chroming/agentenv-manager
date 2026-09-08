import type { AIAnalysisDocument } from "../../shared/aiAssistance";
import { redactSensitiveValues } from "../secretWarnings";
import { AI_INPUT_BYTES } from "./aiJsonClient";

export const analysisPayload = (documents: AIAnalysisDocument[], warnings: string[], partial: boolean) =>
  JSON.stringify({ documents, limitations: warnings, partial });

export const planAnalysisBudget = (input: { documents: AIAnalysisDocument[]; warnings: string[] }) => {
  const warnings = input.warnings.map(redactSensitiveValues);
  const documents: AIAnalysisDocument[] = [];
  let truncated = 0;
  let omitted = 0;
  const redactedPrefixes = new Map<string, string[]>();
  if (Buffer.byteLength(analysisPayload([], warnings, false)) > AI_INPUT_BYTES) {
    throw new Error("Analysis scope exceeds the size limit. Select fewer resources.");
  }
  for (const original of input.documents) {
    const prefix = Array.from(original.content.slice(0, 24000)).slice(0, 12000).join("");
    let text = redactedPrefixes.get(prefix);
    if (!text) {
      text = Array.from(redactSensitiveValues(prefix));
      redactedPrefixes.set(prefix, text);
    }
    const doc = { ...original, label: redactSensitiveValues(original.label), content: "" };
    let low = 0;
    let high = Math.min(text.length, 12000);
    // Account for UTF-8, escaped JSON, labels and the envelope, not just character count.
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { ...doc, content: text.slice(0, middle).join("") };
      if (Buffer.byteLength(analysisPayload([...documents, candidate], warnings, false)) <= AI_INPUT_BYTES) low = middle;
      else high = middle - 1;
    }
    if ((text.length > 0 && low === 0) || Buffer.byteLength(analysisPayload([...documents, doc], warnings, false)) > AI_INPUT_BYTES) {
      omitted += 1;
      continue;
    }
    doc.content = text.slice(0, low).join("");
    if (low < text.length || prefix.length < original.content.length) truncated += 1;
    documents.push(doc);
  }
  return { documents, warnings, partial: truncated > 0 || omitted > 0,
    coverage: { total: input.documents.length, included: documents.length, truncated, omitted } };
};
