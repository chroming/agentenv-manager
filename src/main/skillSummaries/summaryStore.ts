import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeAtomic } from "../fileUtils";
import type { GitHubTokenCipher } from "../githubAuthService";
import type { SkillSummary, SkillSummaryConfigInput } from "../../shared/skillSummaries";

export const summaryKey = (skillId: string, beforeHash: string, afterHash: string) =>
  createHash("sha256").update(JSON.stringify([skillId, beforeHash, afterHash])).digest("hex");

export const SummarySchema = z.object({
  schemaVersion: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/),
  skillId: z.string(), beforeHash: z.string(), afterHash: z.string(),
  generatedAt: z.string(), model: z.string(), overview: z.string().max(1500),
  items: z.array(z.object({
    category: z.enum(["important", "usage", "security", "other"]),
    fact: z.string().max(1500), implication: z.string().max(1500),
    paths: z.array(z.string()).max(20)
  })).max(30),
  coverage: z.enum(["complete", "partial"]), omittedPaths: z.array(z.string()),
  redacted: z.boolean(),
  files: z.array(z.object({ path: z.string(), diff: z.string() })),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()
});

const ConfigSchema = z.object({ endpoint: z.string().max(2048), model: z.string().trim().min(1).max(150), encryptedKey: z.string() });
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

export const validateSummaryEndpoint = (value: string) => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Use an HTTPS API endpoint without credentials, query or fragment (HTTP is allowed only on localhost).");
  }
  return url.href;
};

export const createSummaryStore = (root: string, cipher: GitHubTokenCipher) => {
  const dir = join(root, "skill-update-summaries");
  const skillDir = (id: string) => join(dir, createHash("sha256").update(id).digest("hex"));
  const configPath = join(root, "skill-summary-service.json");
  const privateWrite = async (path: string, value: unknown) => {
    await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  };
  const readConfig = async () => {
    try { return ConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8"))); }
    catch (error) { if (missing(error)) return undefined; throw error; }
  };
  return {
    async config() {
      const config = await readConfig();
      return { endpoint: config?.endpoint ?? "https://api.openai.com/v1/chat/completions", model: config?.model ?? "", hasKey: Boolean(config?.encryptedKey) };
    },
    async saveConfig(input: SkillSummaryConfigInput) {
      const endpoint = validateSummaryEndpoint(input.endpoint);
      const current = await readConfig();
      const key = input.apiKey?.trim();
      if (key && !cipher.isEncryptionAvailable()) throw new Error("Secure storage is unavailable on this device");
      // Never forward an existing credential to a newly selected service.
      const encryptedKey = key ? cipher.encryptString(key).toString("base64")
        : input.apiKey === "" || current?.endpoint !== endpoint ? "" : current?.encryptedKey ?? "";
      await privateWrite(configPath, ConfigSchema.parse({ endpoint, model: input.model, encryptedKey }));
    },
    async credentials() {
      const config = await readConfig();
      if (!config) throw new Error("Configure Update summaries in Settings first.");
      if (config.encryptedKey && !cipher.isEncryptionAvailable()) throw new Error("Secure storage is unavailable on this device");
      return { ...config, key: config.encryptedKey ? cipher.decryptString(Buffer.from(config.encryptedKey, "base64")) : "" };
    },
    async read(key: string, skillId: string): Promise<SkillSummary | undefined> {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid summary key");
      try {
        const value = SummarySchema.parse(JSON.parse(await readFile(join(skillDir(skillId), `${key}.json`), "utf8")));
        if (value.key !== key || summaryKey(value.skillId, value.beforeHash, value.afterHash) !== key) throw new Error("Summary identity mismatch");
        return value;
      }
      catch (error) { if (missing(error)) return undefined; throw new Error("Saved summary could not be read. Original Skill files are unchanged."); }
    },
    async save(summary: SkillSummary) {
      SummarySchema.parse(summary);
      await mkdir(skillDir(summary.skillId), { recursive: true, mode: 0o700 });
      await privateWrite(join(skillDir(summary.skillId), `${summary.key}.json`), summary);
    },
    async history(skillId: string): Promise<SkillSummary[]> {
      let names: string[];
      try { names = await readdir(skillDir(skillId)); } catch (error) { if (missing(error)) return []; throw error; }
      const results: SkillSummary[] = [];
      for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
        const parsed = SummarySchema.safeParse(JSON.parse(await readFile(join(skillDir(skillId), name), "utf8")));
        if (parsed.success && parsed.data.skillId === skillId) results.push(parsed.data);
      }
      return results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    }
  };
};
