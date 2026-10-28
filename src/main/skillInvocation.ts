import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMap, parseDocument } from "yaml";
import { supportsManualSkillInvocation, usesCodexSkillInvocation, type SkillInvocationMode } from "../shared/skillInvocation";
import { hashSkillContent } from "./skillContentHash";
import { isMissingFileError } from "./fileUtils";

export const manualInvocationContent = (content: string): string => {
  const match = content.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---(?:[\t ]*\r?\n|[\t ]*$)/);
  if (!match) throw new Error("Manual invocation requires a valid SKILL.md frontmatter mapping");
  const document = parseDocument(match[1]);
  if (document.errors.length || !isMap(document.contents)) {
    throw new Error("Manual invocation requires a valid SKILL.md frontmatter mapping");
  }
  if (document.get("disable-model-invocation") === true && document.get("user-invocable") !== false) return content;
  document.set("disable-model-invocation", true);
  // An author may have hidden the slash command; manual-only must remain usable.
  if (document.get("user-invocable") === false) document.set("user-invocable", true);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return `---${newline}${document.toString().replace(/\r?\n/g, newline)}---${newline}${content.slice(match[0].length)}`;
};

export const codexManualInvocationContent = (content = ""): string => {
  const document = parseDocument(content);
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) {
    throw new Error("Codex manual invocation requires a valid agents/openai.yaml mapping. Review this file before Apply.");
  }
  if (document.has("policy") && !isMap(document.get("policy", true))) {
    throw new Error("Codex agents/openai.yaml policy must be a mapping. Review this file before Apply.");
  }
  if (document.getIn(["policy", "allow_implicit_invocation"]) === false) return content;
  document.setIn(["policy", "allow_implicit_invocation"], false);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return document.toString().replace(/\r?\n/g, newline);
};

export const skillInvocationOverrides = async (
  sourceDir: string,
  targetId: string,
  mode?: SkillInvocationMode
): Promise<ReadonlyMap<string, Buffer>> => {
  if (mode !== "manual") return new Map();
  if (!supportsManualSkillInvocation(targetId)) {
    throw new Error("This Agent does not support manual-only Skills. Choose Default invocation or turn off the Skill before Apply.");
  }
  if (usesCodexSkillInvocation(targetId)) {
    let content: string | undefined;
    try { content = await readFile(join(sourceDir, "agents", "openai.yaml"), "utf8"); }
    catch (error) { if (!isMissingFileError(error)) throw error; }
    return new Map([["agents/openai.yaml", Buffer.from(codexManualInvocationContent(content))]]);
  }
  return new Map([["SKILL.md", Buffer.from(manualInvocationContent(await readFile(join(sourceDir, "SKILL.md"), "utf8")))]]);
};

export const hashInvokedSkill = async (sourceDir: string, targetId: string, mode?: SkillInvocationMode) =>
  hashSkillContent(sourceDir, { fileOverrides: await skillInvocationOverrides(sourceDir, targetId, mode) });

export const writeSkillInvocationOverrides = async (staging: string, overrides: ReadonlyMap<string, Buffer>) => {
  for (const [path, content] of overrides) {
    const destination = join(staging, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
};
