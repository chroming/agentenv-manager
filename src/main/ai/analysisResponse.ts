import { z } from "zod";

export const analysisOutputSchema = z.object({
  overview: z.string().max(1600),
  findings: z.array(z.object({
    category: z.preprocess((value) => typeof value === "string" ? value.trim().toLowerCase() : value, z.enum(["observation", "suggestion", "risk"])),
    title: z.string().max(120).optional(), detail: z.string().max(1600),
    suggestion: z.string().max(1600).nullish().transform((value) => value ?? ""),
    evidence: z.preprocess((value) => typeof value === "string" ? [value] : value ?? [], z.array(z.string().max(256)).max(12)),
    evidenceStatus: z.literal("unverified").optional()
  })).max(20),
  limitations: z.array(z.string().max(800)).max(10).default([])
});

export function parseAnalysisResponse(response: unknown, ids: string[]) {
  const fail = (reason: string): never => { throw new Error(`${reason}. Previous results are kept; retry manually.`); };
  const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional() }) })).min(1) }).safeParse(response);
  if (!envelope.success) return fail("AI returned an invalid response envelope");
  const choice = envelope.data.choices[0];
  if (choice.finish_reason === "length") return fail("AI analysis was truncated by the service");
  if (choice.finish_reason !== "stop") return fail("AI analysis did not finish normally");
  const content = choice.message.content?.trim();
  if (!content) return fail("AI returned an empty analysis");
  let json: unknown;
  try { json = JSON.parse(content.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1")); }
  catch { return fail("AI returned invalid analysis JSON"); }
  const parsed = analysisOutputSchema.safeParse(json);
  if (!parsed.success) return fail(`AI analysis has invalid fields (${parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.code}`).join(", ")})`);
  const allowed = new Set(ids);
  return { ...parsed.data, findings: parsed.data.findings.map((finding) => {
    const references = finding.evidence.map((id) => id.trim().replace(/^`([^`]+)`$/, "$1"));
    const evidence = [...new Set(references.filter((id) => allowed.has(id)))];
    const unverified = !references.length || references.some((id) => !allowed.has(id));
    return { ...finding, evidence, ...(unverified ? { evidenceStatus: "unverified" as const } : {}) };
  }) };
}
