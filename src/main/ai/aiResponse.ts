import { z } from "zod";
import type { AIResponseIssue } from "../../shared/aiReliability";

export const resultQualityShape = {
  responseIssues: z.array(z.enum(["unclassified", "invalid-items", "truncated"])).max(3).optional(),
  unparsedOutput: z.string().max(128_000).optional()
};
const envelopeSchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(),
  message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }) })).min(1), usage: z.unknown().optional() });

export function decodeAIResponse(response: unknown) {
  const envelope = envelopeSchema.safeParse(response);
  if (!envelope.success) throw new Error("AI service returned an invalid Chat Completions response. Previous results are kept; retry manually.");
  const choice = envelope.data.choices[0];
  if (choice.message.refusal || choice.finish_reason === "content_filter") throw new Error("AI service filtered the response. Previous results are kept.");
  if (choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") throw new Error("AI service returned tool calls instead of analysis. No tools were executed. Previous results are kept.");
  if (choice.finish_reason !== "stop" && choice.finish_reason !== "length") throw new Error("AI service did not report a completed response. Previous results are kept; retry manually.");
  const content = choice.message.content?.trim() ?? "";
  if (!content) throw new Error("AI service returned an empty response. Previous results are kept; retry manually.");
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(content);
  let data: unknown;
  try { data = JSON.parse(fenced?.[1] ?? content); }
  catch { throw new Error(choice.finish_reason === "length"
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
