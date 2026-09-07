import { z } from "zod";
import type { createAIJsonClient } from "./aiJsonClient";

export const testAIService = async (
  credentials: { endpoint: string; key: string; model: string },
  request: ReturnType<typeof createAIJsonClient>
) => {
  const response = await request({ ...credentials, maxTokens: 64,
    system: 'Return only this JSON object: {"ok":true}.', content: "Connection test.",
    signal: AbortSignal.timeout(30_000) });
  try {
    const body = z.object({ choices: z.array(z.object({ finish_reason: z.literal("stop"),
      message: z.object({ content: z.string() }) })).min(1) }).parse(response);
    z.object({ ok: z.literal(true) }).parse(JSON.parse(body.choices[0].message.content));
  } catch {
    throw new Error("The service responded, but did not return the required JSON output. Check the model's JSON support.");
  }
};
