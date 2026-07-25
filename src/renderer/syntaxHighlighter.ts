import type { HighlighterCore } from "shiki/core";
import type { ThemedToken } from "shiki";

export interface SyntaxToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

export type SyntaxLine = SyntaxToken[];
type SupportedLanguage =
  | "jsonc"
  | "json"
  | "toml"
  | "markdown"
  | "yaml"
  | "javascript"
  | "typescript"
  | "tsx"
  | "jsx"
  | "python"
  | "bash"
  | "diff"
  | "css"
  | "html"
  | "text";

const fallbackLine = (line: string): SyntaxLine => [{ content: line }];

const fallbackLines = (code: string): SyntaxLine[] => code.split("\n").map(fallbackLine);

let highlighterPromise: Promise<HighlighterCore> | undefined;

const getHighlighter = () => {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-light.mjs"),
    import("shiki/langs/jsonc.mjs"),
    import("shiki/langs/toml.mjs"),
    import("shiki/langs/md.mjs"),
    import("shiki/langs/yaml.mjs")
  ]).then(
    ([
      core,
      engine,
      githubLight,
      jsonc,
      toml,
      markdown,
      yaml
    ]) =>
      core.createHighlighterCore({
        themes: [githubLight.default],
        langs: [
          jsonc.default,
          toml.default,
          markdown.default,
          yaml.default
        ],
        engine: engine.createJavaScriptRegexEngine()
      })
  );

  return highlighterPromise;
};

export const languageForPath = (path: string): SupportedLanguage => {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith(".json") || lowerPath.endsWith(".jsonc")) {
    return "jsonc";
  }
  if (lowerPath.endsWith(".toml")) {
    return "toml";
  }
  if (lowerPath.endsWith(".md") || lowerPath.endsWith("agents.md")) {
    return "markdown";
  }
  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) {
    return "yaml";
  }

  return "text";
};

type LanguageRegistration = Parameters<HighlighterCore["loadLanguage"]>[0];
const loadedLanguages = new Set<SupportedLanguage>([
  "jsonc",
  "toml",
  "markdown",
  "yaml"
]);
const loadingLanguages = new Map<SupportedLanguage, Promise<void>>();
const additionalLanguageLoaders: Partial<Record<
  SupportedLanguage,
  () => Promise<{ default: LanguageRegistration }>
>> = {
  json: () => import("shiki/langs/json.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs")
};

const ensureLanguage = async (
  highlighter: HighlighterCore,
  language: SupportedLanguage
) => {
  if (language === "text" || loadedLanguages.has(language)) return;
  let loading = loadingLanguages.get(language);
  if (!loading) {
    const loader = additionalLanguageLoaders[language];
    if (!loader) return;
    loading = loader()
      .then((module) => highlighter.loadLanguage(module.default))
      .then(() => {
        loadedLanguages.add(language);
      })
      .finally(() => {
        loadingLanguages.delete(language);
      });
    loadingLanguages.set(language, loading);
  }
  await loading;
};

const languageAliases: Record<string, SupportedLanguage> = {
  bash: "bash",
  css: "css",
  diff: "diff",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  python: "python",
  py: "python",
  shell: "bash",
  sh: "bash",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "html",
  yaml: "yaml",
  yml: "yaml"
};

export const languageForFence = (value: string): SupportedLanguage =>
  languageAliases[value.trim().toLowerCase()] ?? "text";

export const highlightCodeLanguage = async (
  code: string,
  languageName: string
): Promise<SyntaxLine[]> => {
  if (code.length === 0) return [[]];
  const language = languageForFence(languageName);
  if (language === "text") return fallbackLines(code);
  try {
    const highlighter = await getHighlighter();
    await ensureLanguage(highlighter, language);
    const result = highlighter.codeToTokens(code, {
      lang: language,
      theme: "github-light"
    });
    return result.tokens.map((line: ThemedToken[]) =>
      line.map((token) => ({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle
      }))
    );
  } catch {
    return fallbackLines(code);
  }
};

export const highlightCode = async (
  code: string,
  path: string
): Promise<SyntaxLine[]> => {
  if (code.length === 0) {
    return [[]];
  }
  const language = languageForPath(path);
  if (language === "text") {
    return fallbackLines(code);
  }

  return highlightCodeLanguage(code, language);
};

export const highlightCodeFallback = (code: string): SyntaxLine[] => fallbackLines(code);
