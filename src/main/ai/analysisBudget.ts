import type { AIAnalysisDocument } from "../../shared/aiAssistance";
import { redactSensitiveValues } from "../secretWarnings";
import { AI_INPUT_BYTES } from "./aiJsonClient";

export const analysisPayload = (documents: AIAnalysisDocument[], warnings: string[], partial: boolean) =>
  JSON.stringify({ documents, limitations: warnings, partial });

export const planAnalysisBudget = (input: { documents: AIAnalysisDocument[]; warnings: string[]; partial?: boolean }) => {
  // Reserve system/schema space and measure the content as it is escaped inside the HTTP JSON body.
  const warnings = input.warnings.map(redactSensitiveValues);
  const documents: AIAnalysisDocument[] = [];
  const limit = AI_INPUT_BYTES - 8192;
  let usedBytes = Buffer.byteLength(JSON.stringify(analysisPayload([], warnings, false)));
  // Array entries are additive after JSON escaping; exclude only the surrounding string quotes.
  const documentBytes = (doc: AIAnalysisDocument) => Buffer.byteLength(JSON.stringify(JSON.stringify(doc))) - 2;
  let truncated = 0;
  let omitted = 0;
  const redactedPrefixes = new Map<string, string[]>();
  if (usedBytes > limit) {
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
    const separatorBytes = documents.length > 0 ? 1 : 0;
    const remainingBytes = limit - usedBytes - separatorBytes;
    if (documentBytes(doc) > remainingBytes) {
      omitted += 1;
      continue;
    }
    const fits = (content: string) => documentBytes({ ...doc, content }) <= remainingBytes;
    let low = 0;
    let high = Math.min(text.length, 12000);
    if (fits(text.slice(0, high).join(""))) low = high;
    // Account for UTF-8, escaped JSON, labels and the envelope, not just character count.
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(text.slice(0, middle).join(""))) low = middle;
      else high = middle - 1;
    }
    if (text.length > 0 && low === 0) {
      omitted += 1;
      continue;
    }
    doc.content = text.slice(0, low).join("");
    if (low < text.length || prefix.length < original.content.length) truncated += 1;
    documents.push(doc);
    usedBytes += documentBytes(doc) + separatorBytes;
  }
  return { documents, warnings, partial: Boolean(input.partial) || truncated > 0 || omitted > 0,
    coverage: { total: input.documents.length, included: documents.length, truncated, omitted } };
};
