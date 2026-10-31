import { z } from "zod";
import type { AIResponseIssue } from "../../shared/aiReliability";
import { aiCompletionFailure, readAIFinalContent } from "./aiCompletionDiagnostics";

export const resultQualityShape = {
  responseIssues: z.array(z.enum(["unclassified", "invalid-items", "truncated"])).max(3).optional(),
  unparsedOutput: z.string().max(128_000).optional()
};
const envelopeSchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(),
  message: z.record(z.string(), z.unknown()) })).min(1), usage: z.unknown().optional() });

export function decodeAIResponse(response: unknown) {
  const envelope = envelopeSchema.safeParse(response);
  const fail = (code: string, message: string): never => { throw aiCompletionFailure(response, code, message); };
  if (!envelope.success) return fail("AI_RESPONSE_FORMAT", "AI service returned an invalid Chat Completions response. Previous results are kept; retry manually.");
  const choice = envelope.data.choices[0];
  const answer = readAIFinalContent(choice.message, envelope.data.usage);
  if (answer.refusal || choice.finish_reason === "content_filter") return fail("AI_FILTERED", "AI service filtered the response. Previous results are kept.");
  if (answer.tools || choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") return fail("AI_TOOL_OUTPUT", "AI service returned tool calls instead of analysis. No tools were executed. Previous results are kept.");
  if (!answer.supported) return fail("AI_RESPONSE_FORMAT", "AI service returned an unsupported final-answer format. Previous results are kept; check Chat Completions compatibility.");
  if (choice.finish_reason !== "stop" && choice.finish_reason !== "length") return fail("AI_RESPONSE_INCOMPLETE", "AI service did not report a completed response. Previous results are kept; retry manually.");
  const content = answer.text.trim();
  if (!content) {
    if (choice.finish_reason === "length") return fail("AI_OUTPUT_LIMIT", "The model reached its output limit before returning an analysis. Check the service's reasoning mode or output limit before retrying. Previous results are kept; no automatic retry was made.");
    if (answer.reasoning) return fail("AI_REASONING_ONLY", "The service returned reasoning but no final answer. Check the model's reasoning and JSON output settings before retrying. Previous results are kept; no automatic retry was made.");
    if (answer.text.length) return fail("AI_BLANK_OUTPUT", "The service returned only whitespace instead of a JSON answer. Check the model's JSON output support before retrying. Previous results are kept; no automatic retry was made.");
    return fail("AI_EMPTY_OUTPUT", "The service completed without a final answer. Check the service's model and output settings, or retry manually. Previous results are kept; no automatic retry was made.");
  }
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(content);
  let data: unknown;
  try { data = JSON.parse(fenced?.[1] ?? content); }
  catch { return fail(choice.finish_reason === "length" ? "AI_OUTPUT_LIMIT" : "AI_ANSWER_JSON", choice.finish_reason === "length"
    ? "AI response reached the model output limit and contains incomplete JSON. Previous results are kept; retry manually."
    : "AI service returned invalid JSON. Previous results are kept; retry manually."); }
  const responseIssues: AIResponseIssue[] = choice.finish_reason === "length" ? ["truncated"] : [];
  const usage = z.object({ prompt_tokens: z.number().nonnegative().optional(), completion_tokens: z.number().nonnegative().optional() }).safeParse(envelope.data.usage);
  return { data, raw: content, responseIssues, usage: usage.success ? { inputTokens: usage.data.prompt_tokens, outputTokens: usage.data.completion_tokens } : undefined };
}

export function parseAIItems<T>(values: unknown[], schema: z.ZodType<T>, limit: number) {
  const items: T[] = [];
  let invalid = values.length > limit;
  for (const value of values.slice(0, limit)) {
    const parsed = schema.safeParse(value);
    if (parsed.success) items.push(parsed.data);
    else invalid = true;
  }
  return { items, invalid };
}

export const invalidAIFields = (error: z.ZodError) => error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "response"}: ${issue.code}`).join(", ");

export function evidenceIndex(values: string[], prefix: string) {
  const unique = [...new Set(values)];
  while (unique.some((value) => new RegExp(`^${prefix}\\d+$`).test(value))) prefix += "_";
  return new Map(unique.map((value, index) => [`${prefix}${index + 1}`, value]));
}

export const jsonObjectSchema = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const stringSchema = { type: "string" };
// Strict output providers limit total enum values. Large scopes still use exact local validation.
export const referencesSchema = (ids: string[]) => ({ type: "array", items: ids.length > 0 && ids.length <= 900 ? { type: "string", enum: ids } : stringSchema });
