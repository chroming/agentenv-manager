export interface AIOutputSchema { name: string; schema: Record<string, unknown> }

export function aiRequestProfile(endpoint: string, model: string, output?: AIOutputSchema) {
  const host = new URL(endpoint).hostname;
  const officialOpenAI = host === "api.openai.com";
  const reasoning = officialOpenAI && /^(?:o[1-9](?:-|$)|gpt-5(?:[.-]|$))/.test(model);
  const strict = officialOpenAI && /^(?:gpt-4o$|gpt-4o-mini(?:-|$)|gpt-4o-2024-(?:08-06|11-20)$|gpt-4\.1(?:-|$)|gpt-5(?:[.-]|$)|o[3-9](?:-|$))/.test(model);
  return {
    tokenParameter: reasoning ? "max_completion_tokens" : "max_tokens",
    responseFormat: output && strict ? { type: "json_schema", json_schema: { ...output, strict: true } } : { type: "json_object" },
    ...(host === "api.deepseek.com" && /^deepseek-v4-(flash|pro)(?:-|$)/.test(model) ? { thinking: { type: "disabled" } } : {})
  };
}
