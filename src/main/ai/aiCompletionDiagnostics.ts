import { AIRequestError } from "./aiRequestError";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const metadata = new WeakMap<object, { requestId?: string; status: number; maxTokens: number; format: "json_object" | "json_schema" }>();

export function rememberAICompletion(response: unknown, facts: { requestId?: string; status: number; maxTokens: number; format: "json_object" | "json_schema" }) {
  if (response !== null && typeof response === "object") metadata.set(response, facts);
}

export function readAIFinalContent(message: Record<string, unknown>, usage?: unknown) {
  const raw = message.content;
  let text = typeof raw === "string" ? raw : "";
  let supported = raw == null || typeof raw === "string" || Array.isArray(raw);
  let reasoning = nonempty(message.reasoning_content) || nonempty(message.reasoning) ||
    (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) ||
    (count(object(object(usage).completion_tokens_details).reasoning_tokens) ?? 0) > 0;
  let refusal = nonempty(message.refusal);
  let tools = (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) || message.function_call != null;
  if (message.refusal != null && typeof message.refusal !== "string") supported = false;
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const part = object(value);
      if ((part.type === "text" || part.type === "output_text") && typeof part.text === "string") text += part.text;
      else if (part.type === "thinking" || part.type === "reasoning") reasoning ||= nonempty(part.thinking) || nonempty(part.text);
      else if (part.type === "refusal") refusal = true;
      else if (part.type === "tool_use" || part.type === "tool_call") tools = true;
      else supported = false;
    }
  }
  return { text, supported, reasoning, refusal, tools };
}

export function aiCompletionFailure(response: unknown, code: string, message: string) {
  const root = object(response);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = object(choices[0]);
  const answer = object(choice.message);
  const content = readAIFinalContent(answer, root.usage);
  const usage = object(root.usage);
  const reason = choice.finish_reason;
  const finish = typeof reason === "string" && ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(reason)
    ? reason : reason == null ? "missing" : "other";
  const transport = response !== null && typeof response === "object" ? metadata.get(response) : undefined;
  const facts: Record<string, string | number | boolean | undefined> = {
    finish, choices: choices.length,
    content_kind: typeof answer.content === "string" ? "string" : Array.isArray(answer.content) ? "parts" : answer.content === null ? "null" : answer.content === undefined ? "missing" : "other",
    content_characters: content.text.length, visible_characters: content.text.trim().length,
    reasoning_present: content.reasoning, tool_calls_present: content.tools,
    prompt_tokens: count(usage.prompt_tokens), completion_tokens: count(usage.completion_tokens),
    reasoning_tokens: count(object(usage.completion_tokens_details).reasoning_tokens),
    max_output_tokens: count(transport?.maxTokens), format: transport?.format
  };
  const failure = new AIRequestError(message, code, transport?.requestId, transport?.status);
  // Only allowlisted structure and counters reach diagnostics; never copy provider text or reasoning.
  failure.cause = new Error(`AI completion metadata: ${Object.entries(facts).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`).join("; ")}`,
    failure.cause ? { cause: failure.cause } : undefined);
  return failure;
}
