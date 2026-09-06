import { z } from "zod";
import { SummarySchema } from "./summaryStore";

const OutputSchema = SummarySchema.pick({ overview: true, items: true });
const EnvelopeSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional(), reasoning_content: z.string().nullable().optional() }) })).min(1),
  usage: z.unknown().optional()
});
const fail = (reason: string): never => {
  throw new Error(`${reason} The previous summary is kept. No automatic retry was made; regenerate manually or review the original diff.`);
};

export const parseSummaryResponse = (response: unknown, suppliedPaths: string[]) => {
  const envelope = EnvelopeSchema.safeParse(response);
  if (!envelope.success) return fail("The AI service returned an invalid Chat Completions response.");
  const choice = envelope.data.choices[0];
  const content = choice.message.content?.trim() ?? "";
  const counts = `content characters: ${content.length}; reasoning characters: ${choice.message.reasoning_content?.length ?? 0}`;
  if (choice.finish_reason === "length") return fail(`The summary reached the model output limit (${counts}).`);
  if (choice.finish_reason === "content_filter") return fail("The AI service filtered the summary.");
  if (choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") return fail("The AI service returned tool calls instead of a summary. No tools were executed.");
  if (choice.finish_reason !== "stop") return fail("The AI service did not report a completed summary.");
  if (!content) return fail(`The AI service returned an empty summary (${counts}).`);
  // Some compatible services wrap otherwise valid JSON in a single code fence.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(content);
  let json: unknown;
  try { json = JSON.parse(fenced?.[1] ?? content); }
  catch { return fail(`The AI service returned invalid JSON (${counts}).`); }
  const parsed = OutputSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "summary"}: ${issue.code}`).join(", ");
    return fail(`The AI summary has invalid fields (${issues}).`);
  }
  const paths = new Set(suppliedPaths);
  const invalid = parsed.data.items.filter((item) => !item.paths.length || item.paths.some((path) => !paths.has(path))).length;
  if (invalid) return fail(`The summary contains invalid file references in ${invalid} findings. References must match the supplied changed files.`);
  // Optional billing metadata must not invalidate an otherwise valid summary.
  const usage = z.object({ prompt_tokens: z.number().nonnegative().optional(), completion_tokens: z.number().nonnegative().optional() }).safeParse(envelope.data.usage);
  return { parsed: parsed.data, usage: usage.success ? { inputTokens: usage.data.prompt_tokens, outputTokens: usage.data.completion_tokens } : undefined };
};
